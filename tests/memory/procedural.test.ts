import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProceduralMemory } from '../../src/memory/procedural.js';
import type { MutationRecord } from '../../src/types.js';

describe('ProceduralMemory', () => {
  let tmpDir: string;
  let filePath: string;
  let memory: ProceduralMemory;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'procedural-'));
    filePath = join(tmpDir, 'procedural.json');
    memory = new ProceduralMemory(filePath);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty array when file does not exist', async () => {
    const entries = await memory.load();
    expect(entries).toEqual([]);
  });

  it('updates a new skill', async () => {
    await memory.update('tdd', { succeeded: true, durationMs: 1000, taskId: 'task-1' });

    const entries = await memory.load();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.skillName).toBe('tdd');
    expect(entries[0]!.invocationCount).toBe(1);
    expect(entries[0]!.successRate).toBe(1);
  });

  it('updates an existing skill', async () => {
    await memory.update('tdd', { succeeded: true, durationMs: 1000, taskId: 'task-1' });
    await memory.update('tdd', { succeeded: false, durationMs: 2000, taskId: 'task-2' });

    const entries = await memory.load();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.invocationCount).toBe(2);
    expect(entries[0]!.successRate).toBe(0.5);
  });

  it('gets skill score from cache', async () => {
    await memory.update('tdd', { succeeded: true, durationMs: 500, taskId: 'task-1' });

    const score = memory.getSkillScore('tdd');
    expect(score).not.toBeNull();
    expect(score!.skillName).toBe('tdd');
  });

  it('returns null for unknown skill', async () => {
    await memory.load();
    const score = memory.getSkillScore('nonexistent');
    expect(score).toBeNull();
  });

  it('returns null for skill score before load', () => {
    const score = memory.getSkillScore('tdd');
    expect(score).toBeNull();
  });

  it('gets top skills by context', async () => {
    await memory.update('tdd', { succeeded: true, durationMs: 500, taskId: 'task-1' });
    await memory.update('tdd', { succeeded: true, durationMs: 600, taskId: 'task-2' });
    await memory.update('debugging', { succeeded: true, durationMs: 800, taskId: 'task-1' });
    await memory.update('code-review', { succeeded: false, durationMs: 300, taskId: 'task-1' });

    const top = memory.getTopSkills('test driven development', 2);
    expect(top.length).toBeLessThanOrEqual(2);
  });

  it('returns empty top skills before load', () => {
    const top = memory.getTopSkills('anything', 5);
    expect(top).toEqual([]);
  });

  it('records mutation for a skill', async () => {
    await memory.update('tdd', { succeeded: true, durationMs: 500, taskId: 'task-1' });

    const mutation: MutationRecord = {
      mutationId: 'mut-1',
      description: 'Increased retry count',
      appliedAt: '2026-03-25T00:00:00.000Z',
      revertedAt: null,
      status: 'active',
    };

    await memory.recordMutation('tdd', mutation);

    const entries = await memory.load();
    expect(entries[0]!.mutations).toHaveLength(1);
    expect(entries[0]!.mutations[0]!.mutationId).toBe('mut-1');
  });

  it('throws when recording mutation for unknown skill', async () => {
    await memory.load();

    const mutation: MutationRecord = {
      mutationId: 'mut-1',
      description: 'Test',
      appliedAt: '2026-03-25T00:00:00.000Z',
      revertedAt: null,
      status: 'active',
    };

    await expect(memory.recordMutation('nonexistent', mutation)).rejects.toThrow(
      'Skill "nonexistent" not found'
    );
  });

  it('rolls back a mutation', async () => {
    await memory.update('tdd', { succeeded: true, durationMs: 500, taskId: 'task-1' });

    const mutation: MutationRecord = {
      mutationId: 'mut-1',
      description: 'Increased retry count',
      appliedAt: '2026-03-25T00:00:00.000Z',
      revertedAt: null,
      status: 'active',
    };

    await memory.recordMutation('tdd', mutation);
    await memory.rollbackMutation('tdd', 'mut-1');

    const entries = await memory.load();
    expect(entries[0]!.mutations[0]!.status).toBe('reverted');
    expect(entries[0]!.mutations[0]!.revertedAt).not.toBeNull();
  });

  it('throws when rolling back unknown mutation', async () => {
    await memory.update('tdd', { succeeded: true, durationMs: 500, taskId: 'task-1' });

    await expect(memory.rollbackMutation('tdd', 'nonexistent')).rejects.toThrow(
      'Mutation "nonexistent" not found'
    );
  });

  it('creates backup file on write', async () => {
    await memory.update('tdd', { succeeded: true, durationMs: 500, taskId: 'task-1' });
    // First write creates the file but no .bak yet
    expect(existsSync(filePath)).toBe(true);

    await memory.update('tdd', { succeeded: true, durationMs: 600, taskId: 'task-2' });
    // Second write should create .bak
    expect(existsSync(filePath + '.bak')).toBe(true);
  });

  it('performs atomic write via temp file', async () => {
    await memory.update('tdd', { succeeded: true, durationMs: 500, taskId: 'task-1' });

    // Verify the file is valid JSON
    const content = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
  });
});
