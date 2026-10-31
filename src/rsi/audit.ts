/**
 * ClawPowers Agent — RSI Audit Log
 * Append-only JSONL audit trail for all RSI actions.
 */

import { createHash } from 'node:crypto';
import { readFile, appendFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { RSIAuditEntry, RSIAuditIntegrityResult } from '../types.js';

const GENESIS_HASH = '0'.repeat(64);

export class RSIAuditLog {
  private readonly filePath: string;
  /**
   * Serializes log() calls on this instance. Without it, two overlapping log()
   * calls both read the same chain tail and append entries claiming the same
   * previousHash, forking the hash chain and permanently marking the
   * append-only log as tampered by verifyIntegrity().
   */
  private writeChain: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  private async ensureDir(): Promise<void> {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
  }

  async log(entry: RSIAuditEntry): Promise<void> {
    const previousWrite = this.writeChain;
    let release!: () => void;
    this.writeChain = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previousWrite;
    try {
      await this.appendEntry(entry);
    } finally {
      release();
    }
  }

  private async appendEntry(entry: RSIAuditEntry): Promise<void> {
    await this.ensureDir();
    const history = await this.getHistory();
    const previousHash = history.at(-1)?.entryHash ?? GENESIS_HASH;
    const chainedEntry = this.withIntegrityFields(entry, previousHash);
    const line = JSON.stringify(chainedEntry) + '\n';
    await appendFile(this.filePath, line, 'utf-8');
  }

  async getHistory(limit?: number): Promise<RSIAuditEntry[]> {
    if (!existsSync(this.filePath)) {
      return [];
    }
    const content = await readFile(this.filePath, 'utf-8');
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
