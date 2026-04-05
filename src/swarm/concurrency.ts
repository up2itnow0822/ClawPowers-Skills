/**
 * ConcurrencyManager — Bounded parallelism with adaptive throttling.
 *
 * Promise-based semaphore that limits concurrent swarm task execution.
 * Mirrors the Python a0-parallel-swarm-plugin ConcurrencyManager.
 */

export class ConcurrencyManager {
  private readonly maxConcurrency: number;
  private readonly backpressureThreshold: number;
  private activeCount = 0;
  private throttleDelayMs = 0;
  private lastErrorTime = 0;

  // Semaphore queue — each entry is a resolver that grants a slot
  private readonly queue: Array<() => void> = [];

  constructor(maxConcurrency = 5, backpressureThreshold = 0.8) {
    this.maxConcurrency = maxConcurrency;
    this.backpressureThreshold = backpressureThreshold;
  }

  /**
   * Acquire a concurrency slot. Resolves when a slot is available.
   * Applies throttle delay if rate limits have been hit recently.
   */
  async acquire(): Promise<void> {
    if (this.activeCount < this.maxConcurrency) {
      this.activeCount++;
    } else {
      // Block until a slot is freed
      await new Promise<void>((resolve) => {
        this.queue.push(resolve);
      });
      this.activeCount++;
    }

    // Apply throttle delay after acquiring (backpressure)
    if (this.throttleDelayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, this.throttleDelayMs));
    }
  }

  /**
   * Release a concurrency slot. Unblocks next queued waiter if any.
   */
  release(): void {
    this.activeCount = Math.max(0, this.activeCount - 1);
    const next = this.queue.shift();
    if (next) next();
  }

  /**
   * Number of currently active tasks.
   */
  get active(): number {
    return this.activeCount;
  }

  /**
   * Number of tasks waiting for a slot.
   */
  get pending(): number {
    return this.queue.length;
  }

  /**
   * Whether system has capacity for another task.
   */
  hasCapacity(): boolean {
    return this.activeCount < this.maxConcurrency;
  }

  /**
   * Increase throttle delay on rate-limit / transient errors.
   * Multiple errors in quick succession cause exponential backoff.
   */
  adaptiveThrottle(_errorType = 'rate_limit'): void {
    const now = Date.now();
    if (now - this.lastErrorTime < 5000) {
      // Multiple errors in <5s — exponential backoff, capped at 30s
      this.throttleDelayMs = Math.min(this.throttleDelayMs * 2 + 500, 30000);
    } else {
      this.throttleDelayMs = 500;
    }
    this.lastErrorTime = now;
  }

  /**
   * Gradually reduce throttle delay after a successful operation.
   */
  resetThrottle(): void {
    this.throttleDelayMs = Math.max(0, this.throttleDelayMs - 100);
  }

  /**
   * Check if system is above backpressure threshold.
   */
  isUnderPressure(): boolean {
    return this.activeCount / this.maxConcurrency >= this.backpressureThreshold;
  }
}
