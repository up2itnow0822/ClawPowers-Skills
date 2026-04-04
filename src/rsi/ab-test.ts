/**
 * ClawPowers Agent — A/B Test Manager
 * Orchestrates A/B tests for RSI mutations.
 */

import { randomUUID } from 'node:crypto';
import type {
  RSIMutationExtended,
  SkillAggregateStats,
  ABTest,
  ABTestResult,
  ABTestDecision,
  TaskMetrics,
} from '../types.js';

const DEFAULT_MIN_SAMPLE_SIZE = 5;
const PROMOTION_THRESHOLD = 0.10;
const ROLLBACK_THRESHOLD = -0.10;

export class ABTestManager {
  private readonly tests: Map<string, ABTest> = new Map();
  private readonly results: Map<string, TaskMetrics[]> = new Map();

  startTest(
    mutation: RSIMutationExtended,
    baselineMetrics: SkillAggregateStats
  ): ABTest {
    const testId = randomUUID();

    const test: ABTest = {
      testId,
      mutationId: mutation.mutationId,
      skillName: mutation.skillName,
      baselineStats: baselineMetrics,
      variantStats: {
        skillName: mutation.skillName,
        totalInvocations: 0,
        successRate: 0,
        avgDurationMs: 0,
        trendDirection: 'stable',
      },
      sampleSize: 0,
      minSampleSize: DEFAULT_MIN_SAMPLE_SIZE,
      startedAt: new Date().toISOString(),
      status: 'running',
    };

    this.tests.set(testId, test);
    this.results.set(testId, []);
    return test;
  }

  recordResult(testId: string, taskMetrics: TaskMetrics): void {
    const test = this.tests.get(testId);
    if (!test) {
      throw new Error(`A/B test "${testId}" not found`);
    }
    if (test.status !== 'running') {
      throw new Error(`A/B test "${testId}" is not running (status: ${test.status})`);
    }

    const taskResults = this.results.get(testId) ?? [];
    taskResults.push(taskMetrics);
    this.results.set(testId, taskResults);

    // Update variant stats
    const successCount = taskResults.filter(t => t.outcome === 'success').length;
    const totalDuration = taskResults.reduce((sum, t) => sum + t.durationMs, 0);

    const updatedTest: ABTest = {
      ...test,
      sampleSize: taskResults.length,
      variantStats: {
        skillName: test.skillName,
        totalInvocations: taskResults.length,
        successRate: taskResults.length > 0 ? successCount / taskResults.length : 0,
        avgDurationMs: taskResults.length > 0 ? totalDuration / taskResults.length : 0,
        trendDirection: 'stable',
      },
    };

    this.tests.set(testId, updatedTest);
  }

  evaluateTest(testId: string): ABTestResult {
    const test = this.tests.get(testId);
    if (!test) {
      throw new Error(`A/B test "${testId}" not found`);
    }

    if (test.sampleSize < test.minSampleSize) {
      return {
        testId,
        decision: 'continue',
        improvement: 0,
        confidence: test.sampleSize / test.minSampleSize,
      };
    }

    const baselineRate = test.baselineStats.successRate;
    const variantRate = test.variantStats.successRate;

    const improvement = baselineRate > 0
      ? (variantRate - baselineRate) / baselineRate
      : variantRate > 0 ? 1 : 0;

    const confidence = Math.min(1, test.sampleSize / (test.minSampleSize * 2));

    let decision: ABTestDecision;
    if (improvement > PROMOTION_THRESHOLD) {
      decision = 'promote';
    } else if (improvement < ROLLBACK_THRESHOLD) {
      decision = 'rollback';
    } else {
      decision = 'continue';
    }

    // Update test status if decided
    if (decision === 'promote' || decision === 'rollback') {
      const updated: ABTest = {
        ...test,
        status: 'completed',
      };
      this.tests.set(testId, updated);
    }

    return {
      testId,
      decision,
      improvement,
      confidence,
    };
  }

  getActiveTests(): ABTest[] {
    const active: ABTest[] = [];
    for (const test of this.tests.values()) {
      if (test.status === 'running') {
        active.push(test);
      }
    }
    return active;
  }
}
