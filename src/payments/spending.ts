/**
 * ClawPowers Agent — Spending Policy
 * Enforces daily limits, an optional rolling weekly limit, per-transaction
 * limits, and domain allowlists.
 * Fail-closed: any policy error results in rejection.
 * The spend log can be exported (`exportState()`/`serialize()`) and rehydrated
 * (`importState()`/`deserialize()`/`state` option) so counters survive restarts.
 */

import type { SpendingDecision } from '../types.js';

export type ReservationState = 'reserved' | 'settled' | 'unknown';

export interface SpendingRecord {
  amount: number;
  timestamp: number;
  domain: string;
  state: ReservationState;
}

/** Opaque handle for a reserved spend that can be released only when not charged. */
export type SpendReservation = SpendingRecord;

/**
 * Serializable snapshot of a policy's spend history. Persist this (e.g. to disk)
 * and pass it back through the constructor / `importState()` / `deserialize()` so
 * the daily and weekly counters survive a process restart instead of silently
 * resetting to zero.
 */
export interface SpendingPolicyState {
  readonly version: number;
  readonly records: readonly SpendingRecord[];
}

/** Current serialization version for {@link SpendingPolicyState}. */
export const SPENDING_POLICY_STATE_VERSION = 1;

export interface SpendingPolicyOptions {
  dailyLimit: number;
  transactionLimit: number;
  allowedDomains: readonly string[];
  /**
   * Optional rolling 7-day (weekly) spending limit. When omitted, no weekly cap
   * is enforced, preserving the historical daily-only behavior.
   */
  weeklyLimit?: number;
  /**
   * Optional persisted state to rehydrate this policy from. Use this after a
   * restart to restore spend counters from a previously exported snapshot.
   */
  state?: SpendingPolicyState | null;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function isValidSpendingRecord(value: unknown): value is SpendingRecord {
  if (value === null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.amount === 'number' &&
    Number.isFinite(record.amount) &&
    record.amount >= 0 &&
    typeof record.timestamp === 'number' &&
    Number.isFinite(record.timestamp) &&
    typeof record.domain === 'string' &&
    (record.state === 'reserved' || record.state === 'settled' || record.state === 'unknown')
  );
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
  readonly weeklyLimit?: number;

  private spendingLog: SpendingRecord[] = [];

  constructor(options: SpendingPolicyOptions) {
    this.dailyLimit = options.dailyLimit;
    this.transactionLimit = options.transactionLimit;
    this.allowedDomains = options.allowedDomains;
    this.weeklyLimit = options.weeklyLimit;
    if (options.state !== undefined && options.state !== null) {
      this.importState(options.state);
    }
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
   * Get total spending for the trailing 7-day (weekly) window.
   */
  getWeeklySpent(): number {
    const weekStart = Date.now() - WEEK_MS;
    return this.spendingLog
      .filter(r => r.timestamp >= weekStart)
      .reduce((sum, r) => sum + r.amount, 0);
  }

  /**
   * Check whether a transaction is allowed under the current policy.
   * Fail-closed: any validation error results in rejection.
   */
  checkTransaction(amount: number, domain: string): SpendingDecision {
    try {
      // Validate amount (rejects null/undefined/NaN/Infinity/negative/zero)
      if (!Number.isFinite(amount) || amount <= 0) {
        return {
          allowed: false,
          reason: `Invalid amount: ${String(amount)}`,
          remainingDaily: this.dailyLimit - this.getDailySpent(),
        };
      }

      // Validate domain
      if (typeof domain !== 'string' || domain.trim().length === 0) {
        return {
          allowed: false,
          reason: 'Invalid domain: a non-empty string is required',
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

      // Check weekly (rolling 7-day) limit when configured
      const weeklyLimit = this.weeklyLimit;
      if (weeklyLimit !== undefined && Number.isFinite(weeklyLimit)) {
        const weeklySpent = this.getWeeklySpent();
        if (weeklySpent + amount > weeklyLimit) {
          return {
            allowed: false,
            reason: `Transaction of $${amount} would exceed weekly limit of $${weeklyLimit} (already spent: $${weeklySpent})`,
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
   * Atomically check the policy and reserve the amount if allowed.
   * Safe to call from concurrent payment attempts — the reservation is
   * visible to the next check before any await yields.
   */
  reserveTransaction(amount: number, domain: string): {
    decision: SpendingDecision;
    reservation?: SpendReservation;
  } {
    const decision = this.checkTransaction(amount, domain);
    if (!decision.allowed) {
      return { decision };
    }
    const reservation: SpendReservation = {
      amount,
      timestamp: Date.now(),
      domain,
      state: 'reserved',
    };
    this.spendingLog.push(reservation);
    return { decision, reservation };
  }

  /**
   * Release a reservation only when the client confirms the payer was not charged.
   */
  voidReservation(reservation: SpendReservation): void {
    const idx = this.spendingLog.indexOf(reservation);
    if (idx >= 0) {
      this.spendingLog.splice(idx, 1);
    }
  }

  /**
   * Keep a reservation counted after an ambiguous settlement (timeout/throw).
   */
  markReservationUnknown(reservation: SpendReservation): void {
    if (this.spendingLog.includes(reservation)) {
      reservation.state = 'unknown';
    }
  }

  /**
   * Mark a reservation as settled after a confirmed charge.
   */
  settleReservation(reservation: SpendReservation): void {
    if (this.spendingLog.includes(reservation)) {
      reservation.state = 'settled';
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
      state: 'settled',
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

  // ─── Persistence ────────────────────────────────────────────────────────────

  /**
   * Export a serializable snapshot of the current spend history. Persist this
   * across restarts and rehydrate it with `importState()` (or the `state`
   * constructor option) so spend counters are not silently reset to zero.
   */
  exportState(): SpendingPolicyState {
    return {
      version: SPENDING_POLICY_STATE_VERSION,
      records: this.spendingLog.map((record) => ({ ...record })),
    };
  }

  /**
   * Replace the in-memory spend history with a previously exported snapshot.
   * Throws on null/undefined or malformed input so corruption is never silent.
   */
  importState(state: SpendingPolicyState | null | undefined): void {
    if (
      state === null ||
      state === undefined ||
      typeof state !== 'object' ||
      !Array.isArray(state.records)
    ) {
      throw new Error(
        'Invalid spending policy state: expected an object with a "records" array',
      );
    }

    const records: SpendingRecord[] = state.records.map((record, index) => {
      if (!isValidSpendingRecord(record)) {
        throw new Error(
          `Invalid spending policy state: record at index ${index} is malformed`,
        );
      }
      return { ...record };
    });

    this.spendingLog = records;
  }

  /**
   * Serialize the spend history to a JSON string for durable storage.
   */
  serialize(): string {
    return JSON.stringify(this.exportState());
  }

  /**
   * Rehydrate a policy from a JSON string produced by `serialize()`.
   */
  static deserialize(
    json: string,
    options: Omit<SpendingPolicyOptions, 'state'>,
  ): SpendingPolicy {
    if (typeof json !== 'string' || json.trim().length === 0) {
      throw new Error('Invalid spending policy state: expected a JSON string');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new Error('Invalid spending policy state: could not parse JSON');
    }
    return SpendingPolicy.fromState(parsed as SpendingPolicyState, options);
  }

  /**
   * Build a policy from an already-parsed state snapshot.
   */
  static fromState(
    state: SpendingPolicyState,
    options: Omit<SpendingPolicyOptions, 'state'>,
  ): SpendingPolicy {
    return new SpendingPolicy({ ...options, state });
  }

  /** Alias for {@link SpendingPolicy.deserialize}. */
  static fromJSON(
    json: string,
    options: Omit<SpendingPolicyOptions, 'state'>,
  ): SpendingPolicy {
    return SpendingPolicy.deserialize(json, options);
  }

  /**
   * Snapshot the current state. Enables `JSON.stringify(policy)` round-trips.
   */
  toJSON(): SpendingPolicyState {
    return this.exportState();
  }

  /** Alias for {@link SpendingPolicy.exportState}. */
  snapshot(): SpendingPolicyState {
    return this.exportState();
  }

  /** Alias for {@link SpendingPolicy.importState}. */
  restore(state: SpendingPolicyState | null | undefined): void {
    this.importState(state);
  }

  /** Alias for {@link SpendingPolicy.importState}. */
  rehydrate(state: SpendingPolicyState | null | undefined): void {
    this.importState(state);
  }
}
