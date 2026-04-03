/**
 * ClawPowers Agent — Context Injector
 * Selects and compresses relevant memories for working memory injection.
 */

import type { Goal, EpisodicEntry, ProceduralEntry } from '../types.js';
import type { EpisodicMemory } from './episodic.js';
import type { ProceduralMemory } from './procedural.js';

const DEFAULT_MAX_TOKENS = 2000;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function compressEpisodicEntry(entry: EpisodicEntry): string {
  const date = entry.timestamp.slice(0, 10);
  const skills = entry.skillsUsed.length > 0 ? ` (${entry.skillsUsed.join(', ')})` : '';
  const lesson = entry.lessonsLearned.length > 0 ? ` Lesson: ${entry.lessonsLearned[0]}` : '';
  return `[${date}] '${entry.description.slice(0, 80)}' → ${entry.outcome}${skills}${lesson}`;
}

function compressProceduralEntry(entry: ProceduralEntry): string {
  const rate = Math.round(entry.successRate * 100);
  return `[skill] ${entry.skillName}: ${rate}% success over ${entry.invocationCount} invocations`;
}

function scoreEpisodicEntry(entry: EpisodicEntry, goalWords: readonly string[]): number {
  const text = [entry.description, ...entry.lessonsLearned, ...entry.tags].join(' ').toLowerCase();
  let score = 0;

  for (const word of goalWords) {
    if (text.includes(word)) {
      score += 1;
    }
  }

  // Recency bonus: more recent entries score higher
  const ageMs = Date.now() - new Date(entry.timestamp).getTime();
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  score += Math.max(0, 10 - ageDays) / 10; // Up to 1 point for recency

  return score;
}

export class ContextInjector {
  private readonly episodic: EpisodicMemory;
  private readonly procedural: ProceduralMemory;

  constructor(episodic: EpisodicMemory, procedural: ProceduralMemory) {
    this.episodic = episodic;
    this.procedural = procedural;
  }

  async inject(goal: Goal, maxTokens: number = DEFAULT_MAX_TOKENS): Promise<string[]> {
    const goalWords = goal.description.toLowerCase().split(/\s+/).filter(w => w.length > 2);

    // Score and sort episodic entries
    const allEpisodic = await this.episodic.readAll();
    const scoredEpisodic = allEpisodic
      .map(entry => ({ entry, score: scoreEpisodicEntry(entry, goalWords) }))
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score);

    // Get procedural entries
    const allProcedural = await this.procedural.load();
    const relevantProcedural = allProcedural
      .filter(entry => {
        const nameLower = entry.skillName.toLowerCase();
        return goalWords.some(w => nameLower.includes(w) || w.includes(nameLower));
      })
      .sort((a, b) => b.successRate * b.invocationCount - a.successRate * a.invocationCount);

    // Interleave: 2 episodic, 1 procedural, repeat
    const results: string[] = [];
    let totalTokens = 0;
    let eIdx = 0;
    let pIdx = 0;

    while (totalTokens < maxTokens && (eIdx < scoredEpisodic.length || pIdx < relevantProcedural.length)) {
      // Add up to 2 episodic entries
      for (let i = 0; i < 2 && eIdx < scoredEpisodic.length; i++, eIdx++) {
        const compressed = compressEpisodicEntry(scoredEpisodic[eIdx]!.entry);
        const tokens = estimateTokens(compressed);
        if (totalTokens + tokens > maxTokens) {
          return results;
        }
        results.push(compressed);
        totalTokens += tokens;
      }

      // Add 1 procedural entry
      if (pIdx < relevantProcedural.length) {
        const compressed = compressProceduralEntry(relevantProcedural[pIdx]!);
        const tokens = estimateTokens(compressed);
        if (totalTokens + tokens > maxTokens) {
          return results;
        }
        results.push(compressed);
        totalTokens += tokens;
        pIdx++;
      }
    }

    return results;
  }
}
