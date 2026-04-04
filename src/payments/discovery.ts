/**
 * ClawPowers Agent — Payment Discovery
 * Detects HTTP 402 Payment Required responses and parses x402 headers.
 */

import type { PaymentRequired } from '../types.js';

const REQUIRED_HEADERS = [
  'x-payment-amount',
  'x-payment-currency',
  'x-payment-recipient',
  'x-payment-network',
] as const;

interface HttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * Detect a 402 Payment Required response and extract payment details from x402 headers.
 * Returns null if the response is not a 402 or if required headers are missing.
 */
export function detect402(response: HttpResponse): PaymentRequired | null {
  if (response.status !== 402) {
    return null;
  }

  // Normalize header keys to lowercase for case-insensitive matching
  const normalizedHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(response.headers)) {
    normalizedHeaders[key.toLowerCase()] = value;
  }

  // Check all required headers are present
  for (const header of REQUIRED_HEADERS) {
    if (!normalizedHeaders[header] || normalizedHeaders[header].trim() === '') {
      return null;
    }
  }

  const amountStr = normalizedHeaders['x-payment-amount']!;
  const amount = Number(amountStr);

  if (Number.isNaN(amount) || amount <= 0) {
    return null;
  }

  // Collect all x-payment headers for passthrough
  const x402Headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(normalizedHeaders)) {
    if (key.startsWith('x-payment-')) {
      x402Headers[key] = value;
    }
  }

  return {
    amount,
    currency: normalizedHeaders['x-payment-currency']!,
    recipient: normalizedHeaders['x-payment-recipient']!,
    network: normalizedHeaders['x-payment-network']!,
    x402Headers,
  };
}

/**
 * Type guard to check if an error represents a 402 Payment Required response.
 */
export function isPaymentRequired(error: unknown): boolean {
  if (error === null || error === undefined) return false;

  if (typeof error === 'object') {
    const obj = error as Record<string, unknown>;

    // Check for status property
    if ('status' in obj && obj['status'] === 402) return true;

    // Check for statusCode property
    if ('statusCode' in obj && obj['statusCode'] === 402) return true;

    // Check for response.status
    if ('response' in obj && typeof obj['response'] === 'object' && obj['response'] !== null) {
      const response = obj['response'] as Record<string, unknown>;
      if ('status' in response && response['status'] === 402) return true;
    }

    // Check for message containing 402
    if ('message' in obj && typeof obj['message'] === 'string' && obj['message'].includes('402')) {
      return true;
    }
  }

  return false;
}
