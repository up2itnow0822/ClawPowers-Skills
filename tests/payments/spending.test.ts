import { describe, it, expect } from 'vitest';
import { SpendingPolicy } from '../../src/payments/spending.js';

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
});
