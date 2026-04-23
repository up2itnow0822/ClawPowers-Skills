# ClawPowers

> **Hermes-compatible branch note:** this branch only claims Hermes compatibility for the validated skill bundles exported under top-level `skills/`. Today that means `skills/itp/`.
>
> The broader `clawpowers` npm library, including wallet, payments, RSI, memory, and swarm modules, remains a separate library/runtime surface and is **not** part of this branch's Hermes-native compatibility claim.

See [HERMES_COMPATIBILITY.md](./HERMES_COMPATIBILITY.md) for the exact support contract.

**Launch surface:** `clawpowers` is the capability library. It is not the stock OpenClaw wrapper runtime. For the wrapper runtime, install `clawpowers-agent`.

## Canonical Links
- Product site: https://clawpowers.ai
- Docs: https://clawpowers.ai/docs
- Agent runtime: https://clawpowers.ai/agent

**Recommended pairing:** `clawpowers` 2.2.x with `clawpowers-agent` 1.1.x.

**More docs:** [SECURITY](./SECURITY.md) · [Compatibility](./COMPATIBILITY.md) · [Known Limitations](./KNOWN_LIMITATIONS.md) · [Licensing](./LICENSING.md) · [Releasing](./RELEASING.md) · [Demo](./DEMO.md) · [Roadmap](./ROADMAP.md)

**Skills library for AI agents — payments, memory, RSI, wallet, parallel swarm, ITP.** Drop-in capability layer for any agent framework.

[![npm version](https://img.shields.io/npm/v/clawpowers)](https://www.npmjs.com/package/clawpowers)
[![License: BSL 1.1](https://img.shields.io/badge/License-BSL%201.1-blue.svg)](LICENSE)
[![CI](https://github.com/up2itnow0822/ClawPowers-Skills/actions/workflows/ci.yml/badge.svg)](https://github.com/up2itnow0822/ClawPowers-Skills/actions/workflows/ci.yml)

```bash
npm install clawpowers
```

## 60-Second Demo

```bash
npm install clawpowers
node -e "
const { generateWallet, detect402, SpendingPolicy, signMessage } = await import('clawpowers');

// 1. Generate a real Ethereum wallet (MetaMask-compatible)
const wallet = await generateWallet({ chain: 'base', dataDir: './demo-wallet' });
console.log('Address:', wallet.address);

// 2. Detect an x402 payment-required response
const req = detect402({ status: 402, headers: {
  'x-payment-amount': '0.10',
  'x-payment-currency': 'USD',
  'x-payment-recipient': '0xabc',
  'x-payment-network': 'base'
}});
console.log('Payment required:', req);

// 3. Enforce a spending policy
const policy = new SpendingPolicy({ dailyLimitUsd: 25, allowedDomains: ['api.example.com'] });
console.log('Allowed:', policy.checkTransaction(0.10, 'api.example.com').allowed);
"
```

That's a real Ethereum wallet, real x402 detection, and a real spending policy check — all in 60 seconds, zero config, zero Rust toolchain. The `native/` Rust acceleration is optional; the WASM tier ships pre-built in the npm package.

> **⚠️ Patent Pending:** The x402 payment detection, autonomous spending policy enforcement, and recursive self-improvement (RSI) systems described in this library are subject to pending patent applications. Use is governed by the BSL 1.1 license.

---

## What Is This?

ClawPowers extracts the core capabilities from [ClawPowers-Agent](https://github.com/up2itnow0822/ClawPowers-Agent) into a standalone library. **No agent control loop** — bring your own agent framework and get:

That separation is intentional:

- **`clawpowers`** owns the shared capability implementation.
- **`clawpowers-agent`** owns the stock OpenClaw wrapper runtime.
- Downstream wrappers should consume this package rather than duplicating capability logic.

- **x402 Payments** — Detect HTTP 402 responses, enforce spending policies, execute payments
- **Three-Tier Memory** — Working, episodic, procedural memory with crash recovery
- **RSI Engine** — Metrics collection, hypothesis generation, mutation, A/B testing
- **Wallet** — Generate, import, and sign with **MetaMask-compatible** Ethereum addresses out of the box (secp256k1 + Keccak-256 via pre-built WASM, no Rust toolchain required)
- **Skills** — Discover, load, and track skill execution outcomes
- **Parallel Swarm** — Concurrent task execution with intelligent model routing and token budgeting
- **ITP (Identical Twins Protocol)** — Context compression that eliminates redundant token usage across agent sessions

## Native Acceleration

ClawPowers ships the same optional **Rust + WASM + PyO3** stack as [ClawPowers-Agent](https://github.com/up2itnow0822/ClawPowers-Agent), exposed through a **3-tier loader** in TypeScript. **v2.2.0+:** when a native `.node` addon is present, the WASM bundle is still loaded if available so helpers such as secp256k1 stay available even if your local addon predates those exports; `getActiveTier()` remains `native` in that case.

| Tier | Backend | When it loads |
|------|---------|----------------|
| **1 — Native** | `napi-rs` `.node` addon (`native/ffi`, built locally with Rust) | Fastest; optional — not required for npm installs |
| **2 — WASM** | Pre-built `native/wasm/pkg-node` (and `pkg` for web) | **Default** for most Node.js installs — no `wasm-pack` or Rust needed |
| **3 — TypeScript** | Pure JS / Node built-ins | Universal fallback when native and WASM are unavailable |

Check status in code:

```typescript
import { getActiveTier, isNativeAvailable, isWasmAvailable, getCapabilitySummary } from 'clawpowers';

console.log(getActiveTier()); // 'native' | 'wasm' | 'typescript'
console.log(isNativeAvailable(), isWasmAvailable());
console.log(getCapabilitySummary());
```

### Building native / WASM locally

**Requirements (optional):** Rust (`rustc` 1.70+), `wasm-pack` for regenerating WASM bindings.

```bash
npm run build:native   # workspace `cargo build --release` (ignored if Rust missing)
npm run build:wasm     # wasm-pack → native/wasm/pkg-node (optional)
```

`npm run build:wasm` automatically removes `native/wasm/pkg-node/.gitignore` after generation so Node-targeted WASM artifacts are always packable.

Pre-built `.wasm` artifacts are included in the package so consumers are **not** required to run `wasm-pack`.

### Module coverage (aligned with ClawPowers-Agent)

| Area | Tier 1 / 2 capability | TypeScript fallback |
|------|------------------------|---------------------|
| Payments | `JsFeeSchedule`, WASM fee math | Pure-TS fee formula |
| Payments | `JsX402Client` | Base64 JSON header |
| Payments | `JsAgentWallet` (native only) | TS wallet + WASM secp256k1 + Keccak for real Ethereum addresses |
| Memory | `JsCanonicalStore`, `JsTurboCompressor`, `JsWriteFirewall` | File/JSONL memory; simplified firewall |
| Wallet / secp256k1 | Native + WASM: `deriveEthereumAddress`, `derivePublicKey`, `signEcdsa`, `verifyEcdsa`, `computeKeccak256` / `keccak256Bytes` | Tier 3: legacy digest-based “address” + HMAC signing fallback only |

Exported helpers include `calculateTransactionFee`, `createPaymentHeader`, `generateWalletAddress`, `compressVector`, `getBestCanonicalStore`, `digestForWalletAddress`, and the full loader API in `src/native/index.ts`.

## x402 Payment Flow

```
┌─────────┐     ┌──────────────┐     ┌───────────────┐     ┌──────────┐
│  Agent   │────▶│  API Server  │────▶│   detect402() │────▶│ Spending │
│          │     │  returns 402 │     │  parse x402   │     │  Policy  │
└─────────┘     └──────────────┘     │   headers     │     │  check   │
                                     └───────────────┘     └────┬─────┘
                                                                │
                                              ┌─────────────────▼─────────────────┐
                                              │         PaymentExecutor           │
                                              │  ┌───────────┐  ┌─────────────┐  │
                                              │  │ MCP Client │  │ Audit Log   │  │
                                              │  │ (agentpay) │  │ (append-only│  │
                                              │  └─────┬─────┘  └─────────────┘  │
                                              └───────┬───────────────────────────┘
                                                      │
                                              ┌───────▼───────┐
                                              │  Base Network  │
                                              │  USDC Payment  │
                                              └───────────────┘
```

## Framework Compatibility

| Framework | Integration | Example |
|-----------|------------|---------|
| **LangChain** | `DynamicStructuredTool` | [`demos/langchain.ts`](demos/langchain.ts) |
| **Claude Code** | `CLAUDE.md` config | [`demos/claude-code.md`](demos/claude-code.md) |
| **ElizaOS** | Plugin pattern | [`demos/elizaos.ts`](demos/elizaos.ts) |
| **AutoGPT** | Direct import | See examples below |
| **CrewAI** | Tool wrapper | See examples below |
| **Custom** | Direct TypeScript import | See examples below |

## Quick Start

### Payments

```typescript
import { SpendingPolicy, PaymentExecutor, detect402 } from 'clawpowers';

// Configure spending limits
const policy = new SpendingPolicy({
  dailyLimit: 25,        // $25/day
  transactionLimit: 10,  // $10 per tx
  allowedDomains: ['api.example.com'],
});

// Create executor with your MCP client
const executor = new PaymentExecutor(policy, mcpClient);

// Detect and handle 402 responses
const payment = detect402({ status: 402, headers: responseHeaders });
if (payment) {
  const result = await executor.executePayment({
    amount: payment.amount,
    currency: payment.currency,
    recipient: payment.recipient,
    domain: 'api.example.com',
    x402Headers: payment.x402Headers,
  });
}
```

### Memory

```typescript
import { EpisodicMemory, ProceduralMemory, ContextInjector } from 'clawpowers';

// Episodic: Task history (append-only JSONL)
const episodic = new EpisodicMemory('~/.clawpowers/memory/episodic.jsonl');
await episodic.append({
  taskId: 'task-1',
  timestamp: new Date().toISOString(),
  description: 'Built authentication module',
  outcome: 'success',
  lessonsLearned: ['Always test edge cases'],
  skillsUsed: ['tdd'],
  durationMs: 5000,
  tags: ['auth'],
});

// Procedural: Skill effectiveness tracking
const procedural = new ProceduralMemory('~/.clawpowers/memory/procedural.json');
await procedural.update('tdd', { succeeded: true, durationMs: 5000, taskId: 'task-1' });

// Context injection: Relevant memories for new tasks
const injector = new ContextInjector(episodic, procedural);
const context = await injector.inject(goal, 2000); // 2000 token budget
```

### RSI (Recursive Self-Improvement)

```typescript
import { MetricsCollector, HypothesisEngine, MutationEngine, ABTestManager } from 'clawpowers';

// Collect metrics
const metrics = new MetricsCollector('task-metrics.jsonl', 'skill-metrics.jsonl');
await metrics.recordTaskMetrics({ taskId: 'task-1', outcome: 'success', /* ... */ });

// Generate improvement hypotheses
const hypothesis = new HypothesisEngine();
const hypotheses = hypothesis.analyze(skillStats, taskHistory);

// Create and test mutations
const mutations = new MutationEngine('mutations.jsonl');
const mutation = mutations.createMutation(hypotheses[0]);

// A/B test mutations
const ab = new ABTestManager();
const test = ab.startTest(mutation, baselineStats);
ab.recordResult(test.testId, newTaskMetrics);
const result = ab.evaluateTest(test.testId);
// result.decision: 'promote' | 'rollback' | 'continue'
```

### Wallet

**v2.2.0+ produces real MetaMask-compatible Ethereum addresses** via the standard derivation chain: secp256k1 private key → uncompressed public key → Keccak-256 → last 20 bytes, with EIP-55 checksum case. Verified against the Hardhat default test vector (`0xac09...ff80` → `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`). Addresses are importable into MetaMask, Etherscan, and any EVM wallet.

**Tier behavior:**
- **Tier 1** (native `.node` addon, built locally with `cargo`): full secp256k1 + ECDSA + Keccak-256 via the `k256` Rust crate
- **Tier 2** (pre-built WASM, ships in the npm package): same secp256k1 + ECDSA + Keccak-256 via `k256` compiled to WebAssembly
> **⚠️ Wallet safety:** If both Tier 1 (native) and Tier 2 (WASM) fail to load, the library falls back to Tier 3 pure-TypeScript signing, which uses a legacy SHA-256 digest and HMAC — **not standard secp256k1, not production-safe for on-chain use.** Because Tier 2 WASM ships pre-built in every npm tarball, this fallback should only occur in heavily sandboxed environments. Call `getActiveTier()` at startup to verify you are running Tier 1 or Tier 2 before sending any real funds.
- **Tier 3** (pure TypeScript, used only if Tier 1 AND Tier 2 both fail to load): legacy SHA-256 digest and HMAC signing — **not production-safe for on-chain use**

Since Tier 2 WASM artifacts ship pre-built in the npm package, **every install gets real Ethereum wallets out of the box** — no Rust toolchain required.

```typescript
import { WalletManager, generateWallet, signMessage } from 'clawpowers';

// High-level API
const wallet = new WalletManager({
  chain: 'base',
  dataDir: '~/.clawpowers/wallet',
});

const info = await wallet.generate();
console.log(info.address); // 0x... — real Ethereum address, EIP-55 checksummed

// Low-level API for direct key handling
const sig = await signMessage(privateKeyHex, 'Hello, Ethereum');
// Returns 65-byte ECDSA signature (r || s || recovery) as 0x-prefixed hex
// Verifiable by any Ethereum node, ethers.js, viem, or MetaMask
```

For production on-chain sending and transaction construction, you can still use [`viem`](https://viem.sh) or [`ethers`](https://docs.ethers.org) alongside ClawPowers — our wallet produces the same addresses they do.

## Memory Module

| Layer | Storage | Purpose |
|-------|---------|---------|
| **Working** | In-process | Current task context with token budget |
| **Episodic** | JSONL file | Task history, searchable by keywords |
| **Procedural** | JSON file | Skill effectiveness tracking with atomic writes |
| **Checkpoint** | JSON files | Crash recovery, stale detection |
| **Context Injector** | Computed | Selects relevant memories for new tasks |

## RSI Module

The RSI engine implements a continuous improvement loop:

```
measure → hypothesize → mutate → A/B test → promote/rollback → repeat
```

**Tier Safety:**
- **T1** (Parameter Tuning) — Can auto-apply
- **T2** (Strategy Evolution) — Can auto-apply with notification
- **T3** (Skill Composition) — Requires testing gate
- **T4** (Architecture Proposals) — **ALWAYS requires human approval**

Safety invariants (spending limits, identity, RSI definitions, sandbox boundaries, credentials) can **NEVER** be modified by RSI.

## Parallel Swarm

Run multiple tasks concurrently with intelligent model routing, shared context, and token budget management.

```typescript
import { ConcurrencyManager, TokenPool, classifyHeuristic, selectModel } from 'clawpowers';

const pool = new TokenPool({ totalBudget: 100000 });
const concurrency = new ConcurrencyManager({ maxConcurrency: 5 });

// Classify and route tasks to optimal models
const complexity = classifyHeuristic('Build a distributed trading system');
const model = selectModel(complexity); // → claude-opus-4-5

// Allocate token budgets per task
pool.allocate('task-1', 5000);
```

### Swarm vs Sequential Sessions

Running N tasks as a single parallel swarm instead of N separate LLM sessions avoids reloading shared context (system prompt, workspace files, tool schemas) for every task.

**Measured benefits:**
- **Wall time:** parallel fan-out is significantly faster than sequential execution, scaling with task count and concurrency limit
- **Token usage:** shared-context overhead is paid once per swarm run instead of once per task

**Current measurement snapshot:**

**Live ITP compression measurements:**
- **25-message corpus:** 11 of 25 messages compressed, `862` to `759` estimated tokens, **11.95% token reduction**, **7.8 ms/message** round-trip
- **5-task live swarm payload:** `183` to `133` task tokens, **27.32% payload reduction**, **5 of 5 tasks compressed**, **10.8 ms** average encode latency

**Modeled prompt-cache economics on those same live prompt sizes:**

| Scenario | Effective input units | Reduction vs baseline | Source type |
|----------|-----------------------|-----------------------|-------------|
| Baseline | 1902.00 | 0.00% | Derived from live prompt sizes |
| ITP only | 1848.00 | 2.84% | Live ITP server compression applied to full prompts |
| Prompt cache only | 752.95 | 60.41% | Anthropic cache-pricing model |
| ITP + prompt cache | 698.95 | 63.25% | Hybrid result: live ITP compression + modeled cache pricing |

- **Shared prompt prefix in swarm test:** 1,372 characters, about 343 estimated input tokens
- **Three-set hybrid validation on a MacBook Pro (Apple M1, 16 GB RAM) with benchmark runner model `openai-codex/gpt-5.4`:** combined reduction ranged from **61.89%** to **63.25%**, with a **62.56%** mean and **0.56** standard deviation

**Reproduce:**
- `node benchmarks/itp-measurement.mjs` for the live ITP corpus benchmark
- `node benchmarks/swarm-vs-sequential.mjs` for the structure-only swarm cost model
- `node benchmarks/itp-cache-swarm-benchmark.mjs` for the hybrid benchmark (live ITP compression + modeled cache economics)
- `node benchmarks/itp-cache-multi-swarm-benchmark.mjs` for the same hybrid methodology across three swarm sets

## ITP (Identical Twins Protocol) - Experimental

> **Status: Experimental.** ITP compression and latency numbers below are measured against the running server. Any prompt-cache numbers are modeled Anthropic cache economics applied to those same live prompt sizes.

Context compression for multi-agent communication. When agents share similar context (same model, same workspace), ITP deduplicates the common payload before transmission. The library ships with a graceful passthrough fallback, so code using ITP works even when the ITP server is offline. Messages are simply forwarded unchanged.

```typescript
import { itpEncode, itpDecode, itpHealthCheck, encodeTaskDescription, decodeSwarmResult } from 'clawpowers';

// Graceful fallback, works without ITP server running
const encoded = await encodeTaskDescription('Analyze quarterly revenue data');
const decoded = await decodeSwarmResult(result);

// Health check
const serverUp = await itpHealthCheck(); // false = passthrough mode
```

**Live ITP benchmark snapshot:**
- **Codebook:** `v1.0.0`, 99 entries
- **Corpus benchmark:** **11.95%** token reduction on 25 messages
- **Swarm payload benchmark:** **27.32%** task-token reduction on a 5-task swarm
- **Hybrid swarm benchmark:** **63.25%** effective input-cost reduction from live ITP compression plus modeled prompt caching

ITP is most effective in parallel swarm scenarios where multiple tasks share the same model context. Prompt caching handles repeated prompt structure, and ITP reduces the changing task payload inside that structure. Cross-model savings can also compound because providers inject similar preambles across nearby model tiers.

## Fee Structure

| Operation | Fee |
|-----------|-----|
| Transaction | 0.77% |
| Token Swap | 0.30% |

Fees are applied at the payment execution layer and are included in the transaction amount.

## Python Integration

```python
import subprocess
import json

# Call ClawPowers via Node.js subprocess
# Note: use --input-type=module (or a .mjs file) because clawpowers is an ES module
result = subprocess.run(
    ['node', '--input-type=module'],
    input='''
    import { detect402, SpendingPolicy } from "clawpowers";
    const policy = new SpendingPolicy({ dailyLimit: 25, transactionLimit: 10, allowedDomains: [] });
    const decision = policy.checkTransaction(5.00, "api.example.com");
    console.log(JSON.stringify(decision));
    ''',
    capture_output=True, text=True
)
decision = json.loads(result.stdout)
```

## API Reference

### Native acceleration
- `getActiveTier()`, `isNativeAvailable()`, `isWasmAvailable()`, `getCapabilitySummary()` — Loader introspection
- `computeSha256`, `digestForWalletAddress`, `tokenAmountFromHuman`, `calculateFee`, `evaluateWriteFirewall` — Routed helpers
- `getNative()`, `getWasm()` — Low-level module access

### Payments
- `detect402(response)` — Parse x402 headers from 402 response
- `isPaymentRequired(error)` — Type guard for 402 errors
- `SpendingPolicy` — Enforce daily/transaction/domain limits
- `PaymentExecutor` — Execute payments via MCP client
- `calculateTransactionFee`, `createPaymentHeader`, `generateWalletAddress` — Native/WASM-accelerated payment helpers (with TS fallbacks)

### Memory
- `WorkingMemoryManager` — In-process context management
- `EpisodicMemory` — JSONL task history
- `ProceduralMemory` — Skill effectiveness tracking
- `CheckpointManager` — Crash recovery
- `ContextInjector` — Memory-to-context selection
- `getBestCanonicalStore`, `getWasmCanonicalStore`, `compressVector`, `decompressVector`, `evaluateWriteSecurity` — Optional native/WASM memory bridges

### RSI
- `MetricsCollector` — Task/skill metrics in JSONL
- `HypothesisEngine` — Generate improvement hypotheses
- `MutationEngine` — Create/apply/revert mutations
- `ABTestManager` — A/B test mutations
- `RSIAuditLog` — Append-only audit trail
- `AutoResearcher` — Research solutions to failures

### Skills
- `discoverSkills(dir)` — Find skills in a directory
- `loadSkillManifest(dir)` — Load a single skill manifest
- `SkillExecutor` — Execute skills with outcome tracking

### Wallet

- `WalletManager` — High-level wallet operations
- `generateWallet(config)` — Generate new wallet (**v2.2.0+**: standard Ethereum address via secp256k1 when Tier 1/2 is active)
- `importWallet(key, config)` — Import existing wallet (same derivation)
- `signMessage(message, keyFile, passphrase)` — Sign; uses **ECDSA (secp256k1) over Keccak-256(UTF-8 message)** when native/WASM provides crypto, else legacy HMAC
- `signMessage(privateKeyHex, message)` — Same ECDSA path; returns `0x` + 130 hex chars (65-byte signature)

### Config
- `loadConfig()` / `saveConfig()` — Zod-validated config CRUD
- `initConfig()` — Create default config
- `getConfigValue()` / `setConfigValue()` — Dot-notation access

## License

**Business Source License 1.1 (BSL 1.1)**

This software is licensed under the BSL 1.1. You may use it for non-production purposes freely. Production use requires a commercial license until the Change Date, after which the software converts to the Apache 2.0 license.

See [LICENSE](LICENSE) for full terms.

## Patent Notice

⚠️ **Patent Pending:** The autonomous payment detection, spending policy enforcement, recursive self-improvement engine, and multi-tier memory systems implemented in this library are subject to pending patent applications filed by AI Agent Economy. Unauthorized commercial use may constitute patent infringement.

---

Built by [AI Agent Economy](https://github.com/up2itnow0822) 🦅

For commercial use, review [LICENSING.md](./LICENSING.md).
