/**
 * ClawPowers Agent — RSI Audit Log
 * Append-only JSONL audit trail for all RSI actions.
 */

import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, rmdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { RSIAuditEntry, RSIAuditIntegrityResult } from '../types.js';

const GENESIS_HASH = '0'.repeat(64);
const DEFAULT_LOCK_TIMEOUT_MS = 5000;
const LOCK_POLL_MS = 10;

type MutexWaiter = {
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type PathMutex = {
  held: boolean;
  waiters: MutexWaiter[];
};

const mutexByPath = new Map<string, PathMutex>();

type RSIAuditLogOptions = {
  lockTimeoutMs?: number;
};

type RSIAuditLogTestHooks = {
  afterExclusiveLock?: () => Promise<void>;
  beforeAppend?: () => Promise<void>;
};

let testHooks: RSIAuditLogTestHooks | null = null;

/** Test-only hooks. Not exported from the package entry. */
export function setRSIAuditLogTestHooks(hooks: RSIAuditLogTestHooks | null): void {
  testHooks = hooks;
}

class AuditLogLockTimeoutError extends Error {
  constructor(lockdirPath: string) {
    super(`Timed out waiting for audit log lockdir: ${lockdirPath}`);
    this.name = 'AuditLogLockTimeoutError';
  }
}

export class RSIAuditLog {
  private readonly resolvedPath: string;
  private readonly lockTimeoutMs: number;

  constructor(filePath: string, options: RSIAuditLogOptions = {}) {
    this.resolvedPath = resolve(filePath);
    const lockTimeoutMs = options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
    if (!Number.isFinite(lockTimeoutMs) || lockTimeoutMs <= 0) {
      throw new Error('lockTimeoutMs must be a finite positive number');
    }
    this.lockTimeoutMs = lockTimeoutMs;
  }

  private lockdirPath(): string {
    return `${this.resolvedPath}.lock`;
  }

  private async ensureDir(): Promise<void> {
    await mkdir(dirname(this.resolvedPath), { recursive: true });
  }

  async log(entry: RSIAuditEntry): Promise<void> {
    const deadline = Date.now() + this.lockTimeoutMs;
    await this.withPathMutex(deadline, async () => {
      await this.withLockdir(deadline, async () => {
        await this.appendEntry(entry);
      });
    });
  }

  private async withPathMutex(deadline: number, work: () => Promise<void>): Promise<void> {
    const key = this.resolvedPath;
    let state = mutexByPath.get(key);
    if (!state) {
      state = { held: false, waiters: [] };
      mutexByPath.set(key, state);
    }
    const queue = state;

    if (queue.held) {
      await new Promise<void>((resolve, reject) => {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          reject(new AuditLogLockTimeoutError(this.lockdirPath()));
          return;
        }

        const waiter: MutexWaiter = {
          resolve,
          reject,
          timeout: setTimeout(() => {
            const index = queue.waiters.indexOf(waiter);
            if (index < 0) {
              return;
            }
            queue.waiters.splice(index, 1);
            if (!queue.held && queue.waiters.length === 0) {
              mutexByPath.delete(key);
            }
            reject(new AuditLogLockTimeoutError(this.lockdirPath()));
          }, remaining),
        };
        queue.waiters.push(waiter);
      });
    }

    queue.held = true;
    try {
      if (Date.now() >= deadline) {
        throw new AuditLogLockTimeoutError(this.lockdirPath());
      }
      await work();
    } finally {
      const next = queue.waiters.shift();
      if (next) {
        clearTimeout(next.timeout);
        next.resolve();
      } else {
        queue.held = false;
        if (queue.waiters.length === 0) {
          mutexByPath.delete(key);
        }
      }
    }
  }

  private async awaitUntilDeadline(pending: Promise<void>, deadline: number): Promise<void> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new AuditLogLockTimeoutError(this.lockdirPath());
    }

    const controller = new AbortController();
    const timeout = delay(remaining, undefined, { signal: controller.signal }).then(() => {
      throw new AuditLogLockTimeoutError(this.lockdirPath());
    });
    void timeout.catch(() => undefined);

    try {
      await Promise.race([pending, timeout]);
    } finally {
      controller.abort();
    }
  }

  private async withLockdir(deadline: number, work: () => Promise<void>): Promise<void> {
    await this.ensureDir();
    const lockdir = this.lockdirPath();
    let acquired = false;

    try {
      while (!acquired) {
        try {
          await mkdir(lockdir);
          acquired = true;
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === 'EEXIST') {
            await this.awaitUntilDeadline(delay(LOCK_POLL_MS), deadline);
            continue;
          }
          throw error;
        }
      }

      if (testHooks?.afterExclusiveLock) {
        await testHooks.afterExclusiveLock();
      }

      if (Date.now() >= deadline) {
        throw new AuditLogLockTimeoutError(lockdir);
      }

      await work();
    } finally {
      if (acquired) {
        try {
          await rmdir(lockdir);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
          }
        }
      }
    }
  }

  private async appendEntry(entry: RSIAuditEntry): Promise<void> {
    if (testHooks?.beforeAppend) {
      await testHooks.beforeAppend();
    }
    const history = await this.getHistory();
    const previousHash = history.at(-1)?.entryHash ?? GENESIS_HASH;
    const chainedEntry = this.withIntegrityFields(entry, previousHash);
    const line = JSON.stringify(chainedEntry) + '\n';
    await appendFile(this.resolvedPath, line, 'utf-8');
  }

  async getHistory(limit?: number): Promise<RSIAuditEntry[]> {
    let content: string;
    try {
      content = await readFile(this.resolvedPath, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
    const lines = content.split('\n').filter(l => l.trim().length > 0);
    const entries: RSIAuditEntry[] = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line) as RSIAuditEntry);
      } catch {
        // Skip malformed
      }
    }
    if (limit !== undefined) {
      return entries.slice(-limit);
    }
    return entries;
  }

  async getByMutation(mutationId: string): Promise<RSIAuditEntry[]> {
    const all = await this.getHistory();
    return all.filter(e => e.mutationId === mutationId);
  }

  async verifyIntegrity(): Promise<RSIAuditIntegrityResult> {
    const history = await this.getHistory();
    let previousHash = GENESIS_HASH;

    for (const [index, entry] of history.entries()) {
      if (entry.previousHash !== previousHash) {
        return {
          valid: false,
          checkedEntries: index,
          failedAt: index,
          reason: 'previousHash does not match prior entryHash',
        };
      }

      const expectedHash = this.hashEntry({ ...entry, entryHash: undefined }, previousHash);
      if (entry.entryHash !== expectedHash) {
        return {
          valid: false,
          checkedEntries: index,
          failedAt: index,
          reason: 'entryHash does not match entry contents',
        };
      }

      previousHash = entry.entryHash;
    }

    return {
      valid: true,
      checkedEntries: history.length,
      failedAt: null,
      reason: null,
    };
  }

  private withIntegrityFields(entry: RSIAuditEntry, previousHash: string): RSIAuditEntry {
    const baseEntry: RSIAuditEntry = {
      ...entry,
      previousHash,
      entryHash: undefined,
    };

    return {
      ...baseEntry,
      entryHash: this.hashEntry(baseEntry, previousHash),
    };
  }

  private hashEntry(entry: RSIAuditEntry, previousHash: string): string {
    const canonical = JSON.stringify({
      timestamp: entry.timestamp,
      action: entry.action,
      skillName: entry.skillName,
      mutationId: entry.mutationId,
      hypothesis: entry.hypothesis,
      metrics: entry.metrics,
      decision: entry.decision,
      previousHash,
    });

    return createHash('sha256').update(canonical).digest('hex');
  }
}
