import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MetricsCollector } from '../../src/rsi/metrics.js';
import type { TaskMetrics, SkillMetrics } from '../../src/types.js';

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

function makeSkillMetrics(overrides: Partial<SkillMetrics> = {}): SkillMetrics {
  return {
    skillName: 'tdd',
    timestamp: '2026-03-25T10:00:00.000Z',
    invoked: true,
    succeeded: true,
    durationMs: 1000,
    taskId: 'task-1',
    mutationActive: false,
    ...overrides,
  };
}

describe('MetricsCollector', () => {
  let tmpDir: string;
  let collector: MetricsCollector;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'metrics-'));
    collector = new MetricsCollector(
      join(tmpDir, 'tasks.jsonl'),
      join(tmpDir, 'skills.jsonl')
    );
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('records and retrieves task metrics', async () => {
    await collector.recordTaskMetrics(makeTaskMetrics());

    const history = await collector.getTaskHistory();
    expect(history).toHaveLength(1);
    expect(history[0]!.taskId).toBe('task-1');
  });

  it('records multiple task metrics', async () => {
    await collector.recordTaskMetrics(makeTaskMetrics({ taskId: 'task-1' }));
    await collector.recordTaskMetrics(makeTaskMetrics({ taskId: 'task-2' }));
    await collector.recordTaskMetrics(makeTaskMetrics({ taskId: 'task-3' }));

    const history = await collector.getTaskHistory();
    expect(history).toHaveLength(3);
  });

  it('limits task history', async () => {
    for (let i = 0; i < 10; i++) {
      await collector.recordTaskMetrics(makeTaskMetrics({ taskId: `task-${i}` }));
    }

    const history = await collector.getTaskHistory(3);
    expect(history).toHaveLength(3);
  });

  it('records and retrieves skill metrics', async () => {
    await collector.recordSkillMetrics(makeSkillMetrics());

    const history = await collector.getSkillHistory('tdd');
    expect(history).toHaveLength(1);
    expect(history[0]!.skillName).toBe('tdd');
  });

  it('filters skill history by skill name', async () => {
    await collector.recordSkillMetrics(makeSkillMetrics({ skillName: 'tdd' }));
    await collector.recordSkillMetrics(makeSkillMetrics({ skillName: 'debugging' }));
    await collector.recordSkillMetrics(makeSkillMetrics({ skillName: 'tdd', taskId: 'task-2' }));

    const history = await collector.getSkillHistory('tdd');
    expect(history).toHaveLength(2);
  });

  it('aggregates skill stats', async () => {
    await collector.recordSkillMetrics(makeSkillMetrics({ succeeded: true, durationMs: 1000 }));
    await collector.recordSkillMetrics(makeSkillMetrics({ succeeded: true, durationMs: 2000, taskId: 'task-2' }));
    await collector.recordSkillMetrics(makeSkillMetrics({ succeeded: false, durationMs: 500, taskId: 'task-3' }));

    const stats = await collector.getAggregatedSkillStats('tdd');
    expect(stats.skillName).toBe('tdd');
    expect(stats.totalInvocations).toBe(3);
    expect(stats.successRate).toBeCloseTo(2 / 3);
    expect(stats.avgDurationMs).toBeCloseTo((1000 + 2000 + 500) / 3);
  });

  it('returns zero stats for unknown skill', async () => {
    const stats = await collector.getAggregatedSkillStats('nonexistent');
    expect(stats.totalInvocations).toBe(0);
    expect(stats.successRate).toBe(0);
    expect(stats.trendDirection).toBe('stable');
  });

  it('calculates trend direction - improving', async () => {
    // First half: all failures
    for (let i = 0; i < 4; i++) {
      await collector.recordSkillMetrics(makeSkillMetrics({
        succeeded: false,
        taskId: `task-${i}`,
        timestamp: `2026-03-${20 + i}T10:00:00.000Z`,
      }));
    }
    // Second half: all successes
    for (let i = 4; i < 8; i++) {
      await collector.recordSkillMetrics(makeSkillMetrics({
        succeeded: true,
        taskId: `task-${i}`,
        timestamp: `2026-03-${20 + i}T10:00:00.000Z`,
      }));
    }

    const stats = await collector.getAggregatedSkillStats('tdd');
    expect(stats.trendDirection).toBe('improving');
  });

  it('calculates trend direction - declining', async () => {
    // First half: all successes
    for (let i = 0; i < 4; i++) {
      await collector.recordSkillMetrics(makeSkillMetrics({
        succeeded: true,
        taskId: `task-${i}`,
      }));
    }
    // Second half: all failures
    for (let i = 4; i < 8; i++) {
      await collector.recordSkillMetrics(makeSkillMetrics({
        succeeded: false,
        taskId: `task-${i}`,
      }));
    }

    const stats = await collector.getAggregatedSkillStats('tdd');
    expect(stats.trendDirection).toBe('declining');
  });

  it('returns empty history for missing files', async () => {
    const history = await collector.getTaskHistory();
    expect(history).toEqual([]);
  });
});
