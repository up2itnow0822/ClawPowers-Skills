/**
 * ClawPowers Agent — RSI Audit Log
 * Append-only JSONL audit trail for all RSI actions.
 */

import { readFile, appendFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { RSIAuditEntry } from '../types.js';

export class RSIAuditLog {
  private readonly filePath: string;

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
    await this.ensureDir();
    const line = JSON.stringify(entry) + '\n';
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
}
