//! Ethereum address derivation (pubkey → Keccak last 20) and ECDSA over secp256k1 (k256).

use alloy_primitives::{keccak256, Address};
use k256::ecdsa::signature::hazmat::PrehashVerifier;
use k256::ecdsa::{RecoveryId, Signature, SigningKey, VerifyingKey};

/// Uncompressed public key as 64 bytes (x || y), without the `0x04` prefix.
pub fn derive_public_key(private_key_bytes: &[u8]) -> Result<Vec<u8>, String> {
    if private_key_bytes.len() != 32 {
        return Err("private key must be 32 bytes".into());
    }
    let sk = SigningKey::from_slice(private_key_bytes).map_err(|e| e.to_string())?;
    let vk = VerifyingKey::from(&sk);
    let encoded = vk.to_encoded_point(false);
    let bytes = encoded.as_bytes();
    if bytes.len() != 65 || bytes[0] != 0x04 {
        return Err("invalid uncompressed public key encoding".into());
    }
    Ok(bytes[1..].to_vec())
}

/// `0x` + 20-byte Ethereum address (Keccak-256 of 64-byte pubkey, last 20 bytes), EIP-55 checksummed.
pub fn derive_ethereum_address(private_key_bytes: &[u8]) -> Result<String, String> {
    let pk64 = derive_public_key(private_key_bytes)?;
    let digest = keccak256(pk64.as_slice());
    let addr = Address::from_slice(&digest[12..]);
    Ok(addr.to_checksum(None))
}

/// ECDSA sign a 32-byte message hash; returns 65 bytes: r (32) || s (32) || recovery_id (0–3).
pub fn sign_ecdsa(private_key_bytes: &[u8], message_hash: &[u8]) -> Result<Vec<u8>, String> {
    if message_hash.len() != 32 {
        return Err("message hash must be 32 bytes".into());
    }
    let sk = SigningKey::from_slice(private_key_bytes).map_err(|e| e.to_string())?;
    let (sig, recid) = sk
        .sign_prehash_recoverable(message_hash)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(65);
    out.extend_from_slice(&sig.to_bytes());
    out.push(recid.to_byte());
    Ok(out)
}

/// Verify ECDSA over a 32-byte prehash. `public_key_bytes` is 64-byte uncompressed x||y (no prefix).
/// `signature` is 65 bytes (r||s||v) or 64 bytes (r||s) using the given public key.
pub fn verify_ecdsa(
    public_key_bytes: &[u8],
    message_hash: &[u8],
    signature: &[u8],
) -> Result<bool, String> {
    if message_hash.len() != 32 {
        return Err("message hash must be 32 bytes".into());
    }
    if public_key_bytes.len() != 64 {
        return Err("public key must be 64 bytes (uncompressed x||y, no 0x04 prefix)".into());
    }
    let mut sec1 = Vec::with_capacity(65);
    sec1.push(0x04);
    sec1.extend_from_slice(public_key_bytes);
    let vk = VerifyingKey::from_sec1_bytes(&sec1).map_err(|e| e.to_string())?;

    match signature.len() {
        65 => {
            let sig = Signature::try_from(&signature[..64]).map_err(|e| e.to_string())?;
            let recid = RecoveryId::try_from(signature[64])
                .map_err(|_| "invalid recovery id (expected 0–3)".to_string())?;
            let recovered = VerifyingKey::recover_from_prehash(message_hash, &sig, recid)
                .map_err(|e| e.to_string())?;
            Ok(recovered == vk)
        }
        64 => {
            let sig = Signature::try_from(signature).map_err(|e| e.to_string())?;
            vk.verify_prehash(message_hash, &sig)
                .map(|_| true)
                .map_err(|e| e.to_string())
        }
        _ => Err("signature must be 64 or 65 bytes".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Hardhat / Foundry default account #0
    const HH0_SK: &str = "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    const HH0_ADDR: &str = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

    #[test]
    fn hardhat_account_0_address() {
        let sk = hex::decode(HH0_SK).unwrap();
        let addr = derive_ethereum_address(&sk).unwrap();
        assert_eq!(addr.to_lowercase(), HH0_ADDR.to_lowercase());
    }

    #[test]
    fn sign_and_verify_roundtrip() {
        let sk = hex::decode(HH0_SK).unwrap();
        let pk = derive_public_key(&sk).unwrap();
        let msg_hash = keccak256(b"hello clawpowers");
        let sig = sign_ecdsa(&sk, msg_hash.as_slice()).unwrap();
        assert!(verify_ecdsa(&pk, msg_hash.as_slice(), &sig).unwrap());
    }
}
