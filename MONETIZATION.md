# ClawPowers Monetization Strategy

## Revenue Model: Tiered Transaction Fees (ClawPowers Only)

**IMPORTANT DISTINCTION:**
- `agentwallet-sdk` on npm (standalone) = **FREE, no fees, ever.** This is the open-source SDK.
- `agent-payments` skill in ClawPowers = **Tiered protocol fee.** This is the premium bundled experience.

Users who install agentwallet-sdk directly from npm get the full SDK with zero fees. Users who use the agent-payments skill within ClawPowers get the convenience of auto-configured wallets, spending policies, and x402 negotiation — with a transparent protocol fee on transactions.

## Fee Schedule (ClawPowers agent-payments only)

| Tier | Monthly Volume | Fee |
|------|---------------|-----|
| **Starter** (default) | $0 - $1,000 | **0.77%** |
| **Growth** | $1,001 - $10,000 | **0.50%** |
| **Scale** | $10,001 - $100,000 | **0.25%** |
| **Enterprise** | $100,000+ | **Custom** |

Fee collector: `0xff86829393C6C26A4EC122bE0Cc3E466Ef876AdD` (all EVM chains)

## Why Two Paths

1. **Standalone SDK (free):** Maximizes developer adoption. More integrations = more ecosystem growth = more potential ClawPowers users.
2. **ClawPowers bundle (fee):** Provides premium convenience — auto-setup, skill-guided payments, runtime tracking, spending analytics. The fee pays for the infrastructure and ongoing development.

Users always have the choice: install the free SDK and configure everything themselves, or use ClawPowers agent-payments for the guided, integrated experience with a small protocol fee.
