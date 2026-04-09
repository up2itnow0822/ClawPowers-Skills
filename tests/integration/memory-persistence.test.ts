/**
 * Integration Test: Memory Persistence
 * Tests real file I/O across episodic, procedural, checkpoint, and context-injector modules.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EpisodicMemory } from '../../src/memory/episodic.js';
import { ProceduralMemory } from '../../src/memory/procedural.js';
import { CheckpointManager } from '../../src/memory/checkpoint.js';
import { ContextInjector } from '../../src/memory/context-injector.js';
import { MetricsCollector } from '../../src/rsi/metrics.js';
import type { EpisodicEntry, Goal, CheckpointState } from '../../src/types.js';

function makeEpisodic(overrides: Partial<EpisodicEntry> = {}): EpisodicEntry {
  return {
    taskId: 'task-1',
    timestamp: new Date().toISOString(),
    description: 'Test task completion',
    outcome: 'success',
    lessonsLearned: ['Always validate inputs'],
    skillsUsed: ['tdd'],
    durationMs: 3000,
    tags: ['test'],
    ...overrides,
  };
}

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    taskId: 'goal-task-1',
    description: 'Build authentication module with JWT tokens',
    constraints: [],
    successCriteria: ['Tests pass'],
    createdAt: new Date().toISOString(),
    source: 'cli',
    ...overrides,
  };
}

describe('Memory Persistence Integration', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mem-integ-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes episodic entry → reads it back → verifies content', async () => {
    const episodic = new EpisodicMemory(join(tmpDir, 'episodic.jsonl'));
    const entry = makeEpisodic({ taskId: 'persist-1', description: 'Built auth module' });

    await episodic.append(entry);
    const entries = await episodic.readAll();

    expect(entries).toHaveLength(1);
    expect(entries[0]!.taskId).toBe('persist-1');
    expect(entries[0]!.description).toBe('Built auth module');
    expect(entries[0]!.outcome).toBe('success');
    expect(entries[0]!.lessonsLearned).toEqual(['Always validate inputs']);
  });

  it('writes procedural update → reads back → verifies atomic write', async () => {
    const procedural = new ProceduralMemory(join(tmpDir, 'procedural.json'));

    await procedural.update('tdd', { succeeded: true, durationMs: 1000, taskId: 't1' });
    const entries = await procedural.load();

    expect(entries).toHaveLength(1);
    expect(entries[0]!.skillName).toBe('tdd');
    expect(entries[0]!.invocationCount).toBe(1);
    expect(entries[0]!.successRate).toBe(1);

    // Second update: verify stats recalculation
    await procedural.update('tdd', { succeeded: false, durationMs: 2000, taskId: 't2' });
    const updated = await procedural.load();
    expect(updated[0]!.invocationCount).toBe(2);
    expect(updated[0]!.successRate).toBe(0.5);
  });

  it('checkpoint save → load → verifies full state recovery', async () => {
    const checkpointDir = join(tmpDir, 'checkpoints');
    const manager = new CheckpointManager(checkpointDir);

    const goal = makeGoal();
    const state: CheckpointState = {
      taskId: 'ckpt-task-1',
      goal,
      plan: { taskId: 'ckpt-task-1', steps: [], status: 'executing', createdAt: new Date().toISOString(), approvedAt: new Date().toISOString(), parallelizable: false },
      currentStepId: 'step-3',
      intermediateOutputs: { 'step-1': 'result-1', 'step-2': 'result-2' },
      workingMemory: {
        taskId: 'ckpt-task-1',
        goal,
        plan: { taskId: 'ckpt-task-1', steps: [], status: 'executing', createdAt: new Date().toISOString(), approvedAt: null, parallelizable: false },
        currentStepId: 'step-3',
        intermediateOutputs: { 'step-1': 'result-1', 'step-2': 'result-2' },
        contextWindow: ['context-entry-1'],
      },
      savedAt: new Date().toISOString(),
      agentStatus: 'executing',
    };

    await manager.save('ckpt-task-1', state);
    const loaded = await manager.load('ckpt-task-1');

    expect(loaded).not.toBeNull();
    expect(loaded!.taskId).toBe('ckpt-task-1');
    expect(loaded!.currentStepId).toBe('step-3');
    expect(loaded!.intermediateOutputs['step-1']).toBe('result-1');
    expect(loaded!.intermediateOutputs['step-2']).toBe('result-2');
    expect(loaded!.agentStatus).toBe('executing');
    expect(loaded!.workingMemory.contextWindow).toEqual(['context-entry-1']);
  });

  it('episodic corruption recovery: invalid JSON at end of file → recovers valid entries', async () => {
    const filePath = join(tmpDir, 'corrupt-episodic.jsonl');
    const episodic = new EpisodicMemory(filePath);

    // Write 3 valid entries
    await episodic.append(makeEpisodic({ taskId: 'valid-1' }));
    await episodic.append(makeEpisodic({ taskId: 'valid-2' }));
    await episodic.append(makeEpisodic({ taskId: 'valid-3' }));

    // Append corrupt data
    writeFileSync(filePath, '{broken json here\n', { flag: 'a' });
    writeFileSync(filePath, 'not even json\n', { flag: 'a' });

    const result = await episodic.recoverFromCorruption();
    expect(result.recovered).toBe(3);
    expect(result.lost).toBe(2);

    // Verify only valid entries remain
    const entries = await episodic.readAll();
    expect(entries).toHaveLength(3);
    expect(entries[0]!.taskId).toBe('valid-1');
    expect(entries[2]!.taskId).toBe('valid-3');
  });

  it('context injector: writes episodic entries → injects context for new task → verifies relevance ordering and token budget', async () => {
    const episodicPath = join(tmpDir, 'ctx-episodic.jsonl');
    const proceduralPath = join(tmpDir, 'ctx-procedural.json');

    const episodic = new EpisodicMemory(episodicPath);
    const procedural = new ProceduralMemory(proceduralPath);

    // Write 10 episodic entries with varying relevance
    for (let i = 0; i < 10; i++) {
      await episodic.append(makeEpisodic({
        taskId: `ctx-task-${i}`,
        description: i < 5
          ? `Authentication work: JWT token handling #${i}`
          : `Database migration task #${i}`,
        skillsUsed: i < 5 ? ['auth', 'jwt'] : ['database', 'migration'],
        tags: i < 5 ? ['auth', 'jwt'] : ['database'],
      }));
    }

    // Write procedural entries
    await procedural.update('auth', { succeeded: true, durationMs: 1000, taskId: 't1' });
    await procedural.update('database', { succeeded: true, durationMs: 2000, taskId: 't2' });

    const injector = new ContextInjector(episodic, procedural);
    const goal = makeGoal({ description: 'Build authentication module with JWT tokens' });

    const context = await injector.inject(goal, 2000);

    // Should have injected entries
    expect(context.length).toBeGreaterThan(0);

    // Auth-related entries should appear before database entries (relevance ordering)
    const firstAuthIdx = context.findIndex(c => c.toLowerCase().includes('auth') || c.toLowerCase().includes('jwt'));
    const firstDbIdx = context.findIndex(c => c.toLowerCase().includes('database'));

    if (firstAuthIdx >= 0 && firstDbIdx >= 0) {
      expect(firstAuthIdx).toBeLessThan(firstDbIdx);
    }

    // Total context should be within token budget
    const totalChars = context.join('').length;
    const estimatedTokens = Math.ceil(totalChars / 4);
    expect(estimatedTokens).toBeLessThanOrEqual(2000);
  });

  it('procedural backup: update → verify .bak file exists with previous state', async () => {
    const filePath = join(tmpDir, 'backup-procedural.json');
    const procedural = new ProceduralMemory(filePath);

    // First write
    await procedural.update('skill-a', { succeeded: true, durationMs: 100, taskId: 't1' });

    // Second write (should create .bak)
    await procedural.update('skill-a', { succeeded: false, durationMs: 200, taskId: 't2' });

    const bakPath = filePath + '.bak';
    expect(existsSync(bakPath)).toBe(true);

    // The .bak should contain the state before the second write
    const { readFileSync } = await import('node:fs');
    const bakContent = JSON.parse(readFileSync(bakPath, 'utf-8')) as Array<{ invocationCount: number }>;
    expect(bakContent).toHaveLength(1);
    expect(bakContent[0]!.invocationCount).toBe(1);
  });

  it('cross-module: complete a task → write episodic + procedural + metrics → verify all three persisted', async () => {
    const episodicPath = join(tmpDir, 'cross-episodic.jsonl');
    const proceduralPath = join(tmpDir, 'cross-procedural.json');
    const taskMetricsPath = join(tmpDir, 'cross-task-metrics.jsonl');
    const skillMetricsPath = join(tmpDir, 'cross-skill-metrics.jsonl');

    const episodic = new EpisodicMemory(episodicPath);
    const procedural = new ProceduralMemory(proceduralPath);
    const metrics = new MetricsCollector(taskMetricsPath, skillMetricsPath);

    // Simulate task completion: write to all three
    const taskId = 'cross-task-1';

    await episodic.append(makeEpisodic({
      taskId,
      description: 'Cross-module integration task',
      outcome: 'success',
      skillsUsed: ['tdd', 'debugging'],
    }));

    await procedural.update('tdd', { succeeded: true, durationMs: 500, taskId });
    await procedural.update('debugging', { succeeded: true, durationMs: 300, taskId });

    await metrics.recordTaskMetrics({
      taskId,
      timestamp: new Date().toISOString(),
      durationMs: 800,
      stepCount: 3,
      stepsCompleted: 3,
      stepsFailed: 0,
      retryCount: 0,
      skillsUsed: ['tdd', 'debugging'],
      outcome: 'success',
      memoryEntriesCreated: 1,
    });

    // Verify all three persisted
    const episodicEntries = await episodic.readAll();
    expect(episodicEntries).toHaveLength(1);
    expect(episodicEntries[0]!.taskId).toBe(taskId);

    const proceduralEntries = await procedural.load();
    expect(proceduralEntries).toHaveLength(2);
    expect(proceduralEntries.find(e => e.skillName === 'tdd')).toBeTruthy();

    const taskHistory = await metrics.getTaskHistory();
    expect(taskHistory).toHaveLength(1);
    expect(taskHistory[0]!.taskId).toBe(taskId);
  });

  it('checkpoint listIncomplete finds non-terminal checkpoints', async () => {
    const checkpointDir = join(tmpDir, 'list-checkpoints');
    const manager = new CheckpointManager(checkpointDir);
    const goal = makeGoal();

    // Save executing checkpoint
    await manager.save('active-1', {
      taskId: 'active-1',
      goal,
      plan: { taskId: 'active-1', steps: [], status: 'executing', createdAt: new Date().toISOString(), approvedAt: null, parallelizable: false },
      currentStepId: null,
      intermediateOutputs: {},
      workingMemory: { taskId: 'active-1', goal, plan: { taskId: 'active-1', steps: [], status: 'executing', createdAt: new Date().toISOString(), approvedAt: null, parallelizable: false }, currentStepId: null, intermediateOutputs: {}, contextWindow: [] },
      savedAt: new Date().toISOString(),
      agentStatus: 'executing',
    });

    // Save completed checkpoint
    await manager.save('done-1', {
      taskId: 'done-1',
      goal,
      plan: { taskId: 'done-1', steps: [], status: 'complete', createdAt: new Date().toISOString(), approvedAt: null, parallelizable: false },
      currentStepId: null,
      intermediateOutputs: {},
      workingMemory: { taskId: 'done-1', goal, plan: { taskId: 'done-1', steps: [], status: 'complete', createdAt: new Date().toISOString(), approvedAt: null, parallelizable: false }, currentStepId: null, intermediateOutputs: {}, contextWindow: [] },
      savedAt: new Date().toISOString(),
      agentStatus: 'complete',
    });

    const incomplete = await manager.listIncomplete();
    expect(incomplete).toHaveLength(1);
    expect(incomplete[0]!.taskId).toBe('active-1');
  });

  it('checkpoint save and remove lifecycle', async () => {
    const checkpointDir = join(tmpDir, 'lifecycle-checkpoints');
    const manager = new CheckpointManager(checkpointDir);
    const goal = makeGoal();

    const state: CheckpointState = {
      taskId: 'lifecycle-1',
      goal,
      plan: { taskId: 'lifecycle-1', steps: [], status: 'executing', createdAt: new Date().toISOString(), approvedAt: null, parallelizable: false },
      currentStepId: null,
      intermediateOutputs: {},
      workingMemory: { taskId: 'lifecycle-1', goal, plan: { taskId: 'lifecycle-1', steps: [], status: 'executing', createdAt: new Date().toISOString(), approvedAt: null, parallelizable: false }, currentStepId: null, intermediateOutputs: {}, contextWindow: [] },
      savedAt: new Date().toISOString(),
      agentStatus: 'executing',
    };

    await manager.save('lifecycle-1', state);
    expect(await manager.load('lifecycle-1')).not.toBeNull();

    await manager.remove('lifecycle-1');
    expect(await manager.load('lifecycle-1')).toBeNull();
  });

  it('multiple episodic entries persist across reads', async () => {
    const episodic = new EpisodicMemory(join(tmpDir, 'multi-episodic.jsonl'));

    for (let i = 0; i < 20; i++) {
      await episodic.append(makeEpisodic({
        taskId: `task-${i}`,
        description: `Task number ${i}`,
      }));
    }

    const all = await episodic.readAll();
    expect(all).toHaveLength(20);

    const recent = await episodic.readRecent(5);
    expect(recent).toHaveLength(5);
    expect(recent[4]!.taskId).toBe('task-19');
  });

  it('procedural memory tracks mutation records', async () => {
    const procedural = new ProceduralMemory(join(tmpDir, 'mutation-proc.json'));

    await procedural.update('debugging', { succeeded: true, durationMs: 500, taskId: 't1' });

    await procedural.recordMutation('debugging', {
      mutationId: 'mut-1',
      description: 'Increased timeout',
      appliedAt: new Date().toISOString(),
      revertedAt: null,
      status: 'active',
    });

    const entries = await procedural.load();
    expect(entries[0]!.mutations).toHaveLength(1);
    expect(entries[0]!.mutations[0]!.mutationId).toBe('mut-1');

    // Rollback
    await procedural.rollbackMutation('debugging', 'mut-1');
    const updated = await procedural.load();
    expect(updated[0]!.mutations[0]!.status).toBe('reverted');
    expect(updated[0]!.mutations[0]!.revertedAt).not.toBeNull();
  });
});
