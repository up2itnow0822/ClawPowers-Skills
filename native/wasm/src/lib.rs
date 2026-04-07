//! WASM bindings for ClawPowers core.
//!
//! Exposes the following modules via `wasm-bindgen`:
//!
//! - **tokens** — Token registry, token amounts, decimal math
//! - **fee** — Fee schedule calculation
//! - **policy** — Spending policy engine
//! - **compression** — TurboQuant vector compression
//! - **index** — In-memory vector index
//! - **canonical** — Canonical record store (in-memory backend for WASM)
//! - **verification** — Record verification pipeline
//! - **security** — Write firewall and audit log
//!
//! **NOT included (falls back to TypeScript):**
//! - **wallet** — Uses `alloy-signer-local` which depends on native crypto
//!   primitives that are not fully WASM-compatible without significant patching.
//!   The TypeScript fallback uses `ethers.js` / `viem` for equivalent functionality.
//! - **x402** — Uses `reqwest` with `tokio` runtime; in WASM, HTTP is handled
//!   natively by `fetch()` in the TypeScript layer.

use wasm_bindgen::prelude::*;

// ═══════════════════════════════════════════════════════════════════════════════
// Tokens
// ═══════════════════════════════════════════════════════════════════════════════

/// Create a TokenAmount from a human-readable f64 value and decimal count.
/// Returns JSON: `{"raw": "...", "decimals": N}`
#[wasm_bindgen(js_name = "tokenAmountFromHuman")]
pub fn token_amount_from_human(human: f64, decimals: u8) -> Result<String, JsError> {
    let amount = clawpowers_tokens::TokenAmount::from_human(human, decimals);
    Ok(serde_json::to_string(&amount)?)
}

/// Convert a TokenAmount JSON back to a human-readable f64.
#[wasm_bindgen(js_name = "tokenAmountToHuman")]
pub fn token_amount_to_human(json: &str) -> Result<f64, JsError> {
    let amount: clawpowers_tokens::TokenAmount = serde_json::from_str(json)?;
    Ok(amount.to_human())
}

/// Add two TokenAmount JSONs. Returns the sum as JSON.
#[wasm_bindgen(js_name = "tokenAmountAdd")]
pub fn token_amount_add(a_json: &str, b_json: &str) -> Result<String, JsError> {
    let a: clawpowers_tokens::TokenAmount = serde_json::from_str(a_json)?;
    let b: clawpowers_tokens::TokenAmount = serde_json::from_str(b_json)?;
    let result = a.add(&b).map_err(|e| JsError::new(&e.to_string()))?;
    Ok(serde_json::to_string(&result)?)
}

/// Subtract two TokenAmount JSONs. Returns the difference as JSON.
#[wasm_bindgen(js_name = "tokenAmountSub")]
pub fn token_amount_sub(a_json: &str, b_json: &str) -> Result<String, JsError> {
    let a: clawpowers_tokens::TokenAmount = serde_json::from_str(a_json)?;
    let b: clawpowers_tokens::TokenAmount = serde_json::from_str(b_json)?;
    let result = a.sub(&b).map_err(|e| JsError::new(&e.to_string()))?;
    Ok(serde_json::to_string(&result)?)
}

/// Multiply a TokenAmount by basis points. Returns result as JSON.
#[wasm_bindgen(js_name = "tokenAmountMulBps")]
pub fn token_amount_mul_bps(json: &str, bps: u64) -> Result<String, JsError> {
    let amount: clawpowers_tokens::TokenAmount = serde_json::from_str(json)?;
    let result = amount
        .checked_mul_bps(bps)
        .ok_or_else(|| JsError::new("overflow in checked_mul_bps"))?;
    Ok(serde_json::to_string(&result)?)
}

/// Get the default token registry as JSON.
#[wasm_bindgen(js_name = "getDefaultTokenRegistry")]
pub fn get_default_token_registry() -> Result<String, JsError> {
    let registry = clawpowers_tokens::TokenRegistry::default();
    let tokens: Vec<_> = registry.iter().collect();
    Ok(serde_json::to_string(&tokens)?)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Fee
// ═══════════════════════════════════════════════════════════════════════════════

/// Calculate a transaction fee.
/// Returns JSON: `{"gross_amount": ..., "fee_amount": ..., "net_amount": ...}`
#[wasm_bindgen(js_name = "calculateFee")]
pub fn calculate_fee(
    amount_json: &str,
    fee_type: &str,
    tx_fee_bps: Option<u64>,
    swap_fee_bps: Option<u64>,
) -> Result<String, JsError> {
    let amount: clawpowers_tokens::TokenAmount = serde_json::from_str(amount_json)?;

    let fee_type = match fee_type {
        "transaction" => clawpowers_fee::FeeType::Transaction,
        "swap" => clawpowers_fee::FeeType::Swap,
        s if s.starts_with("custom:") => {
            let bps: u64 = s[7..]
                .parse()
                .map_err(|_| JsError::new("invalid custom bps"))?;
            clawpowers_fee::FeeType::Custom(bps)
        }
        _ => return Err(JsError::new("fee_type must be 'transaction', 'swap', or 'custom:N'")),
    };

    let schedule = clawpowers_fee::FeeSchedule::new(
        tx_fee_bps.unwrap_or(clawpowers_fee::DEFAULT_TX_FEE_BPS),
        swap_fee_bps.unwrap_or(clawpowers_fee::DEFAULT_SWAP_FEE_BPS),
        alloy_primitives::Address::ZERO,
    );

    let calc = schedule
        .calculate(amount, fee_type)
        .map_err(|e| JsError::new(&e.to_string()))?;

    let result = serde_json::json!({
        "gross_amount": calc.gross_amount.to_human(),
        "fee_amount": calc.fee_amount.to_human(),
        "net_amount": calc.net_amount.to_human(),
    });
    Ok(serde_json::to_string(&result)?)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Compression
// ═══════════════════════════════════════════════════════════════════════════════

/// Compress a float32 vector. Input: JSON array of f32. Output: CompressedVector JSON.
#[wasm_bindgen(js_name = "compressVector")]
pub fn compress_vector(vector_json: &str, dimensions: usize) -> Result<String, JsError> {
    let vector: Vec<f32> = serde_json::from_str(vector_json)?;
    let config = clawpowers_compression::CompressionConfig {
        dimensions,
        quantization_bits: 8,
        rotation_seed: 0xDEAD_BEEF_CAFE_1234,
    };
    let compressor = clawpowers_compression::TurboCompressor::new(config);
    let compressed = compressor
        .compress(&vector)
        .map_err(|e| JsError::new(&e.to_string()))?;
    Ok(serde_json::to_string(&compressed)?)
}

/// Decompress a CompressedVector JSON back to a float32 array JSON.
#[wasm_bindgen(js_name = "decompressVector")]
pub fn decompress_vector(compressed_json: &str, dimensions: usize) -> Result<String, JsError> {
    let compressed: clawpowers_compression::CompressedVector =
        serde_json::from_str(compressed_json)?;
    let config = clawpowers_compression::CompressionConfig {
        dimensions,
        quantization_bits: 8,
        rotation_seed: 0xDEAD_BEEF_CAFE_1234,
    };
    let compressor = clawpowers_compression::TurboCompressor::new(config);
    let vector = compressor
        .decompress(&compressed)
        .map_err(|e| JsError::new(&e.to_string()))?;
    Ok(serde_json::to_string(&vector)?)
}

/// Compute approximate distance between two CompressedVector JSONs.
#[wasm_bindgen(js_name = "approximateDistance")]
pub fn approximate_distance(
    a_json: &str,
    b_json: &str,
    dimensions: usize,
) -> Result<f32, JsError> {
    let a: clawpowers_compression::CompressedVector = serde_json::from_str(a_json)?;
    let b: clawpowers_compression::CompressedVector = serde_json::from_str(b_json)?;
    let config = clawpowers_compression::CompressionConfig {
        dimensions,
        quantization_bits: 8,
        rotation_seed: 0xDEAD_BEEF_CAFE_1234,
    };
    let compressor = clawpowers_compression::TurboCompressor::new(config);
    let dist = compressor
        .approximate_distance(&a, &b)
        .map_err(|e| JsError::new(&e.to_string()))?;
    Ok(dist)
}

/// Compute SHA-256 hash of content string.
#[wasm_bindgen(js_name = "computeSha256")]
pub fn compute_sha256(content: &str) -> String {
    clawpowers_canonical::compute_sha256(content)
}

/// Compute Keccak-256 hash of raw bytes (EVM-compatible). Returns `0x` + 64 hex chars.
#[wasm_bindgen(js_name = "computeKeccak256")]
pub fn compute_keccak256(bytes: &[u8]) -> String {
    let h = alloy_primitives::keccak256(bytes);
    format!("0x{:x}", h)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Canonical Store
// ═══════════════════════════════════════════════════════════════════════════════

/// Opaque handle to an in-memory CanonicalStore.
#[wasm_bindgen]
pub struct WasmCanonicalStore {
    inner: clawpowers_canonical::CanonicalStore,
}

#[wasm_bindgen]
impl WasmCanonicalStore {
    /// Create a new in-memory canonical store.
    #[wasm_bindgen(constructor)]
    pub fn new() -> Result<WasmCanonicalStore, JsError> {
        let store = clawpowers_canonical::CanonicalStore::in_memory()
            .map_err(|e| JsError::new(&e.to_string()))?;
        Ok(Self { inner: store })
    }

    /// Insert a record. Input: JSON with {namespace, content, metadata, provenance}.
    /// Returns the record UUID as a string.
    pub fn insert(&self, json: &str) -> Result<String, JsError> {
        #[derive(serde::Deserialize)]
        struct InsertInput {
            namespace: String,
            content: String,
            #[serde(default)]
            metadata: serde_json::Value,
            #[serde(default = "default_provenance")]
            provenance: String,
        }
        fn default_provenance() -> String {
            "wasm".to_string()
        }

        let input: InsertInput = serde_json::from_str(json)?;
        let record = clawpowers_canonical::CanonicalRecord::new(
            input.namespace,
            input.content,
            None,
            input.metadata,
            input.provenance,
        );
        let id = self
            .inner
            .insert(&record)
            .map_err(|e| JsError::new(&e.to_string()))?;
        Ok(id.to_string())
    }

    /// Get a record by UUID. Returns JSON or null.
    pub fn get(&self, id: &str) -> Result<Option<String>, JsError> {
        let uuid = uuid::Uuid::parse_str(id).map_err(|e| JsError::new(&e.to_string()))?;
        let record = self
            .inner
            .get(&uuid)
            .map_err(|e| JsError::new(&e.to_string()))?;
        match record {
            Some(r) => Ok(Some(serde_json::to_string(&r)?)),
            None => Ok(None),
        }
    }

    /// Get a record by content hash. Returns JSON or null.
    #[wasm_bindgen(js_name = "getByHash")]
    pub fn get_by_hash(&self, hash: &str) -> Result<Option<String>, JsError> {
        let record = self
            .inner
            .get_by_hash(hash)
            .map_err(|e| JsError::new(&e.to_string()))?;
        match record {
            Some(r) => Ok(Some(serde_json::to_string(&r)?)),
            None => Ok(None),
        }
    }

    /// Query records by namespace. Returns JSON array.
    #[wasm_bindgen(js_name = "queryNamespace")]
    pub fn query_namespace(&self, namespace: &str, limit: usize) -> Result<String, JsError> {
        let records = self
            .inner
            .query_namespace(namespace, limit)
            .map_err(|e| JsError::new(&e.to_string()))?;
        Ok(serde_json::to_string(&records)?)
    }

    /// Soft-delete a record. Returns true if the record existed.
    #[wasm_bindgen(js_name = "softDelete")]
    pub fn soft_delete(&self, id: &str) -> Result<bool, JsError> {
        let uuid = uuid::Uuid::parse_str(id).map_err(|e| JsError::new(&e.to_string()))?;
        self.inner
            .soft_delete(&uuid)
            .map_err(|e| JsError::new(&e.to_string()))
    }

    /// Verify record integrity. Returns true if hash matches.
    #[wasm_bindgen(js_name = "verifyIntegrity")]
    pub fn verify_integrity(&self, id: &str) -> Result<bool, JsError> {
        let uuid = uuid::Uuid::parse_str(id).map_err(|e| JsError::new(&e.to_string()))?;
        self.inner
            .verify_integrity(&uuid)
            .map_err(|e| JsError::new(&e.to_string()))
    }

    /// Export all records as JSON for IndexedDB persistence.
    #[wasm_bindgen(js_name = "exportJson")]
    pub fn export_json(&self) -> Result<String, JsError> {
        self.inner
            .export_json()
            .map_err(|e| JsError::new(&e.to_string()))
    }

    /// Import records from JSON (e.g., loaded from IndexedDB).
    #[wasm_bindgen(js_name = "importJson")]
    pub fn import_json(&self, json: &str) -> Result<usize, JsError> {
        self.inner
            .import_json(json)
            .map_err(|e| JsError::new(&e.to_string()))
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Security — Write Firewall
// ═══════════════════════════════════════════════════════════════════════════════

/// Evaluate a write request against a firewall.
/// Input JSON: {namespace, content, trust_level, source, allowed_namespaces?, blocked_patterns?, max_content_length?}
/// Returns JSON: {"decision": "allow"|"deny"|"sanitize", "reason"?: ..., "sanitized"?: ...}
#[wasm_bindgen(js_name = "evaluateWriteFirewall")]
pub fn evaluate_write_firewall(json: &str) -> Result<String, JsError> {
    #[derive(serde::Deserialize)]
    struct Input {
        namespace: String,
        content: String,
        trust_level: String,
        source: String,
        #[serde(default)]
        allowed_namespaces: Vec<String>,
        #[serde(default)]
        blocked_patterns: Vec<String>,
        max_content_length: Option<usize>,
    }

    let input: Input = serde_json::from_str(json)?;

    let trust = match input.trust_level.as_str() {
        "system" => clawpowers_security::TrustLevel::System,
        "agent" => clawpowers_security::TrustLevel::Agent,
        "external" => clawpowers_security::TrustLevel::External,
        _ => clawpowers_security::TrustLevel::Untrusted,
    };

    let mut firewall = clawpowers_security::WriteFirewall::new(input.allowed_namespaces);
    firewall.blocked_patterns = input.blocked_patterns;
    if let Some(max) = input.max_content_length {
        firewall.max_content_length = max;
    }

    let request = clawpowers_security::WriteRequest {
        namespace: input.namespace,
        content: input.content,
        trust_level: trust,
        source: input.source,
    };

    let decision = firewall.evaluate(&request);
    let result = match decision {
        clawpowers_security::FirewallDecision::Allow => {
            serde_json::json!({"decision": "allow"})
        }
        clawpowers_security::FirewallDecision::Deny(reason) => {
            serde_json::json!({"decision": "deny", "reason": reason})
        }
        clawpowers_security::FirewallDecision::Sanitize(original, sanitized) => {
            serde_json::json!({"decision": "sanitize", "original": original, "sanitized": sanitized})
        }
    };
    Ok(serde_json::to_string(&result)?)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Version info
// ═══════════════════════════════════════════════════════════════════════════════

/// Returns the version and build info.
#[wasm_bindgen(js_name = "getVersion")]
pub fn get_version() -> String {
    format!(
        "clawpowers-wasm v{} ({})",
        env!("CARGO_PKG_VERSION"),
        if cfg!(debug_assertions) {
            "debug"
        } else {
            "release"
        }
    )
}

/// Returns a list of modules available in this WASM build.
#[wasm_bindgen(js_name = "getAvailableModules")]
pub fn get_available_modules() -> String {
    serde_json::to_string(&vec![
        "tokens",
        "fee",
        "compression",
        "canonical",
        "verification",
        "security",
        "index",
    ])
    .unwrap_or_default()
}
