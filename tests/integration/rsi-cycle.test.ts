/**
 * Integration Test: RSI Cycle
 * Tests the full recursive self-improvement loop: metrics → hypothesis → mutation → A/B test → promote/rollback.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MetricsCollector } from '../../src/rsi/metrics.js';
import { HypothesisEngine } from '../../src/rsi/hypothesis.js';
import { MutationEngine } from '../../src/rsi/mutation.js';
import { ABTestManager } from '../../src/rsi/ab-test.js';
import { RSIAuditLog } from '../../src/rsi/audit.js';
import type { TaskMetrics, SkillMetrics, RSIHypothesis, RSITierLabel } from '../../src/types.js';

function makeTaskMetrics(overrides: Partial<TaskMetrics> = {}): TaskMetrics {
  return {
    taskId: `task-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    durationMs: 5000,
    stepCount: 3,
    stepsCompleted: 3,
    stepsFailed: 0,
    retryCount: 0,
    skillsUsed: ['tdd', 'debugging'],
    outcome: 'success',
    memoryEntriesCreated: 1,
    ...overrides,
  };
}

function makeSkillMetrics(skillName: string, succeeded: boolean, overrides: Partial<SkillMetrics> = {}): SkillMetrics {
  return {
    skillName,
    timestamp: new Date().toISOString(),
    invoked: true,
    succeeded,
    durationMs: succeeded ? 1000 : 5000,
    taskId: `task-${Math.random().toString(36).slice(2, 8)}`,
    mutationActive: false,
    ...overrides,
  };
}

describe('RSI Cycle Integration', () => {
  let tmpDir: string;
  let metricsCollector: MetricsCollector;
  let hypothesisEngine: HypothesisEngine;
  let mutationEngine: MutationEngine;
  let abTestManager: ABTestManager;
  let auditLog: RSIAuditLog;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'rsi-integ-'));
    metricsCollector = new MetricsCollector(
      join(tmpDir, 'task-metrics.jsonl'),
      join(tmpDir, 'skill-metrics.jsonl')
    );
    hypothesisEngine = new HypothesisEngine();
    mutationEngine = new MutationEngine(join(tmpDir, 'mutations.jsonl'));
    abTestManager = new ABTestManager();
    auditLog = new RSIAuditLog(join(tmpDir, 'audit.jsonl'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('runs full cycle: record metrics → analyze → generate hypothesis → create mutation → A/B test → promote', async () => {
    // Record 15 task metrics with a struggling skill
    for (let i = 0; i < 15; i++) {
      await metricsCollector.recordTaskMetrics(makeTaskMetrics({
        skillsUsed: ['slow-skill', 'fast-skill'],
        outcome: i < 6 ? 'failure' : 'success',
      }));
      await metricsCollector.recordSkillMetrics(
        makeSkillMetrics('slow-skill', i >= 6)
      );
      await metricsCollector.recordSkillMetrics(
        makeSkillMetrics('fast-skill', true)
      );
    }

    // Get aggregated stats
    const slowStats = await metricsCollector.getAggregatedSkillStats('slow-skill');
    const fastStats = await metricsCollector.getAggregatedSkillStats('fast-skill');
    const taskHistory = await metricsCollector.getTaskHistory();

    // Generate hypotheses
    const hypotheses = hypothesisEngine.analyze([slowStats, fastStats], taskHistory);
    expect(hypotheses.length).toBeGreaterThan(0);

    // Create mutation from first hypothesis
    const hypothesis = hypotheses[0]!;
    const mutation = mutationEngine.createMutation(hypothesis);
    expect(mutation.status).toBe('proposed');

    // Apply mutation (T1 or T2)
    if (hypothesis.tier === 'T1' || hypothesis.tier === 'T2') {
      await mutationEngine.applyMutation(mutation);

      // Log to audit
      await auditLog.log({
        timestamp: new Date().toISOString(),
        action: 'mutation-applied',
        skillName: mutation.skillName,
        mutationId: mutation.mutationId,
        hypothesis: hypothesis.description,
        metrics: { baseline: slowStats.successRate, current: 0, delta: 0 },
        decision: 'applied',
      });

      // Start A/B test
      const test = abTestManager.startTest(mutation, slowStats);
      expect(test.status).toBe('running');

      // Record results showing improvement
      for (let i = 0; i < 6; i++) {
        abTestManager.recordResult(test.testId, makeTaskMetrics({ outcome: 'success' }));
      }

      const result = abTestManager.evaluateTest(test.testId);
      expect(result.decision).toBe('promote');

      // Log promotion
      await auditLog.log({
        timestamp: new Date().toISOString(),
        action: 'mutation-promoted',
        skillName: mutation.skillName,
        mutationId: mutation.mutationId,
        hypothesis: hypothesis.description,
        metrics: { baseline: slowStats.successRate, current: result.improvement, delta: result.improvement - slowStats.successRate },
        decision: 'promoted',
      });

      const auditHistory = await auditLog.getHistory();
      expect(auditHistory.length).toBe(2);
    }
  });

  it('T1 mutation: auto-applies without gate', async () => {
    const hypothesis: RSIHypothesis = {
      hypothesisId: 'hyp-t1',
      skillName: 'tdd',
      description: 'Increase retry count for tdd skill',
      expectedImprovement: 15,
      tier: 'T1',
      confidence: 0.8,
      evidence: ['Low success rate: 50%'],
    };

    const mutation = mutationEngine.createMutation(hypothesis);
    // T1 should auto-apply without error
    await expect(mutationEngine.applyMutation(mutation)).resolves.toBeUndefined();

    const history = await mutationEngine.getMutationHistory();
    expect(history.length).toBe(1);
    expect(history[0]!.status).toBe('applied');
  });

  it('T2 mutation: auto-applies with notification (logged)', async () => {
    const hypothesis: RSIHypothesis = {
      hypothesisId: 'hyp-t2',
      skillName: 'debugging',
      description: 'Change fallback order for debugging skill',
      expectedImprovement: 20,
      tier: 'T2',
      confidence: 0.7,
      evidence: ['Unused in successful tasks'],
    };

    const mutation = mutationEngine.createMutation(hypothesis);
    await mutationEngine.applyMutation(mutation);

    // Log notification
    await auditLog.log({
      timestamp: new Date().toISOString(),
      action: 'T2-auto-applied',
      skillName: mutation.skillName,
      mutationId: mutation.mutationId,
      hypothesis: hypothesis.description,
      metrics: { baseline: 0.5, current: 0, delta: 0 },
      decision: 'auto-applied with notification',
    });

    const audit = await auditLog.getHistory();
    expect(audit[0]!.action).toBe('T2-auto-applied');
  });

  it('T3 mutation: tracks test runs for promotion gate', async () => {
    const hypothesis: RSIHypothesis = {
      hypothesisId: 'hyp-t3',
      skillName: 'tdd+debugging',
      description: 'Create tdd+debugging skill chain',
      expectedImprovement: 25,
      tier: 'T3',
      confidence: 0.6,
      evidence: ['Co-occurrence: 8/15 tasks'],
    };

    const mutation = mutationEngine.createMutation(hypothesis);

    // T3 can be applied (not T4)
    await mutationEngine.applyMutation(mutation);

    // Simulate 3 passing A/B test runs
    const baselineStats = { skillName: 'tdd+debugging', totalInvocations: 10, successRate: 0.5, avgDurationMs: 3000, trendDirection: 'stable' as const };
    const test = abTestManager.startTest(mutation, baselineStats);

    // 3 successful results (above min sample size of 5)
    for (let i = 0; i < 5; i++) {
      abTestManager.recordResult(test.testId, makeTaskMetrics({ outcome: 'success' }));
    }

    const result = abTestManager.evaluateTest(test.testId);
    // With 100% success vs 50% baseline, should promote
    expect(result.decision).toBe('promote');
    expect(result.improvement).toBeGreaterThan(0);
  });

  it('T4 mutation: propose only, never auto-apply', async () => {
    const hypothesis: RSIHypothesis = {
      hypothesisId: 'hyp-t4',
      skillName: 'orchestrator',
      description: 'Restructure agent execution pipeline',
      expectedImprovement: 40,
      tier: 'T4',
      confidence: 0.5,
      evidence: ['Frequent retries in orchestration'],
    };

    const mutation = mutationEngine.createMutation(hypothesis);
    expect(mutation.status).toBe('proposed');

    // T4 must throw on auto-apply
    await expect(mutationEngine.applyMutation(mutation)).rejects.toThrow(
      'T4 mutations (Architecture) cannot be auto-applied'
    );
  });

  it('safety invariant: attempt to mutate spending limits → blocked', () => {
    const hypothesis: RSIHypothesis = {
      hypothesisId: 'hyp-safety',
      skillName: 'Spending limits and SpendingPolicy',
      description: 'Increase daily spending limit',
      expectedImprovement: 50,
      tier: 'T1',
      confidence: 0.9,
      evidence: ['Frequent payment rejections'],
    };

    expect(() => mutationEngine.createMutation(hypothesis)).toThrow(
      'Cannot create mutation targeting safety invariant'
    );
  });

  it('A/B test with clear winner → promotes mutation', async () => {
    const hypothesis: RSIHypothesis = {
      hypothesisId: 'hyp-winner',
      skillName: 'refactor',
      description: 'Optimize refactor skill timeout',
      expectedImprovement: 20,
      tier: 'T1',
      confidence: 0.8,
      evidence: ['Slow execution: 4000ms avg'],
    };

    const mutation = mutationEngine.createMutation(hypothesis);
    await mutationEngine.applyMutation(mutation);

    const baselineStats = { skillName: 'refactor', totalInvocations: 20, successRate: 0.6, avgDurationMs: 4000, trendDirection: 'stable' as const };
    const test = abTestManager.startTest(mutation, baselineStats);

    // All 5 succeed (vs 60% baseline)
    for (let i = 0; i < 5; i++) {
      abTestManager.recordResult(test.testId, makeTaskMetrics({ outcome: 'success' }));
    }

    const result = abTestManager.evaluateTest(test.testId);
    expect(result.decision).toBe('promote');
    expect(result.improvement).toBeGreaterThan(0.10);
  });

  it('A/B test with clear loser → rollback mutation', async () => {
    const hypothesis: RSIHypothesis = {
      hypothesisId: 'hyp-loser',
      skillName: 'deploy',
      description: 'Reduce deploy retries',
      expectedImprovement: 10,
      tier: 'T1',
      confidence: 0.6,
      evidence: ['Excessive retries'],
    };

    const mutation = mutationEngine.createMutation(hypothesis);
    await mutationEngine.applyMutation(mutation);

    const baselineStats = { skillName: 'deploy', totalInvocations: 20, successRate: 0.8, avgDurationMs: 2000, trendDirection: 'stable' as const };
    const test = abTestManager.startTest(mutation, baselineStats);

    // All 5 fail (vs 80% baseline) → clear regression
    for (let i = 0; i < 5; i++) {
      abTestManager.recordResult(test.testId, makeTaskMetrics({ outcome: 'failure' }));
    }

    const result = abTestManager.evaluateTest(test.testId);
    expect(result.decision).toBe('rollback');

    // Revert the mutation
    await mutationEngine.revertMutation(mutation);
    const history = await mutationEngine.getMutationHistory();
    const revertedEntry = history.find(m => m.mutationId === mutation.mutationId && m.status === 'reverted');
    expect(revertedEntry).toBeTruthy();
  });

  it('audit trail captures every action in the cycle', async () => {
    const actions = ['hypothesis-generated', 'mutation-created', 'mutation-applied', 'ab-test-started', 'ab-test-evaluated', 'mutation-promoted'];

    for (const action of actions) {
      await auditLog.log({
        timestamp: new Date().toISOString(),
        action,
        skillName: 'test-skill',
        mutationId: 'mut-audit',
        hypothesis: 'Test hypothesis',
        metrics: { baseline: 0.5, current: 0.8, delta: 0.3 },
        decision: action,
      });
    }

    const history = await auditLog.getHistory();
    expect(history).toHaveLength(6);
    expect(history.map(h => h.action)).toEqual(actions);

    // Filter by mutation
    const filtered = await auditLog.getByMutation('mut-audit');
    expect(filtered).toHaveLength(6);
  });

  it('min data points: hypothesis generation blocked with <10 data points', async () => {
    // Record only 5 task metrics (below MIN_DATA_POINTS=10)
    for (let i = 0; i < 5; i++) {
      await metricsCollector.recordTaskMetrics(makeTaskMetrics());
      await metricsCollector.recordSkillMetrics(makeSkillMetrics('tdd', true));
    }

    const stats = await metricsCollector.getAggregatedSkillStats('tdd');
    const taskHistory = await metricsCollector.getTaskHistory();
    expect(taskHistory.length).toBe(5);

    const hypotheses = hypothesisEngine.analyze([stats], taskHistory);
    expect(hypotheses).toHaveLength(0);
  });

  it('metrics trend detection works across sufficient data points', async () => {
    // Record skill metrics: first half failures, second half successes
    for (let i = 0; i < 10; i++) {
      await metricsCollector.recordSkillMetrics(
        makeSkillMetrics('trending-skill', i >= 5)
      );
    }

    const stats = await metricsCollector.getAggregatedSkillStats('trending-skill');
    expect(stats.trendDirection).toBe('improving');
    expect(stats.totalInvocations).toBe(10);
    expect(stats.successRate).toBe(0.5);
  });

  it('mutation history persists across engine instances', async () => {
    const historyPath = join(tmpDir, 'persist-mutations.jsonl');

    const engine1 = new MutationEngine(historyPath);
    const hypothesis: RSIHypothesis = {
      hypothesisId: 'hyp-persist',
      skillName: 'deploy',
      description: 'Adjust deploy timeout',
      expectedImprovement: 10,
      tier: 'T1',
      confidence: 0.7,
      evidence: ['Timeout errors'],
    };

    const mutation = engine1.createMutation(hypothesis);
    await engine1.applyMutation(mutation);

    // New engine instance reads from same file
    const engine2 = new MutationEngine(historyPath);
    const history = await engine2.getMutationHistory();
    expect(history).toHaveLength(1);
    expect(history[0]!.mutationId).toBe(mutation.mutationId);
  });
});
