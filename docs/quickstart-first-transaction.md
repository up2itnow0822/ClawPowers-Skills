# 5-Minute First Transaction

Get your AI agent sending real (testnet) transactions in under 5 minutes.
Two paths — pick the one that matches your stack.

> **Testnet only.** Both paths use **Base Sepolia** so no real money moves.
> Switch `CHAIN_NAME=base` when you're ready for mainnet.

---

## Prerequisites

1. **Testnet wallet** — any EOA private key (generate one with `cast wallet new` from Foundry, or MetaMask)
2. **Deployed AgentAccountV2** — run `npx clawpowers payments setup` for the interactive wizard
3. **Base Sepolia ETH (gas)** — free from [https://www.coinbase.com/faucets/base-ethereum-goerli-faucet](https://www.coinbase.com/faucets/base-ethereum-goerli-faucet)

---

## .env Setup

Create a `.env` file (never commit this):

```bash
# .env — agent wallet config
AGENT_PRIVATE_KEY=0x...       # EOA signing key (32-byte hex)
AGENT_WALLET_ADDRESS=0x...    # AgentAccountV2 contract address
CHAIN_NAME=base-sepolia       # Use Base Sepolia for testing
RPC_URL=https://sepolia.base.org

# Spending limits (USDC, 6 decimals)
SPEND_LIMIT_PER_TX=1.00       # Max USDC per single transaction
SPEND_LIMIT_DAILY=10.00       # Max USDC per 24-hour period
```

---

## Path A: JavaScript (agentwallet-sdk direct)

**Under 10 lines.** Uses the `walletFromEnv()` convenience wrapper so there's
no viem boilerplate.

```bash
npm install agentwallet-sdk dotenv
```

```javascript
// first-tx.mjs
import 'dotenv/config';
import { walletFromEnv, setPolicyFromEnv, agentExecute } from 'agentwallet-sdk';

const wallet = await walletFromEnv();           // reads AGENT_PRIVATE_KEY + AGENT_WALLET_ADDRESS
await setPolicyFromEnv(wallet);                 // applies SPEND_LIMIT_PER_TX + SPEND_LIMIT_DAILY

const result = await agentExecute(wallet, {
  to: '0x000000000000000000000000000000000000dEaD', // burn address (safe test target)
  value: 1n,                                         // 1 wei — near-zero cost
});

console.log(`✅ txHash: ${result.txHash}`);
console.log(`   executed immediately: ${result.executed}`);
```

```bash
node first-tx.mjs
```

**Expected output:**
```
✅ txHash: 0x3a7f...c9e2
   executed immediately: true
```

> If `executed: false` — the transaction was queued for owner approval because
> the amount exceeded your spend policy. Approve it with:
> ```bash
> node -e "
> import('agentwallet-sdk').then(async ({ walletFromEnv, getPendingApprovals, approveTransaction }) => {
>   const w = walletFromEnv();
>   const pending = await getPendingApprovals(w);
>   if (pending.length > 0) await approveTransaction(w, pending[0].txId);
>   console.log('Approved');
> });
> "
> ```

### What just happened

1. `walletFromEnv()` read your private key from `AGENT_PRIVATE_KEY`, connected
   to Base Sepolia via `RPC_URL`, and instantiated the `AgentAccountV2` smart
   wallet at `AGENT_WALLET_ADDRESS`.
2. `setPolicyFromEnv()` wrote a spend policy on-chain: USDC transfers up to
   `SPEND_LIMIT_PER_TX` per tx and `SPEND_LIMIT_DAILY` per day execute
   autonomously. Anything above is queued.
3. `agentExecute()` called `agentExecute()` on the smart contract, which checked
   the native ETH policy and sent 1 wei to the burn address.
4. The tx hash was returned immediately — you can verify it on
   [https://sepolia.basescan.org](https://sepolia.basescan.org/tx/{txHash}).

---

## Path B: Python (via agentpay-mcp over MCP)

**Under 15 lines.** Uses the official `mcp` Python SDK to connect to the
`agentpay-mcp` server and call `send_payment` over the Model Context Protocol.

```bash
pip install mcp python-dotenv
npx clawpowers mcp start   # starts agentpay-mcp on stdio or a local port
```

```python
# first_tx.py
import asyncio
import os
from dotenv import load_dotenv
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

load_dotenv()

async def main():
    server = StdioServerParameters(
        command="npx",
        args=["agentpay-mcp"],
        env={**os.environ},     # passes AGENT_PRIVATE_KEY, AGENT_WALLET_ADDRESS, etc.
    )
    async with stdio_client(server) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()

            result = await session.call_tool("send_payment", {
                "to": "0x000000000000000000000000000000000000dEaD",
                "amount": "0.001",          # USDC
                "asset": "USDC",
                "chain": "base-sepolia",
                "reason": "first transaction test",
            })
            print(f"✅ txHash: {result.content[0].text}")

asyncio.run(main())
```

```bash
python first_tx.py
```

**Expected output:**
```
✅ txHash: 0x8b2d...f410
```

### What just happened

1. `stdio_client` spawned `agentpay-mcp` as a subprocess — the MCP server
   loaded your `.env` credentials and connected to Base Sepolia.
2. `session.call_tool("send_payment", ...)` sent an MCP tool call over stdio,
   which the server translated into an `agentTransferToken()` call on your
   `AgentAccountV2` smart wallet.
3. The server returned the transaction hash, which you can verify at
   [https://sepolia.basescan.org](https://sepolia.basescan.org).

> **Python + MCP** is ideal when your agent framework is Python-based
> (LangChain, AutoGen, CrewAI) and you want to avoid writing viem/TypeScript.
> The MCP server handles all wallet logic; your Python code just calls tools.

---

## Verify Your Transaction

Both paths produce a `txHash`. Verify on-chain:

```bash
# Quick verification via cast (Foundry)
cast tx $TX_HASH --rpc-url https://sepolia.base.org

# Or open in browser
echo "https://sepolia.basescan.org/tx/$TX_HASH"
```

---

## Next Steps

| Goal | Resource |
|------|----------|
| Set up x402 automatic payments | `skills/agent-payments/SKILL.md` |
| Enable premium enrichment in prospecting | `skills/prospecting/SKILL.md` → "Premium Enrichment" section |
| Post a task bounty for another agent | `skills/agent-bounties/SKILL.md` |
| Review payment history | `npx clawpowers payments log` |
| Configure spending limits interactively | `npx clawpowers payments setup` (setup wizard) |
| Demo — see the full x402 flow in 60s | `runtime/demo/README.md` |

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| `AGENT_PRIVATE_KEY environment variable is required` | Check your `.env` file exists and is loaded |
| `Unsupported chain: base-sepolia` | Ensure `agentwallet-sdk` is v0.3+ |
| `executed: false` (queued) | Amount > spend policy; lower `SPEND_LIMIT_PER_TX` or approve manually |
| `insufficient funds` | Get Base Sepolia ETH from the faucet link above |
| `nonce too low` | Another tx is pending; wait for confirmation or reset nonce |
| MCP: `spawn npx ENOENT` | Run `npm install -g agentpay-mcp` or use `npx --yes` |
