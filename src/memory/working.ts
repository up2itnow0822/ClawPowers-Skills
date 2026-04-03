/**
 * ClawPowers Agent — Working Memory Manager
 * In-process working memory with token budget enforcement.
 */

import type { Goal, Plan, WorkingMemory } from '../types.js';
import { PERFORMANCE } from '../constants.js';

/**
 * Estimate token count from text using simple approximation.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export class WorkingMemoryManager {
  private memory: WorkingMemory | null = null;

  create(taskId: string, goal: Goal): WorkingMemory {
    const emptyPlan: Plan = {
      taskId,
      steps: [],
      status: 'draft',
      createdAt: new Date().toISOString(),
      approvedAt: null,
      parallelizable: false,
    };

    this.memory = {
      taskId,
      goal,
      plan: emptyPlan,
      currentStepId: null,
      intermediateOutputs: {},
      contextWindow: [],
    };

    return this.memory;
  }

  updateCurrentStep(stepId: string): void {
    if (!this.memory) {
      throw new Error('Working memory not initialized. Call create() first.');
    }
    this.memory = {
      ...this.memory,
      currentStepId: stepId,
    };
  }

  addIntermediateOutput(stepId: string, output: string): void {
    if (!this.memory) {
      throw new Error('Working memory not initialized. Call create() first.');
    }
    this.memory = {
      ...this.memory,
      intermediateOutputs: {
        ...this.memory.intermediateOutputs,
        [stepId]: output,
      },
    };
  }

  /**
   * Inject context entries into working memory, enforcing token budget.
   * Entries are added until the budget is exhausted, then truncated.
   */
  injectContext(entries: readonly string[]): void {
    if (!this.memory) {
      throw new Error('Working memory not initialized. Call create() first.');
    }

    const maxTokens = PERFORMANCE.maxContextTokens;
    const injected: string[] = [];
    let totalTokens = 0;

    for (const entry of entries) {
      const entryTokens = estimateTokens(entry);
      if (totalTokens + entryTokens > maxTokens) {
        // Try to fit a truncated version
        const remainingTokens = maxTokens - totalTokens;
        if (remainingTokens > 10) {
          const truncatedLength = remainingTokens * 4;
          injected.push(entry.slice(0, truncatedLength) + '...');
        }
        break;
      }
      totalTokens += entryTokens;
      injected.push(entry);
    }

    this.memory = {
      ...this.memory,
      contextWindow: injected,
    };
  }

  getSnapshot(): WorkingMemory {
    if (!this.memory) {
      throw new Error('Working memory not initialized. Call create() first.');
    }
    return this.memory;
  }

  clear(): void {
    this.memory = null;
  }
}
