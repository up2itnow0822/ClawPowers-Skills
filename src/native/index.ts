/**
 * 3-Tier Native Module Loader
 *
 * Loading precedence:
 *   1. Native .node addon (fastest — napi-rs compiled Rust)
 *   2. WASM module (portable — wasm-pack compiled Rust)
 *   3. Pure TypeScript fallback (universal — no Rust toolchain needed)
 *
 * The active tier is exposed via `getActiveTier()`.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex } from '@noble/hashes/utils';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// ─── Types matching FFI exports from lib.rs ───────────────────────────────────

export interface NativeWallet {
  address(): string;
  signMessage(msg: Buffer): string;
}
export interface NativeWalletConstructor {
  generate(): NativeWallet;
  fromPrivateKey(hex: string): NativeWallet;
}

export interface NativeFeeSchedule {
  calculate(amount: number, decimals: number, feeType: string): string;
}
export interface NativeFeeScheduleConstructor {
  withDefaults(): NativeFeeSchedule;
  new(txBps: number, swapBps: number, recipientHex: string): NativeFeeSchedule;
}

export interface NativeX402Client {
  createPaymentHeader(paymentJson: string, signature: string): string;
}
export interface NativeX402ClientConstructor {
  new(): NativeX402Client;
}

export interface NativeCanonicalStore {
  insert(recordJson: string): string;
  get(id: string): string | null;
  verifyIntegrity(id: string): boolean;
}
export interface NativeCanonicalStoreConstructor {
  open(path: string): NativeCanonicalStore;
  inMemory(): NativeCanonicalStore;
}

export interface NativeTurboCompressor {
  compress(vector: Float32Array): string;
  decompress(compressedJson: string): Float32Array;
}
export interface NativeTurboCompressorConstructor {
  new(dimensions: number, bits: number): NativeTurboCompressor;
}

export interface NativeWriteFirewall {
  evaluate(requestJson: string): string;
}
export interface NativeWriteFirewallConstructor {
  new(configJson: string): NativeWriteFirewall;
}

export interface NativeModule {
  JsAgentWallet: NativeWalletConstructor;
  JsFeeSchedule: NativeFeeScheduleConstructor;
  JsX402Client: NativeX402ClientConstructor;
  JsCanonicalStore: NativeCanonicalStoreConstructor;
  JsTurboCompressor: NativeTurboCompressorConstructor;
  JsWriteFirewall: NativeWriteFirewallConstructor;
  /** Present when `clawpowers-ffi` was built with keccak helper (ClawPowers-Skills ≥2.1.0). */
  keccak256Bytes?: (data: Buffer) => string;
  /** secp256k1 + Keccak address (ClawPowers-Skills ≥2.2.0). */
  deriveEthereumAddress?: (privateKey: Buffer) => string;
  derivePublicKey?: (privateKey: Buffer) => Buffer;
  signEcdsa?: (privateKey: Buffer, messageHash: Buffer) => Buffer;
  verifyEcdsa?: (publicKey: Buffer, messageHash: Buffer, signature: Buffer) => boolean;
}

// ─── WASM Module Types ───────────────────────────────────────────────────────

export interface WasmModule {
  // Tokens
  tokenAmountFromHuman(human: number, decimals: number): string;
  tokenAmountToHuman(json: string): number;
  tokenAmountAdd(aJson: string, bJson: string): string;
  tokenAmountSub(aJson: string, bJson: string): string;
  tokenAmountMulBps(json: string, bps: bigint): string;
  getDefaultTokenRegistry(): string;

  // Fee
  calculateFee(
    amountJson: string,
    feeType: string,
    txFeeBps?: bigint,
    swapFeeBps?: bigint,
  ): string;

  // Compression
  compressVector(vectorJson: string, dimensions: number): string;
  decompressVector(compressedJson: string, dimensions: number): string;
  approximateDistance(aJson: string, bJson: string, dimensions: number): number;

  // Canonical
  WasmCanonicalStore: {
    new(): WasmCanonicalStoreInstance;
  };

  // Security
  evaluateWriteFirewall(json: string): string;

  // Hashing
  computeSha256(content: string): string;
  /** Keccak-256 over raw bytes (`0x` + 64 hex). Present in wasm builds from ClawPowers-Skills ≥2.1.0. */
  computeKeccak256?(bytes: Uint8Array): string;

  /** secp256k1 Ethereum address (ClawPowers-Skills ≥2.2.0). */
  deriveEthereumAddress?(privateKey: Uint8Array): string;
  derivePublicKey?(privateKey: Uint8Array): Uint8Array;
  signEcdsa?(privateKey: Uint8Array, messageHash: Uint8Array): Uint8Array;
  verifyEcdsa?(publicKey: Uint8Array, messageHash: Uint8Array, signature: Uint8Array): boolean;

  // Info
  getVersion(): string;
  getAvailableModules(): string;
}

export interface WasmCanonicalStoreInstance {
  insert(json: string): string;
  get(id: string): string | null;
  getByHash(hash: string): string | null;
  queryNamespace(namespace: string, limit: number): string;
  softDelete(id: string): boolean;
  verifyIntegrity(id: string): boolean;
  exportJson(): string;
  importJson(json: string): number;
}

// ─── Active Tier ─────────────────────────────────────────────────────────────

export type LoadTier = 'native' | 'wasm' | 'typescript';

let _native: NativeModule | null = null;
let _wasm: WasmModule | null = null;
let _activeTier: LoadTier = 'typescript';
let _attempted = false;

// ─── Tier 1: Native .node addon ──────────────────────────────────────────────

function tryLoadNative(): NativeModule | null {
  const candidates = [
    join(__dirname, '../../native/ffi/index.node'),
    join(__dirname, '../../native/ffi/clawpowers_ffi.node'),
    join(__dirname, '../../../native/ffi/index.node'),
    join(__dirname, '../../../native/ffi/clawpowers_ffi.node'),
    join(__dirname, '../native/ffi/index.node'),
    join(__dirname, '../native/ffi/clawpowers_ffi.node'),
  ];

  for (const p of candidates) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(p) as NativeModule;
      console.log(`[clawpowers] Tier 1: Native acceleration enabled (${p})`);
      return mod;
    } catch {
      // Continue
    }
  }
  return null;
}

// ─── Tier 2: WASM module ─────────────────────────────────────────────────────

function tryLoadWasm(): WasmModule | null {
  // Try Node.js WASM package first (dist/index.js → ../native/...; src/native/*.ts → ../../native/...)
  const wasmCandidates = [
    join(__dirname, '../native/wasm/pkg-node/clawpowers_wasm.js'),
    join(__dirname, '../native/wasm/pkg/clawpowers_wasm.js'),
    join(__dirname, '../../native/wasm/pkg-node/clawpowers_wasm.js'),
    join(__dirname, '../../native/wasm/pkg/clawpowers_wasm.js'),
  ];

  for (const p of wasmCandidates) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(p) as WasmModule;
      console.log(`[clawpowers] Tier 2: WASM module loaded (${p})`);
      return mod;
    } catch {
      // Continue
    }
  }
  return null;
}

// ─── Combined Loader ─────────────────────────────────────────────────────────

function loadAll(): void {
  if (_attempted) return;
  _attempted = true;

  // Tier 1: Try native (primary tier for getActiveTier())
  _native = tryLoadNative();
  if (_native) {
    _activeTier = 'native';
    // Still load WASM when present: native builds may omit newer exports (e.g. secp256k1)
    // while prebuilt WASM provides them. Helpers try native first, then WASM.
    _wasm = tryLoadWasm();
    return;
  }

  // Tier 2: WASM only
  _wasm = tryLoadWasm();
  if (_wasm) {
    _activeTier = 'wasm';
    return;
  }

  // Tier 3: TypeScript fallback
  _activeTier = 'typescript';
  console.log('[clawpowers] Tier 3: TypeScript fallback active (no native or WASM)');
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Get the native .node module, or null if unavailable.
 */
export function getNative(): NativeModule | null {
  loadAll();
  return _native;
}

/**
 * Get the WASM module, or null if unavailable.
 */
export function getWasm(): WasmModule | null {
  loadAll();
  return _wasm;
}

/**
 * Returns true if the native Rust addon was loaded successfully.
 */
export function isNativeAvailable(): boolean {
  loadAll();
  return _native !== null;
}

/**
 * Returns true if the WASM module was loaded successfully.
 */
export function isWasmAvailable(): boolean {
  loadAll();
  return _wasm !== null;
}

/**
 * Returns the active loading tier.
 */
export function getActiveTier(): LoadTier {
  loadAll();
  return _activeTier;
}

/**
 * Returns a summary of available modules per tier.
 */
export function getCapabilitySummary(): {
  tier: LoadTier;
  nativeModules: string[];
  wasmModules: string[];
  typescriptFallback: string[];
} {
  loadAll();

  const nativeModules = _native
    ? ['wallet', 'fee', 'x402', 'canonical', 'compression', 'verification', 'security']
    : [];

  let wasmModules: string[] = [];
  if (_wasm) {
    try {
      wasmModules = JSON.parse(_wasm.getAvailableModules());
    } catch {
      wasmModules = ['tokens', 'fee', 'compression', 'canonical', 'verification', 'security', 'index'];
    }
  }

  // These always have TS implementations
  const typescriptFallback = [
    'wallet',   // ethers.js / viem
    'x402',     // fetch()-based HTTP client
    'tokens',   // Pure TS decimal math
    'fee',      // Pure TS fee calculation
    'policy',   // Pure TS policy engine
  ];

  return {
    tier: _activeTier,
    nativeModules,
    wasmModules,
    typescriptFallback,
  };
}

// ─── Unified Operation Helpers ───────────────────────────────────────────────
// These route to the best available backend automatically.

/**
 * Compute SHA-256 hash, using the fastest available backend.
 */
export function computeSha256(content: string): string {
  loadAll();

  // Try WASM
  if (_wasm) {
    return _wasm.computeSha256(content);
  }

  // TypeScript fallback using Node.js crypto
  const { createHash } = require('node:crypto');
  return createHash('sha256').update(content).digest('hex');
}

/**
 * 32-byte Keccak-256 digest as `0x` + 64 hex chars for wallet address derivation.
 *
 * Tier 1: native `keccak256Bytes` (fastest).
 * Tier 2: WASM `computeKeccak256`.
 * Tier 3: @noble/hashes keccak_256 (pure TypeScript, audited).
 *
 * All tiers produce identical Keccak-256 output.
 */
export function digestForWalletAddress(keyMaterial: Buffer): string {
  loadAll();

  if (_native && typeof _native.keccak256Bytes === 'function') {
    try {
      return _native.keccak256Bytes(keyMaterial);
    } catch {
      // fall through
    }
  }

  if (_wasm && typeof _wasm.computeKeccak256 === 'function') {
    try {
      return _wasm.computeKeccak256(new Uint8Array(keyMaterial));
    } catch {
      // fall through
    }
  }

  // Pure TS via @noble/hashes — identical Keccak-256 output
  return '0x' + bytesToHex(keccak_256(new Uint8Array(keyMaterial)));
}

/**
 * Keccak-256 digest of raw bytes as a 32-byte `Buffer`.
 * Tier 1: native; Tier 2: WASM; Tier 3: @noble/hashes.
 * Always succeeds — @noble provides the universal fallback.
 */
export function keccak256Digest(data: Buffer): Buffer {
  loadAll();

  if (_native && typeof _native.keccak256Bytes === 'function') {
    try {
      const hex = _native.keccak256Bytes(data);
      return Buffer.from(hex.replace(/^0x/i, ''), 'hex');
    } catch {
      // fall through
    }
  }

  if (_wasm && typeof _wasm.computeKeccak256 === 'function') {
    try {
      const hex = _wasm.computeKeccak256(new Uint8Array(data));
      return Buffer.from(hex.replace(/^0x/i, ''), 'hex');
    } catch {
      // fall through
    }
  }

  // Pure TS via @noble/hashes
  return Buffer.from(keccak_256(new Uint8Array(data)));
}

/**
 * Ethereum address from 32-byte secp256k1 private key (EIP-55). Tier 1 → Tier 2 → `null`.
 */
export function deriveEthereumAddress(privateKey: Buffer): string | null {
  loadAll();

  if (_native && typeof _native.deriveEthereumAddress === 'function') {
    try {
      return _native.deriveEthereumAddress(privateKey);
    } catch {
      // fall through
    }
  }

  if (_wasm && typeof _wasm.deriveEthereumAddress === 'function') {
    try {
      return _wasm.deriveEthereumAddress(new Uint8Array(privateKey));
    } catch {
      // fall through
    }
  }

  return null;
}

/**
 * Uncompressed public key (64 bytes, no `0x04` prefix). Tier 1 → Tier 2 → `null`.
 */
export function derivePublicKey(privateKey: Buffer): Buffer | null {
  loadAll();

  if (_native && typeof _native.derivePublicKey === 'function') {
    try {
      return Buffer.from(_native.derivePublicKey(privateKey));
    } catch {
      // fall through
    }
  }

  if (_wasm && typeof _wasm.derivePublicKey === 'function') {
    try {
      return Buffer.from(_wasm.derivePublicKey(new Uint8Array(privateKey)));
    } catch {
      // fall through
    }
  }

  return null;
}

/**
 * ECDSA sign a 32-byte message hash (65 bytes: r‖s‖recovery_id). Tier 1 → Tier 2 → `null`.
 */
export function signEcdsa(privateKey: Buffer, messageHash: Buffer): Buffer | null {
  loadAll();

  if (_native && typeof _native.signEcdsa === 'function') {
    try {
      return Buffer.from(_native.signEcdsa(privateKey, messageHash));
    } catch {
      // fall through
    }
  }

  if (_wasm && typeof _wasm.signEcdsa === 'function') {
    try {
      return Buffer.from(_wasm.signEcdsa(new Uint8Array(privateKey), new Uint8Array(messageHash)));
    } catch {
      // fall through
    }
  }

  return null;
}

/**
 * Verify ECDSA over a 32-byte prehash. Tier 1 → Tier 2; otherwise `false`.
 */
export function verifyEcdsa(
  publicKey: Buffer,
  messageHash: Buffer,
  signature: Buffer,
): boolean {
  loadAll();

  try {
    if (_native && typeof _native.verifyEcdsa === 'function') {
      return _native.verifyEcdsa(publicKey, messageHash, signature);
    }
    if (_wasm && typeof _wasm.verifyEcdsa === 'function') {
      return _wasm.verifyEcdsa(
        new Uint8Array(publicKey),
        new Uint8Array(messageHash),
        new Uint8Array(signature),
      );
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Create a token amount from a human-readable number.
 * Routes to WASM if available, otherwise pure TypeScript.
 */
export function tokenAmountFromHuman(
  human: number,
  decimals: number,
): { raw: string; decimals: number } {
  loadAll();

  if (_wasm) {
    return JSON.parse(_wasm.tokenAmountFromHuman(human, decimals));
  }

  // TypeScript fallback
  const multiplier = Math.pow(10, decimals);
  const raw = Math.floor(human * multiplier);
  return { raw: raw.toString(), decimals };
}

/**
 * Calculate a fee, routing to the best available backend.
 */
export function calculateFee(
  amountHuman: number,
  decimals: number,
  feeType: 'transaction' | 'swap' | string,
  txFeeBps?: number,
  swapFeeBps?: number,
): { gross_amount: number; fee_amount: number; net_amount: number } {
  loadAll();

  if (_wasm) {
    const amountJson = _wasm.tokenAmountFromHuman(amountHuman, decimals);
    const result = _wasm.calculateFee(
      amountJson,
      feeType,
      txFeeBps !== undefined ? BigInt(txFeeBps) : undefined,
      swapFeeBps !== undefined ? BigInt(swapFeeBps) : undefined,
    );
    return JSON.parse(result);
  }

  // TypeScript fallback
  const bps =
    feeType === 'transaction'
      ? (txFeeBps ?? 77)
      : feeType === 'swap'
        ? (swapFeeBps ?? 30)
        : parseInt(feeType.replace('custom:', ''), 10) || 0;

  const feeAmount = (amountHuman * bps) / 10_000;
  return {
    gross_amount: amountHuman,
    fee_amount: feeAmount,
    net_amount: amountHuman - feeAmount,
  };
}

/**
 * Evaluate a write request against the security firewall.
 * Routes to WASM if available, otherwise TypeScript.
 */
export function evaluateWriteFirewall(request: {
  namespace: string;
  content: string;
  trust_level: string;
  source: string;
  allowed_namespaces?: string[];
  blocked_patterns?: string[];
  max_content_length?: number;
}): { decision: 'allow' | 'deny' | 'sanitize'; reason?: string; sanitized?: string } {
  loadAll();

  if (_wasm) {
    return JSON.parse(_wasm.evaluateWriteFirewall(JSON.stringify(request)));
  }

  // TypeScript fallback — basic security checks
  if (
    request.allowed_namespaces &&
    request.allowed_namespaces.length > 0 &&
    !request.allowed_namespaces.includes(request.namespace)
  ) {
    return {
      decision: 'deny',
      reason: `namespace '${request.namespace}' is not in the allow-list`,
    };
  }

  const maxLen = request.max_content_length ?? 1024 * 1024;
  if (request.content.length > maxLen) {
    return {
      decision: 'deny',
      reason: `content length ${request.content.length} exceeds maximum ${maxLen}`,
    };
  }

  if (request.blocked_patterns) {
    for (const pattern of request.blocked_patterns) {
      if (request.content.includes(pattern)) {
        if (request.trust_level === 'system' || request.trust_level === 'agent') {
          return {
            decision: 'deny',
            reason: `content contains blocked pattern '${pattern}'`,
          };
        }
        return {
          decision: 'sanitize',
          sanitized: request.content.replaceAll(pattern, ''),
        };
      }
    }
  }

  return { decision: 'allow' };
}
