/**
 * ClawPowers Agent — Episodic Memory
 * JSONL append-only storage for task episodes.
 */

import { readFile, appendFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { EpisodicEntry } from '../types.js';

export class EpisodicMemory {
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

  async append(entry: EpisodicEntry): Promise<void> {
    await this.ensureDir();
    const line = JSON.stringify(entry) + '\n';
    await appendFile(this.filePath, line, 'utf-8');
  }

  async readAll(): Promise<EpisodicEntry[]> {
    if (!existsSync(this.filePath)) {
      return [];
    }
    const content = await readFile(this.filePath, 'utf-8');
    return this.parseLines(content);
  }

  async search(query: string, limit: number = 10): Promise<EpisodicEntry[]> {
    const entries = await this.readAll();
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter(Boolean);

    const scored: Array<{ entry: EpisodicEntry; score: number }> = [];

    for (const entry of entries) {
      const searchText = [
        entry.description,
        ...entry.lessonsLearned,
        ...entry.tags,
      ].join(' ').toLowerCase();

      let score = 0;
      for (const word of queryWords) {
        if (searchText.includes(word)) {
          score += 1;
        }
      }

      // Exact phrase match bonus
      if (searchText.includes(queryLower)) {
        score += queryWords.length;
      }

      if (score > 0) {
        scored.push({ entry, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(s => s.entry);
  }

  async readRecent(count: number): Promise<EpisodicEntry[]> {
    const entries = await this.readAll();
    return entries.slice(-count);
  }

  async recoverFromCorruption(): Promise<{ recovered: number; lost: number }> {
    if (!existsSync(this.filePath)) {
      return { recovered: 0, lost: 0 };
    }

    const content = await readFile(this.filePath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim().length > 0);

    const validLines: string[] = [];
    let lost = 0;

    for (const line of lines) {
      try {
        JSON.parse(line);
        validLines.push(line);
      } catch {
        lost++;
      }
    }

    if (lost > 0) {
      await writeFile(this.filePath, validLines.map(l => l + '\n').join(''), 'utf-8');
    }

    return { recovered: validLines.length, lost };
  }

  private parseLines(content: string): EpisodicEntry[] {
    const lines = content.split('\n').filter(line => line.trim().length > 0);
    const entries: EpisodicEntry[] = [];

    for (const line of lines) {
      try {
        entries.push(JSON.parse(line) as EpisodicEntry);
      } catch {
        // Skip malformed lines
      }
    }

    return entries;
  }
}
