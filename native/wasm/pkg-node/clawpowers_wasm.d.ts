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
