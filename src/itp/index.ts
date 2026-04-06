/**
 * ITP TypeScript Client — Identical Twins Protocol
 *
 * Wraps the Python ITP server HTTP API (http://localhost:8100).
 * Provides encode(), decode(), healthCheck() utilities.
 * Falls back gracefully if server not running (returns original message).
 */

const ITP_BASE_URL = 'http://localhost:8100';
const TIMEOUT_MS = 3000;

export interface EncodeResult {
  encoded: string;
  wasCompressed: boolean;
  savingsPct: number;
}

export interface DecodeResult {
  decoded: string;
  wasItp: boolean;
}

interface EncodeApiResponse {
  encoded?: string;
  was_compressed?: boolean;
  savings_pct?: number;
}

interface DecodeApiResponse {
  decoded?: string;
  was_itp?: boolean;
}

/**
 * Encode a natural language message using the ITP codebook.
 * If the server is unreachable, returns the original message unchanged.
 */
export async function encode(
  message: string,
  sourceAgent?: string,
): Promise<EncodeResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(`${ITP_BASE_URL}/tools/encode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        source_agent: sourceAgent ?? 'unknown',
        target_agent: 'unknown',
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return { encoded: message, wasCompressed: false, savingsPct: 0 };
    }

    const data = (await response.json()) as EncodeApiResponse;
    return {
      encoded: data.encoded ?? message,
      wasCompressed: Boolean(data.was_compressed),
      savingsPct: typeof data.savings_pct === 'number' ? data.savings_pct : 0,
    };
  } catch {
    // Server unreachable — graceful fallback
    return { encoded: message, wasCompressed: false, savingsPct: 0 };
  }
}

/**
 * Decode an ITP-encoded message back to natural language.
 * If the server is unreachable, returns the original message unchanged.
 */
export async function decode(message: string): Promise<DecodeResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(`${ITP_BASE_URL}/tools/decode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return { decoded: message, wasItp: false };
    }

    const data = (await response.json()) as DecodeApiResponse;
    return {
      decoded: data.decoded ?? message,
      wasItp: Boolean(data.was_itp),
    };
  } catch {
    // Server unreachable — graceful fallback
    return { decoded: message, wasItp: false };
  }
}

/**
 * Check if the ITP server is running and healthy.
 */
export async function healthCheck(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(`${ITP_BASE_URL}/health`, {
      signal: controller.signal,
    });

    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}
