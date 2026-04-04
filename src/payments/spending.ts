/**
 * ClawPowers Agent — Spending Policy
 * Enforces daily limits, per-transaction limits, and domain allowlists.
 * Fail-closed: any policy error results in rejection.
 */

import type { SpendingDecision } from '../types.js';

interface SpendingRecord {
  amount: number;
  timestamp: number;
  domain: string;
}

/**
 * Get the start of the current UTC day as a timestamp.
 */
function getUtcDayStart(): number {
  const now = new Date();
  const utcStart = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    0, 0, 0, 0
  ));
  return utcStart.getTime();
}

export class SpendingPolicy {
  readonly dailyLimit: number;
  readonly transactionLimit: number;
  readonly allowedDomains: readonly string[];

  private spendingLog: SpendingRecord[] = [];

  constructor(options: {
    dailyLimit: number;
    transactionLimit: number;
    allowedDomains: readonly string[];
  }) {
    this.dailyLimit = options.dailyLimit;
    this.transactionLimit = options.transactionLimit;
    this.allowedDomains = options.allowedDomains;
  }

  /**
   * Get total spending for the current UTC day.
   */
  getDailySpent(): number {
    const dayStart = getUtcDayStart();
    return this.spendingLog
      .filter(r => r.timestamp >= dayStart)
      .reduce((sum, r) => sum + r.amount, 0);
  }

  /**
   * Check whether a transaction is allowed under the current policy.
   * Fail-closed: any validation error results in rejection.
   */
  checkTransaction(amount: number, domain: string): SpendingDecision {
    try {
      // Validate amount
      if (amount <= 0 || !Number.isFinite(amount)) {
        return {
          allowed: false,
          reason: `Invalid amount: ${amount}`,
          remainingDaily: this.dailyLimit - this.getDailySpent(),
        };
      }

      // Check per-transaction limit
      if (amount > this.transactionLimit) {
        return {
          allowed: false,
          reason: `Amount $${amount} exceeds per-transaction limit of $${this.transactionLimit}`,
          remainingDaily: this.dailyLimit - this.getDailySpent(),
        };
      }

      // Check domain allowlist (if allowlist is non-empty)
      if (this.allowedDomains.length > 0) {
        const normalizedDomain = domain.toLowerCase();
        const isAllowed = this.allowedDomains.some(
          d => d.toLowerCase() === normalizedDomain
        );
        if (!isAllowed) {
          return {
            allowed: false,
            reason: `Domain "${domain}" is not in the allowed domains list`,
            remainingDaily: this.dailyLimit - this.getDailySpent(),
          };
        }
      }

      // Check daily limit
      const dailySpent = this.getDailySpent();
      if (dailySpent + amount > this.dailyLimit) {
        return {
          allowed: false,
          reason: `Transaction of $${amount} would exceed daily limit of $${this.dailyLimit} (already spent: $${dailySpent})`,
          remainingDaily: this.dailyLimit - dailySpent,
        };
      }

      return {
        allowed: true,
        reason: 'Transaction approved',
        remainingDaily: this.dailyLimit - dailySpent - amount,
      };
    } catch {
      // Fail-closed: any unexpected error = reject
      return {
        allowed: false,
        reason: 'Policy check failed due to internal error — rejecting for safety',
        remainingDaily: 0,
      };
    }
  }

  /**
   * Record a completed spending transaction.
   */
  recordSpend(amount: number, domain: string): void {
    this.spendingLog.push({
      amount,
      timestamp: Date.now(),
      domain,
    });
  }

  /**
   * Reset all spending records (used for testing).
   */
  reset(): void {
    this.spendingLog = [];
  }

  /**
   * Get the full spending log (for audit purposes).
   */
  getSpendingLog(): readonly SpendingRecord[] {
    return [...this.spendingLog];
  }
}
