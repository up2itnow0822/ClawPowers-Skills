/**
 * ClawPowers Agent — Spending Policy
 * Enforces daily limits, per-transaction limits, and domain allowlists.
 * Fail-closed: any policy error results in rejection.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { inspect } from 'node:util';
import { z } from 'zod';
import type { SpendingDecision } from '../types.js';

export type ReservationState = 'reserved' | 'settled' | 'unknown';

/** Documented allowance for slightly-fast clocks when validating stored timestamps. */
export const CLOCK_SKEW_MS = 300_000;

/** Minimum HMAC key length (NIST SP 800-224: at least 128 bits). */
export const MIN_INTEGRITY_KEY_BYTES = 16;

const MS_PER_UTC_DAY = 86_400_000;

export type IntegrityKey = string | Uint8Array | Buffer;

const PERSIST_VERSION = 1;
const FAIL_CLOSED_REASON = 'Spending policy persist integrity failed — refusing spends';
const PERSIST_WRITE_REASON = 'Spending policy persist write failed — refusing reservation';
const RELEASED_RESERVATION_REASON = 'Reservation was already released';
const EMPTY_PERSIST_PATH_REASON = 'SpendingPolicy persistPath must be a non-empty path';

interface SpendingRecord {
  amount: number;
  timestamp: number;
  domain: string;
  state: ReservationState;
}

interface InternalRecord {
  amount: number;
  timestamp: number;
  domain: string;
  state: ReservationState;
  handle: SpendReservation;
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

function getUtcDayStart(now = Date.now()): number {
  const date = new Date(now);
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    0, 0, 0, 0
  );
}

function cloneRecord(record: SpendingRecord): SpendingRecord {
  return {
    amount: record.amount,
    timestamp: record.timestamp,
    domain: record.domain,
    state: record.state,
  };
}

function createHandle(record: InternalRecord): SpendReservation {
  const handle: SpendReservation = {
    get amount() {
      return record.amount;
    },
    get timestamp() {
      return record.timestamp;
    },
    get domain() {
      return record.domain;
    },
    get state() {
      return record.state;
    },
    set amount(_value: number) {
      throw new TypeError('SpendReservation.amount is immutable');
    },
    set timestamp(_value: number) {
      throw new TypeError('SpendReservation.timestamp is immutable');
    },
    set domain(_value: string) {
      throw new TypeError('SpendReservation.domain is immutable');
    },
    set state(_value: ReservationState) {
      throw new TypeError('SpendReservation.state is immutable');
    },
  };
  return Object.freeze(handle);
}

function isPersistableRecord(record: SpendingRecord, now: number): boolean {
  return Number.isFinite(record.amount)
    && record.amount > 0
    && Number.isFinite(record.timestamp)
    && record.timestamp <= now + CLOCK_SKEW_MS;
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
    records: records.map(cloneRecord),
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
  mkdirSync(dirname(filePath), { recursive: true });
}

function envelopeBody(key: Buffer, records: readonly SpendingRecord[]): string {
  const cloned = records.map(cloneRecord);
  return `${JSON.stringify({
    version: PERSIST_VERSION,
    records: cloned,
    mac: macHex(key, cloned),
  }, null, 2)}\n`;
}

function fsyncPath(path: string): void {
  const fd = openSync(path, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function writeExclusiveFile(filePath: string, body: string): void {
  const fd = openSync(filePath, 'wx', 0o600);
  try {
    writeSync(fd, body, undefined, 'utf8');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function writeSignedEnvelope(
  filePath: string,
  key: Buffer,
  records: readonly SpendingRecord[],
  exclusive: boolean,
): void {
  const body = envelopeBody(key, records);
  const dir = dirname(filePath);
  if (exclusive) {
    writeExclusiveFile(filePath, body);
    fsyncPath(dir);
    return;
  }
  const tmpPath = join(dir, `.spend-${randomBytes(16).toString('hex')}.tmp`);
  try {
    writeExclusiveFile(tmpPath, body);
    renameSync(tmpPath, filePath);
  } catch (error) {
    try {
      unlinkSync(tmpPath);
    } catch {
      // The tmp name is exclusive; ignore cleanup if it never landed.
    }
    throw error;
  }
  fsyncPath(dir);
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
  const dest = resolve(persistPath);
  ensureParentDir(dest);
  writeSignedEnvelope(dest, key, [], true);
}

export class SpendingPolicy {
  readonly dailyLimit: number;
  readonly transactionLimit: number;
  readonly allowedDomains: readonly string[];

  #spendingLog: InternalRecord[] = [];
  #handles = new WeakMap<SpendReservation, InternalRecord>();
  #persistPath: string | null = null;
  #integrityKey: Buffer | null = null;
  #failClosed = false;
  #unsavedCharge = false;

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

    if (Object.hasOwn(options, 'persistPath')) {
      const supplied = options.persistPath;
      if (typeof supplied !== 'string' || supplied.length === 0) {
        throw new Error(EMPTY_PERSIST_PATH_REASON);
      }
    }

    const persistPath = options.persistPath !== undefined && options.persistPath.length > 0
      ? resolve(options.persistPath)
      : null;
    const key = usableKey(options.integrityKey);
    if (persistPath !== null && key !== null) {
      this.#persistPath = persistPath;
      this.#integrityKey = key;
      this.#loadPersistedLog();
      return;
    }
    if (persistPath !== null || options.integrityKey !== undefined) {
      this.#failClosed = true;
    }
  }

  toJSON(): {
    dailyLimit: number;
    transactionLimit: number;
    allowedDomains: readonly string[];
  } {
    return {
      dailyLimit: this.dailyLimit,
      transactionLimit: this.transactionLimit,
      allowedDomains: this.allowedDomains,
    };
  }

  [inspect.custom](): ReturnType<SpendingPolicy['toJSON']> {
    return this.toJSON();
  }

  #installRecord(record: SpendingRecord): InternalRecord {
    const internal: InternalRecord = {
      amount: record.amount,
      timestamp: record.timestamp,
      domain: record.domain,
      state: record.state,
      handle: undefined as unknown as SpendReservation,
    };
    internal.handle = createHandle(internal);
    this.#handles.set(internal.handle, internal);
    return internal;
  }

  #loadPersistedLog(): void {
    if (this.#persistPath === null || this.#integrityKey === null) {
      this.#failClosed = true;
      return;
    }
    try {
      const raw = readFileSync(this.#persistPath, 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      const envelope = PersistEnvelopeSchema.parse(parsed);
      if (!macMatches(this.#integrityKey, envelope.records, envelope.mac)) {
        this.#failClosed = true;
        return;
      }
      const now = Date.now();
      for (const record of envelope.records) {
        if (!isPersistableRecord(record, now)) {
          this.#failClosed = true;
          return;
        }
      }
      this.#spendingLog = envelope.records.map(record => this.#installRecord(cloneRecord(record)));
    } catch {
      this.#failClosed = true;
    }
  }

  #compactPriorUtcDays(now: number): void {
    const dayStart = getUtcDayStart(now);
    if (!this.#spendingLog.some(record => record.timestamp < dayStart)) {
      return;
    }
    const kept: InternalRecord[] = [];
    for (const record of this.#spendingLog) {
      if (record.timestamp >= dayStart) {
        kept.push(record);
        continue;
      }
      this.#handles.delete(record.handle);
    }
    this.#spendingLog = kept;
  }

  #persistLiveLog(): boolean {
    if (this.#failClosed) {
      return false;
    }
    if (this.#persistPath === null || this.#integrityKey === null) {
      return true;
    }
    const now = Date.now();
    this.#compactPriorUtcDays(now);
    if (!this.#spendingLog.every(record => isPersistableRecord(record, now))) {
      return false;
    }
    try {
      ensureParentDir(this.#persistPath);
      writeSignedEnvelope(this.#persistPath, this.#integrityKey, this.#spendingLog, false);
      this.#unsavedCharge = false;
      return true;
    } catch {
      return false;
    }
  }

  #closedDecision(): SpendingDecision {
    return {
      allowed: false,
      reason: FAIL_CLOSED_REASON,
      remainingDaily: 0,
    };
  }

  #refuseUntilPersisted(): boolean {
    if (this.#failClosed) {
      return true;
    }
    if (!this.#unsavedCharge) {
      return false;
    }
    return !this.#persistLiveLog();
  }

  #lookup(reservation: SpendReservation): InternalRecord | undefined {
    return this.#handles.get(reservation);
  }

  #setReservationState(record: InternalRecord, state: ReservationState): void {
    switch (state) {
      case 'reserved':
      case 'settled':
      case 'unknown':
        record.state = state;
        return;
      default: {
        const _never: never = state;
        throw new Error(`unexpected reservation state: ${_never}`);
      }
    }
  }

  getDailySpent(): number {
    const dayStart = getUtcDayStart();
    const dayEnd = dayStart + MS_PER_UTC_DAY;
    return this.#spendingLog
      .filter(r => r.timestamp >= dayStart && r.timestamp < dayEnd)
      .reduce((sum, r) => sum + r.amount, 0);
  }

  checkTransaction(amount: number, domain: string): SpendingDecision {
    if (this.#refuseUntilPersisted()) {
      return this.#closedDecision();
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
    if (this.#refuseUntilPersisted()) {
      return { decision: this.#closedDecision() };
    }
    const decision = this.checkTransaction(amount, domain);
    if (!decision.allowed) {
      return { decision };
    }
    const record = this.#installRecord({
      amount,
      timestamp: Date.now(),
      domain,
      state: 'reserved',
    });
    this.#spendingLog.push(record);
    if (!this.#persistLiveLog()) {
      this.#spendingLog.pop();
      return {
        decision: {
          allowed: false,
          reason: PERSIST_WRITE_REASON,
          remainingDaily: this.dailyLimit - this.getDailySpent(),
        },
      };
    }
    return { decision, reservation: record.handle };
  }

  voidReservation(reservation: SpendReservation): void {
    if (this.#failClosed) {
      return;
    }
    const record = this.#lookup(reservation);
    if (record === undefined) {
      return;
    }
    if (record.state !== 'reserved') {
      return;
    }
    const idx = this.#spendingLog.indexOf(record);
    if (idx < 0) {
      return;
    }
    const [removed] = this.#spendingLog.splice(idx, 1);
    if (removed === undefined) {
      return;
    }
    if (!this.#persistLiveLog()) {
      this.#spendingLog.splice(idx, 0, removed);
      return;
    }
    this.#handles.delete(removed.handle);
  }

  markReservationUnknown(reservation: SpendReservation): void {
    this.#updateReservationState(reservation, 'unknown');
  }

  settleReservation(reservation: SpendReservation): void {
    this.#updateReservationState(reservation, 'settled');
  }

  #updateReservationState(reservation: SpendReservation, state: ReservationState): void {
    if (this.#failClosed) {
      return;
    }
    const record = this.#lookup(reservation);
    if (record === undefined) {
      throw new Error(RELEASED_RESERVATION_REASON);
    }
    if (record.state === state) {
      return;
    }
    this.#setReservationState(record, state);
    if (!this.#persistLiveLog()) {
      this.#unsavedCharge = true;
    }
  }

  recordSpend(amount: number, domain: string): void {
    if (this.#refuseUntilPersisted()) {
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return;
    }
    const record = this.#installRecord({
      amount,
      timestamp: Date.now(),
      domain,
      state: 'settled',
    });
    this.#spendingLog.push(record);
    if (this.#persistPath !== null && !this.#persistLiveLog()) {
      this.#unsavedCharge = true;
    }
  }

  reset(): void {
    if (this.#persistPath !== null || this.#failClosed || this.#unsavedCharge) {
      return;
    }
    this.#spendingLog = [];
  }

  getSpendingLog(): readonly SpendingRecord[] {
    return this.#spendingLog.map(cloneRecord);
  }
}
