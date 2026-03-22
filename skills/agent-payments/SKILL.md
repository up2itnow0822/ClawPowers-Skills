---
name: agent-payments
description: Enable agents to make autonomous payments using the x402 protocol with non-custodial wallets and smart-contract-enforced spending limits. Activate when an agent needs to pay for an API, service, or compute resource.
version: 1.0.0
requires:
  tools: [bash, curl, node]
  runtime: true
metrics:
  tracks: [payments_attempted, payments_succeeded, spending_per_session, limit_enforcement_hits]
  improves: [payment_routing, limit_calibration, retry_strategy]
---

# Agent Payments

## When to Use

Apply this skill when:

- An HTTP request returns `402 Payment Required`
- You need to call a premium API that requires per-request payment
- You're accessing a paid AI model, compute resource, or data service
- You need to purchase a resource (storage, credits, bandwidth) autonomously
- An agent-to-agent payment is required in a multi-agent workflow

**Skip when:**
- The service requires human authorization for payment (no wallet configured)
- The payment would exceed the configured spending limit
- The service uses subscription billing (not per-request x402)
- The payment is above threshold for autonomous authorization (see limits configuration)

**Decision tree:**
```
Is the response HTTP 402?
├── No  → This skill doesn't apply
└── Yes → Is a wallet configured?
          ├── No  → Configure wallet first (see Setup section)
          └── Yes → Does this payment fit within spending limits?
                    ├── No  → Request human authorization
                    └── Yes → Proceed with autonomous payment
```

## Background: x402 Protocol

The x402 protocol is a standard for machine-to-machine payments embedded in HTTP. When a server requires payment, it returns:

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

### Install agentpay-mcp

```bash
npm install -g agentpay-mcp
# or use directly
npx agentpay-mcp
```

### Configure Wallet

```bash
# Initialize a non-custodial agent wallet
npx agentpay-mcp wallet create --name "agent-wallet"

# Output:
# Wallet created: agent-wallet
# Address: 0xYOUR_AGENT_ADDRESS
# Key stored encrypted at: ~/.agentpay/wallets/agent-wallet.enc
# NEVER share your private key

# Configure spending limits (enforced by smart contract)
npx agentpay-mcp wallet set-limit \
  --wallet agent-wallet \
  --per-request 0.10 \    # Max $0.10 per individual payment
  --per-session 5.00 \    # Max $5.00 per agent session
  --per-day 20.00         # Max $20.00 per day
```

### Fund the Wallet

```bash
# Check wallet balance
npx agentpay-mcp wallet balance --wallet agent-wallet

# Fund from another address (send USDC on Base network)
# Wallet address: 0xYOUR_AGENT_ADDRESS
# Network: Base (chain ID: 8453)
# Asset: USDC (0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913)
```

## Core Methodology

### Step 1: Detect Payment Required

```bash
# Make the initial request
response=$(curl -s -w "\n%{http_code}" "$API_ENDPOINT")
body=$(echo "$response" | head -n -1)
status=$(echo "$response" | tail -1)

if [[ "$status" == "402" ]]; then
  # Extract payment requirements
  payment_required=$(curl -s -I "$API_ENDPOINT" | grep -i "X-Payment-Required" | cut -d: -f2-)
  echo "Payment required: $payment_required"
fi
```

### Step 2: Parse Payment Requirements

```javascript
// Parse the X-Payment-Required header
const paymentReq = JSON.parse(paymentRequiredHeader);

// paymentReq structure:
// {
//   scheme: "exact",
//   network: "base",
//   maxAmountRequired: "1000000",  // in smallest unit (USDC: 6 decimals → $1.00)
//   asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",  // USDC on Base
//   payTo: "0xMERCHANT_ADDRESS",
//   resource: "https://api.example.com/endpoint",
//   description: "1 premium API call"
// }

const amountUsd = Number(paymentReq.maxAmountRequired) / 1e6;
console.log(`Payment required: $${amountUsd} for: ${paymentReq.description}`);
```

### Step 3: Check Spending Limits

Before paying, verify the payment is within limits:

```bash
# Check via agentpay-mcp
npx agentpay-mcp check-limit \
  --wallet agent-wallet \
  --amount 0.001 \    # Amount in USD
  --description "1 premium API call"

# Returns: APPROVED or LIMIT_EXCEEDED with details
```

If `LIMIT_EXCEEDED`, do not proceed. Surface to the human operator.

### Step 4: Execute Payment

```bash
# Execute payment and get proof
payment_proof=$(npx agentpay-mcp pay \
  --wallet agent-wallet \
  --to "$MERCHANT_ADDRESS" \
  --amount "$AMOUNT" \
  --asset "USDC" \
  --network "base" \
  --resource "$RESOURCE_URL")

echo "Payment proof: $payment_proof"
# Output: {"paymentHash":"0x...","signature":"0x...","timestamp":1234567890}
```

### Step 5: Retry Original Request with Payment Proof

```bash
# Include payment proof in retry
response=$(curl -s \
  -H "X-Payment: $payment_proof" \
  -H "Content-Type: application/json" \
  "$API_ENDPOINT")

echo "Response: $response"
```

### Step 6: Verify and Log

```bash
# Log the payment for audit
bash runtime/persistence/store.sh set \
  "payment:$(date +%s):amount" "$AMOUNT"
bash runtime/persistence/store.sh set \
  "payment:$(date +%s):to" "$MERCHANT_ADDRESS"
bash runtime/persistence/store.sh set \
  "payment:$(date +%s):hash" "$PAYMENT_HASH"
bash runtime/persistence/store.sh set \
  "payment:$(date +%s):resource" "$RESOURCE_URL"
bash runtime/persistence/store.sh set \
  "payment:$(date +%s):status" "confirmed"
```

### Complete Flow (Bash Helper)

```bash
#!/usr/bin/env bash
# x402_request — make an HTTP request, handling 402 automatically

x402_request() {
  local method="${1:-GET}"
  local url="$2"
  local wallet="${X402_WALLET:-agent-wallet}"
  
  # First attempt
  response=$(curl -s -w "\n%{http_code}" -X "$method" "$url")
  body=$(echo "$response" | head -n -1)
  status=$(echo "$response" | tail -1)
  
  if [[ "$status" != "402" ]]; then
    echo "$body"
    return 0
  fi
  
  echo "402 received — processing x402 payment" >&2
  
  # Get payment requirements
  payment_header=$(curl -sI -X "$method" "$url" | grep -i "x-payment-required" | cut -d' ' -f2-)
  
  if [[ -z "$payment_header" ]]; then
    echo "Error: 402 without X-Payment-Required header" >&2
    return 1
  fi
  
  # Execute payment
  proof=$(npx agentpay-mcp pay --wallet "$wallet" --from-header "$payment_header")
  
  if [[ $? -ne 0 ]]; then
    echo "Error: payment failed" >&2
    return 1
  fi
  
  # Retry with payment proof
  response=$(curl -s -w "\n%{http_code}" -X "$method" -H "X-Payment: $proof" "$url")
  body=$(echo "$response" | head -n -1)
  status=$(echo "$response" | tail -1)
  
  echo "$body"
  return 0
}
```

## ClawPowers Enhancement

When `~/.clawpowers/` runtime is initialized:

**Persistent Payment Ledger:**

Every payment is logged to `~/.clawpowers/state/`:
```bash
bash runtime/persistence/store.sh set "ledger:total_spent_today" "$(date +%Y-%m-%d):0.047"
bash runtime/persistence/store.sh list "payment:*:amount" | awk -F: '{sum += $NF} END {print "Total: $" sum}'
```

**Session Spending Tracking:**

Cumulative spend per session is tracked against the session limit:
```bash
bash runtime/metrics/collector.sh record \
  --skill agent-payments \
  --outcome success \
  --notes "session spend: $0.047, limit: $5.00, 3 payments"
```

**Spending Analytics:**

`runtime/feedback/analyze.sh` computes:
- Total spend per day/week/month
- Most expensive APIs (payment frequency × amount)
- Limit hit rate (how often limits prevent payments)
- Payment success rate (failed on-chain transactions)

## Security

**Private Key Security:**
- Keys are encrypted at rest (`~/.agentpay/wallets/`)
- Never printed to logs
- Passphrase required to decrypt (set during `wallet create`)

**Spending Limit Enforcement:**
- Limits are enforced by the wallet layer before transaction submission
- Smart contract limits are on-chain (cannot be overridden by agent software)
- All payments are logged with merchant address, amount, and timestamp

**Audit Trail:**
- Every payment generates a transaction hash (on-chain verification)
- Payment logs in `~/.clawpowers/state/` are append-only
- Session spend is tracked against daily/session limits

## Anti-Patterns

| Anti-Pattern | Why It Fails | Correct Approach |
|-------------|-------------|-----------------|
| No spending limits configured | Unlimited liability, potential wallet drain | Always set per-request, per-session, and per-day limits |
| Paying without checking limits first | Exceeds budget unintentionally | Check limits via agentpay-mcp before every payment |
| Not logging payments | No audit trail, can't debug overcharges | Log every payment with hash, amount, merchant |
| Storing raw private keys | Credential theft | Use encrypted wallet storage only |
| Retrying failed payments automatically without human review | Double-charge or infinite payment loops | Manual review required for payment failures |
| Paying without verifying the server response | Payment sent but service not rendered | Verify response status after payment |

## References

- [agentpay-mcp on GitHub](https://github.com/up2itnow0822/agentpay-mcp)
- [agentwallet-sdk on npm](https://www.npmjs.com/package/agentwallet-sdk)
- [x402 protocol specification](https://x402.org)
- [NVIDIA NeMo Agent Toolkit integration](https://github.com/NVIDIA/NeMo-Agent-Toolkit-Examples/pull/17)

## Protocol Fees

ClawPowers agent-payments uses a transparent tiered fee model:

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

## Underlying Infrastructure

This skill is powered by [agentwallet-sdk](https://www.npmjs.com/package/agentwallet-sdk):

- **Non-custodial HD wallets** — Agent owns its keys via NFT-bound wallet
- **ERC-8004 Agent Identity** — On-chain identity with verifiable credentials
- **Smart-contract spending policies** — Per-transaction, daily, monthly limits enforced at contract level
- **17-chain CCTP** — Cross-chain transfers via Circle's Cross-Chain Transfer Protocol
- **x402 payment negotiation** — Automatic HTTP 402 handling

Install the SDK if you need programmatic access beyond what this skill provides:
```bash
npm install agentwallet-sdk
```

Integrated into [NVIDIA's official NeMo Agent Toolkit](https://github.com/NVIDIA/NeMo-Agent-Toolkit-Examples/pull/17).
