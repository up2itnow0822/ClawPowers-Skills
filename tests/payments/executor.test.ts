import { describe, it, expect } from 'vitest';
import { PaymentExecutor } from '../../src/payments/executor.js';
import type { MCPPaymentClient } from '../../src/payments/executor.js';
import { SpendingPolicy } from '../../src/payments/spending.js';
import type { PaymentRequest } from '../../src/types.js';

function createMockClient(
  behavior: 'success' | 'failure' | 'throw' = 'success'
): MCPPaymentClient {
  return {
    async executePayment() {
      if (behavior === 'throw') throw new Error('Network error');
      return {
        txHash: behavior === 'success' ? '0xtxhash123' : '',
        status: behavior === 'success' ? 'success' as const : 'failed' as const,
      };
    },
  };
}

function createPolicy(dailyLimit = 100, transactionLimit = 50): SpendingPolicy {
  return new SpendingPolicy({
    dailyLimit,
    transactionLimit,
    allowedDomains: [],
  });
}

const mockRequest: PaymentRequest = {
  amount: 10,
  currency: 'USDC',
  recipient: '0xrecipient',
  x402Headers: { 'x-payment-amount': '10' },
  domain: 'api.example.com',
};

describe('PaymentExecutor', () => {
  it('executes a successful payment', async () => {
    const executor = new PaymentExecutor(createPolicy(), createMockClient('success'));
    const result = await executor.executePayment(mockRequest);
    expect(result.success).toBe(true);
    expect(result.txHash).toBe('0xtxhash123');
  });

  it('rejects payment when spending policy denies it', async () => {
    const policy = createPolicy(5, 50); // daily limit too low
    policy.recordSpend(4, 'other.com');
    const executor = new PaymentExecutor(policy, createMockClient('success'));
    const result = await executor.executePayment(mockRequest);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Spending policy rejected');
  });

  it('handles MCP client returning failure status', async () => {
    const executor = new PaymentExecutor(createPolicy(), createMockClient('failure'));
    const result = await executor.executePayment(mockRequest);
    expect(result.success).toBe(false);
    expect(result.error).toContain('MCP layer');
  });

  it('handles MCP client throwing an error', async () => {
    const executor = new PaymentExecutor(createPolicy(), createMockClient('throw'));
    const result = await executor.executePayment(mockRequest);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Network error');
  });

  it('logs every payment attempt to audit log', async () => {
    const executor = new PaymentExecutor(createPolicy(), createMockClient('success'));
    await executor.executePayment(mockRequest);
    await executor.executePayment(mockRequest);
    const log = executor.getAuditLog();
    expect(log.length).toBe(2);
    expect(log[0]!.request.amount).toBe(10);
    expect(log[0]!.result.success).toBe(true);
  });

  it('logs rejected payments to audit log', async () => {
    const policy = new SpendingPolicy({
      dailyLimit: 1,
      transactionLimit: 50,
      allowedDomains: ['allowed.com'],
    });
    const executor = new PaymentExecutor(policy, createMockClient('success'));
    await executor.executePayment(mockRequest);
    const log = executor.getAuditLog();
    expect(log.length).toBe(1);
    expect(log[0]!.result.success).toBe(false);
  });

  it('records spend to policy after successful payment', async () => {
    const policy = createPolicy();
    const executor = new PaymentExecutor(policy, createMockClient('success'));
    await executor.executePayment(mockRequest);
    expect(policy.getDailySpent()).toBe(10);
  });

  it('does not record spend after failed payment', async () => {
    const policy = createPolicy();
    const executor = new PaymentExecutor(policy, createMockClient('failure'));
    await executor.executePayment(mockRequest);
    expect(policy.getDailySpent()).toBe(0);
  });

  it('includes spending snapshot in audit log', async () => {
    const executor = new PaymentExecutor(createPolicy(100, 50), createMockClient('success'));
    await executor.executePayment(mockRequest);
    const log = executor.getAuditLog();
    expect(log[0]!.spendingSnapshot.dailyLimit).toBe(100);
    expect(log[0]!.spendingSnapshot.dailySpent).toBe(10);
  });

  it('does not let concurrent payments exceed the daily limit', async () => {
    const policy = new SpendingPolicy({
      dailyLimit: 100,
      transactionLimit: 60,
      allowedDomains: [],
    });

    let releasePayment!: () => void;
    const paymentGate = new Promise<void>((resolve) => {
      releasePayment = resolve;
    });

    let inFlight = 0;
    let peakInFlight = 0;
    const client: MCPPaymentClient = {
      async executePayment() {
        inFlight += 1;
        peakInFlight = Math.max(peakInFlight, inFlight);
        await paymentGate;
        inFlight -= 1;
        return { txHash: '0xconcurrent', status: 'success' };
      },
    };

    const executor = new PaymentExecutor(policy, client);
    const request: PaymentRequest = {
      amount: 60,
      currency: 'USDC',
      recipient: '0xrecipient',
      x402Headers: { 'x-payment-amount': '60' },
      domain: 'api.example.com',
    };

    const first = executor.executePayment(request);
    const second = executor.executePayment({ ...request });

    await Promise.resolve();
    await Promise.resolve();
    releasePayment();

    const results = await Promise.all([first, second]);
    const successes = results.filter((result) => result.success);
    const failures = results.filter((result) => !result.success);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]!.error).toContain('Spending policy rejected');
    expect(policy.getDailySpent()).toBe(60);
    expect(peakInFlight).toBe(1);
  });

  it('allows concurrent payments that still fit the daily limit', async () => {
    const policy = new SpendingPolicy({
      dailyLimit: 100,
      transactionLimit: 50,
      allowedDomains: [],
    });

    let releasePayment!: () => void;
    const paymentGate = new Promise<void>((resolve) => {
      releasePayment = resolve;
    });

    const client: MCPPaymentClient = {
      async executePayment() {
        await paymentGate;
        return { txHash: '0xok', status: 'success' };
      },
    };

    const executor = new PaymentExecutor(policy, client);
    const request: PaymentRequest = {
      amount: 40,
      currency: 'USDC',
      recipient: '0xrecipient',
      x402Headers: { 'x-payment-amount': '40' },
      domain: 'api.example.com',
    };

    const first = executor.executePayment(request);
    const second = executor.executePayment({ ...request });
    await Promise.resolve();
    await Promise.resolve();
    releasePayment();

    const results = await Promise.all([first, second]);
    expect(results.every((result) => result.success)).toBe(true);
    expect(policy.getDailySpent()).toBe(80);
  });
});
