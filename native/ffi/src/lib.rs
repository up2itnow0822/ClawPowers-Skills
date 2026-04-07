//! clawpowers-ffi — napi-rs Node.js bindings for clawpowers-core.

#![allow(clippy::new_without_default)]

use napi::bindgen_prelude::*;
use napi_derive::napi;

fn to_napi_err<E: std::fmt::Display>(e: E) -> napi::Error {
    napi::Error::from_reason(e.to_string())
}

/// Keccak-256 digest of raw bytes. Returns `0x` + 64 hex chars (for wallet / EVM helpers).
#[napi(js_name = "keccak256Bytes")]
pub fn keccak256_bytes(data: Buffer) -> String {
    let h = alloy_primitives::keccak256(data.as_ref());
    format!("0x{:x}", h)
}

// ═══════════════════════════════════════════════════════════════════════════════
// WALLET
// ═══════════════════════════════════════════════════════════════════════════════

/// EVM agent wallet — key management and message signing.
#[napi]
pub struct JsAgentWallet {
    inner: clawpowers_wallet::AgentWallet,
}

#[napi]
impl JsAgentWallet {
    /// Generate a fresh random wallet.
    #[napi(factory)]
    pub fn generate() -> Self {
        Self {
            inner: clawpowers_wallet::AgentWallet::generate(),
        }
    }

    /// Import a wallet from a hex private key string.
    #[napi(factory)]
    pub fn from_private_key(hex: String) -> napi::Result<Self> {
        let inner = clawpowers_wallet::AgentWallet::from_private_key(&hex).map_err(to_napi_err)?;
        Ok(Self { inner })
    }

    /// Return the checksummed EVM address.
    #[napi]
    pub fn address(&self) -> String {
        format!("{:#x}", self.inner.address())
    }

    /// Sign a raw byte buffer. Returns the signature as debug string.
    #[napi]
    pub fn sign_message(&self, msg: Buffer) -> napi::Result<String> {
        let sig = self.inner.sign_message(msg.as_ref()).map_err(to_napi_err)?;
        Ok(format!("{sig:?}"))
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOKENS
// ═══════════════════════════════════════════════════════════════════════════════

/// Fixed-point token amounts with decimal precision.
#[napi]
pub struct JsTokenAmount {
    inner: clawpowers_tokens::TokenAmount,
}

#[napi]
impl JsTokenAmount {
    /// Create a token amount from a human-readable f64 value.
    #[napi(factory)]
    pub fn from_human(amount: f64, decimals: u32) -> Self {
        Self {
            inner: clawpowers_tokens::TokenAmount::from_human(amount, decimals as u8),
        }
    }

    /// Convert to a human-readable f64.
    #[napi]
    pub fn to_human(&self) -> f64 {
        self.inner.to_human()
    }

    /// Serialize to JSON.
    #[napi]
    pub fn to_json(&self) -> napi::Result<String> {
        serde_json::to_string(&self.inner).map_err(to_napi_err)
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FEE
// ═══════════════════════════════════════════════════════════════════════════════

/// Fee schedule calculation.
#[napi]
pub struct JsFeeSchedule {
    inner: clawpowers_fee::FeeSchedule,
}

#[napi]
impl JsFeeSchedule {
    /// Create a fee schedule with default rates (77 bps tx, 30 bps swap).
    #[napi(factory)]
    pub fn with_defaults() -> Self {
        Self {
            inner: clawpowers_fee::FeeSchedule::default(),
        }
    }

    /// Create a fee schedule with custom rates and recipient address.
    #[napi(constructor)]
    pub fn new(tx_bps: i64, swap_bps: i64, recipient_hex: String) -> napi::Result<Self> {
        let recipient: alloy_primitives::Address = recipient_hex.parse().map_err(to_napi_err)?;
        Ok(Self {
            inner: clawpowers_fee::FeeSchedule::new(tx_bps as u64, swap_bps as u64, recipient),
        })
    }

    /// Calculate fee. fee_type: "transaction", "swap", or "custom:<bps>".
    #[napi]
    pub fn calculate(&self, amount: f64, decimals: u32, fee_type: String) -> napi::Result<String> {
        let amt = clawpowers_tokens::TokenAmount::from_human(amount, decimals as u8);
        let ft = match fee_type.as_str() {
            "transaction" => clawpowers_fee::FeeType::Transaction,
            "swap" => clawpowers_fee::FeeType::Swap,
            s if s.starts_with("custom:") => {
                let bps: u64 = s[7..].parse().map_err(to_napi_err)?;
                clawpowers_fee::FeeType::Custom(bps)
            }
            _ => {
                return Err(napi::Error::from_reason(format!(
                    "unknown fee type: {fee_type}"
                )));
            }
        };
        let calc = self.inner.calculate(amt, ft).map_err(to_napi_err)?;
        let result = serde_json::json!({
            "gross": calc.gross_amount.to_human(),
            "fee": calc.fee_amount.to_human(),
            "net": calc.net_amount.to_human(),
            "fee_recipient": format!("{:#x}", calc.fee_recipient),
        });
        Ok(result.to_string())
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// X402
// ═══════════════════════════════════════════════════════════════════════════════

/// HTTP 402 Payment Required protocol client.
#[napi]
pub struct JsX402Client {
    #[allow(dead_code)]
    inner: clawpowers_x402::X402Client,
}

#[napi]
impl JsX402Client {
    /// Create a new x402 client.
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            inner: clawpowers_x402::X402Client::new(),
        }
    }

    /// Build an X-Payment header value from payment JSON and signature.
    #[napi]
    pub fn create_payment_header(
        &self,
        payment_json: String,
        signature: String,
    ) -> napi::Result<String> {
        let payment: clawpowers_x402::X402PaymentRequired =
            serde_json::from_str(&payment_json).map_err(to_napi_err)?;
        Ok(clawpowers_x402::X402Client::create_payment_header(
            &payment, &signature,
        ))
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CANONICAL STORE
// ═══════════════════════════════════════════════════════════════════════════════

/// Append-only canonical record store backed by SQLite.
#[napi]
pub struct JsCanonicalStore {
    inner: clawpowers_canonical::CanonicalStore,
}

#[napi]
impl JsCanonicalStore {
    /// Open or create a persistent store at path.
    #[napi(factory)]
    pub fn open(path: String) -> napi::Result<Self> {
        let inner = clawpowers_canonical::CanonicalStore::new(&path).map_err(to_napi_err)?;
        Ok(Self { inner })
    }

    /// Create an in-memory store (non-persistent).
    #[napi(factory)]
    pub fn in_memory() -> napi::Result<Self> {
        let inner = clawpowers_canonical::CanonicalStore::in_memory().map_err(to_napi_err)?;
        Ok(Self { inner })
    }

    /// Insert a record (JSON). Returns assigned UUID.
    #[napi]
    pub fn insert(&self, record_json: String) -> napi::Result<String> {
        let record: clawpowers_canonical::CanonicalRecord =
            serde_json::from_str(&record_json).map_err(to_napi_err)?;
        let id = self.inner.insert(&record).map_err(to_napi_err)?;
        Ok(id.to_string())
    }

    /// Get a record by UUID. Returns JSON or null.
    #[napi]
    pub fn get(&self, id: String) -> napi::Result<Option<String>> {
        let uuid: uuid::Uuid = id.parse().map_err(to_napi_err)?;
        let record = self.inner.get(&uuid).map_err(to_napi_err)?;
        match record {
            Some(r) => Ok(Some(serde_json::to_string(&r).map_err(to_napi_err)?)),
            None => Ok(None),
        }
    }

    /// Verify record integrity by re-hashing.
    #[napi]
    pub fn verify_integrity(&self, id: String) -> napi::Result<bool> {
        let uuid: uuid::Uuid = id.parse().map_err(to_napi_err)?;
        self.inner.verify_integrity(&uuid).map_err(to_napi_err)
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TURBO COMPRESSOR
// ═══════════════════════════════════════════════════════════════════════════════

/// TurboQuant vector compressor for embeddings.
#[napi]
pub struct JsTurboCompressor {
    inner: clawpowers_compression::TurboCompressor,
}

#[napi]
impl JsTurboCompressor {
    /// Create a new compressor for the given dimensions and quantization bits.
    #[napi(constructor)]
    pub fn new(dimensions: u32, bits: u32) -> Self {
        Self {
            inner: clawpowers_compression::TurboCompressor::new(
                clawpowers_compression::CompressionConfig {
                    dimensions: dimensions as usize,
                    quantization_bits: bits as u8,
                    rotation_seed: 0xDEAD_BEEF_CAFE_1234,
                },
            ),
        }
    }

    /// Compress a Float32Array. Returns JSON.
    #[napi]
    pub fn compress(&self, vector: Float32Array) -> napi::Result<String> {
        let compressed = self.inner.compress(vector.as_ref()).map_err(to_napi_err)?;
        serde_json::to_string(&compressed).map_err(to_napi_err)
    }

    /// Decompress a JSON compressed vector back to Float32Array.
    #[napi]
    pub fn decompress(&self, compressed_json: String) -> napi::Result<Float32Array> {
        let compressed: clawpowers_compression::CompressedVector =
            serde_json::from_str(&compressed_json).map_err(to_napi_err)?;
        let values = self.inner.decompress(&compressed).map_err(to_napi_err)?;
        Ok(Float32Array::new(values))
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// WRITE FIREWALL
// ═══════════════════════════════════════════════════════════════════════════════

/// Write access control firewall.
#[napi]
pub struct JsWriteFirewall {
    inner: clawpowers_security::WriteFirewall,
}

#[napi]
impl JsWriteFirewall {
    /// Create a firewall from a JSON config.
    #[napi(constructor)]
    pub fn new(config_json: String) -> napi::Result<Self> {
        let config: FirewallConfig = serde_json::from_str(&config_json).map_err(to_napi_err)?;
        Ok(Self {
            inner: clawpowers_security::WriteFirewall::new(config.allowed_namespaces),
        })
    }

    /// Evaluate a write request (JSON). Returns JSON decision.
    #[napi]
    pub fn evaluate(&self, request_json: String) -> napi::Result<String> {
        let req: clawpowers_security::WriteRequest =
            serde_json::from_str(&request_json).map_err(to_napi_err)?;
        let decision = self.inner.evaluate(&req);
        serde_json::to_string(&decision).map_err(to_napi_err)
    }
}

#[derive(serde::Deserialize)]
struct FirewallConfig {
    allowed_namespaces: Vec<String>,
}
