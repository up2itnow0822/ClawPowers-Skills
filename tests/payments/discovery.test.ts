import { describe, it, expect } from 'vitest';
import { detect402, isPaymentRequired } from '../../src/payments/discovery.js';

describe('detect402', () => {
  it('detects a valid 402 response with all required headers', () => {
    const result = detect402({
      status: 402,
      headers: {
        'X-Payment-Amount': '5.00',
        'X-Payment-Currency': 'USDC',
        'X-Payment-Recipient': '0x1234567890abcdef',
        'X-Payment-Network': 'base',
      },
    });
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(5);
    expect(result!.currency).toBe('USDC');
    expect(result!.recipient).toBe('0x1234567890abcdef');
    expect(result!.network).toBe('base');
  });

  it('returns null for non-402 responses', () => {
    expect(detect402({ status: 200, headers: {} })).toBeNull();
    expect(detect402({ status: 404, headers: {} })).toBeNull();
    expect(detect402({ status: 500, headers: {} })).toBeNull();
  });

  it('returns null for 402 with missing required headers', () => {
    const result = detect402({
      status: 402,
      headers: {
        'X-Payment-Amount': '5.00',
        // Missing currency, recipient, network
      },
    });
    expect(result).toBeNull();
  });

  it('handles case-insensitive headers', () => {
    const result = detect402({
      status: 402,
      headers: {
        'x-payment-amount': '10.50',
        'x-payment-currency': 'ETH',
        'x-payment-recipient': '0xabc',
        'x-payment-network': 'ethereum',
      },
    });
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(10.5);
  });

  it('returns null for invalid amount', () => {
    const result = detect402({
      status: 402,
      headers: {
        'X-Payment-Amount': 'not-a-number',
        'X-Payment-Currency': 'USDC',
        'X-Payment-Recipient': '0xabc',
        'X-Payment-Network': 'base',
      },
    });
    expect(result).toBeNull();
  });

  it('returns null for zero amount', () => {
    const result = detect402({
      status: 402,
      headers: {
        'X-Payment-Amount': '0',
        'X-Payment-Currency': 'USDC',
        'X-Payment-Recipient': '0xabc',
        'X-Payment-Network': 'base',
      },
    });
    expect(result).toBeNull();
  });

  it('returns null for negative amount', () => {
    const result = detect402({
      status: 402,
      headers: {
        'X-Payment-Amount': '-5',
        'X-Payment-Currency': 'USDC',
        'X-Payment-Recipient': '0xabc',
        'X-Payment-Network': 'base',
      },
    });
    expect(result).toBeNull();
  });

  it('collects all x-payment headers into x402Headers', () => {
    const result = detect402({
      status: 402,
      headers: {
        'X-Payment-Amount': '1',
        'X-Payment-Currency': 'USDC',
        'X-Payment-Recipient': '0xabc',
        'X-Payment-Network': 'base',
        'X-Payment-Memo': 'test-memo',
      },
    });
    expect(result).not.toBeNull();
    expect(result!.x402Headers['x-payment-memo']).toBe('test-memo');
  });

  it('returns null for empty header values', () => {
    const result = detect402({
      status: 402,
      headers: {
        'X-Payment-Amount': '5',
        'X-Payment-Currency': '',
        'X-Payment-Recipient': '0xabc',
        'X-Payment-Network': 'base',
      },
    });
    expect(result).toBeNull();
  });
});

describe('isPaymentRequired', () => {
  it('returns true for object with status 402', () => {
    expect(isPaymentRequired({ status: 402 })).toBe(true);
  });

  it('returns true for object with statusCode 402', () => {
    expect(isPaymentRequired({ statusCode: 402 })).toBe(true);
  });

  it('returns true for nested response.status 402', () => {
    expect(isPaymentRequired({ response: { status: 402 } })).toBe(true);
  });

  it('returns true for error message containing 402', () => {
    expect(isPaymentRequired({ message: 'HTTP 402 Payment Required' })).toBe(true);
  });

  it('returns false for null/undefined', () => {
    expect(isPaymentRequired(null)).toBe(false);
    expect(isPaymentRequired(undefined)).toBe(false);
  });

  it('returns false for non-402 status', () => {
    expect(isPaymentRequired({ status: 200 })).toBe(false);
    expect(isPaymentRequired({ status: 404 })).toBe(false);
  });

  it('returns false for primitive values', () => {
    expect(isPaymentRequired(42)).toBe(false);
    expect(isPaymentRequired('error')).toBe(false);
  });
});
