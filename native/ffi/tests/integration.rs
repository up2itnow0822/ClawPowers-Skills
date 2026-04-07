//! Integration tests for the clawpowers-core cross-crate pipeline.
//!
//! These tests exercise the full workflows that the napi-rs FFI bindings expose
//! to JavaScript, but at the Rust level using the public crate APIs directly.
//!
//! Pipelines tested:
//! 1. Wallet → Policy → Fee → x402 payment format
//! 2. Canonical store → Compression → Index → Verification
//! 3. Security firewall → Evaluate write request → Audit log

// ─── Pipeline 1: wallet → policy → fee → x402 ───────────────────────────────

#[cfg(test)]
mod wallet_payment_pipeline {
    use clawpowers_fee::{FeeSchedule, FeeType};
    use clawpowers_policy::{PolicyDecision, ProposedTx, SpendingPolicy};
    use clawpowers_tokens::TokenAmount;
    use clawpowers_wallet::AgentWallet;
    use clawpowers_x402::{X402Client, X402PaymentRequired};

    /// Hard-coded Hardhat account #0 private key used for deterministic tests.
    const TEST_KEY: &str = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

    fn usdc(amount: f64) -> TokenAmount {
        TokenAmount::from_human(amount, 6)
    }

    /// Build a complete x402 header from wallet signing.
    #[test]
    fn test_wallet_sign_then_x402_header() {
        // 1. Import wallet from known key.
        let wallet = AgentWallet::from_private_key(TEST_KEY).expect("valid test key");
        assert!(wallet.address().to_string().to_lowercase().contains("f39f"));

        // 2. Sign a payment descriptor.
        let descriptor = b"pay:USDC:1.00:8453:0xrecipient";
        let sig = wallet.sign_message(descriptor).expect("sign");
        assert_eq!(sig.as_bytes().len(), 65, "signature must be 65 bytes");
        let sig_hex = format!("0x{}", hex_encode(&sig.as_bytes()));

        // 3. Build x402 payment required struct.
        let requirement = X402PaymentRequired {
            payment_url: "https://pay.example.com/pay".to_string(),
            amount: "1.00".to_string(),
            token: "USDC".to_string(),
            chain_id: 8453,
            recipient: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266".to_string(),
            memo: None,
        };

        // 4. Format the X-Payment header.
        let header = X402Client::create_payment_header(&requirement, &sig_hex);
        assert!(header.contains("8453"), "chain_id must be in header");
        assert!(header.contains(&sig_hex), "signature must be in header");
    }

    /// Policy → fee → verify the fee calculation is consistent.
    #[test]
    fn test_policy_permits_then_fee_calculated() {
        // 1. Build a spending policy: max 500 USDC per tx.
        let policy = SpendingPolicy::builder()
            .max_per_tx(usdc(500.0))
            .fail_closed(true)
            .build();

        // 2. Define a proposed 100 USDC transaction.
        let tx = ProposedTx {
            recipient: "0x0000000000000000000000000000000000000001"
                .parse()
                .expect("valid address"),
            amount: usdc(100.0),
            merchant_allowlist_check: false,
        };

        // 3. Policy evaluation must approve.
        assert_eq!(policy.evaluate(&tx), PolicyDecision::Approve);

        // 4. Calculate 30 bps fee on the approved amount.
        let schedule = FeeSchedule::new(
            30, // tx_bps
            50, // swap_bps
            "0x0000000000000000000000000000000000000000"
                .parse()
                .expect("zero address"),
        );
        let calc = schedule
            .calculate(tx.amount, FeeType::Transaction)
            .expect("fee calculation");

        // 5. Invariant: gross = fee + net.
        let gross: f64 = calc.gross_amount.to_human();
        let fee: f64 = calc.fee_amount.to_human();
        let net: f64 = calc.net_amount.to_human();
        assert!((gross - fee - net).abs() < 1e-9, "gross != fee + net");

        // 6. 30 bps of 100 USDC = 0.3 USDC.
        assert!(
            (fee - 0.3).abs() < 0.000_001,
            "fee should be 0.3 USDC, got {fee}"
        );
    }

    /// Policy denies oversized transactions.
    #[test]
    fn test_policy_denies_over_limit() {
        let policy = SpendingPolicy::builder()
            .max_per_tx(usdc(100.0))
            .fail_closed(true)
            .build();
        let big_tx = ProposedTx {
            recipient: "0x0000000000000000000000000000000000000001"
                .parse()
                .expect("valid"),
            amount: usdc(200.0),
            merchant_allowlist_check: false,
        };
        assert!(matches!(policy.evaluate(&big_tx), PolicyDecision::Deny(_)));
    }

    fn hex_encode(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }
}

// ─── Pipeline 2: canonical store → compression → index → verification ────────

#[cfg(test)]
mod memory_pipeline {
    use clawpowers_canonical::{CanonicalRecord, CanonicalStore};
    use clawpowers_compression::{CompressionConfig, TurboCompressor};
    use clawpowers_index::{InMemoryIndex, VectorIndex};
    use clawpowers_verification::VerificationPipeline;

    const DIM: usize = 32;

    fn make_compressor() -> TurboCompressor {
        TurboCompressor::new(CompressionConfig {
            dimensions: DIM,
            quantization_bits: 8,
            rotation_seed: 42,
        })
    }

    fn simple_vector(seed: f32) -> Vec<f32> {
        (0..DIM).map(|i| seed + i as f32 * 0.01).collect()
    }

    /// Full memory pipeline: insert → compress → index → search → verify.
    #[test]
    fn test_full_memory_pipeline() {
        // 1. Create in-memory canonical store.
        let store = CanonicalStore::in_memory().expect("in-memory store");

        // 2. Insert three records.
        let rec1 = CanonicalRecord::new(
            "embeddings",
            "first document text",
            Some(simple_vector(0.1)),
            serde_json::json!({"doc_id": 1}),
            "test-pipeline",
        );
        let rec2 = CanonicalRecord::new(
            "embeddings",
            "second document text",
            Some(simple_vector(0.5)),
            serde_json::json!({"doc_id": 2}),
            "test-pipeline",
        );
        let rec3 = CanonicalRecord::new(
            "embeddings",
            "third document text",
            Some(simple_vector(0.9)),
            serde_json::json!({"doc_id": 3}),
            "test-pipeline",
        );

        let id1 = store.insert(&rec1).expect("insert rec1");
        let id2 = store.insert(&rec2).expect("insert rec2");
        let id3 = store.insert(&rec3).expect("insert rec3");

        // 3. Compress the embeddings and index them.
        let compressor = make_compressor();
        let mut index = InMemoryIndex::with_dimensions(DIM);

        for &id in &[id1, id2, id3] {
            let record = store.get(&id).expect("get").expect("present");
            let embedding = record.embedding.expect("has embedding");
            // Compress to verify the pipeline works (store compressed stats).
            let _ = compressor.compress(&embedding).expect("compress");
            // Index the original vector for ANN search.
            index.insert(id, embedding).expect("index");
        }

        assert_eq!(index.len(), 3);

        // 4. Search: query close to rec1's vector (seed 0.1).
        let query = simple_vector(0.11); // very close to rec1
        let results = index.search(&query, 1).expect("search");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, id1, "nearest should be rec1");

        // 5. Verify integrity of all records.
        let pipeline = VerificationPipeline::new(store);
        for &id in &[id1, id2, id3] {
            let result = pipeline.verify(&id).expect("verify");
            assert!(
                matches!(
                    result,
                    clawpowers_verification::VerificationResult::Verified(_)
                ),
                "all records should be verified"
            );
        }
    }

    /// Compression produces smaller byte footprint than original f32 slice.
    #[test]
    fn test_compression_reduces_size() {
        let compressor = make_compressor();
        let original = simple_vector(0.5);
        let original_bytes = original.len() * 4; // f32 = 4 bytes each
        let compressed = compressor.compress(&original).expect("compress");
        assert!(
            compressed.byte_size() < original_bytes,
            "compressed ({}) should be smaller than original ({original_bytes})",
            compressed.byte_size()
        );
    }

    /// Decompressed vector is within 5% L2 error of the original.
    #[test]
    fn test_compression_roundtrip_accuracy() {
        let compressor = make_compressor();
        let original = simple_vector(0.3);
        let compressed = compressor.compress(&original).expect("compress");
        let restored = compressor.decompress(&compressed).expect("decompress");

        let l2: f32 = original
            .iter()
            .zip(restored.iter())
            .map(|(a, b)| (a - b) * (a - b))
            .sum::<f32>()
            .sqrt();
        let norm: f32 = original.iter().map(|x| x * x).sum::<f32>().sqrt();
        let relative_err = if norm > f32::EPSILON { l2 / norm } else { l2 };
        assert!(
            relative_err < 0.05,
            "relative L2 error {relative_err:.4} should be < 5%"
        );
    }
}

// ─── Pipeline 3: security firewall → evaluate → audit log ────────────────────

#[cfg(test)]
mod security_pipeline {
    use clawpowers_security::{
        AuditLog, FirewallDecision, TrustLevel, WriteFirewall, WriteRequest,
    };

    fn make_firewall() -> WriteFirewall {
        WriteFirewall::new(vec!["agents".to_string(), "memory".to_string()])
    }

    fn req(namespace: &str, content: &str, trust: TrustLevel, source: &str) -> WriteRequest {
        WriteRequest {
            namespace: namespace.to_string(),
            content: content.to_string(),
            trust_level: trust,
            source: source.to_string(),
        }
    }

    /// Full security pipeline: evaluate request, record in audit log.
    #[test]
    fn test_full_security_pipeline() {
        let firewall = make_firewall();
        let mut audit = AuditLog::new();

        // 1. Approved agent write.
        let r1 = req("agents", "store memory fact", TrustLevel::Agent, "agent-1");
        let d1 = firewall.evaluate(&r1);
        assert_eq!(d1, FirewallDecision::Allow);
        audit.record(&r1, d1, "write");

        // 2. Denied: unauthorized namespace.
        let r2 = req("secrets", "leak private key", TrustLevel::Agent, "agent-1");
        let d2 = firewall.evaluate(&r2);
        assert!(matches!(d2, FirewallDecision::Deny(_)));
        audit.record(&r2, d2, "write");

        // 3. External write with injection attempt.
        let r3 = req(
            "memory",
            "hello; DROP users;--",
            TrustLevel::External,
            "api-gateway",
        );
        let d3 = firewall.evaluate(&r3);
        // Should be sanitized or allowed; not panicking.
        audit.record(&r3, d3, "write");

        // 4. Verify audit log has all 3 entries.
        assert_eq!(audit.len(), 3);

        // 5. Query by namespace.
        let agent_entries = audit.query("agents", 10);
        assert_eq!(agent_entries.len(), 1);
        assert_eq!(agent_entries[0].source, "agent-1");

        let secret_entries = audit.query("secrets", 10);
        assert_eq!(secret_entries.len(), 1);
        assert!(matches!(
            secret_entries[0].decision,
            FirewallDecision::Deny(_)
        ));
    }

    /// System trust level always allowed in permitted namespaces.
    #[test]
    fn test_system_trust_always_allowed() {
        let firewall = make_firewall();
        let r = req("agents", "system operation", TrustLevel::System, "sys");
        assert_eq!(firewall.evaluate(&r), FirewallDecision::Allow);
    }

    /// Content length enforcement.
    #[test]
    fn test_content_length_limit() {
        let mut firewall = make_firewall();
        firewall.max_content_length = 10;
        let r = req(
            "agents",
            "this content is way too long",
            TrustLevel::Agent,
            "a",
        );
        assert!(matches!(firewall.evaluate(&r), FirewallDecision::Deny(_)));
    }

    /// Audit log query respects limit.
    #[test]
    fn test_audit_log_limit() {
        let firewall = make_firewall();
        let mut audit = AuditLog::new();
        for i in 0..5 {
            let r = req("agents", &format!("content {i}"), TrustLevel::Agent, "a");
            let d = firewall.evaluate(&r);
            audit.record(&r, d, "write");
        }
        let limited = audit.query("agents", 3);
        assert_eq!(limited.len(), 3);
    }
}
