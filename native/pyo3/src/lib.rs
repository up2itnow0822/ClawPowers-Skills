//! clawpowers-pyo3 — Python bindings for clawpowers-core.

use pyo3::prelude::*;
use pyo3::exceptions::PyValueError;

// ═══════════════════════════════════════════════════════════════════════════════
// WALLET
// ═══════════════════════════════════════════════════════════════════════════════

/// EVM agent wallet — key management and message signing.
#[pyclass]
pub struct AgentWallet {
    inner: clawpowers_wallet::AgentWallet,
}

#[pymethods]
impl AgentWallet {
    /// Generate a fresh random wallet.
    #[staticmethod]
    fn generate() -> Self {
        Self {
            inner: clawpowers_wallet::AgentWallet::generate(),
        }
    }

    /// Import a wallet from a hex private key string.
    #[staticmethod]
    fn from_private_key(hex: &str) -> PyResult<Self> {
        let inner = clawpowers_wallet::AgentWallet::from_private_key(hex)
            .map_err(|e| PyValueError::new_err(e.to_string()))?;
        Ok(Self { inner })
    }

    /// Return the checksummed EVM address.
    fn address(&self) -> String {
        format!("{:#x}", self.inner.address())
    }

    /// Return the wallet UUID.
    fn wallet_id(&self) -> String {
        self.inner.wallet_id.to_string()
    }

    /// Sign a raw byte buffer. Returns the signature as a string.
    fn sign_message(&self, msg: &[u8]) -> PyResult<String> {
        let sig = self.inner.sign_message(msg)
            .map_err(|e| PyValueError::new_err(e.to_string()))?;
        Ok(format!("{sig:?}"))
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOKENS
// ═══════════════════════════════════════════════════════════════════════════════

/// Fixed-point token amounts with decimal precision.
#[pyclass]
pub struct TokenAmount {
    inner: clawpowers_tokens::TokenAmount,
}

#[pymethods]
impl TokenAmount {
    /// Create a token amount from a human-readable float value.
    #[staticmethod]
    fn from_human(amount: f64, decimals: u8) -> Self {
        Self {
            inner: clawpowers_tokens::TokenAmount::from_human(amount, decimals),
        }
    }

    /// Convert to a human-readable float.
    fn to_human(&self) -> f64 {
        self.inner.to_human()
    }

    /// Return true if the amount is zero.
    fn is_zero(&self) -> bool {
        self.inner.is_zero()
    }

    /// Serialize to JSON.
    fn to_json(&self) -> PyResult<String> {
        serde_json::to_string(&self.inner)
            .map_err(|e| PyValueError::new_err(e.to_string()))
    }

    fn __repr__(&self) -> String {
        format!("TokenAmount({})", self.inner.to_human())
    }
}

/// Get the default token registry as JSON.
#[pyfunction]
fn default_token_registry() -> PyResult<String> {
    let reg = clawpowers_tokens::TokenRegistry::default();
    let tokens: Vec<serde_json::Value> = reg.iter().map(|t| {
        serde_json::json!({
            "symbol": t.symbol,
            "decimals": t.decimals,
            "chain_id": t.chain_id,
        })
    }).collect();
    serde_json::to_string(&tokens)
        .map_err(|e| PyValueError::new_err(e.to_string()))
}

// ═══════════════════════════════════════════════════════════════════════════════
// FEE
// ═══════════════════════════════════════════════════════════════════════════════

/// Fee schedule calculation.
#[pyclass]
pub struct FeeSchedule {
    inner: clawpowers_fee::FeeSchedule,
}

#[pymethods]
impl FeeSchedule {
    /// Create a fee schedule with default rates (77 bps tx, 30 bps swap).
    #[staticmethod]
    fn with_defaults() -> Self {
        Self {
            inner: clawpowers_fee::FeeSchedule::default(),
        }
    }

    /// Create a fee schedule with custom rates and recipient address.
    #[new]
    fn new(tx_bps: u64, swap_bps: u64, recipient_hex: &str) -> PyResult<Self> {
        let recipient: alloy_primitives::Address = recipient_hex.parse()
            .map_err(|e: alloy_primitives::hex::FromHexError| PyValueError::new_err(e.to_string()))?;
        Ok(Self {
            inner: clawpowers_fee::FeeSchedule::new(tx_bps, swap_bps, recipient),
        })
    }

    /// Calculate fee. fee_type: "transaction", "swap", or "custom:<bps>".
    fn calculate(&self, amount: f64, decimals: u8, fee_type: &str) -> PyResult<String> {
        let amt = clawpowers_tokens::TokenAmount::from_human(amount, decimals);
        let ft = match fee_type {
            "transaction" => clawpowers_fee::FeeType::Transaction,
            "swap" => clawpowers_fee::FeeType::Swap,
            s if s.starts_with("custom:") => {
                let bps: u64 = s[7..].parse()
                    .map_err(|e: std::num::ParseIntError| PyValueError::new_err(e.to_string()))?;
                clawpowers_fee::FeeType::Custom(bps)
            }
            _ => return Err(PyValueError::new_err(format!("unknown fee type: {fee_type}"))),
        };
        let calc = self.inner.calculate(amt, ft)
            .map_err(|e| PyValueError::new_err(e.to_string()))?;
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
#[pyclass]
pub struct X402Client {
    #[allow(dead_code)]
    inner: clawpowers_x402::X402Client,
}

#[pymethods]
impl X402Client {
    /// Create a new x402 client.
    #[new]
    fn new() -> Self {
        Self {
            inner: clawpowers_x402::X402Client::new(),
        }
    }

    /// Build an X-Payment header value from payment JSON and signature.
    fn create_payment_header(&self, payment_json: &str, signature: &str) -> PyResult<String> {
        let payment: clawpowers_x402::X402PaymentRequired =
            serde_json::from_str(payment_json)
                .map_err(|e| PyValueError::new_err(e.to_string()))?;
        Ok(clawpowers_x402::X402Client::create_payment_header(&payment, signature))
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CANONICAL STORE
// ═══════════════════════════════════════════════════════════════════════════════

/// Append-only canonical record store backed by SQLite.
#[pyclass(unsendable)]
pub struct CanonicalStore {
    inner: clawpowers_canonical::CanonicalStore,
}

#[pymethods]
impl CanonicalStore {
    /// Open or create a persistent store at path.
    #[staticmethod]
    fn open(path: &str) -> PyResult<Self> {
        let inner = clawpowers_canonical::CanonicalStore::new(path)
            .map_err(|e| PyValueError::new_err(e.to_string()))?;
        Ok(Self { inner })
    }

    /// Create an in-memory store (non-persistent).
    #[staticmethod]
    fn in_memory() -> PyResult<Self> {
        let inner = clawpowers_canonical::CanonicalStore::in_memory()
            .map_err(|e| PyValueError::new_err(e.to_string()))?;
        Ok(Self { inner })
    }

    /// Insert a record (JSON). Returns assigned UUID.
    fn insert(&self, record_json: &str) -> PyResult<String> {
        let record: clawpowers_canonical::CanonicalRecord =
            serde_json::from_str(record_json)
                .map_err(|e| PyValueError::new_err(e.to_string()))?;
        let id = self.inner.insert(&record)
            .map_err(|e| PyValueError::new_err(e.to_string()))?;
        Ok(id.to_string())
    }

    /// Get a record by UUID. Returns JSON or None.
    fn get(&self, id: &str) -> PyResult<Option<String>> {
        let uuid: uuid::Uuid = id.parse()
            .map_err(|e: uuid::Error| PyValueError::new_err(e.to_string()))?;
        let record = self.inner.get(&uuid)
            .map_err(|e| PyValueError::new_err(e.to_string()))?;
        match record {
            Some(r) => Ok(Some(serde_json::to_string(&r)
                .map_err(|e| PyValueError::new_err(e.to_string()))?)),
            None => Ok(None),
        }
    }

    /// Verify record integrity by re-hashing.
    fn verify_integrity(&self, id: &str) -> PyResult<bool> {
        let uuid: uuid::Uuid = id.parse()
            .map_err(|e: uuid::Error| PyValueError::new_err(e.to_string()))?;
        self.inner.verify_integrity(&uuid)
            .map_err(|e| PyValueError::new_err(e.to_string()))
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TURBO COMPRESSOR
// ═══════════════════════════════════════════════════════════════════════════════

/// TurboQuant vector compressor for embeddings.
#[pyclass]
pub struct TurboCompressor {
    inner: clawpowers_compression::TurboCompressor,
}

#[pymethods]
impl TurboCompressor {
    /// Create a new compressor for the given dimensions and quantization bits.
    #[new]
    fn new(dimensions: usize, bits: u8) -> Self {
        Self {
            inner: clawpowers_compression::TurboCompressor::new(
                clawpowers_compression::CompressionConfig {
                    dimensions,
                    quantization_bits: bits,
                    rotation_seed: 0xDEAD_BEEF_CAFE_1234,
                },
            ),
        }
    }

    /// Compress a list of f32 values. Returns JSON.
    fn compress(&self, vector: Vec<f32>) -> PyResult<String> {
        let compressed = self.inner.compress(&vector)
            .map_err(|e| PyValueError::new_err(e.to_string()))?;
        serde_json::to_string(&compressed)
            .map_err(|e| PyValueError::new_err(e.to_string()))
    }

    /// Decompress a JSON compressed vector back to a list of f32.
    fn decompress(&self, compressed_json: &str) -> PyResult<Vec<f32>> {
        let compressed: clawpowers_compression::CompressedVector =
            serde_json::from_str(compressed_json)
                .map_err(|e| PyValueError::new_err(e.to_string()))?;
        self.inner.decompress(&compressed)
            .map_err(|e| PyValueError::new_err(e.to_string()))
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// WRITE FIREWALL
// ═══════════════════════════════════════════════════════════════════════════════

/// Write access control firewall.
#[pyclass]
pub struct WriteFirewall {
    inner: clawpowers_security::WriteFirewall,
}

#[pymethods]
impl WriteFirewall {
    /// Create a firewall from a JSON config with "allowed_namespaces" array.
    #[new]
    fn new(config_json: &str) -> PyResult<Self> {
        #[derive(serde::Deserialize)]
        struct FirewallConfig {
            allowed_namespaces: Vec<String>,
        }
        let config: FirewallConfig = serde_json::from_str(config_json)
            .map_err(|e| PyValueError::new_err(e.to_string()))?;
        Ok(Self {
            inner: clawpowers_security::WriteFirewall::new(config.allowed_namespaces),
        })
    }

    /// Evaluate a write request (JSON). Returns JSON decision.
    fn evaluate(&self, request_json: &str) -> PyResult<String> {
        let req: clawpowers_security::WriteRequest =
            serde_json::from_str(request_json)
                .map_err(|e| PyValueError::new_err(e.to_string()))?;
        let decision = self.inner.evaluate(&req);
        serde_json::to_string(&decision)
            .map_err(|e| PyValueError::new_err(e.to_string()))
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// POLICY
// ═══════════════════════════════════════════════════════════════════════════════

/// Evaluate a spending policy on a proposed transaction.
#[pyfunction]
fn evaluate_spending_policy(
    max_per_tx: f64,
    decimals: u8,
    fail_closed: bool,
    tx_amount: f64,
    tx_recipient: &str,
) -> PyResult<String> {
    let policy = clawpowers_policy::SpendingPolicy::builder()
        .max_per_tx(clawpowers_tokens::TokenAmount::from_human(max_per_tx, decimals))
        .fail_closed(fail_closed)
        .build();
    let recipient: alloy_primitives::Address = tx_recipient.parse()
        .map_err(|e: alloy_primitives::hex::FromHexError| PyValueError::new_err(e.to_string()))?;
    let tx = clawpowers_policy::ProposedTx {
        recipient,
        amount: clawpowers_tokens::TokenAmount::from_human(tx_amount, decimals),
        merchant_allowlist_check: false,
    };
    let decision = policy.evaluate(&tx);
    let result = match decision {
        clawpowers_policy::PolicyDecision::Approve => "approve".to_string(),
        clawpowers_policy::PolicyDecision::Deny(reason) => format!("deny: {reason}"),
        clawpowers_policy::PolicyDecision::RequireHumanApproval(reason) => format!("escalate: {reason}"),
    };
    Ok(result)
}

/// Compute SHA-256 hash of content (from canonical crate).
#[pyfunction]
fn compute_sha256(content: &str) -> String {
    clawpowers_canonical::compute_sha256(content)
}

/// Compute cosine similarity between two f32 vectors.
#[pyfunction]
fn cosine_similarity(a: Vec<f32>, b: Vec<f32>) -> f32 {
    clawpowers_compression::cosine_similarity(&a, &b)
}

/// Compute L2 distance between two f32 vectors.
#[pyfunction]
fn l2_distance(a: Vec<f32>, b: Vec<f32>) -> f32 {
    clawpowers_compression::l2_distance(&a, &b)
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE
// ═══════════════════════════════════════════════════════════════════════════════

/// ClawPowers Core — Rust-powered Python bindings for the agent economy.
#[pymodule]
fn clawpowers_core(m: &Bound<'_, PyModule>) -> PyResult<()> {
    // Classes
    m.add_class::<AgentWallet>()?;
    m.add_class::<TokenAmount>()?;
    m.add_class::<FeeSchedule>()?;
    m.add_class::<X402Client>()?;
    m.add_class::<CanonicalStore>()?;
    m.add_class::<TurboCompressor>()?;
    m.add_class::<WriteFirewall>()?;
    // Functions
    m.add_function(wrap_pyfunction!(default_token_registry, m)?)?;
    m.add_function(wrap_pyfunction!(evaluate_spending_policy, m)?)?;
    m.add_function(wrap_pyfunction!(compute_sha256, m)?)?;
    m.add_function(wrap_pyfunction!(cosine_similarity, m)?)?;
    m.add_function(wrap_pyfunction!(l2_distance, m)?)?;
    Ok(())
}
