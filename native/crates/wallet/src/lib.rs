//! Key management for the ClawPowers agent wallet system.
//!
//! Provides [`AgentWallet`] — a thin wrapper around an `alloy-signer-local`
//! [`PrivateKeySigner`] that adds identity metadata and guarantees private-key
//! scrubbing on drop via [`Zeroize`].

use alloy_primitives::{Address, Signature};
use alloy_signer::SignerSync;
use alloy_signer_local::PrivateKeySigner;
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;
use uuid::Uuid;
use zeroize::Zeroize;

// ── WalletError ───────────────────────────────────────────────────────────────

/// Errors produced by wallet operations.
#[derive(Debug, Error)]
pub enum WalletError {
    /// Failed to parse or import a private key.
    #[error("Invalid private key: {0}")]
    InvalidPrivateKey(String),
    /// Signing operation failed.
    #[error("Signing failed: {0}")]
    SigningFailed(String),
}

// ── AgentWallet ───────────────────────────────────────────────────────────────

/// An agent-controlled Ethereum wallet.
///
/// Wraps a [`PrivateKeySigner`] together with a unique wallet ID and creation
/// timestamp.  On drop the inner signing key is zeroed in memory via the
/// `ZeroizeOnDrop` impl already present on `k256::ecdsa::SigningKey`.
///
/// # Example
/// ```
/// use clawpowers_wallet::AgentWallet;
/// let wallet = AgentWallet::generate();
/// println!("address: {}", wallet.address());
/// ```
pub struct AgentWallet {
    signer: PrivateKeySigner,
    /// Unique, stable identifier for this wallet instance.
    pub wallet_id: Uuid,
    /// Unix timestamp (seconds since epoch) when this wallet was created.
    pub created_at_secs: u64,
    /// Holds a zeroed copy of the raw private key bytes for the explicit
    /// `Zeroize` impl below.  Cleared on every call to `zeroize()`.
    key_bytes: [u8; 32],
}

impl std::fmt::Debug for AgentWallet {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AgentWallet")
            .field("wallet_id", &self.wallet_id)
            .field("created_at_secs", &self.created_at_secs)
            .field("address", &self.signer.address())
            .finish_non_exhaustive()
    }
}

impl AgentWallet {
    /// Generates a brand-new random keypair.
    pub fn generate() -> Self {
        let signer = PrivateKeySigner::random();
        let key_bytes = signer.credential().to_bytes().into();
        Self {
            signer,
            wallet_id: Uuid::new_v4(),
            created_at_secs: Self::now_secs(),
            key_bytes,
        }
    }

    /// Imports an existing private key from a hex string (with or without `0x`
    /// prefix).
    ///
    /// # Errors
    /// Returns [`WalletError::InvalidPrivateKey`] if the hex is invalid or does
    /// not represent a valid secp256k1 scalar.
    pub fn from_private_key(hex: &str) -> Result<Self, WalletError> {
        let trimmed = hex.trim().strip_prefix("0x").unwrap_or(hex.trim());
        let signer = trimmed
            .parse::<PrivateKeySigner>()
            .map_err(|e| WalletError::InvalidPrivateKey(e.to_string()))?;
        let key_bytes = signer.credential().to_bytes().into();
        Ok(Self {
            signer,
            wallet_id: Uuid::new_v4(),
            created_at_secs: Self::now_secs(),
            key_bytes,
        })
    }

    fn now_secs() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
    }

    /// Returns the Ethereum address corresponding to this wallet's public key.
    pub fn address(&self) -> Address {
        self.signer.address()
    }

    /// Signs an arbitrary byte payload using EIP-191 message hashing.
    ///
    /// # Errors
    /// Returns [`WalletError::SigningFailed`] on cryptographic errors.
    pub fn sign_message(&self, msg: &[u8]) -> Result<Signature, WalletError> {
        self.signer
            .sign_message_sync(msg)
            .map_err(|e| WalletError::SigningFailed(e.to_string()))
    }
}

impl Zeroize for AgentWallet {
    /// Zeroes the cached private-key bytes held in this struct.
    ///
    /// The inner `PrivateKeySigner` (and thereby the `k256::ecdsa::SigningKey`)
    /// automatically zeroes its own memory on drop via `ZeroizeOnDrop`.
    fn zeroize(&mut self) {
        self.key_bytes.zeroize();
    }
}

impl Drop for AgentWallet {
    fn drop(&mut self) {
        self.zeroize();
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use alloy_primitives::eip191_hash_message;

    /// Helper: known test private key from Ethereum test vectors.
    const TEST_PRIVKEY: &str = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

    #[test]
    fn test_generate_produces_valid_address() {
        let w = AgentWallet::generate();
        // Address must not be the zero address.
        assert_ne!(w.address(), Address::ZERO);
    }

    #[test]
    fn test_generate_unique_ids() {
        let w1 = AgentWallet::generate();
        let w2 = AgentWallet::generate();
        assert_ne!(w1.wallet_id, w2.wallet_id);
    }

    #[test]
    fn test_generate_different_keys() {
        let w1 = AgentWallet::generate();
        let w2 = AgentWallet::generate();
        assert_ne!(w1.address(), w2.address());
    }

    #[test]
    fn test_from_private_key_valid() {
        let w = AgentWallet::from_private_key(TEST_PRIVKEY).expect("valid key");
        // Known address for the Hardhat account #0 key.
        let expected: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
            .parse()
            .expect("parse address");
        assert_eq!(w.address(), expected);
    }

    #[test]
    fn test_from_private_key_without_0x_prefix() {
        let hex_no_prefix = TEST_PRIVKEY.trim_start_matches("0x");
        let w = AgentWallet::from_private_key(hex_no_prefix).expect("should accept no-0x form");
        let expected: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
            .parse()
            .expect("parse address");
        assert_eq!(w.address(), expected);
    }

    #[test]
    fn test_from_private_key_invalid_returns_err() {
        let result = AgentWallet::from_private_key("not_a_hex_key");
        assert!(result.is_err());
        assert!(matches!(result, Err(WalletError::InvalidPrivateKey(_))));
    }

    #[test]
    fn test_sign_message_produces_signature() {
        let w = AgentWallet::from_private_key(TEST_PRIVKEY).expect("valid key");
        let msg = b"hello clawpowers";
        let sig = w.sign_message(msg).expect("sign should succeed");
        // Verify the signature recovers to the correct address.
        let recovered = sig
            .recover_address_from_prehash(&eip191_hash_message(msg))
            .expect("recover address");
        assert_eq!(recovered, w.address());
    }

    #[test]
    fn test_sign_message_deterministic_for_same_key() {
        let w1 = AgentWallet::from_private_key(TEST_PRIVKEY).expect("valid key");
        let w2 = AgentWallet::from_private_key(TEST_PRIVKEY).expect("valid key");
        let msg = b"determinism test";
        let s1 = w1.sign_message(msg).expect("sign 1");
        let s2 = w2.sign_message(msg).expect("sign 2");
        assert_eq!(s1, s2);
    }

    #[test]
    fn test_zeroize_clears_key_bytes() {
        let mut w = AgentWallet::from_private_key(TEST_PRIVKEY).expect("valid key");
        // Before zeroize, key_bytes should be non-zero.
        let nonzero_before = w.key_bytes.iter().any(|&b| b != 0);
        assert!(
            nonzero_before,
            "key_bytes should be non-zero before zeroize"
        );

        w.zeroize();
        let all_zero = w.key_bytes.iter().all(|&b| b == 0);
        assert!(
            all_zero,
            "key_bytes should be zeroed after explicit zeroize"
        );
    }

    #[test]
    fn test_debug_does_not_expose_private_key() {
        let w = AgentWallet::from_private_key(TEST_PRIVKEY).expect("valid key");
        let debug_str = format!("{w:?}");
        // Make sure the raw private key hex is not in the debug output.
        assert!(
            !debug_str.contains("ac0974"),
            "private key bytes must not appear in Debug output: {debug_str}"
        );
    }

    #[test]
    fn test_wallet_created_at_is_recent() {
        let before = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let w = AgentWallet::generate();
        let after = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        assert!(
            w.created_at_secs >= before && w.created_at_secs <= after,
            "created_at_secs={} not in [{before}, {after}]",
            w.created_at_secs
        );
    }
}
