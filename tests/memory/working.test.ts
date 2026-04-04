import { describe, it, expect, beforeEach } from 'vitest';
import { WorkingMemoryManager } from '../../src/memory/working.js';
import type { Goal } from '../../src/types.js';

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    taskId: 'task-1',
    description: 'Build authentication module',
    constraints: ['Must use TypeScript'],
    successCriteria: ['Tests pass'],
    createdAt: '2026-03-25T00:00:00.000Z',
    source: 'cli',
    ...overrides,
  };
}

describe('WorkingMemoryManager', () => {
  let manager: WorkingMemoryManager;

  beforeEach(() => {
    manager = new WorkingMemoryManager();
  });

  it('creates working memory for a task', () => {
    const goal = makeGoal();
    const memory = manager.create('task-1', goal);

    expect(memory.taskId).toBe('task-1');
    expect(memory.goal).toBe(goal);
    expect(memory.currentStepId).toBeNull();
    expect(memory.intermediateOutputs).toEqual({});
    expect(memory.contextWindow).toEqual([]);
  });

  it('updates current step', () => {
    manager.create('task-1', makeGoal());
    manager.updateCurrentStep('step-1');

    const snapshot = manager.getSnapshot();
    expect(snapshot.currentStepId).toBe('step-1');
  });

  it('adds intermediate output', () => {
    manager.create('task-1', makeGoal());
    manager.addIntermediateOutput('step-1', 'output-data');

    const snapshot = manager.getSnapshot();
    expect(snapshot.intermediateOutputs['step-1']).toBe('output-data');
  });

  it('supports multiple intermediate outputs', () => {
    manager.create('task-1', makeGoal());
    manager.addIntermediateOutput('step-1', 'output-1');
    manager.addIntermediateOutput('step-2', 'output-2');

    const snapshot = manager.getSnapshot();
    expect(snapshot.intermediateOutputs['step-1']).toBe('output-1');
    expect(snapshot.intermediateOutputs['step-2']).toBe('output-2');
  });

  it('enforces token budget when injecting context', () => {
    manager.create('task-1', makeGoal());

    // 2000 tokens * 4 chars/token = 8000 chars max
    const longEntry = 'a'.repeat(9000); // Would be ~2250 tokens
    manager.injectContext([longEntry]);

    const snapshot = manager.getSnapshot();
    // Should be truncated
    expect(snapshot.contextWindow.length).toBe(1);
    expect(snapshot.contextWindow[0]!.length).toBeLessThan(9000);
    expect(snapshot.contextWindow[0]!.endsWith('...')).toBe(true);
  });

  it('fits multiple entries within token budget', () => {
    manager.create('task-1', makeGoal());

    const entries = [
      'Short entry one',       // ~4 tokens
      'Short entry two',       // ~4 tokens
      'Short entry three',     // ~5 tokens
    ];
    manager.injectContext(entries);

    const snapshot = manager.getSnapshot();
    expect(snapshot.contextWindow.length).toBe(3);
  });

  it('clears memory', () => {
    manager.create('task-1', makeGoal());
    manager.clear();

    expect(() => manager.getSnapshot()).toThrow('Working memory not initialized');
  });

  it('throws when accessing snapshot before create', () => {
    expect(() => manager.getSnapshot()).toThrow('Working memory not initialized');
  });

  it('throws when updating step before create', () => {
    expect(() => manager.updateCurrentStep('step-1')).toThrow('Working memory not initialized');
  });

  it('throws when adding output before create', () => {
    expect(() => manager.addIntermediateOutput('step-1', 'data')).toThrow('Working memory not initialized');
  });

  it('throws when injecting context before create', () => {
    expect(() => manager.injectContext(['entry'])).toThrow('Working memory not initialized');
  });

  it('returns snapshot matching current state', () => {
    manager.create('task-1', makeGoal());
    manager.updateCurrentStep('step-2');
    manager.addIntermediateOutput('step-1', 'result');
    manager.injectContext(['context entry']);

    const snapshot = manager.getSnapshot();
    expect(snapshot.currentStepId).toBe('step-2');
    expect(snapshot.intermediateOutputs['step-1']).toBe('result');
    expect(snapshot.contextWindow).toEqual(['context entry']);
  });
});
