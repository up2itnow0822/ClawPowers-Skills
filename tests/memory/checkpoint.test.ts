import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CheckpointManager } from '../../src/memory/checkpoint.js';
import type { CheckpointState, Goal, Plan, WorkingMemory } from '../../src/types.js';

function makeGoal(): Goal {
  return {
    taskId: 'task-1',
    description: 'Build auth module',
    constraints: [],
    successCriteria: ['Tests pass'],
    createdAt: '2026-03-25T00:00:00.000Z',
    source: 'cli',
  };
}

function makePlan(): Plan {
  return {
    taskId: 'task-1',
    steps: [],
    status: 'executing',
    createdAt: '2026-03-25T00:00:00.000Z',
    approvedAt: '2026-03-25T00:01:00.000Z',
    parallelizable: false,
  };
}

function makeWorkingMemory(): WorkingMemory {
  return {
    taskId: 'task-1',
    goal: makeGoal(),
    plan: makePlan(),
    currentStepId: null,
    intermediateOutputs: {},
    contextWindow: [],
  };
}

function makeCheckpoint(overrides: Partial<CheckpointState> = {}): CheckpointState {
  return {
    taskId: 'task-1',
    goal: makeGoal(),
    plan: makePlan(),
    currentStepId: 'step-1',
    intermediateOutputs: { 'step-0': 'done' },
    workingMemory: makeWorkingMemory(),
    savedAt: new Date().toISOString(),
    agentStatus: 'executing',
    ...overrides,
  };
}

describe('CheckpointManager', () => {
  let tmpDir: string;
  let manager: CheckpointManager;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'checkpoint-'));
    manager = new CheckpointManager(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('saves and loads a checkpoint', async () => {
    const state = makeCheckpoint();
    await manager.save('task-1', state);

    const loaded = await manager.load('task-1');
    expect(loaded).not.toBeNull();
    expect(loaded!.taskId).toBe('task-1');
    expect(loaded!.agentStatus).toBe('executing');
  });

  it('returns null for missing checkpoint', async () => {
    const loaded = await manager.load('nonexistent');
    expect(loaded).toBeNull();
  });

  it('removes a checkpoint', async () => {
    await manager.save('task-1', makeCheckpoint());
    await manager.remove('task-1');

    const loaded = await manager.load('task-1');
    expect(loaded).toBeNull();
  });

  it('remove does not throw for missing file', async () => {
    await expect(manager.remove('nonexistent')).resolves.not.toThrow();
  });

  it('lists incomplete checkpoints', async () => {
    await manager.save('task-1', makeCheckpoint({ agentStatus: 'executing' }));
    await manager.save('task-2', makeCheckpoint({
      taskId: 'task-2',
      agentStatus: 'complete',
      goal: { ...makeGoal(), taskId: 'task-2', description: 'Completed task' },
    }));
    await manager.save('task-3', makeCheckpoint({
      taskId: 'task-3',
      agentStatus: 'paused',
      goal: { ...makeGoal(), taskId: 'task-3', description: 'Paused task' },
    }));

    const incomplete = await manager.listIncomplete();
    expect(incomplete).toHaveLength(2);
    const taskIds = incomplete.map(c => c.taskId);
    expect(taskIds).toContain('task-1');
    expect(taskIds).toContain('task-3');
  });

  it('detects stale checkpoints (default 24h)', () => {
    const staleDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const state = makeCheckpoint({ savedAt: staleDate });

    expect(manager.isStale(state)).toBe(true);
  });

  it('detects non-stale checkpoints', () => {
    const freshDate = new Date().toISOString();
    const state = makeCheckpoint({ savedAt: freshDate });

    expect(manager.isStale(state)).toBe(false);
  });

  it('uses custom max age for stale check', () => {
    const date = new Date(Date.now() - 5000).toISOString();
    const state = makeCheckpoint({ savedAt: date });

    expect(manager.isStale(state, 1000)).toBe(true);
    expect(manager.isStale(state, 60000)).toBe(false);
  });

  it('overwrites existing checkpoint on save', async () => {
    await manager.save('task-1', makeCheckpoint({ currentStepId: 'step-1' }));
    await manager.save('task-1', makeCheckpoint({ currentStepId: 'step-2' }));

    const loaded = await manager.load('task-1');
    expect(loaded!.currentStepId).toBe('step-2');
  });
});
