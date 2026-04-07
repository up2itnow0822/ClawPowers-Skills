//! clawpowers-fee — Fee schedule calculation for transactions and swaps.
//!
//! [`FeeSchedule`] holds basis-point rates for different operation types and
//! computes the fee for a given [`TokenAmount`].

use alloy_primitives::Address;
use clawpowers_tokens::{TokenAmount, TokenError};
use serde::{Deserialize, Serialize};
use thiserror::Error;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Default transaction fee: 77 bps = 0.77%.
pub const DEFAULT_TX_FEE_BPS: u64 = 77;

/// Default swap fee: 30 bps = 0.30%.
pub const DEFAULT_SWAP_FEE_BPS: u64 = 30;

/// Placeholder fee recipient address used by [`FeeSchedule::default`].
pub const PLACEHOLDER_FEE_RECIPIENT: Address = Address::ZERO;

// ---------------------------------------------------------------------------
// FeeType
// ---------------------------------------------------------------------------

/// Fee classification.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FeeType {
    /// Standard on-chain transaction fee.
    Transaction,
    /// DEX swap fee.
    Swap,
    /// Custom fee with explicit basis points.
    Custom(u64),
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/// Errors produced by fee operations.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum FeeError {
    /// Token arithmetic failed.
    #[error("token arithmetic error: {0}")]
    Token(String),
    /// Basis-point rate exceeds 10 000 (100%).
    #[error("invalid basis points: {0} (max 10000)")]
    InvalidBps(u64),
    /// Computed fee would exceed the gross amount.
    #[error("fee ({fee_bps} bps) would exceed gross amount")]
    FeeExceedsAmount {
        /// The basis-point rate that caused the violation.
        fee_bps: u64,
    },
}

impl From<TokenError> for FeeError {
    fn from(e: TokenError) -> Self {
        FeeError::Token(e.to_string())
    }
}

// ---------------------------------------------------------------------------
// FeeCalculation
// ---------------------------------------------------------------------------

/// The result of a fee calculation.
#[derive(Debug, Clone)]
pub struct FeeCalculation {
    /// The original, pre-fee amount.
    pub gross_amount: TokenAmount,
    /// The fee portion deducted from `gross_amount`.
    pub fee_amount: TokenAmount,
    /// The amount remaining after fee deduction.
    pub net_amount: TokenAmount,
    /// The address that will receive the fee.
    pub fee_recipient: Address,
    /// The type of fee that was applied.
    pub fee_type: FeeType,
}

// ---------------------------------------------------------------------------
// FeeSchedule
// ---------------------------------------------------------------------------

/// Configures fee rates and the recipient address for the protocol.
#[derive(Debug, Clone)]
pub struct FeeSchedule {
    /// Transaction fee in basis points (default: 77 = 0.77%).
    pub tx_fee_bps: u64,
    /// Swap fee in basis points (default: 30 = 0.30%).
    pub swap_fee_bps: u64,
    /// Address that accumulates collected fees.
    pub fee_recipient: Address,
}

impl Default for FeeSchedule {
    fn default() -> Self {
        Self {
            tx_fee_bps: DEFAULT_TX_FEE_BPS,
            swap_fee_bps: DEFAULT_SWAP_FEE_BPS,
            fee_recipient: PLACEHOLDER_FEE_RECIPIENT,
        }
    }
}

impl FeeSchedule {
    /// Creates a new [`FeeSchedule`] with explicit parameters.
    pub fn new(tx_fee_bps: u64, swap_fee_bps: u64, fee_recipient: Address) -> Self {
        Self {
            tx_fee_bps,
            swap_fee_bps,
            fee_recipient,
        }
    }

    /// Returns the effective basis-point rate for the given `fee_type`.
    fn bps_for(&self, fee_type: &FeeType) -> u64 {
        match fee_type {
            FeeType::Transaction => self.tx_fee_bps,
            FeeType::Swap => self.swap_fee_bps,
            FeeType::Custom(bps) => *bps,
        }
    }

    /// Calculates a fee for `amount` and the given `fee_type`.
    ///
    /// # Errors
    ///
    /// - [`FeeError::InvalidBps`] — rate exceeds 10 000.
    /// - [`FeeError::Token`] — arithmetic overflow.
    /// - [`FeeError::FeeExceedsAmount`] — fee ≥ gross.
    pub fn calculate(
        &self,
        amount: TokenAmount,
        fee_type: FeeType,
    ) -> Result<FeeCalculation, FeeError> {
        let bps = self.bps_for(&fee_type);
        if bps > 10_000 {
            return Err(FeeError::InvalidBps(bps));
        }

        let fee_amount = amount
            .checked_mul_bps(bps)
            .ok_or_else(|| FeeError::Token("overflow in checked_mul_bps".to_string()))?;

        let net_amount = amount
            .sub(&fee_amount)
            .map_err(|_| FeeError::FeeExceedsAmount { fee_bps: bps })?;

        Ok(FeeCalculation {
            gross_amount: amount,
            fee_amount,
            net_amount,
            fee_recipient: self.fee_recipient,
            fee_type,
        })
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use alloy_primitives::Address;

    fn usdc(amount: f64) -> TokenAmount {
        TokenAmount::from_human(amount, 6)
    }

    fn eth(amount: f64) -> TokenAmount {
        TokenAmount::from_human(amount, 18)
    }

    #[test]
    fn default_fee_schedule_values() {
        let s = FeeSchedule::default();
        assert_eq!(s.tx_fee_bps, 77);
        assert_eq!(s.swap_fee_bps, 30);
        assert_eq!(s.fee_recipient, Address::ZERO);
    }

    #[test]
    fn tx_fee_usdc_1000() {
        let s = FeeSchedule::default();
        let calc = s.calculate(usdc(1000.0), FeeType::Transaction).unwrap();
        // 1000 USDC × 77/10000 = 7.7 USDC
        assert!((calc.fee_amount.to_human() - 7.7).abs() < 0.000_001);
        assert!((calc.net_amount.to_human() - 992.3).abs() < 0.000_001);
        assert_eq!(calc.fee_type, FeeType::Transaction);
    }

    #[test]
    fn tx_fee_usdc_1() {
        let s = FeeSchedule::default();
        let calc = s.calculate(usdc(1.0), FeeType::Transaction).unwrap();
        // 1 USDC × 77/10000 = 0.0077 USDC
        assert!((calc.fee_amount.to_human() - 0.0077).abs() < 0.000_001);
    }

    #[test]
    fn swap_fee_usdc_1000() {
        let s = FeeSchedule::default();
        let calc = s.calculate(usdc(1000.0), FeeType::Swap).unwrap();
        // 1000 USDC × 30/10000 = 3 USDC
        assert!((calc.fee_amount.to_human() - 3.0).abs() < 0.000_001);
        assert_eq!(calc.fee_type, FeeType::Swap);
    }

    #[test]
    fn swap_fee_custom_50bps() {
        let s = FeeSchedule::new(30, 50, Address::ZERO);
        let calc = s.calculate(usdc(200.0), FeeType::Swap).unwrap();
        // 200 USDC × 50/10000 = 1 USDC
        assert!((calc.fee_amount.to_human() - 1.0).abs() < 0.000_001);
    }

    #[test]
    fn tx_fee_eth_1() {
        let s = FeeSchedule::default();
        let calc = s.calculate(eth(1.0), FeeType::Transaction).unwrap();
        // 1 ETH × 77/10000 = 0.0077 ETH
        assert!((calc.fee_amount.to_human() - 0.0077).abs() < 0.000_001);
    }

    #[test]
    fn swap_fee_eth_10() {
        let s = FeeSchedule::default();
        let calc = s.calculate(eth(10.0), FeeType::Swap).unwrap();
        // 10 ETH × 30/10000 = 0.03 ETH
        assert!((calc.fee_amount.to_human() - 0.03).abs() < 0.000_001);
    }

    #[test]
    fn zero_amount_returns_zero_fee() {
        let s = FeeSchedule::default();
        let calc = s.calculate(usdc(0.0), FeeType::Transaction).unwrap();
        assert!(calc.fee_amount.is_zero());
        assert!(calc.net_amount.is_zero());
    }

    #[test]
    fn custom_fee_type_100bps() {
        let s = FeeSchedule::default();
        let calc = s.calculate(usdc(100.0), FeeType::Custom(100)).unwrap();
        // 100 USDC × 100/10000 = 1 USDC
        assert!((calc.fee_amount.to_human() - 1.0).abs() < 0.000_001);
    }

    #[test]
    fn fee_recipient_propagated() {
        use alloy_primitives::address;
        let recipient = address!("d8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
        let s = FeeSchedule::new(77, 30, recipient);
        let calc = s.calculate(usdc(500.0), FeeType::Transaction).unwrap();
        assert_eq!(calc.fee_recipient, recipient);
    }

    #[test]
    fn gross_equals_fee_plus_net() {
        let s = FeeSchedule::default();
        let gross = usdc(123.456789);
        let calc = s.calculate(gross.clone(), FeeType::Swap).unwrap();
        let reconstructed = calc.fee_amount.add(&calc.net_amount).unwrap();
        assert_eq!(reconstructed, calc.gross_amount);
    }

    #[test]
    fn bps_over_10000_is_rejected() {
        let s = FeeSchedule::new(10_001, 30, Address::ZERO);
        let err = s.calculate(usdc(1.0), FeeType::Transaction).unwrap_err();
        assert_eq!(err, FeeError::InvalidBps(10_001));
    }
}
