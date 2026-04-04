/**
 * Integration Test: Payment Flow
 * Tests 402 detection → spending policy → payment execution → audit logging.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { detect402 } from '../../src/payments/discovery.js';
import { SpendingPolicy } from '../../src/payments/spending.js';
import { PaymentExecutor } from '../../src/payments/executor.js';
import type { MCPPaymentClient } from '../../src/payments/executor.js';
import type { PaymentRequest } from '../../src/types.js';

function makePaymentRequest(overrides: Partial<PaymentRequest> = {}): PaymentRequest {
  return {
    amount: 1.00,
    currency: 'USDC',
    recipient: '0xRecipient',
    x402Headers: {
      'x-payment-amount': '1.00',
      'x-payment-currency': 'USDC',
      'x-payment-recipient': '0xRecipient',
      'x-payment-network': 'base',
    },
    domain: 'api.example.com',
    ...overrides,
  };
}

function makeSuccessClient(): MCPPaymentClient {
  return {
    executePayment: async () => ({ txHash: '0xabc123', status: 'success' }),
  };
}

function makeFailClient(): MCPPaymentClient {
  return {
    executePayment: async () => ({ txHash: '', status: 'failed' }),
  };
}

describe('Payment Flow Integration', () => {
  let policy: SpendingPolicy;

  beforeEach(() => {
    policy = new SpendingPolicy({
      dailyLimit: 25,
      transactionLimit: 10,
      allowedDomains: ['api.example.com', 'data.service.io'],
    });
  });

  it('402 detection → spending policy check → execute payment → log audit', async () => {
    // Step 1: Detect 402 response
    const response = {
      status: 402,
      headers: {
        'X-Payment-Amount': '2.50',
        'X-Payment-Currency': 'USDC',
        'X-Payment-Recipient': '0xRecipient',
        'X-Payment-Network': 'base',
      },
    };

    const paymentRequired = detect402(response);
    expect(paymentRequired).not.toBeNull();
    expect(paymentRequired!.amount).toBe(2.50);
    expect(paymentRequired!.currency).toBe('USDC');

    // Step 2: Create payment request and check policy
    const request = makePaymentRequest({
      amount: paymentRequired!.amount,
      domain: 'api.example.com',
    });

    const decision = policy.checkTransaction(request.amount, request.domain);
    expect(decision.allowed).toBe(true);

    // Step 3: Execute payment
    const executor = new PaymentExecutor(policy, makeSuccessClient());
    const result = await executor.executePayment(request);
    expect(result.success).toBe(true);
    expect(result.txHash).toBe('0xabc123');

    // Step 4: Verify audit log
    const audit = executor.getAuditLog();
    expect(audit).toHaveLength(1);
    expect(audit[0]!.request.amount).toBe(2.50);
    expect(audit[0]!.result.success).toBe(true);
    expect(audit[0]!.spendingSnapshot.dailySpent).toBe(2.50);
  });

  it('over daily limit → payment blocked', async () => {
    const executor = new PaymentExecutor(policy, makeSuccessClient());

    // Spend up to near the limit
    await executor.executePayment(makePaymentRequest({ amount: 9 }));
    await executor.executePayment(makePaymentRequest({ amount: 9 }));
    await executor.executePayment(makePaymentRequest({ amount: 6 }));

    // This should exceed the $25 daily limit
    const result = await executor.executePayment(makePaymentRequest({ amount: 5 }));
    expect(result.success).toBe(false);
    expect(result.error).toContain('daily limit');

    const audit = executor.getAuditLog();
    expect(audit).toHaveLength(4);
    expect(audit[3]!.result.success).toBe(false);
  });

  it('blocked domain → payment rejected', async () => {
    const executor = new PaymentExecutor(policy, makeSuccessClient());

    const request = makePaymentRequest({ domain: 'evil.hacker.com' });
    const result = await executor.executePayment(request);

    expect(result.success).toBe(false);
    expect(result.error).toContain('not in the allowed domains');

    const audit = executor.getAuditLog();
    expect(audit).toHaveLength(1);
    expect(audit[0]!.result.success).toBe(false);
  });

  it('payment failure → logged, task continues', async () => {
    const executor = new PaymentExecutor(policy, makeFailClient());

    const request = makePaymentRequest({ amount: 1 });
    const result = await executor.executePayment(request);

    expect(result.success).toBe(false);
    expect(result.error).toContain('failed at MCP layer');

    // Daily spent should NOT increase on failure
    expect(policy.getDailySpent()).toBe(0);

    const audit = executor.getAuditLog();
    expect(audit).toHaveLength(1);
    expect(audit[0]!.spendingSnapshot.dailySpent).toBe(0);
  });

  it('multiple payments in one task → daily total tracked correctly', async () => {
    const executor = new PaymentExecutor(policy, makeSuccessClient());

    await executor.executePayment(makePaymentRequest({ amount: 3 }));
    await executor.executePayment(makePaymentRequest({ amount: 5 }));
    await executor.executePayment(makePaymentRequest({ amount: 7 }));

    expect(policy.getDailySpent()).toBe(15);

    const audit = executor.getAuditLog();
    expect(audit).toHaveLength(3);

    // Verify cumulative daily spending in snapshots
    expect(audit[0]!.spendingSnapshot.dailySpent).toBe(3);
    expect(audit[1]!.spendingSnapshot.dailySpent).toBe(8);
    expect(audit[2]!.spendingSnapshot.dailySpent).toBe(15);
  });

  it('per-transaction limit enforced', async () => {
    const executor = new PaymentExecutor(policy, makeSuccessClient());

    // Transaction limit is $10
    const result = await executor.executePayment(makePaymentRequest({ amount: 11 }));
    expect(result.success).toBe(false);
    expect(result.error).toContain('per-transaction limit');
  });

  it('payment client exception → caught and logged, no retry', async () => {
    const errorClient: MCPPaymentClient = {
      executePayment: async () => { throw new Error('Network timeout'); },
    };

    const executor = new PaymentExecutor(policy, errorClient);
    const result = await executor.executePayment(makePaymentRequest({ amount: 1 }));

    expect(result.success).toBe(false);
    expect(result.error).toContain('Network timeout');

    // No spending recorded on error
    expect(policy.getDailySpent()).toBe(0);

    const audit = executor.getAuditLog();
    expect(audit).toHaveLength(1);
  });

  it('spending policy with empty allowedDomains allows all domains', async () => {
    const openPolicy = new SpendingPolicy({
      dailyLimit: 100,
      transactionLimit: 50,
      allowedDomains: [],
    });

    const executor = new PaymentExecutor(openPolicy, makeSuccessClient());
    const result = await executor.executePayment(
      makePaymentRequest({ domain: 'any-domain.com', amount: 5 })
    );

    expect(result.success).toBe(true);
  });

  it('402 detection returns null for non-402 responses', () => {
    expect(detect402({ status: 200, headers: {} })).toBeNull();
    expect(detect402({ status: 403, headers: {} })).toBeNull();
    expect(detect402({ status: 402, headers: {} })).toBeNull(); // Missing required headers
  });

  it('spending resets on new SpendingPolicy instance (simulates midnight rollover)', async () => {
    const executor1 = new PaymentExecutor(policy, makeSuccessClient());
    await executor1.executePayment(makePaymentRequest({ amount: 10 }));
    expect(policy.getDailySpent()).toBe(10);

    // Reset simulates midnight rollover
    policy.reset();
    expect(policy.getDailySpent()).toBe(0);

    // Can now spend again
    const result = await executor1.executePayment(makePaymentRequest({ amount: 10 }));
    expect(result.success).toBe(true);
    expect(policy.getDailySpent()).toBe(10);
  });
});
