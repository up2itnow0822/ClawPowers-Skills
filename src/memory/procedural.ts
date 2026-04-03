/**
 * ClawPowers Agent — Procedural Memory
 * JSON-based skill effectiveness tracking with atomic writes.
 */

import { readFile, writeFile, rename, mkdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ProceduralEntry, MutationRecord } from '../types.js';

export class ProceduralMemory {
  private readonly filePath: string;
  private cache: ProceduralEntry[] | null = null;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  private async ensureDir(): Promise<void> {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
  }

  async load(): Promise<ProceduralEntry[]> {
    if (!existsSync(this.filePath)) {
      this.cache = [];
      return [];
    }
    const content = await readFile(this.filePath, 'utf-8');
    const entries = JSON.parse(content) as ProceduralEntry[];
    this.cache = entries;
    return entries;
  }

  async update(
    skillName: string,
    result: { succeeded: boolean; durationMs: number; taskId: string }
  ): Promise<void> {
    const entries = await this.load();
    const existing = entries.find(e => e.skillName === skillName);

    if (existing) {
      const newCount = existing.invocationCount + 1;
      const successCount = Math.round(existing.successRate * existing.invocationCount) + (result.succeeded ? 1 : 0);
      const newSuccessRate = successCount / newCount;
      const newAvgContribution =
        (existing.avgContribution * existing.invocationCount + result.durationMs) / newCount;

      const updated: ProceduralEntry = {
        ...existing,
        invocationCount: newCount,
        successRate: newSuccessRate,
        avgContribution: newAvgContribution,
        lastUsed: new Date().toISOString(),
      };

      const index = entries.indexOf(existing);
      entries[index] = updated;
    } else {
      const newEntry: ProceduralEntry = {
        skillName,
        invocationCount: 1,
        successRate: result.succeeded ? 1 : 0,
        avgContribution: result.durationMs,
        preferredContexts: [],
        lastUsed: new Date().toISOString(),
        mutations: [],
      };
      entries.push(newEntry);
    }

    await this.atomicWrite(entries);
    this.cache = entries;
  }

  getSkillScore(skillName: string): ProceduralEntry | null {
    if (!this.cache) {
      return null;
    }
    return this.cache.find(e => e.skillName === skillName) ?? null;
  }

  getTopSkills(context: string, limit: number): ProceduralEntry[] {
    if (!this.cache) {
      return [];
    }

    const contextLower = context.toLowerCase();
    const contextWords = contextLower.split(/\s+/).filter(Boolean);

    const scored: Array<{ entry: ProceduralEntry; score: number }> = [];

    for (const entry of this.cache) {
      let score = entry.successRate * entry.invocationCount;

      // Boost if context matches preferred contexts
      for (const preferred of entry.preferredContexts) {
        const prefLower = preferred.toLowerCase();
        for (const word of contextWords) {
          if (prefLower.includes(word)) {
            score += 2;
          }
        }
      }

      // Boost if skill name matches context
      if (contextLower.includes(entry.skillName.toLowerCase())) {
        score += 5;
      }

      scored.push({ entry, score });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(s => s.entry);
  }

  async recordMutation(skillName: string, mutation: MutationRecord): Promise<void> {
    const entries = await this.load();
    const existing = entries.find(e => e.skillName === skillName);

    if (!existing) {
      throw new Error(`Skill "${skillName}" not found in procedural memory`);
    }

    const updated: ProceduralEntry = {
      ...existing,
      mutations: [...existing.mutations, mutation],
    };

    const index = entries.indexOf(existing);
    entries[index] = updated;

    await this.atomicWrite(entries);
    this.cache = entries;
  }

  async rollbackMutation(skillName: string, mutationId: string): Promise<void> {
    const entries = await this.load();
    const existing = entries.find(e => e.skillName === skillName);

    if (!existing) {
      throw new Error(`Skill "${skillName}" not found in procedural memory`);
    }

    const mutation = existing.mutations.find(m => m.mutationId === mutationId);
    if (!mutation) {
      throw new Error(`Mutation "${mutationId}" not found for skill "${skillName}"`);
    }

    const updatedMutations = existing.mutations.map(m => {
      if (m.mutationId === mutationId) {
        return {
          ...m,
          status: 'reverted' as const,
          revertedAt: new Date().toISOString(),
        };
      }
      return m;
    });

    const updated: ProceduralEntry = {
      ...existing,
      mutations: updatedMutations,
    };

    const index = entries.indexOf(existing);
    entries[index] = updated;

    await this.atomicWrite(entries);
    this.cache = entries;
  }

  private async atomicWrite(entries: ProceduralEntry[]): Promise<void> {
    await this.ensureDir();

    // Backup existing file
    if (existsSync(this.filePath)) {
      await copyFile(this.filePath, this.filePath + '.bak');
    }

    // Write to temp file then rename
    const tmpPath = this.filePath + '.tmp';
    await writeFile(tmpPath, JSON.stringify(entries, null, 2) + '\n', 'utf-8');
    await rename(tmpPath, this.filePath);
  }
}
