import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { createHmac } from 'node:crypto';
import { inspect } from 'node:util';
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
    expect(persistedPolicy(dir).getDailySpent()).toBe(6);
    expect(persistedPolicy(dir).getSpendingLog().map(r => r.state)).toEqual(['reserved']);
    first.markReservationUnknown(reserved.reservation!);
    first.recordSpend(4, 'b.com');
    expect(first.getDailySpent()).toBe(10);

    const second = persistedPolicy(dir);
    expect(second.getDailySpent()).toBe(10);
    expect(second.getSpendingLog().map(r => r.state).sort()).toEqual(['settled', 'unknown']);
  });

  it('does not persist a mutated reservation amount', () => {
    const dir = tempDir();
    initializeSpendingPersist(persistPath(dir), KEY);
    const policy = persistedPolicy(dir);
    const reserved = policy.reserveTransaction(15, 'a.com');
    expect(reserved.reservation).toBeDefined();
    expect(() => {
      reserved.reservation!.amount = 1;
    }).toThrow();
    expect(policy.getDailySpent()).toBe(15);
    policy.settleReservation(reserved.reservation!);
    expect(persistedPolicy(dir).getDailySpent()).toBe(15);
  });

  it('does not record non-positive spend on a persist-enabled policy', () => {
    const dir = tempDir();
    initializeSpendingPersist(persistPath(dir), KEY);
    const policy = persistedPolicy(dir);
    policy.recordSpend(0, 'a.com');
    policy.recordSpend(-1, 'a.com');
    policy.recordSpend(Number.NaN, 'a.com');
    expect(policy.getDailySpent()).toBe(0);
    expect(persistedPolicy(dir).getDailySpent()).toBe(0);
    expect(persistedPolicy(dir).checkTransaction(5, 'a.com').allowed).toBe(true);
  });

  it('keeps in-memory spend when recordSpend persist I/O fails', () => {
    const dir = tempDir();
    initializeSpendingPersist(persistPath(dir), KEY);
    const policy = persistedPolicy(dir);
    chmodSync(dir, 0o555);
    policy.recordSpend(5, 'a.com');
    expect(policy.getDailySpent()).toBe(5);
    expect(policy.checkTransaction(1, 'a.com').allowed).toBe(false);
    chmodSync(dir, 0o755);
    expect(persistedPolicy(dir).getDailySpent()).toBe(0);
  });

  it('keeps two completed $10 charges while persist is failing and writes both on recovery', () => {
    const dir = tempDir();
    initializeSpendingPersist(persistPath(dir), KEY);
    const policy = persistedPolicy(dir, { dailyLimit: 20, transactionLimit: 10 });
    chmodSync(dir, 0o555);
    policy.recordSpend(10, 'a.com');
    policy.recordSpend(10, 'b.com');
    expect(policy.getDailySpent()).toBe(20);
    expect(policy.checkTransaction(1, 'c.com').allowed).toBe(false);
    chmodSync(dir, 0o755);
    expect(policy.checkTransaction(1, 'c.com').allowed).toBe(false);
    expect(persistedPolicy(dir).getDailySpent()).toBe(20);
    expect(persistedPolicy(dir).checkTransaction(1, 'c.com').allowed).toBe(false);
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
    const names = Object.getOwnPropertyNames(Object.getPrototypeOf(policy));
    expect(names).not.toContain('importLog');
    expect(names).not.toContain('replaceLog');
    expect(names).not.toContain('loadState');
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

  it('never includes the integrity key in JSON, inspect, or own properties', () => {
    const dir = tempDir();
    initializeSpendingPersist(persistPath(dir), KEY);
    const policy = persistedPolicy(dir);
    policy.recordSpend(5, 'a.com');
    const json = JSON.stringify(policy);
    const shown = inspect(policy, { showHidden: true, depth: 8, getters: true });
    expect(json).not.toMatch(/integrityKey|07 07|"data":\[7,7/);
    expect(shown).not.toMatch(/integrityKey|07 07/);
    expect(Object.getOwnPropertyNames(policy)).not.toContain('integrityKey');
    expect(Object.values(policy)).not.toEqual(expect.arrayContaining([KEY]));
    const cloned = structuredClone(policy);
    expect(JSON.stringify(cloned)).not.toMatch(/integrityKey|"data":\[7,7/);
    expect(inspect(cloned, { showHidden: true, depth: 8 })).not.toMatch(/integrityKey|07 07/);
  });

  it('does not let a caller revert handle state and release a settled row', () => {
    const dir = tempDir();
    initializeSpendingPersist(persistPath(dir), KEY);
    const policy = persistedPolicy(dir);
    const reserved = policy.reserveTransaction(15, 'a.com');
    expect(reserved.reservation).toBeDefined();
    policy.settleReservation(reserved.reservation!);
    expect(() => {
      reserved.reservation!.state = 'reserved';
    }).toThrow();
    expect(reserved.reservation!.state).toBe('settled');
    policy.voidReservation(reserved.reservation!);
    expect(policy.getDailySpent()).toBe(15);
    expect(persistedPolicy(dir).getDailySpent()).toBe(15);
  });

  it('throws when settling a reservation after it was released', () => {
    const dir = tempDir();
    initializeSpendingPersist(persistPath(dir), KEY);
    const policy = persistedPolicy(dir);
    const reserved = policy.reserveTransaction(6, 'a.com');
    policy.voidReservation(reserved.reservation!);
    expect(() => policy.settleReservation(reserved.reservation!)).toThrow(/already released/i);
    expect(policy.getDailySpent()).toBe(0);
  });

  it('throws on an explicitly empty persistPath', () => {
    expect(() => new SpendingPolicy({
      ...limits(),
      persistPath: '',
    })).toThrow(/non-empty path/);
    expect(() => new SpendingPolicy({
      ...limits(),
      persistPath: '',
      integrityKey: KEY,
    })).toThrow(/non-empty path/);
  });

  it('keeps a settled reservation after a persist failure and refuses further spends', () => {
    const dir = tempDir();
    initializeSpendingPersist(persistPath(dir), KEY);
    const policy = persistedPolicy(dir);
    const reserved = policy.reserveTransaction(10, 'a.com');
    expect(reserved.reservation).toBeDefined();
    chmodSync(dir, 0o555);
    policy.settleReservation(reserved.reservation!);
    expect(reserved.reservation!.state).toBe('settled');
    policy.voidReservation(reserved.reservation!);
    expect(policy.getDailySpent()).toBe(10);
    expect(policy.checkTransaction(1, 'a.com').allowed).toBe(false);
    chmodSync(dir, 0o755);
  });

  it('fails closed when a record field is edited but the MAC is left unchanged', () => {
    const dir = tempDir();
    initializeSpendingPersist(persistPath(dir), KEY);
    persistedPolicy(dir).recordSpend(15, 'a.com');
    const envelope = JSON.parse(readFileSync(persistPath(dir), 'utf-8')) as {
      version: number;
      records: PersistRecord[];
      mac: string;
    };
    envelope.records[0]!.amount = 1;
    writeFileSync(persistPath(dir), `${JSON.stringify(envelope, null, 2)}\n`);
    const policy = persistedPolicy(dir);
    expect(policy.checkTransaction(5, 'a.com').allowed).toBe(false);
    expect(policy.getDailySpent()).toBe(0);
  });

  it('does not follow a predictable persistPath.tmp symlink', () => {
    const dir = tempDir();
    const victim = join(dir, 'victim.txt');
    writeFileSync(victim, 'keep-me\n');
    initializeSpendingPersist(persistPath(dir), KEY);
    symlinkSync(victim, `${persistPath(dir)}.tmp`);
    persistedPolicy(dir).recordSpend(8, 'a.com');
    expect(readFileSync(victim, 'utf-8')).toBe('keep-me\n');
    expect(persistedPolicy(dir).getDailySpent()).toBe(8);
  });

  it('pins a relative persistPath against later chdir', () => {
    const dir = tempDir();
    const cwd = process.cwd();
    try {
      process.chdir(dir);
      initializeSpendingPersist('spend.json', KEY);
      const policy = new SpendingPolicy({
        ...limits(),
        persistPath: 'spend.json',
        integrityKey: KEY,
      });
      process.chdir(tmpdir());
      policy.recordSpend(15, 'a.com');
      expect(new SpendingPolicy({
        ...limits(),
        persistPath: persistPath(dir),
        integrityKey: KEY,
      }).getDailySpent()).toBe(15);
    } finally {
      process.chdir(cwd);
    }
    expect(relative(dir, persistPath(dir))).toBe('spend.json');
  });

  it('keeps yesterday and drops only rows older than day-1', () => {
    const dir = tempDir();
    const dayStart = Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      new Date().getUTCDate(),
      0, 0, 0, 0
    );
    const msPerDay = 86_400_000;
    writeFileSync(persistPath(dir), signEnvelope([
      {
        amount: 3,
        timestamp: dayStart - msPerDay - 1,
        domain: 'ancient.com',
        state: 'settled',
      },
      {
        amount: 9,
        timestamp: dayStart - 1,
        domain: 'yesterday.com',
        state: 'settled',
      },
    ]));
    const policy = persistedPolicy(dir);
    expect(policy.getDailySpent()).toBe(0);
    policy.recordSpend(4, 'today.com');
    expect(policy.getDailySpent()).toBe(4);
    const saved = JSON.parse(readFileSync(persistPath(dir), 'utf-8')) as { records: PersistRecord[] };
    expect(saved.records.map(r => r.domain).sort()).toEqual(['today.com', 'yesterday.com']);
  });

  it('does not erase today from the signed file after a forward clock jump', () => {
    const dir = tempDir();
    initializeSpendingPersist(persistPath(dir), KEY);
    const policy = persistedPolicy(dir);
    policy.recordSpend(7, 'today.com');
    const realNow = Date.now;
    const jumped = realNow() + 2 * 86_400_000;
    try {
      Date.now = () => jumped;
      policy.recordSpend(3, 'future.com');
    } finally {
      Date.now = realNow;
    }
    const saved = JSON.parse(readFileSync(persistPath(dir), 'utf-8')) as { records: PersistRecord[] };
    expect(saved.records.map(r => r.domain)).toEqual(['today.com', 'future.com']);
    expect(policy.getDailySpent()).toBe(7);
  });

  it('rejects forged and other-policy reservation handles', () => {
    const dirA = tempDir();
    const dirB = tempDir();
    initializeSpendingPersist(persistPath(dirA), KEY);
    initializeSpendingPersist(persistPath(dirB), KEY);
    const policyA = persistedPolicy(dirA);
    const policyB = persistedPolicy(dirB);
    const reserved = policyA.reserveTransaction(8, 'a.com');
    expect(reserved.reservation).toBeDefined();
    const forged = {
      amount: 8,
      timestamp: Date.now(),
      domain: 'a.com',
      state: 'reserved' as const,
    };
    policyA.voidReservation(forged);
    expect(policyA.getDailySpent()).toBe(8);
    expect(() => policyA.settleReservation(forged)).toThrow(/already released/i);
    policyB.voidReservation(reserved.reservation!);
    expect(policyA.getDailySpent()).toBe(8);
    expect(() => policyB.settleReservation(reserved.reservation!)).toThrow(/already released/i);
    expect(policyB.getDailySpent()).toBe(0);
  });

  it('clears refuse-state after a later successful save', () => {
    const dir = tempDir();
    initializeSpendingPersist(persistPath(dir), KEY);
    const policy = persistedPolicy(dir, { dailyLimit: 100 });
    chmodSync(dir, 0o555);
    policy.recordSpend(10, 'a.com');
    expect(policy.checkTransaction(5, 'a.com').allowed).toBe(false);
    chmodSync(dir, 0o755);
    expect(policy.checkTransaction(5, 'a.com').allowed).toBe(true);
    expect(persistedPolicy(dir).getDailySpent()).toBe(10);
  });

  it('creates persist parent directories with mode 0700 when not root', () => {
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      return;
    }
    const dir = tempDir();
    const nested = join(dir, 'private', 'spend.json');
    initializeSpendingPersist(nested, KEY);
    expect(statSync(join(dir, 'private')).mode & 0o777).toBe(0o700);
  });
});
