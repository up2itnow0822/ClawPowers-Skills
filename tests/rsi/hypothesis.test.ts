import { describe, it, expect } from 'vitest';
import { HypothesisEngine } from '../../src/rsi/hypothesis.js';
import type { SkillAggregateStats, TaskMetrics } from '../../src/types.js';

function makeTaskMetrics(overrides: Partial<TaskMetrics> = {}): TaskMetrics {
  return {
    taskId: 'task-1',
    timestamp: '2026-03-25T10:00:00.000Z',
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

function makeSkillStats(overrides: Partial<SkillAggregateStats> = {}): SkillAggregateStats {
  return {
    skillName: 'tdd',
    totalInvocations: 20,
    successRate: 0.8,
    avgDurationMs: 1000,
    trendDirection: 'stable',
    ...overrides,
  };
}

function makeTaskHistory(count: number): TaskMetrics[] {
  return Array.from({ length: count }, (_, i) =>
    makeTaskMetrics({ taskId: `task-${i}` })
  );
}

describe('HypothesisEngine', () => {
  const engine = new HypothesisEngine();

  it('returns empty when insufficient data points', () => {
    const stats = [makeSkillStats()];
    const history = makeTaskHistory(5); // < 10

    const hypotheses = engine.analyze(stats, history);
    expect(hypotheses).toEqual([]);
  });

  it('requires minimum 10 data points', () => {
    const stats = [makeSkillStats({ successRate: 0.3 })];
    const history = makeTaskHistory(9);

    const hypotheses = engine.analyze(stats, history);
    expect(hypotheses).toEqual([]);
  });

  it('detects low success rate skills', () => {
    const stats = [
      makeSkillStats({ skillName: 'flaky-skill', successRate: 0.4, totalInvocations: 10 }),
    ];
    const history = makeTaskHistory(15);

    const hypotheses = engine.analyze(stats, history);
    const lowSuccess = hypotheses.filter(h => h.skillName === 'flaky-skill' && h.tier === 'T1');
    expect(lowSuccess.length).toBeGreaterThanOrEqual(1);
    expect(lowSuccess[0]!.description).toContain('retry count');
  });

  it('skips skills with high success rate', () => {
    const stats = [
      makeSkillStats({ skillName: 'reliable-skill', successRate: 0.95, totalInvocations: 20 }),
    ];
    const history = makeTaskHistory(15);

    const hypotheses = engine.analyze(stats, history);
    const forReliable = hypotheses.filter(h => h.skillName === 'reliable-skill' && h.description.includes('retry'));
    expect(forReliable).toHaveLength(0);
  });

  it('detects slow skills', () => {
    const stats = [
      makeSkillStats({ skillName: 'fast-skill', avgDurationMs: 100, totalInvocations: 10 }),
      makeSkillStats({ skillName: 'medium-a', avgDurationMs: 400, totalInvocations: 10 }),
      makeSkillStats({ skillName: 'medium-b', avgDurationMs: 500, totalInvocations: 10 }),
      makeSkillStats({ skillName: 'slow-skill', avgDurationMs: 5000, totalInvocations: 10 }),
    ];
    const history = makeTaskHistory(15);

    const hypotheses = engine.analyze(stats, history);
    const slowHypotheses = hypotheses.filter(h => h.description.includes('timeout'));
    expect(slowHypotheses.length).toBeGreaterThanOrEqual(1);
    expect(slowHypotheses.some(h => h.skillName === 'slow-skill')).toBe(true);
  });

  it('detects frequently paired skills', () => {
    const history = Array.from({ length: 12 }, (_, i) =>
      makeTaskMetrics({
        taskId: `task-${i}`,
        skillsUsed: ['skill-a', 'skill-b'],
      })
    );
    const stats = [
      makeSkillStats({ skillName: 'skill-a' }),
      makeSkillStats({ skillName: 'skill-b' }),
    ];

    const hypotheses = engine.analyze(stats, history);
    const pairedHypotheses = hypotheses.filter(h => h.tier === 'T3');
    expect(pairedHypotheses.length).toBeGreaterThanOrEqual(1);
    expect(pairedHypotheses[0]!.description).toContain('chain');
  });

  it('detects skills unused in successful tasks', () => {
    const successHistory = Array.from({ length: 8 }, (_, i) =>
      makeTaskMetrics({
        taskId: `task-${i}`,
        outcome: 'success',
        skillsUsed: ['good-skill'],
      })
    );
    const failHistory = Array.from({ length: 4 }, (_, i) =>
      makeTaskMetrics({
        taskId: `task-fail-${i}`,
        outcome: 'failure',
        skillsUsed: ['bad-skill'],
      })
    );

    const history = [...successHistory, ...failHistory];
    const stats = [
      makeSkillStats({ skillName: 'bad-skill', totalInvocations: 10, successRate: 0.3 }),
    ];

    const hypotheses = engine.analyze(stats, history);
    const deprioritize = hypotheses.filter(h => h.description.includes('Deprioritizing'));
    expect(deprioritize.length).toBeGreaterThanOrEqual(1);
  });

  it('includes confidence scoring based on data volume', () => {
    const stats = [
      makeSkillStats({ skillName: 'flaky', successRate: 0.3, totalInvocations: 5 }),
    ];
    const history = makeTaskHistory(15);

    const hypotheses = engine.analyze(stats, history);
    const flaky = hypotheses.find(h => h.skillName === 'flaky');
    expect(flaky).toBeDefined();
    expect(flaky!.confidence).toBeGreaterThan(0);
    expect(flaky!.confidence).toBeLessThanOrEqual(1);
  });

  it('includes evidence in hypotheses', () => {
    const stats = [
      makeSkillStats({ skillName: 'flaky', successRate: 0.4, totalInvocations: 10 }),
    ];
    const history = makeTaskHistory(15);

    const hypotheses = engine.analyze(stats, history);
    const flaky = hypotheses.find(h => h.skillName === 'flaky');
    expect(flaky).toBeDefined();
    expect(flaky!.evidence.length).toBeGreaterThan(0);
  });
});
