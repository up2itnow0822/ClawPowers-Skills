//! Token registry and decimal math for the ClawPowers agent wallet system.
//!
//! Provides [`TokenInfo`], [`TokenRegistry`], and [`TokenAmount`] — the
//! foundational types for expressing on-chain token quantities with correct
//! decimal semantics.

use alloy_primitives::{Address, U256, address};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::collections::HashMap;
use std::fmt;
use thiserror::Error;

// ── Custom serde helpers for alloy types ─────────────────────────────────────

mod serde_address_opt {
    use super::*;

    pub fn serialize<S>(addr: &Option<Address>, s: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match addr {
            Some(a) => s.serialize_some(&format!("{a:?}")),
            None => s.serialize_none(),
        }
    }

    pub fn deserialize<'de, D>(d: D) -> Result<Option<Address>, D::Error>
    where
        D: Deserializer<'de>,
    {
        let opt: Option<String> = Option::deserialize(d)?;
        match opt {
            None => Ok(None),
            Some(s) => {
                let trimmed = s.trim();
                let hex = trimmed.strip_prefix("0x").unwrap_or(trimmed);
                let mut bytes = [0u8; 20];
                if hex.len() != 40 {
                    return Err(serde::de::Error::custom(format!(
                        "invalid address length: {hex}"
                    )));
                }
                for i in 0..20 {
                    bytes[i] = u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16)
                        .map_err(|e| serde::de::Error::custom(e.to_string()))?;
                }
                Ok(Some(Address::from(bytes)))
            }
        }
    }
}

mod serde_u256 {
    use super::*;

    pub fn serialize<S>(v: &U256, s: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        s.serialize_str(&v.to_string())
    }

    pub fn deserialize<'de, D>(d: D) -> Result<U256, D::Error>
    where
        D: Deserializer<'de>,
    {
        let s = String::deserialize(d)?;
        U256::from_str_radix(s.trim(), 10)
            .map_err(|e| serde::de::Error::custom(format!("invalid U256: {e}")))
    }
}

// ── TokenInfo ────────────────────────────────────────────────────────────────

/// Metadata about an ERC-20 token (or native asset).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TokenInfo {
    /// Ticker symbol, e.g. `"USDC"`.
    pub symbol: String,
    /// Number of decimal places, e.g. `6` for USDC.
    pub decimals: u8,
    /// Chain ID the token lives on (1 = Ethereum mainnet).
    pub chain_id: u64,
    /// Contract address. `None` for native assets such as ETH.
    #[serde(with = "serde_address_opt")]
    pub address: Option<Address>,
}

// ── TokenRegistry ─────────────────────────────────────────────────────────

/// A registry of well-known tokens, keyed by symbol.
///
/// Constructed with [`TokenRegistry::default()`] which pre-populates a set of
/// common mainnet tokens.
#[derive(Debug, Clone)]
pub struct TokenRegistry {
    tokens: HashMap<String, TokenInfo>,
}

impl TokenRegistry {
    /// Creates an empty registry.
    pub fn empty() -> Self {
        Self {
            tokens: HashMap::new(),
        }
    }

    /// Registers a token, overwriting any existing entry with the same symbol.
    pub fn register(&mut self, token: TokenInfo) {
        self.tokens.insert(token.symbol.clone(), token);
    }

    /// Looks up a token by its ticker symbol.
    pub fn get(&self, symbol: &str) -> Option<&TokenInfo> {
        self.tokens.get(symbol)
    }

    /// Returns an iterator over all registered tokens.
    pub fn iter(&self) -> impl Iterator<Item = &TokenInfo> {
        self.tokens.values()
    }
}

impl Default for TokenRegistry {
    /// Returns a registry pre-populated with common mainnet tokens.
    fn default() -> Self {
        let mut r = Self::empty();
        r.register(TokenInfo {
            symbol: "USDC".to_string(),
            decimals: 6,
            chain_id: 1,
            address: Some(address!("A0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")),
        });
        r.register(TokenInfo {
            symbol: "USDT".to_string(),
            decimals: 6,
            chain_id: 1,
            address: Some(address!("dAC17F958D2ee523a2206206994597C13D831ec7")),
        });
        r.register(TokenInfo {
            symbol: "DAI".to_string(),
            decimals: 18,
            chain_id: 1,
            address: Some(address!("6B175474E89094C44Da98b954EedeAC495271d0F")),
        });
        r.register(TokenInfo {
            symbol: "WETH".to_string(),
            decimals: 18,
            chain_id: 1,
            address: Some(address!("C02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2")),
        });
        r.register(TokenInfo {
            symbol: "ETH".to_string(),
            decimals: 18,
            chain_id: 1,
            address: None,
        });
        r
    }
}

// ── TokenAmount ──────────────────────────────────────────────────────────────

/// Error type for token arithmetic operations.
#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum TokenError {
    /// The two operands have mismatched decimal precision.
    #[error("Decimal mismatch: lhs={lhs}, rhs={rhs}")]
    DecimalMismatch { lhs: u8, rhs: u8 },
    /// Arithmetic overflow or underflow.
    #[error("Arithmetic overflow/underflow")]
    Overflow,
}

/// A fixed-point token amount, backed by a [`U256`] raw integer.
///
/// All arithmetic is decimal-aware. Use [`TokenAmount::from_human`] and
/// [`TokenAmount::to_human`] to cross the human-readable boundary.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TokenAmount {
    /// Raw integer representation (`human × 10^decimals`), serialised as a
    /// decimal string for portability.
    #[serde(with = "serde_u256")]
    pub raw: U256,
    /// Number of decimal places this amount is expressed with.
    pub decimals: u8,
}

impl TokenAmount {
    /// Creates a [`TokenAmount`] from a human-readable `f64` value.
    ///
    /// # Example
    /// ```
    /// use clawpowers_tokens::TokenAmount;
    /// let one_usdc = TokenAmount::from_human(1.0, 6);
    /// assert_eq!(one_usdc.raw, alloy_primitives::U256::from(1_000_000u64));
    /// ```
    pub fn from_human(human: f64, decimals: u8) -> Self {
        let multiplier = 10f64.powi(i32::from(decimals));
        let raw_f64 = (human * multiplier).floor();
        let raw = if raw_f64 <= 0.0 {
            U256::ZERO
        } else {
            let as_int = raw_f64 as u128;
            U256::from(as_int)
        };
        Self { raw, decimals }
    }

    /// Converts back to a human-readable `f64`.
    ///
    /// Precision is limited by `f64` — do not use this for exact comparisons.
    pub fn to_human(&self) -> f64 {
        let divisor = 10f64.powi(i32::from(self.decimals));
        let raw_str = self.raw.to_string();
        let raw_f64: f64 = raw_str.parse().unwrap_or(0.0);
        raw_f64 / divisor
    }

    /// Returns `true` if the amount is zero.
    pub fn is_zero(&self) -> bool {
        self.raw.is_zero()
    }

    /// Checked addition. Returns an error on overflow or decimal mismatch.
    pub fn add(&self, other: &TokenAmount) -> Result<TokenAmount, TokenError> {
        if self.decimals != other.decimals {
            return Err(TokenError::DecimalMismatch {
                lhs: self.decimals,
                rhs: other.decimals,
            });
        }
        let raw = self
            .raw
            .checked_add(other.raw)
            .ok_or(TokenError::Overflow)?;
        Ok(TokenAmount {
            raw,
            decimals: self.decimals,
        })
    }

    /// Checked subtraction. Returns an error on underflow or decimal mismatch.
    pub fn sub(&self, other: &TokenAmount) -> Result<TokenAmount, TokenError> {
        if self.decimals != other.decimals {
            return Err(TokenError::DecimalMismatch {
                lhs: self.decimals,
                rhs: other.decimals,
            });
        }
        let raw = self
            .raw
            .checked_sub(other.raw)
            .ok_or(TokenError::Overflow)?;
        Ok(TokenAmount {
            raw,
            decimals: self.decimals,
        })
    }

    /// Multiply by basis points (1 bps = 0.01%).
    ///
    /// Formula: `result = self × bps / 10_000`.
    ///
    /// Returns `None` on arithmetic overflow.
    pub fn checked_mul_bps(&self, bps: u64) -> Option<TokenAmount> {
        let numerator = self.raw.checked_mul(U256::from(bps))?;
        let raw = numerator.checked_div(U256::from(10_000u64))?;
        Some(TokenAmount {
            raw,
            decimals: self.decimals,
        })
    }

    /// Creates a zero amount with the given decimal precision.
    pub fn zero(decimals: u8) -> Self {
        Self {
            raw: U256::ZERO,
            decimals,
        }
    }

    /// Alias for [`TokenAmount::from_human`] accepting an `f64`.
    ///
    /// Provided for API symmetry — `from_human` already accepts `f64`.
    pub fn from_human_f64(human: f64, decimals: u8) -> Self {
        Self::from_human(human, decimals)
    }

    /// Scale by basis points (1 bps = 0.01%): `self × bps / 10_000`.
    ///
    /// Returns `None` on arithmetic overflow.
    pub fn scale_bps(&self, bps: u32) -> Option<TokenAmount> {
        self.checked_mul_bps(bps as u64)
    }

    /// Checked subtraction (alias exposing the same name used by the fee crate).
    ///
    /// Returns `None` on underflow or decimal mismatch.
    pub fn checked_sub(&self, other: &TokenAmount) -> Option<TokenAmount> {
        self.sub(other).ok()
    }
}

// ─── FeeType ─────────────────────────────────────────────────────────────────

/// Fee classification used by the fee schedule.
///
/// Defined here in `clawpowers-tokens` and re-exported by `clawpowers-fee` so
/// downstream consumers can `use clawpowers_fee::FeeType` or
/// `use clawpowers_tokens::FeeType` interchangeably.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FeeType {
    /// Standard on-chain transaction fee.
    Transaction,
    /// DEX swap fee.
    Swap,
    /// Custom fee with explicit basis points.
    Custom(u32),
}

impl fmt::Display for TokenAmount {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.to_human())
    }
}

impl PartialOrd for TokenAmount {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        if self.decimals != other.decimals {
            return None;
        }
        Some(self.raw.cmp(&other.raw))
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── TokenInfo ──────────────────────────────────────────────────────────

    #[test]
    fn test_token_info_fields() {
        let info = TokenInfo {
            symbol: "USDC".to_string(),
            decimals: 6,
            chain_id: 1,
            address: Some(address!("A0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")),
        };
        assert_eq!(info.symbol, "USDC");
        assert_eq!(info.decimals, 6);
        assert_eq!(info.chain_id, 1);
        assert!(info.address.is_some());
    }

    #[test]
    fn test_token_info_no_address_for_eth() {
        let eth = TokenInfo {
            symbol: "ETH".to_string(),
            decimals: 18,
            chain_id: 1,
            address: None,
        };
        assert!(eth.address.is_none());
    }

    // ── TokenRegistry ──────────────────────────────────────────────────────

    #[test]
    fn test_registry_default_contains_all_tokens() {
        let reg = TokenRegistry::default();
        for sym in &["USDC", "USDT", "DAI", "WETH", "ETH"] {
            assert!(reg.get(sym).is_some(), "missing token: {sym}");
        }
    }

    #[test]
    fn test_registry_usdc_decimals() {
        let reg = TokenRegistry::default();
        let usdc = reg.get("USDC").expect("USDC should be present");
        assert_eq!(usdc.decimals, 6);
    }

    #[test]
    fn test_registry_dai_decimals() {
        let reg = TokenRegistry::default();
        let dai = reg.get("DAI").expect("DAI should be present");
        assert_eq!(dai.decimals, 18);
    }

    #[test]
    fn test_registry_register_custom_token() {
        let mut reg = TokenRegistry::empty();
        reg.register(TokenInfo {
            symbol: "MYTOKEN".to_string(),
            decimals: 8,
            chain_id: 137,
            address: None,
        });
        let t = reg.get("MYTOKEN").expect("custom token");
        assert_eq!(t.chain_id, 137);
        assert_eq!(t.decimals, 8);
    }

    // ── TokenAmount ────────────────────────────────────────────────────────

    #[test]
    fn test_from_human_usdc_one_dollar() {
        let one = TokenAmount::from_human(1.0, 6);
        assert_eq!(one.raw, U256::from(1_000_000u64));
    }

    #[test]
    fn test_from_human_eth_one() {
        let one_eth = TokenAmount::from_human(1.0, 18);
        assert_eq!(one_eth.raw, U256::from(1_000_000_000_000_000_000u128));
    }

    #[test]
    fn test_to_human_round_trip() {
        let human = 123.456_789;
        let amt = TokenAmount::from_human(human, 6);
        let back = amt.to_human();
        assert!(
            (back - human).abs() < 0.000_001,
            "round-trip: got {back}, want ~{human}"
        );
    }

    #[test]
    fn test_from_human_zero() {
        let zero = TokenAmount::from_human(0.0, 6);
        assert!(zero.is_zero());
    }

    #[test]
    fn test_add_same_decimals() {
        let a = TokenAmount::from_human(1.0, 6);
        let b = TokenAmount::from_human(2.0, 6);
        let sum = a.add(&b).expect("addition should succeed");
        assert_eq!(sum, TokenAmount::from_human(3.0, 6));
    }

    #[test]
    fn test_sub_valid() {
        let a = TokenAmount::from_human(5.0, 6);
        let b = TokenAmount::from_human(2.0, 6);
        let diff = a.sub(&b).expect("subtraction should succeed");
        assert_eq!(diff, TokenAmount::from_human(3.0, 6));
    }

    #[test]
    fn test_sub_underflow_returns_err() {
        let a = TokenAmount::from_human(1.0, 6);
        let b = TokenAmount::from_human(2.0, 6);
        let result = a.sub(&b);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), TokenError::Overflow);
    }

    #[test]
    fn test_add_decimal_mismatch_returns_err() {
        let a = TokenAmount::from_human(1.0, 6);
        let b = TokenAmount::from_human(1.0, 18);
        let result = a.add(&b);
        assert!(matches!(result, Err(TokenError::DecimalMismatch { .. })));
    }

    #[test]
    fn test_checked_mul_bps_50bps() {
        // 50 bps = 0.5% of 1000 USDC = 5 USDC
        let amount = TokenAmount::from_human(1000.0, 6);
        let fee = amount.checked_mul_bps(50).expect("no overflow");
        let expected = TokenAmount::from_human(5.0, 6);
        assert_eq!(fee, expected);
    }

    #[test]
    fn test_checked_mul_bps_100bps_is_1pct() {
        let amount = TokenAmount::from_human(200.0, 6);
        let result = amount.checked_mul_bps(100).expect("no overflow");
        let expected = TokenAmount::from_human(2.0, 6);
        assert_eq!(result, expected);
    }

    #[test]
    fn test_checked_mul_bps_zero() {
        let amount = TokenAmount::from_human(1000.0, 6);
        let result = amount.checked_mul_bps(0).expect("no overflow");
        assert!(result.is_zero());
    }

    #[test]
    fn test_display_shows_human_amount() {
        let amt = TokenAmount::from_human(42.5, 6);
        let s = format!("{amt}");
        assert!(s.contains("42.5"), "display: {s}");
    }

    #[test]
    fn test_partial_ord_same_decimals() {
        let a = TokenAmount::from_human(1.0, 6);
        let b = TokenAmount::from_human(2.0, 6);
        assert!(a < b);
        assert!(b > a);
        assert!(a <= a.clone());
    }

    #[test]
    fn test_serde_round_trip() {
        let amt = TokenAmount::from_human(99.99, 6);
        let json = serde_json::to_string(&amt).expect("serialize");
        let back: TokenAmount = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(amt, back);
    }

    #[test]
    fn test_token_info_serde_round_trip() {
        let info = TokenInfo {
            symbol: "USDC".to_string(),
            decimals: 6,
            chain_id: 1,
            address: Some(address!("A0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")),
        };
        let json = serde_json::to_string(&info).expect("serialize");
        let back: TokenInfo = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(info, back);
    }
}
