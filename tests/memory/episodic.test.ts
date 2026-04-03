import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EpisodicMemory } from '../../src/memory/episodic.js';
import type { EpisodicEntry } from '../../src/types.js';

function makeEntry(overrides: Partial<EpisodicEntry> = {}): EpisodicEntry {
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

describe('EpisodicMemory', () => {
  let tmpDir: string;
  let filePath: string;
  let memory: EpisodicMemory;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'episodic-'));
    filePath = join(tmpDir, 'episodic.jsonl');
    memory = new EpisodicMemory(filePath);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty array when file does not exist', async () => {
    const entries = await memory.readAll();
    expect(entries).toEqual([]);
  });

  it('appends and reads entries', async () => {
    const entry = makeEntry();
    await memory.append(entry);

    const entries = await memory.readAll();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.taskId).toBe('task-1');
  });

  it('appends multiple entries', async () => {
    await memory.append(makeEntry({ taskId: 'task-1' }));
    await memory.append(makeEntry({ taskId: 'task-2' }));
    await memory.append(makeEntry({ taskId: 'task-3' }));

    const entries = await memory.readAll();
    expect(entries).toHaveLength(3);
  });

  it('searches by keyword in description', async () => {
    await memory.append(makeEntry({ description: 'Built authentication module' }));
    await memory.append(makeEntry({ description: 'Fixed payment bug', taskId: 'task-2' }));
    await memory.append(makeEntry({ description: 'Auth system refactor', taskId: 'task-3' }));

    const results = await memory.search('auth');
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  it('searches by keyword in lessons', async () => {
    await memory.append(makeEntry({ lessonsLearned: ['Test edge cases thoroughly'] }));
    await memory.append(makeEntry({
      taskId: 'task-2',
      lessonsLearned: ['Avoid premature optimization'],
    }));

    const results = await memory.search('edge cases');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.lessonsLearned[0]).toContain('edge cases');
  });

  it('limits search results', async () => {
    for (let i = 0; i < 10; i++) {
      await memory.append(makeEntry({ taskId: `task-${i}`, description: 'auth module work' }));
    }

    const results = await memory.search('auth', 3);
    expect(results).toHaveLength(3);
  });

  it('reads recent entries', async () => {
    for (let i = 0; i < 5; i++) {
      await memory.append(makeEntry({ taskId: `task-${i}` }));
    }

    const recent = await memory.readRecent(2);
    expect(recent).toHaveLength(2);
    expect(recent[0]!.taskId).toBe('task-3');
    expect(recent[1]!.taskId).toBe('task-4');
  });

  it('recovers from corruption at end of file', async () => {
    await memory.append(makeEntry({ taskId: 'task-1' }));
    await memory.append(makeEntry({ taskId: 'task-2' }));

    // Append corrupt data
    writeFileSync(filePath, '{"corrupt": true\n', { flag: 'a' });

    const result = await memory.recoverFromCorruption();
    expect(result.recovered).toBe(2);
    expect(result.lost).toBe(1);

    const entries = await memory.readAll();
    expect(entries).toHaveLength(2);
  });

  it('recovers from empty file without error', async () => {
    writeFileSync(filePath, '', 'utf-8');

    const result = await memory.recoverFromCorruption();
    expect(result.recovered).toBe(0);
    expect(result.lost).toBe(0);
  });

  it('returns 0/0 for corruption recovery on missing file', async () => {
    const result = await memory.recoverFromCorruption();
    expect(result.recovered).toBe(0);
    expect(result.lost).toBe(0);
  });

  it('searches return empty array when no matches', async () => {
    await memory.append(makeEntry({ description: 'Built auth module' }));

    const results = await memory.search('nonexistent-term-xyz');
    expect(results).toEqual([]);
  });

  it('creates directory if it does not exist', async () => {
    const nestedPath = join(tmpDir, 'deep', 'nested', 'episodic.jsonl');
    const nestedMemory = new EpisodicMemory(nestedPath);
    await nestedMemory.append(makeEntry());

    const entries = await nestedMemory.readAll();
    expect(entries).toHaveLength(1);
  });
});
