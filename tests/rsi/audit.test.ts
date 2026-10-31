import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
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

  it('logs and retrieves an entry with integrity hashes', async () => {
    await auditLog.log(makeAuditEntry());

    const history = await auditLog.getHistory();
    expect(history).toHaveLength(1);
    expect(history[0]!.action).toBe('mutation-applied');
    expect(history[0]!.previousHash).toMatch(/^[a-f0-9]{64}$/);
    expect(history[0]!.entryHash).toMatch(/^[a-f0-9]{64}$/);
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

  it('verifies the audit chain for untampered history', async () => {
    await auditLog.log(makeAuditEntry({ mutationId: 'mut-1' }));
    await auditLog.log(makeAuditEntry({ mutationId: 'mut-2' }));

    await expect(auditLog.verifyIntegrity()).resolves.toEqual({
      valid: true,
      checkedEntries: 2,
      failedAt: null,
      reason: null,
    });
  });

  it('detects tampered audit entries', async () => {
    const auditPath = join(tmpDir, 'audit.jsonl');
    await auditLog.log(makeAuditEntry({ mutationId: 'mut-1', decision: 'continue' }));
    await auditLog.log(makeAuditEntry({ mutationId: 'mut-2', decision: 'rollback' }));

    const lines = readFileSync(auditPath, 'utf-8').trim().split('\n');
    const firstEntry = JSON.parse(lines[0]!) as RSIAuditEntry;
    lines[0] = JSON.stringify({ ...firstEntry, decision: 'promote' });
    writeFileSync(auditPath, `${lines.join('\n')}\n`, 'utf-8');

    const result = await auditLog.verifyIntegrity();
    expect(result.valid).toBe(false);
    expect(result.failedAt).toBe(0);
    expect(result.reason).toBe('entryHash does not match entry contents');
  });

  it('serializes concurrent appends from two instances on resolved path aliases', async () => {
    const relativePath = join(tmpDir, 'audit.jsonl');
    const aliasedPath = join(tmpDir, '.', 'audit.jsonl');
    const first = new RSIAuditLog(relativePath);
    const second = new RSIAuditLog(aliasedPath);

    await Promise.all(
      Array.from({ length: 20 }, (_, i) => {
        const log = i % 2 === 0 ? first : second;
        return log.log(
          makeAuditEntry({
            mutationId: `mut-${i}`,
            timestamp: `2026-03-25T10:00:${String(i).padStart(2, '0')}.000Z`,
          }),
        );
      }),
    );

    const history = await first.getHistory();
    expect(history).toHaveLength(20);
    await expect(first.verifyIntegrity()).resolves.toEqual({
      valid: true,
      checkedEntries: 20,
      failedAt: null,
      reason: null,
    });
  });

  it('releases the lockdir after a thrown write so a later log succeeds', async () => {
    const auditPath = join(tmpDir, 'audit.jsonl');
    await auditLog.log(makeAuditEntry({ mutationId: 'mut-ok' }));

    chmodSync(auditPath, 0o444);
    await expect(auditLog.log(makeAuditEntry({ mutationId: 'mut-fail' }))).rejects.toThrow();
    expect(existsSync(`${resolve(auditPath)}.lock`)).toBe(false);

    chmodSync(auditPath, 0o644);
    await auditLog.log(makeAuditEntry({ mutationId: 'mut-retry' }));

    const history = await auditLog.getHistory();
    expect(history.map(entry => entry.mutationId)).toEqual(['mut-ok', 'mut-retry']);
    await expect(auditLog.verifyIntegrity()).resolves.toMatchObject({ valid: true, checkedEntries: 2 });
  });

  it('rejects a non-positive lock timeout at construction', () => {
    const auditPath = join(tmpDir, 'audit.jsonl');
    expect(() => new RSIAuditLog(auditPath, { lockTimeoutMs: 0 })).toThrow(
      'lockTimeoutMs must be a finite positive number',
    );
    expect(() => new RSIAuditLog(auditPath, { lockTimeoutMs: Number.NaN })).toThrow(
      'lockTimeoutMs must be a finite positive number',
    );
  });

  it('keeps a later caller queued after a mutex waiter times out', async () => {
    const auditPath = join(tmpDir, 'audit.jsonl');
    const lockdir = `${resolve(auditPath)}.lock`;
    mkdirSync(lockdir);

    const holder = new RSIAuditLog(auditPath, { lockTimeoutMs: 200 });
    const waiter = new RSIAuditLog(auditPath, { lockTimeoutMs: 40 });
    const holderAttempt = holder.log(makeAuditEntry({ mutationId: 'mut-holder' }));
    await new Promise(resolve => setTimeout(resolve, 15));
    await expect(waiter.log(makeAuditEntry({ mutationId: 'mut-waiter' }))).rejects.toMatchObject({
      name: 'AuditLogLockTimeoutError',
    });

    const later = new RSIAuditLog(auditPath, { lockTimeoutMs: 40 });
    const laterAttempt = later.log(makeAuditEntry({ mutationId: 'mut-later' }));
    const laterRejected = expect(laterAttempt).rejects.toMatchObject({
      name: 'AuditLogLockTimeoutError',
    });
    await expect(holderAttempt).rejects.toMatchObject({ name: 'AuditLogLockTimeoutError' });
    await laterRejected;
    expect(existsSync(auditPath)).toBe(false);
    expect(existsSync(lockdir)).toBe(true);

    rmSync(lockdir, { recursive: true, force: true });
    await later.log(makeAuditEntry({ mutationId: 'mut-recovered' }));
    await expect(later.verifyIntegrity()).resolves.toMatchObject({ valid: true, checkedEntries: 1 });
  });

  it('fails closed on lock timeout and writes no line', async () => {
    const auditPath = join(tmpDir, 'audit.jsonl');
    const lockdir = `${resolve(auditPath)}.lock`;
    mkdirSync(lockdir);

    const timed = new RSIAuditLog(auditPath, { lockTimeoutMs: 40 });
    await expect(timed.log(makeAuditEntry({ mutationId: 'mut-timeout' }))).rejects.toMatchObject({
      name: 'AuditLogLockTimeoutError',
      message: expect.stringContaining(lockdir),
    });

    expect(existsSync(auditPath)).toBe(false);
    expect(existsSync(lockdir)).toBe(true);
  });
});
