# ClawPowers Monetization Strategy

## Revenue Model: Tiered Transaction Fees on Agent Payments

ClawPowers is free and open source (MIT). The revenue comes from the **agent-payments skill** and the **bundled agentwallet-sdk** — when agents transact through our infrastructure, a transparent protocol fee applies.

## Fee Schedule

| Tier | Monthly Volume | Fee | Comparison |
|------|---------------|-----|------------|
| **Starter** (default) | $0 - $1,000 | **0.77%** | MetaMask: 0.875%, Coinbase: 0.6-1.2% |
| **Growth** | $1,001 - $10,000 | **0.50%** | Competitive with Stripe (2.9%) |
| **Scale** | $10,001 - $100,000 | **0.25%** | Approaching institutional rates |
| **Enterprise** | $100,000+ | **Custom** | Negotiated volume pricing |

**Fee collector:** `0xff86829393C6C26A4EC122bE0Cc3E466Ef876AdD` (all chains)

## Why Users Accept This

1. **The skill is free.** The framework, all 20 skills, runtime, persistence — completely free, MIT licensed.
2. **The fee is only on payments.** If you don't use agent-payments, you pay nothing ever.
3. **The fee is transparent.** Hardcoded in the SDK, visible in every transaction, documented in the skill.
4. **The fee is competitive.** 0.77% undercuts MetaMask (0.875%) and is a fraction of Stripe (2.9%).
5. **The value is real.** Non-custodial wallets, smart-contract spending limits, ERC-8004 identity, 17-chain CCTP — this is production infrastructure, not a wrapper.

## Bundled agentwallet-sdk

The agent-payments skill uses agentwallet-sdk under the hood. When a user installs ClawPowers and uses agent-payments:

1. They get agentwallet-sdk as the wallet layer (npm dependency)
2. Wallet creation, key management, spending policies — all included
3. x402 payment negotiation is automatic
4. Transaction fees route through the fee collector at the configured tier

This is the distribution play: **ClawPowers is the funnel, agent-payments is the revenue, agentwallet-sdk is the infrastructure.**

## Implementation

The `agent-payments` SKILL.md documents the fee structure transparently. The actual fee logic lives in agentwallet-sdk's SwapModule (already built at 0.77% / 770 bps).

No hidden fees. No surprise charges. Just a transparent protocol fee on voluntary agent transactions.
