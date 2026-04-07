//! Exact verification pipeline for TurboMemory.
//!
//! The [`VerificationPipeline`] fetches records from a [`CanonicalStore`],
//! recomputes content hashes, and checks TTL / quarantine metadata before
//! returning a typed [`VerificationResult`].

use chrono::{Duration, Utc};
use clawpowers_canonical::{CanonicalRecord, CanonicalStore, compute_sha256};
use thiserror::Error;
use uuid::Uuid;

/// Errors returned by the verification pipeline.
#[derive(Debug, Error)]
pub enum VerificationError {
    /// Underlying canonical store error.
    #[error("store error: {0}")]
    Store(#[from] clawpowers_canonical::CanonicalError),
}

/// A shorthand result type for [`VerificationError`].
pub type Result<T> = std::result::Result<T, VerificationError>;

// ─── Verification Result ─────────────────────────────────────────────────────

/// The outcome of verifying a single record.
#[derive(Debug)]
pub enum VerificationResult {
    /// Record is present, hash is valid, not expired, and not quarantined.
    Verified(CanonicalRecord),

    /// The stored hash does not match the recomputed hash.
    IntegrityFailed {
        /// Record identifier.
        id: Uuid,
        /// Hash value stored in the database.
        expected_hash: String,
        /// Hash value computed from the stored content.
        actual_hash: String,
    },

    /// The record has a `ttl_seconds` metadata field and the record has
    /// outlived it.
    Expired {
        /// Record identifier.
        id: Uuid,
        /// How far past the TTL deadline the record is.
        ttl_exceeded_by: Duration,
    },

    /// The record has `"quarantined": true` in its metadata.
    Quarantined {
        /// Record identifier.
        id: Uuid,
        /// Reason, extracted from `metadata["quarantine_reason"]` if present.
        reason: String,
    },

    /// No record with the given id exists in the store.
    NotFound(Uuid),
}

// ─── Pipeline ────────────────────────────────────────────────────────────────

/// Verification pipeline wrapping a [`CanonicalStore`].
pub struct VerificationPipeline {
    store: CanonicalStore,
}

impl VerificationPipeline {
    /// Create a new pipeline backed by `store`.
    pub fn new(store: CanonicalStore) -> Self {
        Self { store }
    }

    /// Access the underlying canonical store.
    pub fn store(&self) -> &CanonicalStore {
        &self.store
    }

    // ── Single Verification ───────────────────────────────────────────────

    /// Verify a single record identified by `id`.
    ///
    /// Steps:
    /// 1. Fetch — [`VerificationResult::NotFound`] if absent.
    /// 2. Hash check — [`VerificationResult::IntegrityFailed`] on mismatch.
    /// 3. TTL check — [`VerificationResult::Expired`] if past `metadata["ttl_seconds"]`.
    /// 4. Quarantine check — [`VerificationResult::Quarantined`] if
    ///    `metadata["quarantined"] == true`.
    /// 5. Otherwise [`VerificationResult::Verified`].
    pub fn verify(&self, id: &Uuid) -> Result<VerificationResult> {
        // Step 1: Fetch.
        let record = match self.store.get(id)? {
            None => return Ok(VerificationResult::NotFound(*id)),
            Some(r) => r,
        };

        // Step 2: Hash check.
        let actual_hash = compute_sha256(&record.content);
        if actual_hash != record.content_hash {
            return Ok(VerificationResult::IntegrityFailed {
                id: *id,
                expected_hash: record.content_hash.clone(),
                actual_hash,
            });
        }

        // Step 3: TTL check.
        if let Some(ttl_val) = record.metadata.get("ttl_seconds")
            && let Some(ttl_secs) = ttl_val.as_i64()
        {
            let deadline = record.created_at + Duration::seconds(ttl_secs);
            let now = Utc::now();
            if now > deadline {
                let exceeded_by = now - deadline;
                return Ok(VerificationResult::Expired {
                    id: *id,
                    ttl_exceeded_by: exceeded_by,
                });
            }
        }

        // Step 4: Quarantine check.
        if record
            .metadata
            .get("quarantined")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
        {
            let reason = record
                .metadata
                .get("quarantine_reason")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string();
            return Ok(VerificationResult::Quarantined { id: *id, reason });
        }

        Ok(VerificationResult::Verified(record))
    }

    // ── Batch Verification ────────────────────────────────────────────────

    /// Verify a batch of records; each id is verified independently.
    pub fn verify_batch(&self, ids: &[Uuid]) -> Result<Vec<VerificationResult>> {
        ids.iter().map(|id| self.verify(id)).collect()
    }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use clawpowers_canonical::{CanonicalRecord, CanonicalStore};
    use serde_json::json;

    fn make_pipeline() -> VerificationPipeline {
        let store = CanonicalStore::in_memory().expect("in-memory store");
        VerificationPipeline::new(store)
    }

    fn insert(
        pipeline: &VerificationPipeline,
        namespace: &str,
        content: &str,
        metadata: serde_json::Value,
    ) -> Uuid {
        let rec = CanonicalRecord::new(namespace, content, None, metadata, "test");
        let id = rec.id;
        pipeline.store().insert(&rec).expect("insert");
        id
    }

    // ── Verified ─────────────────────────────────────────────────────────

    #[test]
    fn test_verify_valid_record() {
        let p = make_pipeline();
        let id = insert(&p, "ns", "hello world", json!({}));
        match p.verify(&id).expect("verify") {
            VerificationResult::Verified(r) => assert_eq!(r.id, id),
            other => panic!("expected Verified, got {other:?}"),
        }
    }

    #[test]
    fn test_verify_correct_hash_is_verified() {
        let p = make_pipeline();
        let id = insert(&p, "ns", "content for integrity check", json!({}));
        assert!(matches!(
            p.verify(&id).expect("verify"),
            VerificationResult::Verified(_)
        ));
    }

    // ── Not Found ─────────────────────────────────────────────────────────

    #[test]
    fn test_verify_not_found() {
        let p = make_pipeline();
        let missing = Uuid::new_v4();
        match p.verify(&missing).expect("verify") {
            VerificationResult::NotFound(id) => assert_eq!(id, missing),
            other => panic!("expected NotFound, got {other:?}"),
        }
    }

    // ── Integrity (via hash comparison) ───────────────────────────────────

    #[test]
    fn test_verify_integrity_passes_for_fresh_record() {
        let p = make_pipeline();
        let id = insert(&p, "ns", "fresh record content", json!({}));
        // Freshly inserted record should always pass hash check.
        assert!(matches!(
            p.verify(&id).expect("v"),
            VerificationResult::Verified(_)
        ));
    }

    #[test]
    fn test_integrity_check_uses_sha256() {
        let content = "check sha256 content";
        let expected_hash = compute_sha256(content);
        let p = make_pipeline();
        let rec = CanonicalRecord::new("ns", content, None, json!({}), "test");
        assert_eq!(rec.content_hash, expected_hash);
        let id = p.store().insert(&rec).expect("insert");
        assert!(matches!(
            p.verify(&id).expect("v"),
            VerificationResult::Verified(_)
        ));
    }

    // ── TTL ───────────────────────────────────────────────────────────────

    #[test]
    fn test_verify_expired_ttl() {
        let p = make_pipeline();
        let id = insert(&p, "ns", "old content", json!({"ttl_seconds": -1}));
        match p.verify(&id).expect("verify") {
            VerificationResult::Expired { id: eid, .. } => assert_eq!(eid, id),
            other => panic!("expected Expired, got {other:?}"),
        }
    }

    #[test]
    fn test_verify_future_ttl_is_valid() {
        let p = make_pipeline();
        let id = insert(&p, "ns", "fresh content", json!({"ttl_seconds": 3600}));
        assert!(matches!(
            p.verify(&id).expect("v"),
            VerificationResult::Verified(_)
        ));
    }

    #[test]
    fn test_no_ttl_field_is_valid() {
        let p = make_pipeline();
        let id = insert(&p, "ns", "no ttl here", json!({"source": "test"}));
        assert!(matches!(
            p.verify(&id).expect("v"),
            VerificationResult::Verified(_)
        ));
    }

    // ── Quarantine ────────────────────────────────────────────────────────

    #[test]
    fn test_verify_quarantined_with_reason() {
        let p = make_pipeline();
        let id = insert(
            &p,
            "ns",
            "suspicious content",
            json!({"quarantined": true, "quarantine_reason": "policy violation"}),
        );
        match p.verify(&id).expect("verify") {
            VerificationResult::Quarantined { id: qid, reason } => {
                assert_eq!(qid, id);
                assert_eq!(reason, "policy violation");
            }
            other => panic!("expected Quarantined, got {other:?}"),
        }
    }

    #[test]
    fn test_verify_quarantined_default_reason() {
        let p = make_pipeline();
        let id = insert(&p, "ns", "another bad record", json!({"quarantined": true}));
        match p.verify(&id).expect("verify") {
            VerificationResult::Quarantined { reason, .. } => assert_eq!(reason, "unknown"),
            other => panic!("expected Quarantined, got {other:?}"),
        }
    }

    // ── Batch ─────────────────────────────────────────────────────────────

    #[test]
    fn test_verify_batch_mixed_results() {
        let p = make_pipeline();
        let valid_id = insert(&p, "ns", "valid batch record", json!({}));
        let expired_id = insert(&p, "ns", "expired batch", json!({"ttl_seconds": -1}));
        let missing_id = Uuid::new_v4();

        let results = p
            .verify_batch(&[valid_id, expired_id, missing_id])
            .expect("batch");
        assert_eq!(results.len(), 3);
        assert!(matches!(results[0], VerificationResult::Verified(_)));
        assert!(matches!(results[1], VerificationResult::Expired { .. }));
        assert!(matches!(results[2], VerificationResult::NotFound(_)));
    }

    #[test]
    fn test_verify_batch_empty() {
        let p = make_pipeline();
        let results = p.verify_batch(&[]).expect("batch");
        assert!(results.is_empty());
    }

    #[test]
    fn test_verify_batch_all_not_found() {
        let p = make_pipeline();
        let ids = vec![Uuid::new_v4(), Uuid::new_v4()];
        let results = p.verify_batch(&ids).expect("batch");
        assert_eq!(results.len(), 2);
        for r in results {
            assert!(matches!(r, VerificationResult::NotFound(_)));
        }
    }
}
