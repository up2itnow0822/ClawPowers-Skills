import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EpisodicMemory } from '../../src/memory/episodic.js';
import { ProceduralMemory } from '../../src/memory/procedural.js';
import { ContextInjector } from '../../src/memory/context-injector.js';
import type { Goal, EpisodicEntry } from '../../src/types.js';

function makeGoal(description: string = 'Build authentication module'): Goal {
  return {
    taskId: 'task-1',
    description,
    constraints: [],
    successCriteria: ['Tests pass'],
    createdAt: '2026-03-25T00:00:00.000Z',
    source: 'cli',
  };
}

function makeEpisodicEntry(overrides: Partial<EpisodicEntry> = {}): EpisodicEntry {
  return {
    taskId: 'task-1',
    timestamp: '2026-03-25T10:00:00.000Z',
    description: 'Built authentication module',
    outcome: 'success',
    lessonsLearned: ['Always test edge cases'],
    skillsUsed: ['tdd', 'debugging'],
    durationMs: 5000,
    tags: ['auth', 'module'],
    ...overrides,
  };
}

describe('ContextInjector', () => {
  let tmpDir: string;
  let episodic: EpisodicMemory;
  let procedural: ProceduralMemory;
  let injector: ContextInjector;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'context-'));
    episodic = new EpisodicMemory(join(tmpDir, 'episodic.jsonl'));
    procedural = new ProceduralMemory(join(tmpDir, 'procedural.json'));
    injector = new ContextInjector(episodic, procedural);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty array when no memories exist', async () => {
    const result = await injector.inject(makeGoal());
    expect(result).toEqual([]);
  });

  it('injects relevant episodic entries', async () => {
    await episodic.append(makeEpisodicEntry({
      description: 'Built authentication system',
    }));
    await episodic.append(makeEpisodicEntry({
      taskId: 'task-2',
      description: 'Fixed payment bug',
    }));

    const result = await injector.inject(makeGoal('Build authentication module'));
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.some(r => r.includes('authentication'))).toBe(true);
  });

  it('injects relevant procedural entries', async () => {
    await procedural.update('authentication', { succeeded: true, durationMs: 500, taskId: 'task-1' });
    await procedural.update('payment', { succeeded: true, durationMs: 300, taskId: 'task-2' });

    const result = await injector.inject(makeGoal('Build authentication module'));
    expect(result.some(r => r.includes('authentication'))).toBe(true);
  });

  it('respects token budget', async () => {
    // Add many entries
    for (let i = 0; i < 50; i++) {
      await episodic.append(makeEpisodicEntry({
        taskId: `task-${i}`,
        description: `Built auth module iteration ${i} with lots of detail and description text`,
      }));
    }

    const result = await injector.inject(makeGoal('Build auth module'), 500);

    // Total tokens should be within budget
    const totalChars = result.join('').length;
    const totalTokens = Math.ceil(totalChars / 4);
    expect(totalTokens).toBeLessThanOrEqual(600); // Allow some tolerance
  });

  it('interleaves episodic and procedural entries', async () => {
    await episodic.append(makeEpisodicEntry({ description: 'Auth module work' }));
    await episodic.append(makeEpisodicEntry({ taskId: 'task-2', description: 'Auth testing' }));
    await procedural.update('auth', { succeeded: true, durationMs: 500, taskId: 'task-1' });

    const result = await injector.inject(makeGoal('auth module'));
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it('prioritizes entries by relevance', async () => {
    await episodic.append(makeEpisodicEntry({
      description: 'Unrelated database migration',
      tags: ['database'],
    }));
    await episodic.append(makeEpisodicEntry({
      taskId: 'task-2',
      description: 'Build authentication system with JWT',
      tags: ['auth'],
    }));

    const result = await injector.inject(makeGoal('Build authentication module'));
    // The auth-related entry should appear
    expect(result.some(r => r.includes('authentication'))).toBe(true);
  });

  it('handles mixed empty memories', async () => {
    // Only procedural, no episodic
    await procedural.update('tdd', { succeeded: true, durationMs: 500, taskId: 'task-1' });

    const result = await injector.inject(makeGoal('tdd approach'));
    expect(result.some(r => r.includes('tdd'))).toBe(true);
  });

  it('compresses entries into readable format', async () => {
    await episodic.append(makeEpisodicEntry({
      timestamp: '2026-03-25T10:00:00.000Z',
      description: 'Built auth module',
      outcome: 'success',
      skillsUsed: ['tdd'],
      lessonsLearned: ['Test edge cases'],
    }));

    const result = await injector.inject(makeGoal('Build auth module'));
    expect(result.length).toBeGreaterThanOrEqual(1);
    // Should contain date, description, outcome
    const entry = result[0]!;
    expect(entry).toContain('2026-03-25');
    expect(entry).toContain('success');
  });
});
