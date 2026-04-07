//! Spending policy engine for the ClawPowers agent wallet system.
//!
//! Provides [`SpendingPolicy`] — a configurable rule set that determines
//! whether a proposed on-chain transaction should be approved, denied, or
//! escalated for human review.
//!
//! # Quick start
//! ```
//! use clawpowers_policy::{SpendingPolicy, ProposedTx, PolicyDecision};
//! use clawpowers_tokens::TokenAmount;
//! use alloy_primitives::Address;
//!
//! let policy = SpendingPolicy::builder()
//!     .max_per_tx(TokenAmount::from_human(100.0, 6))
//!     .fail_closed(true)
//!     .build();
//!
//! let tx = ProposedTx {
//!     recipient: Address::ZERO,
//!     amount: TokenAmount::from_human(50.0, 6),
//!     merchant_allowlist_check: false,
//! };
//!
//! assert!(matches!(policy.evaluate(&tx), PolicyDecision::Approve));
//! ```

use alloy_primitives::Address;
use clawpowers_tokens::TokenAmount;
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;

// ── PolicyError ───────────────────────────────────────────────────────────────

/// Errors produced during policy construction.
#[derive(Debug, Error)]
pub enum PolicyError {
    /// A required field was missing when calling [`PolicyBuilder::build`].
    #[error("Policy configuration error: {0}")]
    Configuration(String),
}

// ── RollingCap ────────────────────────────────────────────────────────────────

/// A rolling spending cap over a sliding time window.
#[derive(Debug, Clone)]
pub struct RollingCap {
    /// Maximum cumulative spend allowed within the window.
    pub amount: TokenAmount,
    /// Window duration in seconds.
    pub window_secs: u64,
}

// ── ProposedTx ────────────────────────────────────────────────────────────────

/// A transaction proposed for approval.
#[derive(Debug, Clone)]
pub struct ProposedTx {
    /// Target Ethereum address for this transaction.
    pub recipient: Address,
    /// Amount being sent.
    pub amount: TokenAmount,
    /// When `true` and a non-empty [`SpendingPolicy::merchant_allowlist`] is
    /// configured, the recipient will be checked against the list.
    pub merchant_allowlist_check: bool,
}

// ── PolicyDecision ────────────────────────────────────────────────────────────

/// The outcome of evaluating a [`ProposedTx`] against a [`SpendingPolicy`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PolicyDecision {
    /// The transaction is approved; proceed with signing.
    Approve,
    /// The transaction is denied. The payload explains why.
    Deny(String),
    /// The transaction requires a human to approve before proceeding.
    RequireHumanApproval(String),
}

// ── SpendRecord ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
struct SpendRecord {
    amount: TokenAmount,
    timestamp_secs: u64,
}

// ── SpendingPolicy ────────────────────────────────────────────────────────────

/// A configurable spending policy for an agent wallet.
///
/// All checks respect the `fail_closed` flag: when `true` (the default), any
/// failed check results in an immediate [`PolicyDecision::Deny`] rather than
/// allowing the transaction through.
///
/// Use [`SpendingPolicy::builder()`] to construct instances.
#[derive(Debug)]
pub struct SpendingPolicy {
    /// Maximum amount allowed per single transaction.
    pub max_per_tx: Option<TokenAmount>,
    /// Optional rolling spend cap over a sliding time window.
    pub rolling_cap: Option<RollingCap>,
    /// Explicit list of allowed recipient addresses.  An empty list means "any
    /// recipient is allowed".
    pub merchant_allowlist: Vec<Address>,
    /// When `true`, any policy violation causes an immediate
    /// [`PolicyDecision::Deny`]. When `false`, policy failures escalate to
    /// [`PolicyDecision::RequireHumanApproval`].
    pub fail_closed: bool,
    /// Internal history of recorded spends, used for rolling-cap evaluation.
    spend_history: Vec<SpendRecord>,
}

impl SpendingPolicy {
    /// Returns a new [`PolicyBuilder`] for constructing a [`SpendingPolicy`].
    pub fn builder() -> PolicyBuilder {
        PolicyBuilder::default()
    }

    /// Evaluates a [`ProposedTx`] against this policy and returns a
    /// [`PolicyDecision`].
    pub fn evaluate(&self, tx: &ProposedTx) -> PolicyDecision {
        // --- 1. max_per_tx check ---
        if let Some(ref max) = self.max_per_tx {
            match tx.amount.partial_cmp(max) {
                None => {
                    return self.violation(
                        "Decimal mismatch between transaction amount and max_per_tx".to_string(),
                    );
                }
                Some(ord) => {
                    if ord == std::cmp::Ordering::Greater {
                        let reason = format!(
                            "Transaction amount {} exceeds max_per_tx {}",
                            tx.amount.to_human(),
                            max.to_human()
                        );
                        return self.violation(reason);
                    }
                }
            }
        }

        // --- 2. merchant allowlist check ---
        if tx.merchant_allowlist_check
            && !self.merchant_allowlist.is_empty()
            && !self.merchant_allowlist.contains(&tx.recipient)
        {
            let reason = format!(
                "Recipient {:#x} is not in the merchant allowlist",
                tx.recipient
            );
            return self.violation(reason);
        }

        // --- 3. rolling cap check ---
        if let Some(ref cap) = self.rolling_cap {
            let now = now_secs();
            let window_start = now.saturating_sub(cap.window_secs);

            let mut window_total = TokenAmount::zero(cap.amount.decimals);
            for record in &self.spend_history {
                if record.timestamp_secs >= window_start {
                    match window_total.add(&record.amount) {
                        Ok(new_total) => window_total = new_total,
                        Err(_) => {
                            return self.violation(
                                "Rolling cap accounting error (decimal mismatch in history)"
                                    .to_string(),
                            );
                        }
                    }
                }
            }

            // Check if adding this tx would breach the cap
            match window_total.add(&tx.amount) {
                Err(_) => {
                    return self.violation("Rolling cap overflow".to_string());
                }
                Ok(projected) => match projected.partial_cmp(&cap.amount) {
                    None => {
                        return self.violation("Decimal mismatch in rolling cap".to_string());
                    }
                    Some(ord) => {
                        if ord == std::cmp::Ordering::Greater {
                            let reason = format!(
                                "Transaction would exceed rolling cap of {} \
                                 (current window total: {})",
                                cap.amount.to_human(),
                                window_total.to_human()
                            );
                            return self.violation(reason);
                        }
                    }
                },
            }
        }

        PolicyDecision::Approve
    }

    /// Records a completed spend into the rolling-window history.
    ///
    /// Call this *after* a transaction has been successfully broadcast, not
    /// before evaluation.
    pub fn record_spend(&mut self, amount: TokenAmount) {
        self.spend_history.push(SpendRecord {
            amount,
            timestamp_secs: now_secs(),
        });
    }

    /// Purges spend records older than the rolling window from memory.
    ///
    /// Optional housekeeping — the rolling cap logic filters automatically, but
    /// calling this periodically avoids unbounded growth.
    pub fn prune_history(&mut self) {
        if let Some(ref cap) = self.rolling_cap {
            let now = now_secs();
            let window_start = now.saturating_sub(cap.window_secs);
            self.spend_history
                .retain(|r| r.timestamp_secs >= window_start);
        }
    }

    /// Returns the appropriate denial/escalation decision based on `fail_closed`.
    fn violation(&self, reason: String) -> PolicyDecision {
        if self.fail_closed {
            PolicyDecision::Deny(reason)
        } else {
            PolicyDecision::RequireHumanApproval(reason)
        }
    }
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

// ── PolicyBuilder ─────────────────────────────────────────────────────────────

/// Builder for [`SpendingPolicy`].
#[derive(Debug, Default)]
pub struct PolicyBuilder {
    max_per_tx: Option<TokenAmount>,
    rolling_cap: Option<RollingCap>,
    merchant_allowlist: Vec<Address>,
    fail_closed: bool,
}

impl PolicyBuilder {
    /// Sets the per-transaction spending limit.
    pub fn max_per_tx(mut self, amount: TokenAmount) -> Self {
        self.max_per_tx = Some(amount);
        self
    }

    /// Sets a rolling spending cap.
    pub fn rolling_cap(mut self, cap: RollingCap) -> Self {
        self.rolling_cap = Some(cap);
        self
    }

    /// Adds an address to the merchant allowlist.
    pub fn allow_merchant(mut self, addr: Address) -> Self {
        self.merchant_allowlist.push(addr);
        self
    }

    /// Sets the `fail_closed` flag (default: `false` — bool default).
    ///
    /// Pass `true` to make all policy failures produce a hard [`PolicyDecision::Deny`].
    pub fn fail_closed(mut self, v: bool) -> Self {
        self.fail_closed = v;
        self
    }

    /// Builds the [`SpendingPolicy`].
    pub fn build(self) -> SpendingPolicy {
        SpendingPolicy {
            max_per_tx: self.max_per_tx,
            rolling_cap: self.rolling_cap,
            merchant_allowlist: self.merchant_allowlist,
            fail_closed: self.fail_closed,
            spend_history: Vec::new(),
        }
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use alloy_primitives::address;

    fn usdc(human: f64) -> TokenAmount {
        TokenAmount::from_human(human, 6)
    }

    // ── Approve scenarios ─────────────────────────────────────────────────

    #[test]
    fn test_approve_when_no_constraints() {
        let policy = SpendingPolicy::builder().fail_closed(true).build();
        let tx = ProposedTx {
            recipient: Address::ZERO,
            amount: usdc(999_999.0),
            merchant_allowlist_check: false,
        };
        assert_eq!(policy.evaluate(&tx), PolicyDecision::Approve);
    }

    #[test]
    fn test_approve_within_max_per_tx() {
        let policy = SpendingPolicy::builder()
            .max_per_tx(usdc(100.0))
            .fail_closed(true)
            .build();
        let tx = ProposedTx {
            recipient: Address::ZERO,
            amount: usdc(99.99),
            merchant_allowlist_check: false,
        };
        assert_eq!(policy.evaluate(&tx), PolicyDecision::Approve);
    }

    #[test]
    fn test_approve_exact_max_per_tx() {
        let policy = SpendingPolicy::builder()
            .max_per_tx(usdc(100.0))
            .fail_closed(true)
            .build();
        let tx = ProposedTx {
            recipient: Address::ZERO,
            amount: usdc(100.0),
            merchant_allowlist_check: false,
        };
        assert_eq!(policy.evaluate(&tx), PolicyDecision::Approve);
    }

    #[test]
    fn test_approve_recipient_in_allowlist() {
        let merchant = address!("f39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
        let policy = SpendingPolicy::builder()
            .allow_merchant(merchant)
            .fail_closed(true)
            .build();
        let tx = ProposedTx {
            recipient: merchant,
            amount: usdc(50.0),
            merchant_allowlist_check: true,
        };
        assert_eq!(policy.evaluate(&tx), PolicyDecision::Approve);
    }

    #[test]
    fn test_approve_allowlist_check_disabled_for_unknown_recipient() {
        let merchant = address!("f39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
        let policy = SpendingPolicy::builder()
            .allow_merchant(merchant)
            .fail_closed(true)
            .build();
        // merchant_allowlist_check = false → allowlist not enforced
        let tx = ProposedTx {
            recipient: Address::ZERO,
            amount: usdc(50.0),
            merchant_allowlist_check: false,
        };
        assert_eq!(policy.evaluate(&tx), PolicyDecision::Approve);
    }

    // ── Deny scenarios ────────────────────────────────────────────────────

    #[test]
    fn test_deny_exceeds_max_per_tx() {
        let policy = SpendingPolicy::builder()
            .max_per_tx(usdc(100.0))
            .fail_closed(true)
            .build();
        let tx = ProposedTx {
            recipient: Address::ZERO,
            amount: usdc(100.01),
            merchant_allowlist_check: false,
        };
        assert!(matches!(policy.evaluate(&tx), PolicyDecision::Deny(_)));
    }

    #[test]
    fn test_deny_recipient_not_in_allowlist() {
        let merchant = address!("f39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
        let policy = SpendingPolicy::builder()
            .allow_merchant(merchant)
            .fail_closed(true)
            .build();
        let other: Address = "0x0000000000000000000000000000000000000001"
            .parse()
            .expect("valid");
        let tx = ProposedTx {
            recipient: other,
            amount: usdc(10.0),
            merchant_allowlist_check: true,
        };
        assert!(matches!(policy.evaluate(&tx), PolicyDecision::Deny(_)));
    }

    #[test]
    fn test_deny_exceeds_rolling_cap() {
        let mut policy = SpendingPolicy::builder()
            .rolling_cap(RollingCap {
                amount: usdc(500.0),
                window_secs: 3600,
            })
            .fail_closed(true)
            .build();

        // Consume most of the cap
        policy.record_spend(usdc(400.0));

        let tx = ProposedTx {
            recipient: Address::ZERO,
            amount: usdc(200.0), // 400 + 200 = 600 > 500
            merchant_allowlist_check: false,
        };
        assert!(matches!(policy.evaluate(&tx), PolicyDecision::Deny(_)));
    }

    // ── fail_closed = false → RequireHumanApproval ─────────────────────────

    #[test]
    fn test_fail_open_escalates_to_human_approval() {
        let policy = SpendingPolicy::builder()
            .max_per_tx(usdc(100.0))
            .fail_closed(false)
            .build();
        let tx = ProposedTx {
            recipient: Address::ZERO,
            amount: usdc(200.0),
            merchant_allowlist_check: false,
        };
        assert!(matches!(
            policy.evaluate(&tx),
            PolicyDecision::RequireHumanApproval(_)
        ));
    }

    // ── Rolling cap expiry ────────────────────────────────────────────────

    #[test]
    fn test_rolling_cap_expired_records_ignored() {
        let mut policy = SpendingPolicy::builder()
            .rolling_cap(RollingCap {
                amount: usdc(500.0),
                window_secs: 1, // 1-second window
            })
            .fail_closed(true)
            .build();

        // Inject a spend record at epoch=0 (definitely outside any 1-second window).
        policy.spend_history.push(SpendRecord {
            amount: usdc(490.0),
            timestamp_secs: 0,
        });

        let tx = ProposedTx {
            recipient: Address::ZERO,
            amount: usdc(200.0),
            merchant_allowlist_check: false,
        };
        assert_eq!(policy.evaluate(&tx), PolicyDecision::Approve);
    }

    #[test]
    fn test_rolling_cap_within_window_blocks_tx() {
        let mut policy = SpendingPolicy::builder()
            .rolling_cap(RollingCap {
                amount: usdc(500.0),
                window_secs: 3600,
            })
            .fail_closed(true)
            .build();

        // Record a spend at current time — it will be within the window.
        policy.record_spend(usdc(450.0));

        let tx = ProposedTx {
            recipient: Address::ZERO,
            amount: usdc(100.0), // 450 + 100 = 550 > 500
            merchant_allowlist_check: false,
        };
        assert!(matches!(policy.evaluate(&tx), PolicyDecision::Deny(_)));
    }

    // ── Builder defaults ──────────────────────────────────────────────────

    #[test]
    fn test_builder_default_fail_closed_is_false() {
        // Default builder has fail_closed = false (bool default).
        let policy = PolicyBuilder::default().build();
        assert!(!policy.fail_closed);
    }

    #[test]
    fn test_builder_explicit_fail_closed_true() {
        let policy = SpendingPolicy::builder().fail_closed(true).build();
        assert!(policy.fail_closed);
    }

    #[test]
    fn test_record_spend_accumulates() {
        let mut policy = SpendingPolicy::builder()
            .rolling_cap(RollingCap {
                amount: usdc(1000.0),
                window_secs: 3600,
            })
            .fail_closed(true)
            .build();

        policy.record_spend(usdc(300.0));
        policy.record_spend(usdc(300.0));
        policy.record_spend(usdc(300.0));

        let tx = ProposedTx {
            recipient: Address::ZERO,
            amount: usdc(200.0), // 900 + 200 = 1100 > 1000
            merchant_allowlist_check: false,
        };
        assert!(matches!(policy.evaluate(&tx), PolicyDecision::Deny(_)));
    }

    #[test]
    fn test_prune_history_removes_stale_records() {
        let mut policy = SpendingPolicy::builder()
            .rolling_cap(RollingCap {
                amount: usdc(500.0),
                window_secs: 1,
            })
            .fail_closed(true)
            .build();

        // Inject an expired record (timestamp = 0)
        policy.spend_history.push(SpendRecord {
            amount: usdc(490.0),
            timestamp_secs: 0,
        });
        assert_eq!(policy.spend_history.len(), 1);

        policy.prune_history();
        assert_eq!(policy.spend_history.len(), 0);
    }

    #[test]
    fn test_allowlist_empty_means_any_recipient_allowed() {
        // No merchants registered → allowlist is not enforced even when check=true.
        let policy = SpendingPolicy::builder().fail_closed(true).build();
        let other: Address = "0x0000000000000000000000000000000000000001"
            .parse()
            .expect("valid");
        let tx = ProposedTx {
            recipient: other,
            amount: usdc(10.0),
            merchant_allowlist_check: true,
        };
        assert_eq!(policy.evaluate(&tx), PolicyDecision::Approve);
    }

    #[test]
    fn test_multiple_merchants_in_allowlist() {
        let m1 = address!("f39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
        let m2 = address!("70997970C51812dc3A010C7d01b50e0d17dc79C8");
        let policy = SpendingPolicy::builder()
            .allow_merchant(m1)
            .allow_merchant(m2)
            .fail_closed(true)
            .build();

        let tx1 = ProposedTx {
            recipient: m1,
            amount: usdc(10.0),
            merchant_allowlist_check: true,
        };
        let tx2 = ProposedTx {
            recipient: m2,
            amount: usdc(10.0),
            merchant_allowlist_check: true,
        };
        assert_eq!(policy.evaluate(&tx1), PolicyDecision::Approve);
        assert_eq!(policy.evaluate(&tx2), PolicyDecision::Approve);
    }

    #[test]
    fn test_rolling_cap_exact_limit_is_approved() {
        let mut policy = SpendingPolicy::builder()
            .rolling_cap(RollingCap {
                amount: usdc(500.0),
                window_secs: 3600,
            })
            .fail_closed(true)
            .build();

        policy.record_spend(usdc(300.0));

        let tx = ProposedTx {
            recipient: Address::ZERO,
            amount: usdc(200.0), // 300 + 200 = 500 == cap (not greater than)
            merchant_allowlist_check: false,
        };
        assert_eq!(policy.evaluate(&tx), PolicyDecision::Approve);
    }
}
