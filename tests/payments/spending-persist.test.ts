import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { PaymentExecutor } from '../../src/payments/executor.js';
import {
  CLOCK_SKEW_MS,
  initializeSpendingPersist,
  SpendingPolicy,
} from '../../src/payments/spending.js';

const KEY = Buffer.alloc(16, 7);
const SHORT_KEY = Buffer.alloc(15, 7);

interface PersistRecord {
  amount: number;
  timestamp: number;
  domain: string;
  state: 'reserved' | 'settled' | 'unknown';
}

function signEnvelope(records: PersistRecord[], extra?: Record<string, unknown>): string {
  const payload = JSON.stringify({
    version: 1,
    records: records.map(r => ({
      amount: r.amount,
      timestamp: r.timestamp,
      domain: r.domain,
      state: r.state,
    })),
  });
  const mac = createHmac('sha256', KEY).update(payload).digest('hex');
  return `${JSON.stringify({ version: 1, records, mac, ...extra }, null, 2)}\n`;
}

function limits() {
  return { dailyLimit: 20, transactionLimit: 50, allowedDomains: [] as const };
}

describe('SpendingPolicy persistence', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      chmodSync(dir, 0o755);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'spend-persist-'));
    dirs.push(dir);
    return dir;
  }

  function persistPath(dir: string): string {
    return join(dir, 'spend.json');
  }

  function persistedPolicy(dir: string, overrides?: Partial<ReturnType<typeof limits>>): SpendingPolicy {
    return new SpendingPolicy({
      ...limits(),
      ...overrides,
      persistPath: persistPath(dir),
      integrityKey: KEY,
    });
  }

  it('round-trips daily spend across a new instance', () => {
    const dir = tempDir();
    initializeSpendingPersist(persistPath(dir), KEY);
    const first = persistedPolicy(dir);
    first.recordSpend(15, 'a.com');
    expect(first.getDailySpent()).toBe(15);

    const second = persistedPolicy(dir);
    expect(second.getDailySpent()).toBe(15);
    expect(second.checkTransaction(5, 'b.com').allowed).toBe(true);
    expect(second.checkTransaction(6, 'b.com').allowed).toBe(false);
  });

  it('refuses spends when the MAC is tampered', () => {
    const dir = tempDir();
    initializeSpendingPersist(persistPath(dir), KEY);
    persistedPolicy(dir).recordSpend(15, 'a.com');

    const raw = readFileSync(persistPath(dir), 'utf-8');
    const flipped = raw.replace(/"mac": "([0-9a-f])/, (_, hex: string) => {
      const next = hex === '0' ? '1' : '0';
      return `"mac": "${next}`;
    });
    writeFileSync(persistPath(dir), flipped);

    const policy = persistedPolicy(dir);
    expect(policy.checkTransaction(5, 'a.com').allowed).toBe(false);
    expect(policy.getDailySpent()).toBe(0);
  });

  it('fails closed on a future timestamp beyond clock skew', () => {
    const dir = tempDir();
    writeFileSync(persistPath(dir), signEnvelope([{
      amount: 5,
      timestamp: Date.now() + CLOCK_SKEW_MS + 60_000,
      domain: 'a.com',
      state: 'settled',
    }]));
    const policy = persistedPolicy(dir);
    expect(policy.checkTransaction(5, 'a.com').allowed).toBe(false);
    expect(policy.reserveTransaction(5, 'a.com').reservation).toBeUndefined();
  });

  it('fails closed on a zero amount record', () => {
    const dir = tempDir();
    writeFileSync(persistPath(dir), signEnvelope([{
      amount: 0,
      timestamp: Date.now(),
      domain: 'a.com',
      state: 'settled',
    }]));
    expect(persistedPolicy(dir).checkTransaction(5, 'a.com').allowed).toBe(false);
  });

  it('fails closed on a negative amount record', () => {
    const dir = tempDir();
    writeFileSync(persistPath(dir), signEnvelope([{
      amount: -1,
      timestamp: Date.now(),
      domain: 'a.com',
      state: 'settled',
    }]));
    expect(persistedPolicy(dir).checkTransaction(5, 'a.com').allowed).toBe(false);
  });

  it('fails closed when persistPath is set without a key', () => {
    const dir = tempDir();
    initializeSpendingPersist(persistPath(dir), KEY);
    const policy = new SpendingPolicy({
      ...limits(),
      persistPath: persistPath(dir),
    });
    expect(policy.checkTransaction(5, 'a.com').allowed).toBe(false);
  });

  it('fails closed when the integrity key is empty', () => {
    const dir = tempDir();
    initializeSpendingPersist(persistPath(dir), KEY);
    const policy = new SpendingPolicy({
      ...limits(),
      persistPath: persistPath(dir),
      integrityKey: '',
    });
    expect(policy.checkTransaction(5, 'a.com').allowed).toBe(false);
  });

  it('fails closed when the integrity key is shorter than 16 bytes', () => {
    const dir = tempDir();
    initializeSpendingPersist(persistPath(dir), KEY);
    const policy = new SpendingPolicy({
      ...limits(),
      persistPath: persistPath(dir),
      integrityKey: SHORT_KEY,
    });
    expect(policy.checkTransaction(5, 'a.com').allowed).toBe(false);
  });

  it('fails closed on corrupted non-JSON', () => {
    const dir = tempDir();
    writeFileSync(persistPath(dir), 'not-json');
    expect(persistedPolicy(dir).checkTransaction(5, 'a.com').allowed).toBe(false);
  });

  it('fails closed when the envelope is missing mac', () => {
    const dir = tempDir();
    writeFileSync(persistPath(dir), `${JSON.stringify({ version: 1, records: [] }, null, 2)}\n`);
    expect(persistedPolicy(dir).checkTransaction(5, 'a.com').allowed).toBe(false);
  });

  it('keeps reserved and unknown rows after restart', () => {
    const dir = tempDir();
    initializeSpendingPersist(persistPath(dir), KEY);
    const first = persistedPolicy(dir);
    const reserved = first.reserveTransaction(6, 'a.com');
    expect(reserved.reservation).toBeDefined();
    first.markReservationUnknown(reserved.reservation!);
    first.recordSpend(4, 'b.com');
    expect(first.getDailySpent()).toBe(10);

    const second = persistedPolicy(dir);
    expect(second.getDailySpent()).toBe(10);
    expect(second.getSpendingLog().map(r => r.state).sort()).toEqual(['settled', 'unknown']);
  });

  it('returns no reservation when persist I/O fails on reserve', () => {
    const dir = tempDir();
    initializeSpendingPersist(persistPath(dir), KEY);
    const policy = persistedPolicy(dir);
    chmodSync(dir, 0o555);
    const result = policy.reserveTransaction(5, 'a.com');
    chmodSync(dir, 0o755);
    expect(result.decision.allowed).toBe(false);
    expect(result.reservation).toBeUndefined();
    expect(policy.getDailySpent()).toBe(0);
  });

  it('returns a policy rejection from PaymentExecutor when reserve persist fails', async () => {
    const dir = tempDir();
    initializeSpendingPersist(persistPath(dir), KEY);
    const policy = persistedPolicy(dir, { dailyLimit: 100 });
    const executor = new PaymentExecutor(policy, {
      async executePayment() {
        return { txHash: '0xabc', status: 'settled' };
      },
    });
    chmodSync(dir, 0o555);
    const result = await executor.executePayment({
      amount: 10,
      currency: 'USDC',
      recipient: '0xrecipient',
      x402Headers: { 'x-payment-amount': '10' },
      domain: 'api.example.com',
    });
    chmodSync(dir, 0o755);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Spending policy rejected/i);
    expect(result.settlement).toBeUndefined();
    expect(policy.getDailySpent()).toBe(0);
  });

  it('does not let persist-enabled reset then recordSpend lower the stored total', () => {
    const dir = tempDir();
    initializeSpendingPersist(persistPath(dir), KEY);
    const first = persistedPolicy(dir);
    first.recordSpend(15, 'a.com');
    first.reset();
    first.recordSpend(1, 'b.com');
    expect(first.getDailySpent()).toBe(16);

    const second = persistedPolicy(dir);
    expect(second.getDailySpent()).toBe(16);
  });

  it('does not replace an existing dest on a second initialize', () => {
    const dir = tempDir();
    initializeSpendingPersist(persistPath(dir), KEY);
    persistedPolicy(dir).recordSpend(15, 'a.com');
    expect(() => initializeSpendingPersist(persistPath(dir), KEY)).toThrow();
    expect(persistedPolicy(dir).getDailySpent()).toBe(15);
  });

  it('fails closed when the dest file is missing after initialize', () => {
    const dir = tempDir();
    initializeSpendingPersist(persistPath(dir), KEY);
    persistedPolicy(dir).recordSpend(15, 'a.com');
    unlinkSync(persistPath(dir));
    const policy = persistedPolicy(dir);
    expect(policy.checkTransaction(5, 'a.com').allowed).toBe(false);
    expect(policy.getDailySpent()).toBe(0);
  });

  it('ignores a stored counter lower than the verified log sum', () => {
    const dir = tempDir();
    writeFileSync(persistPath(dir), signEnvelope([{
      amount: 15,
      timestamp: Date.now(),
      domain: 'a.com',
      state: 'settled',
    }], { dailySpent: 0, total: 5 }));
    expect(persistedPolicy(dir).getDailySpent()).toBe(15);
  });

  it('ignores leftover tmp and fails closed when only tmp exists', () => {
    const dir = tempDir();
    initializeSpendingPersist(persistPath(dir), KEY);
    persistedPolicy(dir).recordSpend(15, 'a.com');
    writeFileSync(`${persistPath(dir)}.tmp`, signEnvelope([]));
    expect(persistedPolicy(dir).getDailySpent()).toBe(15);

    unlinkSync(persistPath(dir));
    const tmpOnly = persistedPolicy(dir);
    expect(tmpOnly.checkTransaction(5, 'a.com').allowed).toBe(false);
    expect(tmpOnly.getDailySpent()).toBe(0);
  });

  it('rejects an unverified seed or replace payload', () => {
    const dir = tempDir();
    initializeSpendingPersist(persistPath(dir), KEY);
    const policy = persistedPolicy(dir);
    policy.recordSpend(15, 'a.com');
    const seeded = new SpendingPolicy({
      ...limits(),
      persistPath: persistPath(dir),
      integrityKey: KEY,
      ...({ records: [], seedLog: [], importLog: '[]' } as object),
    } as ConstructorParameters<typeof SpendingPolicy>[0]);
    expect(seeded.getDailySpent()).toBe(15);
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(policy))).not.toEqual(
      expect.arrayContaining(['importLog', 'replaceLog', 'loadState'])
    );
  });

  it('does not let getSpendingLog copies lower counters', () => {
    const dir = tempDir();
    initializeSpendingPersist(persistPath(dir), KEY);
    const policy = persistedPolicy(dir);
    policy.recordSpend(15, 'a.com');
    for (const row of policy.getSpendingLog()) {
      policy.voidReservation(row);
      row.amount = 0;
      row.timestamp = 1;
      row.state = 'reserved';
    }
    expect(policy.getDailySpent()).toBe(15);
    expect(persistedPolicy(dir).getDailySpent()).toBe(15);
  });

  it('does not drop settled or unknown rows via persist-enabled voidReservation', () => {
    const dir = tempDir();
    initializeSpendingPersist(persistPath(dir), KEY);
    const policy = persistedPolicy(dir);
    const reserved = policy.reserveTransaction(6, 'a.com');
    policy.settleReservation(reserved.reservation!);
    const unknown = policy.reserveTransaction(4, 'b.com');
    policy.markReservationUnknown(unknown.reservation!);
    policy.voidReservation(reserved.reservation!);
    policy.voidReservation(unknown.reservation!);
    expect(policy.getDailySpent()).toBe(10);
  });

  it('round-trips a voided reservation to zero on the next instance', () => {
    const dir = tempDir();
    initializeSpendingPersist(persistPath(dir), KEY);
    const policy = persistedPolicy(dir);
    const reserved = policy.reserveTransaction(6, 'a.com');
    policy.voidReservation(reserved.reservation!);
    expect(policy.getDailySpent()).toBe(0);
    expect(persistedPolicy(dir).getDailySpent()).toBe(0);
  });

  it('does not let recordSpend recreate a dest after a failed load', () => {
    const dir = tempDir();
    initializeSpendingPersist(persistPath(dir), KEY);
    persistedPolicy(dir).recordSpend(15, 'a.com');
    unlinkSync(persistPath(dir));
    const policy = persistedPolicy(dir);
    policy.recordSpend(5, 'b.com');
    expect(existsSync(persistPath(dir))).toBe(false);
    expect(persistedPolicy(dir).checkTransaction(5, 'a.com').allowed).toBe(false);
  });

  it('still allows spend without persist options', () => {
    const policy = new SpendingPolicy(limits());
    expect(policy.checkTransaction(5, 'a.com').allowed).toBe(true);
    policy.recordSpend(5, 'a.com');
    expect(policy.getDailySpent()).toBe(5);
  });

  it('fails closed when integrityKey is set without persistPath', () => {
    const policy = new SpendingPolicy({
      ...limits(),
      integrityKey: KEY,
    });
    expect(policy.checkTransaction(5, 'a.com').allowed).toBe(false);
  });

  it('creates parent directories on initialize', () => {
    const dir = tempDir();
    const nested = join(dir, 'deep', 'nested', 'spend.json');
    initializeSpendingPersist(nested, KEY);
    expect(existsSync(nested)).toBe(true);
    mkdirSync(join(dir, 'other'), { recursive: true });
  });
});
