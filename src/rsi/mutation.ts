/**
 * ClawPowers Agent — RSI Mutation Engine
 * Creates and manages mutations from hypotheses with tier enforcement.
 */

import { readFile, appendFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SAFETY_INVARIANTS } from '../constants.js';
import type { RSIHypothesis, RSIMutationExtended, RSIMutationExtendedStatus } from '../types.js';

export class MutationEngine {
  private readonly historyPath: string;

  constructor(historyPath: string) {
    this.historyPath = historyPath;
  }

  private async ensureDir(): Promise<void> {
    const dir = dirname(this.historyPath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
  }

  createMutation(hypothesis: RSIHypothesis): RSIMutationExtended {
    // Safety check: never mutate safety invariants
    this.validateSafety(hypothesis);

    const initialStatus: RSIMutationExtendedStatus =
      hypothesis.tier === 'T4' ? 'proposed' : 'proposed';

    return {
      mutationId: randomUUID(),
      hypothesisId: hypothesis.hypothesisId,
      skillName: hypothesis.skillName,
      tier: hypothesis.tier,
      description: hypothesis.description,
      originalValue: '',
      mutatedValue: hypothesis.description,
      status: initialStatus,
      appliedAt: null,
      revertedAt: null,
    };
  }

  async applyMutation(mutation: RSIMutationExtended): Promise<void> {
    // Safety check
    if (this.isSafetyInvariant(mutation.skillName)) {
      throw new Error(
        `Cannot mutate safety invariant: ${mutation.skillName}. ` +
        `Safety invariants are: ${SAFETY_INVARIANTS.join(', ')}`
      );
    }

    // T4 never auto-applies
    if (mutation.tier === 'T4') {
      throw new Error(
        'T4 mutations (Architecture) cannot be auto-applied. They must be proposed and reviewed by a human.'
      );
    }

    const applied: RSIMutationExtended = {
      ...mutation,
      status: 'applied',
      appliedAt: new Date().toISOString(),
    };

    await this.appendHistory(applied);
  }

  async revertMutation(mutation: RSIMutationExtended): Promise<void> {
    const reverted: RSIMutationExtended = {
      ...mutation,
      status: 'reverted',
      revertedAt: new Date().toISOString(),
    };

    await this.appendHistory(reverted);
  }

  async getMutationHistory(): Promise<RSIMutationExtended[]> {
    if (!existsSync(this.historyPath)) {
      return [];
    }
    const content = await readFile(this.historyPath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim().length > 0);
    const results: RSIMutationExtended[] = [];
    for (const line of lines) {
      try {
        results.push(JSON.parse(line) as RSIMutationExtended);
      } catch {
        // Skip malformed
      }
    }
    return results;
  }

  private async appendHistory(mutation: RSIMutationExtended): Promise<void> {
    await this.ensureDir();
    const line = JSON.stringify(mutation) + '\n';
    await appendFile(this.historyPath, line, 'utf-8');
  }

  private validateSafety(hypothesis: RSIHypothesis): void {
    if (this.isSafetyInvariant(hypothesis.skillName)) {
      throw new Error(
        `Cannot create mutation targeting safety invariant: ${hypothesis.skillName}`
      );
    }
  }

  private isSafetyInvariant(name: string): boolean {
    const nameLower = name.toLowerCase();
    return SAFETY_INVARIANTS.some(invariant =>
      nameLower.includes(invariant.toLowerCase()) ||
      invariant.toLowerCase().includes(nameLower)
    );
  }
}
