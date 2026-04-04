import { describe, it, expect, beforeEach } from 'vitest';
import { ABTestManager } from '../../src/rsi/ab-test.js';
import type { RSIMutationExtended, SkillAggregateStats, TaskMetrics, RSITierLabel } from '../../src/types.js';

function makeMutation(overrides: Partial<RSIMutationExtended> = {}): RSIMutationExtended {
  return {
    mutationId: 'mut-1',
    hypothesisId: 'hyp-1',
    skillName: 'tdd',
    tier: 'T1' as RSITierLabel,
    description: 'Increase retry count',
    originalValue: '3',
    mutatedValue: '5',
    status: 'applied',
    appliedAt: '2026-03-25T00:00:00.000Z',
    revertedAt: null,
    ...overrides,
  };
}

function makeBaselineStats(overrides: Partial<SkillAggregateStats> = {}): SkillAggregateStats {
  return {
    skillName: 'tdd',
    totalInvocations: 20,
    successRate: 0.6,
    avgDurationMs: 1000,
    trendDirection: 'stable',
    ...overrides,
  };
}

function makeTaskMetrics(overrides: Partial<TaskMetrics> = {}): TaskMetrics {
  return {
    taskId: 'task-1',
    timestamp: '2026-03-25T10:00:00.000Z',
    durationMs: 5000,
    stepCount: 3,
    stepsCompleted: 3,
    stepsFailed: 0,
    retryCount: 0,
    skillsUsed: ['tdd'],
    outcome: 'success',
    memoryEntriesCreated: 1,
    ...overrides,
  };
}

describe('ABTestManager', () => {
  let manager: ABTestManager;

  beforeEach(() => {
    manager = new ABTestManager();
  });

  it('starts a new A/B test', () => {
    const test = manager.startTest(makeMutation(), makeBaselineStats());

    expect(test.testId).toBeDefined();
    expect(test.mutationId).toBe('mut-1');
    expect(test.skillName).toBe('tdd');
    expect(test.sampleSize).toBe(0);
    expect(test.status).toBe('running');
  });

  it('records results for a test', () => {
    const test = manager.startTest(makeMutation(), makeBaselineStats());
    manager.recordResult(test.testId, makeTaskMetrics());

    const active = manager.getActiveTests();
    expect(active[0]!.sampleSize).toBe(1);
  });

  it('throws when recording for unknown test', () => {
    expect(() => manager.recordResult('nonexistent', makeTaskMetrics())).toThrow('not found');
  });

  it('continues when sample size is below minimum', () => {
    const test = manager.startTest(makeMutation(), makeBaselineStats());
    manager.recordResult(test.testId, makeTaskMetrics());

    const result = manager.evaluateTest(test.testId);
    expect(result.decision).toBe('continue');
    expect(result.confidence).toBeLessThan(1);
  });

  it('promotes when variant outperforms by >10%', () => {
    const test = manager.startTest(
      makeMutation(),
      makeBaselineStats({ successRate: 0.5 })
    );

    // Record 5+ successful results (high success rate > baseline + 10%)
    for (let i = 0; i < 6; i++) {
      manager.recordResult(test.testId, makeTaskMetrics({
        taskId: `task-${i}`,
        outcome: 'success',
      }));
    }

    const result = manager.evaluateTest(test.testId);
    expect(result.decision).toBe('promote');
    expect(result.improvement).toBeGreaterThan(0.1);
  });

  it('rolls back when variant underperforms by >10%', () => {
    const test = manager.startTest(
      makeMutation(),
      makeBaselineStats({ successRate: 0.9 })
    );

    // Record 5+ failed results (low success rate < baseline - 10%)
    for (let i = 0; i < 6; i++) {
      manager.recordResult(test.testId, makeTaskMetrics({
        taskId: `task-${i}`,
        outcome: 'failure',
      }));
    }

    const result = manager.evaluateTest(test.testId);
    expect(result.decision).toBe('rollback');
    expect(result.improvement).toBeLessThan(-0.1);
  });

  it('continues on marginal difference', () => {
    const test = manager.startTest(
      makeMutation(),
      makeBaselineStats({ successRate: 0.6 })
    );

    // Record mix of success/failure that's close to baseline
    for (let i = 0; i < 5; i++) {
      manager.recordResult(test.testId, makeTaskMetrics({
        taskId: `task-${i}`,
        outcome: i < 3 ? 'success' : 'failure',
      }));
    }

    const result = manager.evaluateTest(test.testId);
    expect(result.decision).toBe('continue');
  });

  it('tracks variant stats accurately', () => {
    const test = manager.startTest(makeMutation(), makeBaselineStats());

    manager.recordResult(test.testId, makeTaskMetrics({ outcome: 'success', durationMs: 1000 }));
    manager.recordResult(test.testId, makeTaskMetrics({ taskId: 'task-2', outcome: 'failure', durationMs: 2000 }));

    const active = manager.getActiveTests();
    expect(active[0]!.variantStats.totalInvocations).toBe(2);
    expect(active[0]!.variantStats.successRate).toBe(0.5);
    expect(active[0]!.variantStats.avgDurationMs).toBe(1500);
  });

  it('marks test as completed on promote', () => {
    const test = manager.startTest(
      makeMutation(),
      makeBaselineStats({ successRate: 0.4 })
    );

    for (let i = 0; i < 6; i++) {
      manager.recordResult(test.testId, makeTaskMetrics({
        taskId: `task-${i}`,
        outcome: 'success',
      }));
    }

    manager.evaluateTest(test.testId);

    const active = manager.getActiveTests();
    expect(active).toHaveLength(0);
  });

  it('marks test as completed on rollback', () => {
    const test = manager.startTest(
      makeMutation(),
      makeBaselineStats({ successRate: 0.9 })
    );

    for (let i = 0; i < 6; i++) {
      manager.recordResult(test.testId, makeTaskMetrics({
        taskId: `task-${i}`,
        outcome: 'failure',
      }));
    }

    manager.evaluateTest(test.testId);

    const active = manager.getActiveTests();
    expect(active).toHaveLength(0);
  });

  it('throws when recording result for completed test', () => {
    const test = manager.startTest(
      makeMutation(),
      makeBaselineStats({ successRate: 0.4 })
    );

    for (let i = 0; i < 6; i++) {
      manager.recordResult(test.testId, makeTaskMetrics({
        taskId: `task-${i}`,
        outcome: 'success',
      }));
    }

    manager.evaluateTest(test.testId); // Should promote and complete

    expect(() =>
      manager.recordResult(test.testId, makeTaskMetrics({ taskId: 'task-extra' }))
    ).toThrow('not running');
  });

  it('throws when evaluating unknown test', () => {
    expect(() => manager.evaluateTest('nonexistent')).toThrow('not found');
  });

  it('returns empty active tests initially', () => {
    const active = manager.getActiveTests();
    expect(active).toEqual([]);
  });

  it('uses default minSampleSize of 5', () => {
    const test = manager.startTest(makeMutation(), makeBaselineStats());
    expect(test.minSampleSize).toBe(5);
  });
});
