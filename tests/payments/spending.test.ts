import { describe, it, expect } from 'vitest';
import {
  SpendingPolicy,
  SPENDING_POLICY_STATE_VERSION,
} from '../../src/payments/spending.js';
import type { SpendingPolicyState } from '../../src/payments/spending.js';

const baseOptions = { dailyLimit: 100, transactionLimit: 50, allowedDomains: [] as string[] };

describe('SpendingPolicy', () => {
  it('allows a transaction within all limits', () => {
    const policy = new SpendingPolicy({
      dailyLimit: 100,
      transactionLimit: 50,
      allowedDomains: [],
    });
    const decision = policy.checkTransaction(25, 'example.com');
    expect(decision.allowed).toBe(true);
    expect(decision.remainingDaily).toBe(75);
  });

  it('rejects a transaction exceeding per-transaction limit', () => {
    const policy = new SpendingPolicy({
      dailyLimit: 100,
      transactionLimit: 10,
      allowedDomains: [],
    });
    const decision = policy.checkTransaction(15, 'example.com');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('per-transaction limit');
  });

  it('rejects a transaction exceeding daily limit', () => {
    const policy = new SpendingPolicy({
      dailyLimit: 20,
      transactionLimit: 50,
      allowedDomains: [],
    });
    // Record some spend first
    policy.recordSpend(15, 'example.com');
    const decision = policy.checkTransaction(10, 'example.com');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('daily limit');
  });

  it('tracks daily spending correctly', () => {
    const policy = new SpendingPolicy({
      dailyLimit: 100,
      transactionLimit: 50,
      allowedDomains: [],
    });
    policy.recordSpend(10, 'a.com');
    policy.recordSpend(20, 'b.com');
    expect(policy.getDailySpent()).toBe(30);
  });

  it('blocks non-allowlisted domains when allowlist is set', () => {
    const policy = new SpendingPolicy({
      dailyLimit: 100,
      transactionLimit: 50,
      allowedDomains: ['api.trusted.com', 'pay.example.com'],
    });
    const decision = policy.checkTransaction(5, 'evil.com');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('not in the allowed domains');
  });

  it('allows allowlisted domains', () => {
    const policy = new SpendingPolicy({
      dailyLimit: 100,
      transactionLimit: 50,
      allowedDomains: ['api.trusted.com'],
    });
    const decision = policy.checkTransaction(5, 'api.trusted.com');
    expect(decision.allowed).toBe(true);
  });

  it('allows any domain when allowlist is empty', () => {
    const policy = new SpendingPolicy({
      dailyLimit: 100,
      transactionLimit: 50,
      allowedDomains: [],
    });
    const decision = policy.checkTransaction(5, 'any-domain.com');
    expect(decision.allowed).toBe(true);
  });

  it('rejects invalid amounts (zero)', () => {
    const policy = new SpendingPolicy({
      dailyLimit: 100,
      transactionLimit: 50,
      allowedDomains: [],
    });
    const decision = policy.checkTransaction(0, 'example.com');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('Invalid amount');
  });

  it('rejects negative amounts', () => {
    const policy = new SpendingPolicy({
      dailyLimit: 100,
      transactionLimit: 50,
      allowedDomains: [],
    });
    const decision = policy.checkTransaction(-5, 'example.com');
    expect(decision.allowed).toBe(false);
  });

  it('rejects NaN amounts', () => {
    const policy = new SpendingPolicy({
      dailyLimit: 100,
      transactionLimit: 50,
      allowedDomains: [],
    });
    const decision = policy.checkTransaction(NaN, 'example.com');
    expect(decision.allowed).toBe(false);
  });

  it('rejects Infinity amounts', () => {
    const policy = new SpendingPolicy({
      dailyLimit: 100,
      transactionLimit: 50,
      allowedDomains: [],
    });
    const decision = policy.checkTransaction(Infinity, 'example.com');
    expect(decision.allowed).toBe(false);
  });

  it('resets spending log', () => {
    const policy = new SpendingPolicy({
      dailyLimit: 100,
      transactionLimit: 50,
      allowedDomains: [],
    });
    policy.recordSpend(50, 'example.com');
    expect(policy.getDailySpent()).toBe(50);
    policy.reset();
    expect(policy.getDailySpent()).toBe(0);
  });

  it('maintains a spending log for audit', () => {
    const policy = new SpendingPolicy({
      dailyLimit: 100,
      transactionLimit: 50,
      allowedDomains: [],
    });
    policy.recordSpend(10, 'a.com');
    policy.recordSpend(20, 'b.com');
    const log = policy.getSpendingLog();
    expect(log.length).toBe(2);
    expect(log[0]!.amount).toBe(10);
    expect(log[1]!.amount).toBe(20);
  });

  it('handles domain matching case-insensitively', () => {
    const policy = new SpendingPolicy({
      dailyLimit: 100,
      transactionLimit: 50,
      allowedDomains: ['API.Trusted.COM'],
    });
    const decision = policy.checkTransaction(5, 'api.trusted.com');
    expect(decision.allowed).toBe(true);
  });

  it('reserveTransaction records spend before a later check can race', () => {
    const policy = new SpendingPolicy({
      dailyLimit: 100,
      transactionLimit: 60,
      allowedDomains: [],
    });
    const first = policy.reserveTransaction(60, 'a.com');
    const second = policy.reserveTransaction(60, 'b.com');
    expect(first.decision.allowed).toBe(true);
    expect(first.reservation).toBeDefined();
    expect(second.decision.allowed).toBe(false);
    expect(policy.getDailySpent()).toBe(60);
  });

  it('voidReservation releases a failed reservation', () => {
    const policy = new SpendingPolicy({
      dailyLimit: 100,
      transactionLimit: 60,
      allowedDomains: [],
    });
    const reserved = policy.reserveTransaction(60, 'a.com');
    expect(reserved.reservation).toBeDefined();
    policy.voidReservation(reserved.reservation!);
    expect(policy.getDailySpent()).toBe(0);
    const retry = policy.reserveTransaction(60, 'a.com');
    expect(retry.decision.allowed).toBe(true);
  });

  it('markReservationUnknown keeps the reservation counted', () => {
    const policy = new SpendingPolicy({
      dailyLimit: 100,
      transactionLimit: 60,
      allowedDomains: [],
    });
    const reserved = policy.reserveTransaction(40, 'a.com');
    expect(reserved.reservation).toBeDefined();
    policy.markReservationUnknown(reserved.reservation!);
    expect(policy.getDailySpent()).toBe(40);
    expect(reserved.reservation!.state).toBe('unknown');
  });
});

describe('SpendingPolicy persistence (regression: issue #126)', () => {
  it('loses the daily counter when a process restarts with no persisted state', () => {
    const before = new SpendingPolicy(baseOptions);
    before.recordSpend(60, 'a.com');
    expect(before.getDailySpent()).toBe(60);

    // Simulated restart: a brand-new policy has no memory of the prior spend.
    const afterRestart = new SpendingPolicy(baseOptions);
    expect(afterRestart.getDailySpent()).toBe(0);
  });

  it('retains the daily counter across a restart via serialize/deserialize', () => {
    const before = new SpendingPolicy(baseOptions);
    before.recordSpend(60, 'a.com');
    const persisted = before.serialize();

    const afterRestart = SpendingPolicy.deserialize(persisted, baseOptions);
    expect(afterRestart.getDailySpent()).toBe(60);

    // The rehydrated policy still enforces the $100 daily cap.
    const decision = afterRestart.checkTransaction(50, 'a.com');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('daily limit');
  });

  it('rehydrates through the state constructor option', () => {
    const before = new SpendingPolicy(baseOptions);
    before.recordSpend(30, 'a.com');

    const afterRestart = new SpendingPolicy({ ...baseOptions, state: before.exportState() });
    expect(afterRestart.getDailySpent()).toBe(30);
    expect(afterRestart.getSpendingLog()).toHaveLength(1);
  });

  it('round-trips through JSON.stringify/fromJSON', () => {
    const before = new SpendingPolicy(baseOptions);
    before.recordSpend(15, 'a.com');

    const afterRestart = SpendingPolicy.fromJSON(JSON.stringify(before), baseOptions);
    expect(afterRestart.getDailySpent()).toBe(15);
  });

  it('exports a versioned snapshot that snapshot/restore can round-trip', () => {
    const policy = new SpendingPolicy(baseOptions);
    policy.recordSpend(20, 'a.com');
    const snapshot = policy.snapshot();
    expect(snapshot.version).toBe(SPENDING_POLICY_STATE_VERSION);

    const other = new SpendingPolicy(baseOptions);
    other.restore(snapshot);
    expect(other.getDailySpent()).toBe(20);
  });

  it('keeps unknown-settlement reservations counted after rehydration', () => {
    const before = new SpendingPolicy(baseOptions);
    const reserved = before.reserveTransaction(40, 'a.com');
    before.markReservationUnknown(reserved.reservation!);

    const afterRestart = new SpendingPolicy({ ...baseOptions, state: before.exportState() });
    expect(afterRestart.getDailySpent()).toBe(40);
    expect(afterRestart.checkTransaction(70, 'a.com').allowed).toBe(false);
  });

  it('rejects null/undefined/malformed persisted state with an explicit error', () => {
    const policy = new SpendingPolicy(baseOptions);
    expect(() => policy.importState(null)).toThrow(/Invalid spending policy state/);
    expect(() => policy.importState(undefined)).toThrow(/Invalid spending policy state/);
    expect(() =>
      policy.importState({ records: 'nope' } as unknown as SpendingPolicyState),
    ).toThrow(/Invalid spending policy state/);
    expect(() =>
      policy.importState({
        version: 1,
        records: [{ amount: 'x', timestamp: 1, domain: 'a.com', state: 'settled' }],
      } as unknown as SpendingPolicyState),
    ).toThrow(/malformed/);
    expect(() => SpendingPolicy.deserialize('', baseOptions)).toThrow(/expected a JSON string/);
    expect(() => SpendingPolicy.deserialize('{not json', baseOptions)).toThrow(/could not parse JSON/);
  });

  it('accepts an empty state and clears the log without corrupting state', () => {
    const policy = new SpendingPolicy(baseOptions);
    policy.recordSpend(10, 'a.com');
    policy.importState({ version: SPENDING_POLICY_STATE_VERSION, records: [] });
    expect(policy.getDailySpent()).toBe(0);
    expect(policy.getSpendingLog()).toHaveLength(0);
  });

  it('does not share record objects with the source policy (defensive copy)', () => {
    const before = new SpendingPolicy(baseOptions);
    before.recordSpend(10, 'a.com');
    const state = before.exportState();
    state.records[0]!.amount = 9999;
    expect(before.getDailySpent()).toBe(10);
  });
});

describe('SpendingPolicy weekly limit', () => {
  const weeklyOptions = {
    dailyLimit: 50,
    weeklyLimit: 50,
    transactionLimit: 50,
    allowedDomains: [] as string[],
  };

  it('enforces the weekly limit even when the daily limit would still allow it', () => {
    const policy = new SpendingPolicy(weeklyOptions);
    expect(policy.checkTransaction(50, 'a.com').allowed).toBe(true);
    policy.recordSpend(50, 'a.com');
    expect(policy.getWeeklySpent()).toBe(50);

    const decision = policy.checkTransaction(50, 'a.com');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('weekly limit');
  });

  it('does not enforce a weekly cap when weeklyLimit is omitted', () => {
    const policy = new SpendingPolicy(baseOptions);
    policy.recordSpend(50, 'a.com');
    expect(policy.getWeeklySpent()).toBe(50);
    // Only the daily cap applies, and it is still enforced.
    expect(policy.checkTransaction(60, 'a.com').allowed).toBe(false);
  });
});

describe('SpendingPolicy input validation (boundary/null/empty)', () => {
  it('rejects null and undefined amounts without crashing', () => {
    const policy = new SpendingPolicy(baseOptions);
    expect(policy.checkTransaction(null as unknown as number, 'a.com').allowed).toBe(false);
    expect(policy.checkTransaction(undefined as unknown as number, 'a.com').allowed).toBe(false);
    expect(policy.getDailySpent()).toBe(0);
  });

  it('rejects empty and whitespace-only domains with a clear diagnostic', () => {
    const policy = new SpendingPolicy(baseOptions);
    const empty = policy.checkTransaction(5, '');
    expect(empty.allowed).toBe(false);
    expect(empty.reason).toContain('Invalid domain');

    const blank = policy.checkTransaction(5, '   ');
    expect(blank.allowed).toBe(false);
    expect(blank.reason).toContain('Invalid domain');
  });

  it('allows a transaction exactly at the transaction and daily limit', () => {
    const policy = new SpendingPolicy({ dailyLimit: 50, transactionLimit: 50, allowedDomains: [] });
    const decision = policy.checkTransaction(50, 'a.com');
    expect(decision.allowed).toBe(true);
    expect(decision.remainingDaily).toBe(0);
  });

  it('still rejects bad domains when an allowlist is configured', () => {
    const policy = new SpendingPolicy({ dailyLimit: 100, transactionLimit: 50, allowedDomains: ['a.com'] });
    expect(policy.checkTransaction(5, '').allowed).toBe(false);
    expect(policy.checkTransaction(5, 'evil.com').allowed).toBe(false);
  });
});
