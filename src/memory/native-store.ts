/**
 * Native acceleration bridge for memory storage.
 *
 * Tier 1: Native Rust .node addon (canonical store, TurboQuant compressor, write firewall)
 * Tier 2: WASM module (WasmCanonicalStore, compressVector, evaluateWriteFirewall)
 * Tier 3: Pure TypeScript fallback (null returns / fail-open defaults)
 *
 * Note: Wallet and x402 are excluded from the WASM build; memory functions
 * (canonical store, compression, security, verification) are all available in WASM.
 */
import { getNative, getWasm, computeSha256, evaluateWriteFirewall as wasmEvaluateWriteFirewall } from '../native/index.js';
import type { NativeCanonicalStore, WasmCanonicalStoreInstance } from '../native/index.js';

// ─── Canonical Store ─────────────────────────────────────────────────────────

/** Get a native persistent canonical store, or null if unavailable. */
export function getNativeCanonicalStore(dbPath: string): NativeCanonicalStore | null {
  const native = getNative();
  if (!native) return null;
  try {
    return native.JsCanonicalStore.open(dbPath);
  } catch {
    return null;
  }
}

/** Get an in-memory native canonical store for testing, or null if unavailable. */
export function getNativeCanonicalStoreInMemory(): NativeCanonicalStore | null {
  const native = getNative();
  if (!native) return null;
  try {
    return native.JsCanonicalStore.inMemory();
  } catch {
    return null;
  }
}

/**
 * Get an in-memory WASM canonical store, or null if WASM is unavailable.
 * This is the Tier 2 alternative to getNativeCanonicalStoreInMemory().
 */
export function getWasmCanonicalStore(): WasmCanonicalStoreInstance | null {
  const wasm = getWasm();
  if (!wasm) return null;
  try {
    return new wasm.WasmCanonicalStore();
  } catch {
    return null;
  }
}

/**
 * Get the best available in-memory canonical store.
 * Returns a unified interface regardless of which tier is active.
 *
 * Tier 1: Native canonical store (SQLite-backed in-memory)
 * Tier 2: WASM canonical store (in-memory HashMap)
 * Tier 3: null (caller must handle)
 */
export function getBestCanonicalStore(): NativeCanonicalStore | WasmCanonicalStoreInstance | null {
  return getNativeCanonicalStoreInMemory() ?? getWasmCanonicalStore();
}

// ─── Compression ─────────────────────────────────────────────────────────────

export interface CompressionResult {
  compressed: string;
  originalSize: number;
  compressedSize: number;
}

/**
 * Compress a float32 vector using the best available backend.
 *
 * Tier 1: Native TurboQuant compressor (JsTurboCompressor)
 * Tier 2: WASM vector compression (compressVector)
 * Tier 3: null (no compression available)
 */
export function compressVector(
  vector: Float32Array,
  bits: number = 8,
): CompressionResult | null {
  // Tier 1: Native
  const native = getNative();
  if (native) {
    try {
      const compressor = new native.JsTurboCompressor(vector.length, bits);
      const compressed = compressor.compress(vector);
      return {
        compressed,
        originalSize: vector.length * 4,
        compressedSize: compressed.length,
      };
    } catch {
      // Fall through to Tier 2
    }
  }

  // Tier 2: WASM
  const wasm = getWasm();
  if (wasm) {
    try {
      const vectorJson = JSON.stringify(Array.from(vector));
      const compressed = wasm.compressVector(vectorJson, vector.length);
      return {
        compressed,
        originalSize: vector.length * 4,
        compressedSize: compressed.length,
      };
    } catch {
      // Fall through to Tier 3
    }
  }

  // Tier 3: null — caller handles missing compression
  return null;
}

/**
 * Decompress a previously compressed vector using the best available backend.
 *
 * Tier 1: Native TurboQuant decompressor
 * Tier 2: WASM vector decompressor
 * Tier 3: null (no decompression available)
 */
export function decompressVector(
  compressedJson: string,
  dimensions: number,
  bits: number = 8,
): Float32Array | null {
  // Tier 1: Native
  const native = getNative();
  if (native) {
    try {
      const compressor = new native.JsTurboCompressor(dimensions, bits);
      return compressor.decompress(compressedJson);
    } catch {
      // Fall through to Tier 2
    }
  }

  // Tier 2: WASM
  const wasm = getWasm();
  if (wasm) {
    try {
      const arrayJson = wasm.decompressVector(compressedJson, dimensions);
      const arr = JSON.parse(arrayJson) as number[];
      return new Float32Array(arr);
    } catch {
      // Fall through to Tier 3
    }
  }

  // Tier 3: null
  return null;
}

/**
 * Compute approximate distance between two compressed vectors.
 *
 * Tier 1: Not exposed on native JsTurboCompressor directly
 * Tier 2: WASM approximateDistance
 * Tier 3: null
 */
export function approximateDistance(
  aJson: string,
  bJson: string,
  dimensions: number,
): number | null {
  // Tier 2: WASM
  const wasm = getWasm();
  if (wasm) {
    try {
      return wasm.approximateDistance(aJson, bJson, dimensions);
    } catch {
      // Fall through
    }
  }
  return null;
}

// ─── Security / Write Firewall ────────────────────────────────────────────────

/**
 * Evaluate a write request through the security firewall.
 * Fail-open: returns allowed:true if no backend is available.
 *
 * Tier 1: Native JsWriteFirewall
 * Tier 2: WASM evaluateWriteFirewall (via index.ts unified helper)
 * Tier 3: Basic TypeScript checks (via index.ts unified helper)
 */
export function evaluateWriteSecurity(
  namespace: string,
  content: string,
  allowedNamespaces: string[],
  source: string = 'agent',
  trustLevel: string = 'agent',
): { allowed: boolean; reason?: string } {
  // Tier 1: Native
  const native = getNative();
  if (native) {
    try {
      const firewall = new native.JsWriteFirewall(
        JSON.stringify({ allowed_namespaces: allowedNamespaces }),
      );
      const result = JSON.parse(
        firewall.evaluate(JSON.stringify({ namespace, content, trust_level: trustLevel })),
      ) as { allowed: boolean; reason?: string };
      return result;
    } catch {
      // Fall through to Tier 2
    }
  }

  // Tier 2 + Tier 3: WASM or TypeScript fallback via unified helper in index.ts
  // wasmEvaluateWriteFirewall automatically routes to WASM if available, else TS
  try {
    const result = wasmEvaluateWriteFirewall({
      namespace,
      content,
      trust_level: trustLevel,
      source,
      allowed_namespaces: allowedNamespaces.length > 0 ? allowedNamespaces : undefined,
    });

    // Normalise: WASM returns {decision, reason, sanitized}, callers expect {allowed, reason}
    return {
      allowed: result.decision === 'allow' || result.decision === 'sanitize',
      reason: result.reason,
    };
  } catch {
    // Absolute fallback: fail-open
    return { allowed: true };
  }
}

/**
 * Compute SHA-256 hash of content using the best available backend.
 * Re-exported from native/index.ts for convenience — already 3-tier aware.
 */
export { computeSha256 };
