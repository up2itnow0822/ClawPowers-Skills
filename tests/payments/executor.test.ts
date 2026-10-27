import { describe, it, expect } from 'vitest';
import { PaymentExecutor } from '../../src/payments/executor.js';
import type { MCPPaymentClient } from '../../src/payments/executor.js';
import { SpendingPolicy } from '../../src/payments/spending.js';
import type { PaymentRequest } from '../../src/types.js';

function createMockClient(
  behavior: 'settled' | 'not_charged' | 'throw' = 'settled'
): MCPPaymentClient {
  return {
    async executePayment() {
      if (behavior === 'throw') throw new Error('Network error');
      return {
        txHash: behavior === 'settled' ? '0xtxhash123' : '',
        status: behavior === 'settled' ? 'settled' as const : 'not_charged' as const,
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
    const executor = new PaymentExecutor(createPolicy(), createMockClient('settled'));
    const result = await executor.executePayment(mockRequest);
    expect(result.success).toBe(true);
    expect(result.txHash).toBe('0xtxhash123');
  });

  it('rejects payment when spending policy denies it', async () => {
    const policy = createPolicy(5, 50); // daily limit too low
    policy.recordSpend(4, 'other.com');
    const executor = new PaymentExecutor(policy, createMockClient('settled'));
    const result = await executor.executePayment(mockRequest);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Spending policy rejected');
  });

  it('handles MCP client returning failure status', async () => {
    const executor = new PaymentExecutor(createPolicy(), createMockClient('not_charged'));
    const result = await executor.executePayment(mockRequest);
    expect(result.success).toBe(false);
    expect(result.error).toContain('MCP layer');
  });

  it('handles MCP client throwing an error', async () => {
    const policy = createPolicy();
    const executor = new PaymentExecutor(policy, createMockClient('throw'));
    const result = await executor.executePayment(mockRequest);
    expect(result.success).toBe(false);
    expect(result.settlement).toBe('unknown');
    expect(result.error).toContain('Network error');
    expect(policy.getDailySpent()).toBe(10);
  });

  it('logs every payment attempt to audit log', async () => {
    const executor = new PaymentExecutor(createPolicy(), createMockClient('settled'));
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
    const executor = new PaymentExecutor(policy, createMockClient('settled'));
    await executor.executePayment(mockRequest);
    const log = executor.getAuditLog();
    expect(log.length).toBe(1);
    expect(log[0]!.result.success).toBe(false);
  });

  it('records spend to policy after successful payment', async () => {
    const policy = createPolicy();
    const executor = new PaymentExecutor(policy, createMockClient('settled'));
    await executor.executePayment(mockRequest);
    expect(policy.getDailySpent()).toBe(10);
  });

  it('does not record spend after failed payment', async () => {
    const policy = createPolicy();
    const executor = new PaymentExecutor(policy, createMockClient('not_charged'));
    await executor.executePayment(mockRequest);
    expect(policy.getDailySpent()).toBe(0);
  });

  it('includes spending snapshot in audit log', async () => {
    const executor = new PaymentExecutor(createPolicy(100, 50), createMockClient('settled'));
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
        return { txHash: '0xconcurrent', status: 'settled' };
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
        return { txHash: '0xok', status: 'settled' };
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

  it('does not free budget when a thrown error leaves settlement unknown', async () => {
    const policy = createPolicy(100, 50);
    const client: MCPPaymentClient = {
      async executePayment() {
        throw new Error('timeout after submit');
      },
    };
    const executor = new PaymentExecutor(policy, client);
    const result = await executor.executePayment({
      ...mockRequest,
      amount: 10,
      idempotencyKey: 'timeout-1',
    });

    expect(result.success).toBe(false);
    expect(result.settlement).toBe('unknown');
    expect(result.error).toContain('timeout after submit');
    expect(policy.getDailySpent()).toBe(10);

    const followUp = await executor.executePayment({
      ...mockRequest,
      amount: 95,
      idempotencyKey: 'timeout-follow-up',
    });
    expect(followUp.success).toBe(false);
    expect(followUp.error).toContain('Spending policy rejected');
    expect(policy.getDailySpent()).toBe(10);
  });

  it('single-flights concurrent payments that share an idempotencyKey', async () => {
    const policy = createPolicy(100, 50);
    let calls = 0;
    let releasePayment!: () => void;
    const paymentGate = new Promise<void>((resolve) => {
      releasePayment = resolve;
    });

    const client: MCPPaymentClient = {
      async executePayment() {
        calls += 1;
        await paymentGate;
        return { txHash: '0xonce', status: 'settled' };
      },
    };

    const executor = new PaymentExecutor(policy, client);
    const request: PaymentRequest = {
      ...mockRequest,
      idempotencyKey: 'pay-once',
    };

    const first = executor.executePayment(request);
    const second = executor.executePayment({ ...request });
    await Promise.resolve();
    await Promise.resolve();
    releasePayment();

    const [a, b] = await Promise.all([first, second]);
    expect(calls).toBe(1);
    expect(a.success).toBe(true);
    expect(b.success).toBe(true);
    expect(a.txHash).toBe('0xonce');
    expect(b.txHash).toBe('0xonce');
    expect(policy.getDailySpent()).toBe(10);
  });

  it('holds budget when the client reports unknown settlement', async () => {
    const policy = createPolicy(100, 50);
    const client: MCPPaymentClient = {
      async executePayment() {
        return { txHash: '0xmaybe', status: 'unknown' };
      },
    };
    const executor = new PaymentExecutor(policy, client);
    const result = await executor.executePayment(mockRequest);
    expect(result.success).toBe(false);
    expect(result.settlement).toBe('unknown');
    expect(policy.getDailySpent()).toBe(10);
  });
});
