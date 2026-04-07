/* tslint:disable */
/* eslint-disable */

/**
 * Opaque handle to an in-memory CanonicalStore.
 */
export class WasmCanonicalStore {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Export all records as JSON for IndexedDB persistence.
     */
    exportJson(): string;
    /**
     * Get a record by UUID. Returns JSON or null.
     */
    get(id: string): string | undefined;
    /**
     * Get a record by content hash. Returns JSON or null.
     */
    getByHash(hash: string): string | undefined;
    /**
     * Import records from JSON (e.g., loaded from IndexedDB).
     */
    importJson(json: string): number;
    /**
     * Insert a record. Input: JSON with {namespace, content, metadata, provenance}.
     * Returns the record UUID as a string.
     */
    insert(json: string): string;
    /**
     * Create a new in-memory canonical store.
     */
    constructor();
    /**
     * Query records by namespace. Returns JSON array.
     */
    queryNamespace(namespace: string, limit: number): string;
    /**
     * Soft-delete a record. Returns true if the record existed.
     */
    softDelete(id: string): boolean;
    /**
     * Verify record integrity. Returns true if hash matches.
     */
    verifyIntegrity(id: string): boolean;
}

/**
 * Compute approximate distance between two CompressedVector JSONs.
 */
export function approximateDistance(a_json: string, b_json: string, dimensions: number): number;

/**
 * Calculate a transaction fee.
 * Returns JSON: `{"gross_amount": ..., "fee_amount": ..., "net_amount": ...}`
 */
export function calculateFee(amount_json: string, fee_type: string, tx_fee_bps?: bigint | null, swap_fee_bps?: bigint | null): string;

/**
 * Compress a float32 vector. Input: JSON array of f32. Output: CompressedVector JSON.
 */
export function compressVector(vector_json: string, dimensions: number): string;

/**
 * Compute Keccak-256 hash of raw bytes (EVM-compatible). Returns `0x` + 64 hex chars.
 */
export function computeKeccak256(bytes: Uint8Array): string;

/**
 * Compute SHA-256 hash of content string.
 */
export function computeSha256(content: string): string;

/**
 * Decompress a CompressedVector JSON back to a float32 array JSON.
 */
export function decompressVector(compressed_json: string, dimensions: number): string;

/**
 * Ethereum address from 32-byte secp256k1 private key (`0x` + 20 bytes, EIP-55 checksum).
 */
export function deriveEthereumAddress(private_key: Uint8Array): string;

/**
 * Uncompressed public key: 64 bytes (x || y), no `0x04` prefix.
 */
export function derivePublicKey(private_key: Uint8Array): Uint8Array;

/**
 * Evaluate a write request against a firewall.
 * Input JSON: {namespace, content, trust_level, source, allowed_namespaces?, blocked_patterns?, max_content_length?}
 * Returns JSON: {"decision": "allow"|"deny"|"sanitize", "reason"?: ..., "sanitized"?: ...}
 */
export function evaluateWriteFirewall(json: string): string;

/**
 * Returns a list of modules available in this WASM build.
 */
export function getAvailableModules(): string;

/**
 * Get the default token registry as JSON.
 */
export function getDefaultTokenRegistry(): string;

/**
 * Returns the version and build info.
 */
export function getVersion(): string;

/**
 * ECDSA sign 32-byte message hash → 65 bytes (r || s || recovery_id).
 */
export function signEcdsa(private_key: Uint8Array, message_hash: Uint8Array): Uint8Array;

/**
 * Add two TokenAmount JSONs. Returns the sum as JSON.
 */
export function tokenAmountAdd(a_json: string, b_json: string): string;

/**
 * Create a TokenAmount from a human-readable f64 value and decimal count.
 * Returns JSON: `{"raw": "...", "decimals": N}`
 */
export function tokenAmountFromHuman(human: number, decimals: number): string;

/**
 * Multiply a TokenAmount by basis points. Returns result as JSON.
 */
export function tokenAmountMulBps(json: string, bps: bigint): string;

/**
 * Subtract two TokenAmount JSONs. Returns the difference as JSON.
 */
export function tokenAmountSub(a_json: string, b_json: string): string;

/**
 * Convert a TokenAmount JSON back to a human-readable f64.
 */
export function tokenAmountToHuman(json: string): number;

export function verifyEcdsa(public_key: Uint8Array, message_hash: Uint8Array, signature: Uint8Array): boolean;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_wasmcanonicalstore_free: (a: number, b: number) => void;
    readonly approximateDistance: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly calculateFee: (a: number, b: number, c: number, d: number, e: number, f: bigint, g: number, h: bigint) => [number, number, number, number];
    readonly compressVector: (a: number, b: number, c: number) => [number, number, number, number];
    readonly computeKeccak256: (a: number, b: number) => [number, number];
    readonly computeSha256: (a: number, b: number) => [number, number];
    readonly decompressVector: (a: number, b: number, c: number) => [number, number, number, number];
    readonly deriveEthereumAddress: (a: number, b: number) => [number, number, number, number];
    readonly derivePublicKey: (a: number, b: number) => [number, number, number, number];
    readonly evaluateWriteFirewall: (a: number, b: number) => [number, number, number, number];
    readonly getAvailableModules: () => [number, number];
    readonly getDefaultTokenRegistry: () => [number, number, number, number];
    readonly getVersion: () => [number, number];
    readonly signEcdsa: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly tokenAmountAdd: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly tokenAmountFromHuman: (a: number, b: number) => [number, number, number, number];
    readonly tokenAmountMulBps: (a: number, b: number, c: bigint) => [number, number, number, number];
    readonly tokenAmountSub: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly tokenAmountToHuman: (a: number, b: number) => [number, number, number];
    readonly verifyEcdsa: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly wasmcanonicalstore_exportJson: (a: number) => [number, number, number, number];
    readonly wasmcanonicalstore_get: (a: number, b: number, c: number) => [number, number, number, number];
    readonly wasmcanonicalstore_getByHash: (a: number, b: number, c: number) => [number, number, number, number];
    readonly wasmcanonicalstore_importJson: (a: number, b: number, c: number) => [number, number, number];
    readonly wasmcanonicalstore_insert: (a: number, b: number, c: number) => [number, number, number, number];
    readonly wasmcanonicalstore_new: () => [number, number, number];
    readonly wasmcanonicalstore_queryNamespace: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly wasmcanonicalstore_softDelete: (a: number, b: number, c: number) => [number, number, number];
    readonly wasmcanonicalstore_verifyIntegrity: (a: number, b: number, c: number) => [number, number, number];
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
