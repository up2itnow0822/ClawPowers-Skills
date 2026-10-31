/**
 * ClawPowers Agent — Spending Policy
 * Enforces daily limits, per-transaction limits, and domain allowlists.
 * Fail-closed: any policy error results in rejection.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { SpendingDecision } from '../types.js';

export type ReservationState = 'reserved' | 'settled' | 'unknown';

/** Documented allowance for slightly-fast clocks when validating stored timestamps. */
export const CLOCK_SKEW_MS = 300_000;

/** Minimum HMAC key length (NIST SP 800-224: at least 128 bits). */
export const MIN_INTEGRITY_KEY_BYTES = 16;

export type IntegrityKey = string | Uint8Array | Buffer;

const PERSIST_VERSION = 1;
const FAIL_CLOSED_REASON = 'Spending policy persist integrity failed — refusing spends';
const PERSIST_WRITE_REASON = 'Spending policy persist write failed — refusing reservation';

interface SpendingRecord {
  amount: number;
  timestamp: number;
  domain: string;
  state: ReservationState;
}

/** Opaque handle for a reserved spend that can be released only when not charged. */
export type SpendReservation = SpendingRecord;

const ReservationStateSchema = z.enum(['reserved', 'settled', 'unknown']);

const SpendingRecordSchema = z.object({
  amount: z.number(),
  timestamp: z.number(),
  domain: z.string(),
  state: ReservationStateSchema,
});

const PersistEnvelopeSchema = z.object({
  version: z.literal(PERSIST_VERSION),
  records: z.array(SpendingRecordSchema),
  mac: z.string().min(1),
});

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

function cloneRecord(record: SpendingRecord): SpendingRecord {
  return {
    amount: record.amount,
    timestamp: record.timestamp,
    domain: record.domain,
    state: record.state,
  };
}

function keyBytes(key: IntegrityKey | undefined): Buffer | null {
  if (key === undefined) {
    return null;
  }
  if (typeof key === 'string') {
    return Buffer.from(key, 'utf8');
  }
  if (key instanceof Uint8Array) {
    return Buffer.from(key);
  }
  return null;
}

function usableKey(key: IntegrityKey | undefined): Buffer | null {
  const bytes = keyBytes(key);
  if (bytes === null || bytes.length < MIN_INTEGRITY_KEY_BYTES) {
    return null;
  }
  return bytes;
}

function canonicalPayload(records: readonly SpendingRecord[]): string {
  return JSON.stringify({
    version: PERSIST_VERSION,
    records: records.map(record => ({
      amount: record.amount,
      timestamp: record.timestamp,
      domain: record.domain,
      state: record.state,
    })),
  });
}

function computeMac(key: Buffer, records: readonly SpendingRecord[]): Buffer {
  return createHmac('sha256', key).update(canonicalPayload(records)).digest();
}

function macHex(key: Buffer, records: readonly SpendingRecord[]): string {
  return computeMac(key, records).toString('hex');
}

function macMatches(key: Buffer, records: readonly SpendingRecord[], hex: string): boolean {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) {
    return false;
  }
  const provided = Buffer.from(hex, 'hex');
  const expected = computeMac(key, records);
  if (provided.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(provided, expected);
}

function ensureParentDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function writeSignedEnvelope(filePath: string, key: Buffer, records: readonly SpendingRecord[], flag?: 'wx'): void {
  const envelope = {
    version: PERSIST_VERSION,
    records: records.map(cloneRecord),
    mac: macHex(key, records),
  };
  const body = `${JSON.stringify(envelope, null, 2)}\n`;
  if (flag === 'wx') {
    writeFileSync(filePath, body, { encoding: 'utf-8', flag: 'wx', mode: 0o600 });
    return;
  }
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, body, { encoding: 'utf-8', mode: 0o600 });
  renameSync(tmpPath, filePath);
}

/**
 * Exclusive-create an empty signed spend log. Operator ritual, not a boot ensure.
 */
export function initializeSpendingPersist(persistPath: string, integrityKey: IntegrityKey): void {
  const key = usableKey(integrityKey);
  if (key === null) {
    throw new Error('initializeSpendingPersist requires an integrity key of at least 16 bytes');
  }
  if (persistPath.length === 0) {
    throw new Error('initializeSpendingPersist requires a persist path');
  }
  ensureParentDir(persistPath);
  writeSignedEnvelope(persistPath, key, [], 'wx');
}

export class SpendingPolicy {
  readonly dailyLimit: number;
  readonly transactionLimit: number;
  readonly allowedDomains: readonly string[];

  private spendingLog: SpendingRecord[] = [];
  private readonly persistPath: string | null = null;
  private readonly integrityKey: Buffer | null = null;
  private failClosed = false;

  constructor(options: {
    dailyLimit: number;
    transactionLimit: number;
    allowedDomains: readonly string[];
    persistPath?: string;
    integrityKey?: IntegrityKey;
  }) {
    this.dailyLimit = options.dailyLimit;
    this.transactionLimit = options.transactionLimit;
    this.allowedDomains = options.allowedDomains;

    const persistPath = options.persistPath !== undefined && options.persistPath.length > 0
      ? options.persistPath
      : null;
    const key = usableKey(options.integrityKey);
    if (persistPath !== null && key !== null) {
      this.persistPath = persistPath;
      this.integrityKey = key;
      this.loadPersistedLog();
      return;
    }
    if (persistPath !== null || options.integrityKey !== undefined) {
      this.failClosed = true;
    }
  }

  private loadPersistedLog(): void {
    if (this.persistPath === null || this.integrityKey === null) {
      this.failClosed = true;
      return;
    }
    if (!existsSync(this.persistPath)) {
      this.failClosed = true;
      return;
    }
    try {
      const raw = readFileSync(this.persistPath, 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      const envelope = PersistEnvelopeSchema.parse(parsed);
      if (!macMatches(this.integrityKey, envelope.records, envelope.mac)) {
        this.failClosed = true;
        return;
      }
      const now = Date.now();
      for (const record of envelope.records) {
        if (!Number.isFinite(record.amount) || record.amount <= 0) {
          this.failClosed = true;
          return;
        }
        if (record.timestamp > now + CLOCK_SKEW_MS) {
          this.failClosed = true;
          return;
        }
      }
      this.spendingLog = envelope.records.map(cloneRecord);
    } catch {
      this.failClosed = true;
    }
  }

  private persistLiveLog(): boolean {
    if (this.failClosed || this.persistPath === null || this.integrityKey === null) {
      return false;
    }
    try {
      ensureParentDir(this.persistPath);
      writeSignedEnvelope(this.persistPath, this.integrityKey, this.spendingLog);
      return true;
    } catch {
      return false;
    }
  }

  private closedDecision(): SpendingDecision {
    return {
      allowed: false,
      reason: FAIL_CLOSED_REASON,
      remainingDaily: 0,
    };
  }

  getDailySpent(): number {
    const dayStart = getUtcDayStart();
    return this.spendingLog
      .filter(r => r.timestamp >= dayStart)
      .reduce((sum, r) => sum + r.amount, 0);
  }

  checkTransaction(amount: number, domain: string): SpendingDecision {
    if (this.failClosed) {
      return this.closedDecision();
    }
    try {
      if (amount <= 0 || !Number.isFinite(amount)) {
        return {
          allowed: false,
          reason: `Invalid amount: ${amount}`,
          remainingDaily: this.dailyLimit - this.getDailySpent(),
        };
      }

      if (amount > this.transactionLimit) {
        return {
          allowed: false,
          reason: `Amount $${amount} exceeds per-transaction limit of $${this.transactionLimit}`,
          remainingDaily: this.dailyLimit - this.getDailySpent(),
        };
      }

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
      return {
        allowed: false,
        reason: 'Policy check failed due to internal error — rejecting for safety',
        remainingDaily: 0,
      };
    }
  }

  reserveTransaction(amount: number, domain: string): {
    decision: SpendingDecision;
    reservation?: SpendReservation;
  } {
    if (this.failClosed) {
      return { decision: this.closedDecision() };
    }
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
    if (this.persistPath !== null && !this.persistLiveLog()) {
      this.spendingLog.pop();
      return {
        decision: {
          allowed: false,
          reason: PERSIST_WRITE_REASON,
          remainingDaily: this.dailyLimit - this.getDailySpent(),
        },
      };
    }
    return { decision, reservation };
  }

  voidReservation(reservation: SpendReservation): void {
    if (this.failClosed) {
      return;
    }
    if (this.persistPath !== null && reservation.state !== 'reserved') {
      return;
    }
    const idx = this.spendingLog.indexOf(reservation);
    if (idx < 0) {
      return;
    }
    const [removed] = this.spendingLog.splice(idx, 1);
    if (removed === undefined) {
      return;
    }
    if (this.persistPath !== null && !this.persistLiveLog()) {
      this.spendingLog.splice(idx, 0, removed);
    }
  }

  markReservationUnknown(reservation: SpendReservation): void {
    this.updateReservationState(reservation, 'unknown');
  }

  settleReservation(reservation: SpendReservation): void {
    this.updateReservationState(reservation, 'settled');
  }

  private updateReservationState(reservation: SpendReservation, state: ReservationState): void {
    if (this.failClosed) {
      return;
    }
    if (!this.spendingLog.includes(reservation)) {
      return;
    }
    const previous = reservation.state;
    reservation.state = state;
    if (this.persistPath !== null && !this.persistLiveLog()) {
      reservation.state = previous;
    }
  }

  recordSpend(amount: number, domain: string): void {
    if (this.failClosed) {
      return;
    }
    this.spendingLog.push({
      amount,
      timestamp: Date.now(),
      domain,
      state: 'settled',
    });
    if (this.persistPath !== null) {
      this.persistLiveLog();
    }
  }

  reset(): void {
    if (this.persistPath !== null || this.failClosed) {
      return;
    }
    this.spendingLog = [];
  }

  getSpendingLog(): readonly SpendingRecord[] {
    return this.spendingLog.map(cloneRecord);
  }
}
