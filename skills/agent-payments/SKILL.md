---
name: agent-payments
description: Enable agents to transact autonomously across a full multi-chain financial stack — x402 payments, Uniswap V3 swaps, CCTP bridging, ERC-8004 identity, mutual stake escrow, spending policies, and agent-to-agent delegation (AP2). Activate when an agent needs to pay for an API, swap tokens, bridge assets, escrow funds for a task, or establish on-chain identity.
version: 6.0.0
requires:
  tools: [bash, node]
  runtime: true
metrics:
  tracks: [payments_attempted, payments_succeeded, swaps_executed, bridges_initiated, escrows_created, spending_per_session, limit_enforcement_hits]
  improves: [payment_routing, limit_calibration, retry_strategy, swap_routing, bridge_selection]
---

# Agent Payments

## When to Use

Apply this skill when:

- An HTTP request returns `402 Payment Required`
- You need to call a premium API that requires per-request payment
- You're accessing a paid AI model, compute resource, or data service
- You need to purchase a resource (storage, credits, bandwidth) autonomously
- An agent-to-agent payment or task delegation is required (AP2 protocol)
- You need to swap tokens across Base, Arbitrum, Optimism, or Polygon
- You need to bridge USDC between EVM chains or to Solana (CCTP V2)
- You need to establish or verify on-chain agent identity (ERC-8004)
- You need to escrow funds for a multi-agent task (mutual stake or optimistic)
- Gas sponsorship is needed for a gasless user experience

**Skip when:**
- The service requires human authorization for payment (no wallet configured)
- The payment would exceed the configured spending limit (surface to operator)
- The service uses subscription billing (not per-request x402)
- The payment is above threshold for autonomous authorization (see limits)

**Decision tree:**
```
Is the response HTTP 402?
├── No  → Does the task require swap/bridge/escrow/identity?
│         ├── No  → This skill doesn't apply
│         └── Yes → Jump to the relevant section below
└── Yes → Is a wallet configured?
          ├── No  → Run setup (see Setup section)
          └── Yes → Does this payment fit within spending limits?
                    ├── No  → Queue via agentExecute or request human auth
                    └── Yes → Proceed with autonomous payment
```

## Background: x402 Protocol

The x402 protocol is a standard for machine-to-machine payments embedded in HTTP. When a server requires payment it returns:

```http
HTTP/1.1 402 Payment Required
X-Payment-Required: {"scheme":"exact","network":"base","maxAmountRequired":"1000000","asset":"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913","payTo":"0xMERCHANT","resource":"https://api.example.com/premium-endpoint","description":"1 API call"}
```

The agent then:
1. Constructs a payment matching the requirement
2. Submits the payment (on-chain or via payment channel)
3. Includes payment proof in the retry request
4. Server validates and processes the original request

Reference implementation: [agentpay-mcp](https://github.com/up2itnow0822/agentpay-mcp) (integrated into NVIDIA NeMo Agent Toolkit)

## Setup

### Install agentwallet-sdk

```bash
npm install agentwallet-sdk viem
```

### Supported Chains

Base, Ethereum, Arbitrum, Polygon, Optimism, Avalanche, Unichain, Linea, Sonic, World Chain, Base Sepolia (testnet). Solana is supported for CCTP V2 bridging.

## Core Methodology

### 1. Create Wallet + Set Spending Policy

Non-custodial ERC-6551 token-bound wallets are available on all 11 supported EVM chains. Spending limits are enforced by smart contract — the agent cannot override them.

```typescript
import { createWallet, setSpendPolicy, agentExecute, NATIVE_TOKEN } from 'agentwallet-sdk';

const wallet = createWallet({
  accountAddress: '0x...',
  chain: 'base',
  walletClient,            // viem WalletClient
});

// Set per-token, per-period on-chain spending limits
await setSpendPolicy(wallet, {
  token: NATIVE_TOKEN,
  perTxLimit: 25000000000000000n,    // 0.025 ETH per transaction
  periodLimit: 500000000000000000n,  // 0.5 ETH per period
  periodLength: 86400,               // 24-hour rolling period
});

// agentExecute auto-approves within limits, queues if over
const result = await agentExecute(wallet, {
  to: '0x...',
  value: 10000000000000000n,         // 0.01 ETH
});
```

**`agentExecute` behavior:**
- Within limits → executes immediately, returns transaction receipt
- Over limits → queues the payment, returns queue ID for human review
- Exceeded daily cap → returns `LIMIT_EXCEEDED` with details

### 2. x402 Payments (Multi-Chain)

```typescript
import { createX402Client } from 'agentwallet-sdk';

const x402 = createX402Client(wallet, {
  supportedNetworks: ['base:8453', 'arbitrum:42161'],
  globalDailyLimit: 10_000_000n,     // 10 USDC daily cap (6 decimals)
});

// Auto-detects network, handles 402 → pay → retry transparently
const response = await x402.fetch('https://api.example.com/premium');
const data = await response.json();
```

The client automatically:
- Parses the `X-Payment-Required` header
- Selects the cheapest supported network
- Constructs and submits the payment
- Retries the original request with proof

### 3. Token Swaps (Uniswap V3)

Available on Base, Arbitrum, Optimism, Polygon. Use the chain-specific token registries: `BASE_TOKENS`, `ARBITRUM_TOKENS`, `OPTIMISM_TOKENS`, `POLYGON_TOKENS`.

```typescript
import { attachSwap } from 'agentwallet-sdk/swap';
import { BASE_TOKENS } from 'agentwallet-sdk';

const swap = attachSwap(wallet, { chain: 'base' });

await swap.swap(
  BASE_TOKENS.WETH,
  BASE_TOKENS.USDC,
  amount,
  { slippageBps: 50 },              // 0.5% slippage tolerance
);
```

Token registries expose canonical addresses for all major tokens on each chain. Always use registry constants rather than hardcoding addresses.

### 4. CCTP V2 Bridge (EVM ↔ EVM and EVM ↔ Solana)

Bridge USDC across any supported chain pair, including to/from Solana.

```typescript
import { CCTPBridge } from 'agentwallet-sdk';

const bridge = new CCTPBridge({ sourceChain: 'base', walletClient });

const { transferId } = await bridge.transfer({
  destinationChain: 'arbitrum',      // or 'solana' for cross-ecosystem
  amount: 100_000_000n,              // 100 USDC (6 decimals)
  recipient: '0x...',
});

// Poll for settlement
const status = await bridge.getStatus(transferId);
```

### 5. ERC-8004 On-Chain Agent Identity

Register and manage verifiable on-chain identity for agents. Three registries: Identity, Reputation, Validation.

```typescript
import { AgentIdentity } from 'agentwallet-sdk';

const identity = new AgentIdentity({ chain: 'base', walletClient });

// Register agent identity
const { agentId } = await identity.register({
  name: 'my-agent',
  capabilities: ['payments', 'swaps', 'data-fetch'],
  metadataURI: 'ipfs://...',
});

// Verify another agent's identity before task delegation
const isValid = await identity.validate('0xAgentAddress');
```

### 6. Mutual Stake Escrow

Reciprocal collateral for agent-to-agent tasks. Both parties stake before work begins; funds release on verified completion.

```typescript
import { MutualStakeEscrow } from 'agentwallet-sdk';

const escrow = new MutualStakeEscrow({ chain: 'base', walletClient });

const { escrowId } = await escrow.create({
  counterparty: '0x...',
  token: '0xUSDC',
  stakeAmount: 100_000_000n,         // 100 USDC (6 decimals)
  taskHash: '0x...',
  deadline: Math.floor(Date.now() / 1000) + 86400,
});

// Release on verified completion
await escrow.release(escrowId, proofOfWork);
```

### 7. Optimistic Escrow

Time-locked escrow with challenge window. Funds release automatically after the lock period unless disputed.

```typescript
import { OptimisticEscrow } from 'agentwallet-sdk';

const escrow = new OptimisticEscrow({ chain: 'base', walletClient });

const { escrowId } = await escrow.create({
  beneficiary: '0x...',
  token: '0xUSDC',
  amount: 50_000_000n,
  lockPeriod: 3600,                  // 1-hour challenge window
  taskHash: '0x...',
});
```

### 8. AP2 Protocol — Agent-to-Agent Task Delegation

Delegate tasks to sub-agents with automatic payment on completion.

```typescript
import { AP2Client } from 'agentwallet-sdk';

const ap2 = new AP2Client({ chain: 'base', walletClient });

const { taskId } = await ap2.delegate({
  agent: '0xSubAgentAddress',
  task: { type: 'data-fetch', params: { url: 'https://...' } },
  maxPayment: 5_000_000n,            // 5 USDC ceiling
  escrowType: 'mutual-stake',
});

const result = await ap2.awaitCompletion(taskId);
```

### 9. Gas Sponsorship (ERC-4337 Paymaster)

Sponsor gas for agent transactions so end users never hold ETH.

```typescript
import { createWallet } from 'agentwallet-sdk';

const wallet = createWallet({
  accountAddress: '0x...',
  chain: 'base',
  walletClient,
  gasSponsorship: {
    enabled: true,
    paymasterUrl: 'https://...',     // ERC-4337 paymaster endpoint
  },
});
```

### 10. Fiat Onramp

Opt-in fiat-to-crypto conversion for wallets that need funding without manual crypto transfers.

```typescript
import { FiatOnramp } from 'agentwallet-sdk';

const onramp = new FiatOnramp({ chain: 'base', walletClient });

const { sessionUrl } = await onramp.createSession({
  targetToken: 'USDC',
  targetAmount: 100,                 // USD
  walletAddress: wallet.address,
});
// Redirect agent operator to sessionUrl for KYC/payment
```

### 11. On-Chain Settlement

Finalize multi-party payment flows with cryptographic settlement proof.

```typescript
import { Settlement } from 'agentwallet-sdk';

const settlement = new Settlement({ chain: 'base', walletClient });

await settlement.finalize({
  taskId: '0x...',
  parties: ['0xAgent1', '0xAgent2'],
  amounts: [80_000_000n, 20_000_000n],
  proofHash: '0x...',
});
```

## ClawPowers Enhancement

When `~/.clawpowers/` runtime is initialized, agent-payments gains persistent tracking across all transaction types.

**Persistent Payment Ledger:**

```bash
bash runtime/persistence/store.sh set "ledger:total_spent_today" "$(date +%Y-%m-%d):0.047"
bash runtime/persistence/store.sh list "payment:*:amount" | awk -F: '{sum += $NF} END {print "Total: $" sum}'
```

**Multi-Metric Session Tracking:**

```bash
bash runtime/metrics/collector.sh record \
  --skill agent-payments \
  --outcome success \
  --notes "payments: 3, swaps: 1, bridges: 0, session_spend: $0.047, limit: $5.00"
```

**Spending Analytics:**

`runtime/feedback/analyze.sh` computes:
- Total spend per day/week/month across all transaction types
- Most expensive APIs (payment frequency × amount)
- Swap slippage vs. configured tolerance
- Bridge utilization and latency
- Escrow open/close ratio
- Limit hit rate (how often limits block payments)
- Payment success rate (failed on-chain transactions)

## Security

**Private Key Security:**
- Keys are encrypted at rest via the ERC-6551 NFT-bound wallet
- Never printed to logs or surfaces
- Passphrase required to decrypt

**Spending Limit Enforcement:**
- `setSpendPolicy()` writes limits to the smart contract — the agent cannot override them
- `agentExecute()` queries the contract before submitting any transaction
- Over-limit transactions are queued, not silently dropped

**Audit Trail:**
- Every transaction generates an on-chain hash
- Payment logs in `~/.clawpowers/state/` are append-only
- Session spend is tracked against daily/session limits

## Anti-Patterns

| Anti-Pattern | Why It Fails | Correct Approach |
|-------------|-------------|-----------------|
| No spending limits configured | Unlimited liability, potential wallet drain | Always call `setSpendPolicy()` before `agentExecute()` |
| Hardcoding token addresses | Chain upgrades break integrations | Use `BASE_TOKENS`, `ARBITRUM_TOKENS`, etc. from the SDK |
| Skipping identity validation before AP2 delegation | Funds sent to unverified agent | Call `identity.validate()` before delegating tasks |
| Using optimistic escrow for high-value tasks | Challenge window may be too short | Use mutual stake escrow for tasks above risk threshold |
| Retrying failed payments without human review | Double-charge or infinite payment loop | Manual review required for any payment failure |
| Paying without verifying server response | Payment sent, service not rendered | Always check response status after x402 payment |
| Not logging swap/bridge transactions | No audit trail for reconciliation | Log every transaction hash via runtime persistence |
| Swapping with default slippage on volatile pairs | Front-run or excessive slippage | Set explicit `slippageBps` based on pair volatility |

## Protocol Fees (ClawPowers Only)

**These fees apply ONLY when using agent-payments through ClawPowers.** The standalone [agentwallet-sdk](https://www.npmjs.com/package/agentwallet-sdk) on npm is free with zero fees. You always have the choice to use the SDK directly.

ClawPowers agent-payments provides auto-configured wallets, guided payment flows, spending analytics, and runtime tracking. A transparent protocol fee applies:

| Monthly Volume | Fee |
|---------------|-----|
| $0 - $1,000 | 0.77% |
| $1,001 - $10,000 | 0.50% |
| $10,001 - $100,000 | 0.25% |
| $100,000+ | Custom |

Fees are:
- Applied at the protocol level (smart contract), not application level
- Visible in every transaction before confirmation
- Competitive with alternatives (MetaMask 0.875%, Stripe 2.9%, Nory 1%)
- Zero if you don't use agent-payments — the rest of ClawPowers is completely free

Fee collector: `0xff86829393C6C26A4EC122bE0Cc3E466Ef876AdD` (all EVM chains)

## References

- [agentwallet-sdk on npm](https://www.npmjs.com/package/agentwallet-sdk)
- [agentpay-mcp on GitHub](https://github.com/up2itnow0822/agentpay-mcp)
- [x402 protocol specification](https://x402.org)
- [ERC-6551 Token Bound Accounts](https://eips.ethereum.org/EIPS/eip-6551)
- [ERC-4337 Account Abstraction](https://eips.ethereum.org/EIPS/eip-4337)
- [CCTP V2 Documentation](https://developers.circle.com/stablecoins/cctp-getting-started)
- [NVIDIA NeMo Agent Toolkit integration](https://github.com/NVIDIA/NeMo-Agent-Toolkit-Examples/pull/17)

## Underlying Infrastructure

This skill is powered by [agentwallet-sdk v6.0](https://www.npmjs.com/package/agentwallet-sdk) — full multi-chain agent wallet stack:

- **ERC-6551 Non-custodial wallets** — Agent owns its keys via NFT-bound wallet on 11 chains
- **Smart-contract spending policies** — Per-token, per-period limits enforced at contract level
- **x402 multi-chain payments** — Auto network detection across Base, Arbitrum, Optimism, and more
- **Uniswap V3 swaps** — Base, Arbitrum, Optimism, Polygon with chain-specific token registries
- **CCTP V2 bridge** — EVM↔EVM and EVM↔Solana USDC bridging
- **ERC-8004 Agent Identity** — Identity, Reputation, and Validation registries
- **Mutual Stake & Optimistic Escrow** — Reciprocal and time-locked collateral for agent tasks
- **AP2 Protocol** — Agent-to-agent task delegation and payment
- **ERC-4337 Gas Sponsorship** — Paymaster integration for gasless transactions
- **Fiat Onramp** — Opt-in fiat-to-crypto conversion
- **On-chain Settlement** — Cryptographic finalization of multi-party payment flows

Integrated into [NVIDIA's official NeMo Agent Toolkit](https://github.com/NVIDIA/NeMo-Agent-Toolkit-Examples/pull/17).
