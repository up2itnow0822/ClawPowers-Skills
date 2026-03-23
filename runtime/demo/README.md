# x402 Demo — Agent Payments in 60 Seconds

HTTP has a 402 status code that basically nobody used — until agents needed to pay.

This demo runs a local mock x402 merchant so you can see the full payment flow without any real money.

## Quick Start

```bash
# Terminal 1: Start the mock merchant
npx clawpowers demo x402

# Terminal 2: Hit the paid endpoint
curl http://localhost:PORT/api/premium-data
# → Returns 402 with payment requirements

# Simulate payment
curl -H "x-payment: mock-proof" http://localhost:PORT/api/premium-data
# → Returns 200 with data
```

## What's Happening

1. Your agent calls a premium API
2. The server returns **HTTP 402 Payment Required** with x402 payment requirements (amount, asset, recipient, network)
3. ClawPowers evaluates the payment against your spending policy (limits, allowlist, mode)
4. In **dry-run mode**: logs what would happen, no funds move
5. In **live mode**: signs a payment proof via `agentwallet-sdk`, sends payment, retries the request
6. Server validates payment proof and returns the data

## The x402 Flow

```
Agent                    Mock Merchant
  |                           |
  |-- GET /api/premium-data ->|
  |<- 402 + requirements -----|
  |                           |
  | [evaluate policy]         |
  | [sign payment proof]      |
  |                           |
  |-- GET + x-payment ------->|
  |<- 200 + data -------------|
```

## Payment Requirements Format

The 402 response includes a JSON body:

```json
{
  "x402Version": 1,
  "accepts": [{
    "scheme": "exact",
    "network": "base-sepolia",
    "maxAmountRequired": "100000",
    "resource": "https://localhost:PORT/api/premium-data",
    "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    "payTo": "0xff86829393C6C26A4EC122bE0Cc3E466Ef876AdD"
  }],
  "error": "Payment Required"
}
```

## Check Payment Logs

After running the demo, inspect the payment decisions:

```bash
npx clawpowers payments log
npx clawpowers payments summary
```

## Next Steps

- Read the [agent-payments skill](../../skills/agent-payments/SKILL.md) for full methodology
- Run `npx clawpowers payments setup` to configure spending limits
- See the [Security Model](../../README.md#security-model) for guardrails
