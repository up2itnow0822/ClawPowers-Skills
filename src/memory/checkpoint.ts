/**
 * ClawPowers Agent — Checkpoint Manager
 * Crash recovery via atomic checkpoint files.
 */

import { readFile, writeFile, rename, unlink, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { CheckpointState, CheckpointInfo } from '../types.js';

const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

export class CheckpointManager {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  private async ensureDir(): Promise<void> {
    if (!existsSync(this.dir)) {
      await mkdir(this.dir, { recursive: true });
    }
  }

  private filePath(taskId: string): string {
    return join(this.dir, `${taskId}.json`);
  }

  async save(taskId: string, state: CheckpointState): Promise<void> {
    await this.ensureDir();
    const path = this.filePath(taskId);
    const tmpPath = path + '.tmp';
    await writeFile(tmpPath, JSON.stringify(state, null, 2) + '\n', 'utf-8');
    await rename(tmpPath, path);
  }

  async load(taskId: string): Promise<CheckpointState | null> {
    const path = this.filePath(taskId);
    if (!existsSync(path)) {
      return null;
    }
    const content = await readFile(path, 'utf-8');
    return JSON.parse(content) as CheckpointState;
  }

  async remove(taskId: string): Promise<void> {
    const path = this.filePath(taskId);
    if (existsSync(path)) {
      await unlink(path);
    }
  }

  async listIncomplete(): Promise<CheckpointInfo[]> {
    await this.ensureDir();
    const files = await readdir(this.dir);
    const results: CheckpointInfo[] = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      const path = join(this.dir, file);
      try {
        const content = await readFile(path, 'utf-8');
        const state = JSON.parse(content) as CheckpointState;

        if (state.agentStatus !== 'complete' && state.agentStatus !== 'failed') {
          results.push({
            taskId: state.taskId,
            description: state.goal.description,
            savedAt: state.savedAt,
            isStale: this.isStale(state),
          });
        }
      } catch {
        // Skip corrupt checkpoint files
      }
    }

    return results;
  }

  isStale(checkpoint: CheckpointState, maxAgeMs: number = DEFAULT_MAX_AGE_MS): boolean {
    const savedTime = new Date(checkpoint.savedAt).getTime();
    const now = Date.now();
    return now - savedTime > maxAgeMs;
  }
}
