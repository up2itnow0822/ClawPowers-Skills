/**
 * TokenPool — Centralized token budget manager for swarm parallel execution.
 *
 * Enforces a total token budget across all parallel agents via pre-allocation.
 * Single-threaded JS means no locking needed — operations are synchronous.
 *
 * Mirrors the Python a0-parallel-swarm-plugin TokenPool.
 */

import type { TokenAllocation, TokenUsageReport } from './types.js';

export class TokenPool {
  readonly totalBudget: number;
  readonly perTaskDefault: number;
  private readonly allocations: Map<string, TokenAllocation> = new Map();

  constructor(totalBudget = 100_000, perTaskDefault = 20_000) {
    this.totalBudget = totalBudget;
    this.perTaskDefault = perTaskDefault;
  }

  /**
   * Reserve tokens for a task.
   * Returns false if the pool doesn't have enough remaining budget.
   */
  allocate(taskId: string, budget?: number): boolean {
    const requested = budget ?? this.perTaskDefault;
    const currentAllocated = this.totalAllocated();
    if (currentAllocated + requested > this.totalBudget) {
      return false;
    }
    this.allocations.set(taskId, {
      task_id: taskId,
      budget: requested,
      consumed: 0,
      allocated_at: Date.now(),
    });
    return true;
  }

  /**
   * Record actual token usage for a task (cumulative).
   */
  consume(taskId: string, tokens: number): void {
    const alloc = this.allocations.get(taskId);
    if (alloc) {
      alloc.consumed += tokens;
    }
  }

  /**
   * Free the allocation when a task completes.
   * Returns tokens consumed by that task.
   */
  release(taskId: string): number {
    const alloc = this.allocations.get(taskId);
    this.allocations.delete(taskId);
    return alloc?.consumed ?? 0;
  }

  /**
   * Total remaining budget (total - allocated).
   */
  remaining(): number {
    return this.totalBudget - this.totalAllocated();
  }

  /**
   * Total tokens consumed across all active tasks.
   */
  consumed(): number {
    let total = 0;
    for (const alloc of this.allocations.values()) {
      total += alloc.consumed;
    }
    return total;
  }

  /**
   * Total tokens currently allocated (reserved but not necessarily consumed).
   */
  totalAllocated(): number {
    let total = 0;
    for (const alloc of this.allocations.values()) {
      total += alloc.budget;
    }
    return total;
  }

  /**
   * Check if a specific task has exceeded its allocation.
   */
  isTaskOverBudget(taskId: string): boolean {
    const alloc = this.allocations.get(taskId);
    if (!alloc) return false;
    return alloc.consumed >= alloc.budget;
  }

  /**
   * Remaining budget for a specific task.
   */
  taskBudgetRemaining(taskId: string): number {
    const alloc = this.allocations.get(taskId);
    if (!alloc) return 0;
    return Math.max(0, alloc.budget - alloc.consumed);
  }

  /**
   * Per-task token consumption summary for observability.
   */
  usageReport(): TokenUsageReport {
    const tasks: TokenUsageReport['tasks'] = {};
    let totalConsumed = 0;
    let totalAllocated = 0;

    for (const [taskId, alloc] of this.allocations.entries()) {
      tasks[taskId] = {
        budget: alloc.budget,
        consumed: alloc.consumed,
        remaining: Math.max(0, alloc.budget - alloc.consumed),
        over_budget: alloc.consumed >= alloc.budget,
      };
      totalConsumed += alloc.consumed;
      totalAllocated += alloc.budget;
    }

    return {
      total_budget: this.totalBudget,
      total_allocated: totalAllocated,
      total_consumed: totalConsumed,
      total_remaining: this.totalBudget - totalAllocated,
      tasks,
    };
  }

  /**
   * Clear all allocations (reset between runs).
   */
  reset(): void {
    this.allocations.clear();
  }
}
