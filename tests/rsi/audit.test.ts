import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RSIAuditLog } from '../../src/rsi/audit.js';
import type { RSIAuditEntry } from '../../src/types.js';

function makeAuditEntry(overrides: Partial<RSIAuditEntry> = {}): RSIAuditEntry {
  return {
    timestamp: '2026-03-25T10:00:00.000Z',
    action: 'mutation-applied',
    skillName: 'tdd',
    mutationId: 'mut-1',
    hypothesis: 'Adjusting retry count for tdd',
    metrics: {
      baseline: 0.6,
      current: 0.8,
      delta: 0.2,
    },
    decision: 'promote',
    ...overrides,
  };
}

describe('RSIAuditLog', () => {
  let tmpDir: string;
  let auditLog: RSIAuditLog;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'audit-'));
    auditLog = new RSIAuditLog(join(tmpDir, 'audit.jsonl'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('logs and retrieves an entry', async () => {
    await auditLog.log(makeAuditEntry());

    const history = await auditLog.getHistory();
    expect(history).toHaveLength(1);
    expect(history[0]!.action).toBe('mutation-applied');
  });

  it('logs multiple entries', async () => {
    await auditLog.log(makeAuditEntry({ mutationId: 'mut-1' }));
    await auditLog.log(makeAuditEntry({ mutationId: 'mut-2', action: 'mutation-reverted' }));
    await auditLog.log(makeAuditEntry({ mutationId: 'mut-3', action: 'test-started' }));

    const history = await auditLog.getHistory();
    expect(history).toHaveLength(3);
  });

  it('limits history results', async () => {
    for (let i = 0; i < 10; i++) {
      await auditLog.log(makeAuditEntry({ mutationId: `mut-${i}` }));
    }

    const history = await auditLog.getHistory(3);
    expect(history).toHaveLength(3);
  });

  it('filters by mutation ID', async () => {
    await auditLog.log(makeAuditEntry({ mutationId: 'mut-1', action: 'applied' }));
    await auditLog.log(makeAuditEntry({ mutationId: 'mut-2', action: 'applied' }));
    await auditLog.log(makeAuditEntry({ mutationId: 'mut-1', action: 'promoted' }));

    const entries = await auditLog.getByMutation('mut-1');
    expect(entries).toHaveLength(2);
    expect(entries.every(e => e.mutationId === 'mut-1')).toBe(true);
  });

  it('returns empty array for unknown mutation', async () => {
    await auditLog.log(makeAuditEntry());

    const entries = await auditLog.getByMutation('nonexistent');
    expect(entries).toEqual([]);
  });

  it('returns empty history when file does not exist', async () => {
    const history = await auditLog.getHistory();
    expect(history).toEqual([]);
  });

  it('creates directory if it does not exist', async () => {
    const nestedPath = join(tmpDir, 'deep', 'nested', 'audit.jsonl');
    const nestedLog = new RSIAuditLog(nestedPath);
    await nestedLog.log(makeAuditEntry());

    const history = await nestedLog.getHistory();
    expect(history).toHaveLength(1);
  });
});
