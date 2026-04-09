/**
 * Native acceleration bridge for payments.
 *
 * Tier 1: Native Rust .node addon (fastest — napi-rs compiled)
 * Tier 2: WASM module (portable — wasm-pack compiled)
 * Tier 3: Pure TypeScript fallback (universal)
 *
 * Note: x402 remains native/TypeScript only, but wallet address derivation is
 * available in both Tier 1 native and Tier 2 WASM via the shared secp256k1 +
 * Keccak implementation in src/native/index.ts.
 */
import { randomBytes } from 'node:crypto';
import {
  calculateFee as wasmCalculateFee,
  deriveEthereumAddress,
  getNative,
  getWasm,
} from '../native/index.js';

export interface FeeCalculation {
  gross: number;
  fee: number;
  net: number;
  feeRecipient: string;
}

/**
 * Calculate transaction fee using the best available backend.
 *
 * Tier 1: Native Rust fee crate (JsFeeSchedule.withDefaults, 77 bps)
 * Tier 2: WASM fee crate (calculateFee via index.ts helper)
 * Tier 3: Pure TypeScript 77 bps calculation
 */
export function calculateTransactionFee(
  amount: number,
  decimals: number = 6,
): FeeCalculation {
  // Tier 1: Native
  const native = getNative();
  if (native) {
    try {
      const schedule = native.JsFeeSchedule.withDefaults();
      const raw = JSON.parse(schedule.calculate(amount, decimals, 'transaction')) as Record<string, unknown>;
      return {
        gross: raw.gross as number,
        fee: raw.fee as number,
        net: raw.net as number,
        feeRecipient: (raw.feeRecipient ?? raw.fee_recipient ?? '0x0000000000000000000000000000000000000000') as string,
      };
    } catch {
      // Fall through to Tier 2
    }
  }

  // Tier 2: WASM (via the unified helper in native/index.ts)
  const wasm = getWasm();
  if (wasm) {
    try {
      const result = wasmCalculateFee(amount, decimals, 'transaction');
      return {
        gross: result.gross_amount,
        fee: result.fee_amount,
        net: result.net_amount,
        feeRecipient: '0x0000000000000000000000000000000000000000',
      };
    } catch {
      // Fall through to Tier 3
    }
  }

  // Tier 3: TypeScript fallback — 77 bps
  const fee = amount * 0.0077;
  return {
    gross: amount,
    fee,
    net: amount - fee,
    feeRecipient: '0x0000000000000000000000000000000000000000',
  };
}

/**
 * Build an X-Payment header.
 *
 * Tier 1: Native Rust x402 crate (JsX402Client)
 * Tier 2: Not available in WASM (wallet/x402 excluded from wasm crate)
 * Tier 3: Base64-encoded JSON representation
 */
export function createPaymentHeader(paymentJson: string, signature: string): string {
  // Tier 1: Native
  const native = getNative();
  if (native) {
    try {
      const client = new native.JsX402Client();
      return client.createPaymentHeader(paymentJson, signature);
    } catch {
      // Fall through to Tier 3 (WASM does not expose x402)
    }
  }

  // Tier 3: TypeScript fallback (x402 excluded from WASM build)
  return Buffer.from(JSON.stringify({ payment: JSON.parse(paymentJson), signature })).toString('base64');
}

/**
 * Generate a new EVM agent wallet address.
 *
 * Tier 1: Native Rust wallet crate (JsAgentWallet.generate)
 * Tier 2: WASM secp256k1 + Keccak derivation via the shared loader
 * Tier 3: throws, because returning a fake zero address would be misleading
 */
export function generateWalletAddress(): string {
  // Tier 1: Native
  const native = getNative();
  if (native) {
    try {
      return native.JsAgentWallet.generate().address();
    } catch {
      // Fall through to shared loader path
    }
  }

  const address = deriveEthereumAddress(randomBytes(32));
  if (address) {
    return address;
  }

  throw new Error(
    'Unable to derive a real Ethereum address. Native or WASM wallet support is required for generateWalletAddress().'
  );
}
