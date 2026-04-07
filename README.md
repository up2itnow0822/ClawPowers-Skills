# ClawPowers

**Skills library for AI agents — payments, memory, RSI, wallet, parallel swarm, ITP.** Drop-in capability layer for any agent framework.

[![npm version](https://img.shields.io/npm/v/clawpowers)](https://www.npmjs.com/package/clawpowers)
[![License: BSL 1.1](https://img.shields.io/badge/License-BSL%201.1-blue.svg)](LICENSE)

```bash
npm install clawpowers
```

> **⚠️ Patent Pending:** The x402 payment detection, autonomous spending policy enforcement, and recursive self-improvement (RSI) systems described in this library are subject to pending patent applications. Use is governed by the BSL 1.1 license.

---

## What Is This?

ClawPowers extracts the core capabilities from [ClawPowers-Agent](https://github.com/up2itnow0822/ClawPowers-Agent) into a standalone library. **No agent control loop** — bring your own agent framework and get:

- **x402 Payments** — Detect HTTP 402 responses, enforce spending policies, execute payments
- **Three-Tier Memory** — Working, episodic, procedural memory with crash recovery
- **RSI Engine** — Metrics collection, hypothesis generation, mutation, A/B testing
- **Wallet** — Generate, import, and sign with Ethereum-compatible wallets
- **Skills** — Discover, load, and track skill execution outcomes
- **Parallel Swarm** — Concurrent task execution with intelligent model routing and token budgeting
- **ITP (Identical Twins Protocol)** — Context compression that eliminates redundant token usage across agent sessions

## Native Acceleration

ClawPowers ships the same optional **Rust + WASM + PyO3** stack as [ClawPowers-Agent](https://github.com/up2itnow0822/ClawPowers-Agent), exposed through a **3-tier loader** in TypeScript:

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

`wasm-pack` may regenerate `pkg/.gitignore` / `pkg-node/.gitignore` that ignore all files in those folders — remove those ignore files if you need to commit refreshed WASM output.

Pre-built `.wasm` artifacts are included in the package so consumers are **not** required to run `wasm-pack`.

### Module coverage (aligned with ClawPowers-Agent)

| Area | Tier 1 / 2 capability | TypeScript fallback |
|------|------------------------|---------------------|
| Payments | `JsFeeSchedule`, WASM fee math | Pure-TS fee formula |
| Payments | `JsX402Client` | Base64 JSON header |
| Payments | `JsAgentWallet` (native only) | TS wallet + WASM-backed keccak where available |
| Memory | `JsCanonicalStore`, `JsTurboCompressor`, `JsWriteFirewall` | File/JSONL memory; simplified firewall |
| Hashing / wallet digest | WASM `computeKeccak256`, native `keccak256Bytes` (when built) | SHA-256 for wallet address digest only |

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

Address strings are derived from the **last 20 bytes** of a 32-byte digest of the private key material. **Tier 1** (native addon with `keccak256Bytes`) and **Tier 2** (pre-built WASM with `computeKeccak256`) use **Keccak-256**; **Tier 3** (no native/WASM) falls back to **SHA-256** for that digest. This is still **not** the standard EIP-1191 / MetaMask derivation (secp256k1 public key → Keccak-256 → last 20 bytes). For **on-chain** sending, contract interaction, or addresses that must match hardware wallets, use [`viem`](https://viem.sh) or [`ethers`](https://docs.ethers.org).

```typescript
import { WalletManager } from 'clawpowers';

const wallet = new WalletManager({
  chain: 'base',
  dataDir: '~/.clawpowers/wallet',
});

const info = await wallet.generate();
console.log(info.address); // 0x... (Keccak-256 digest when WASM/native loaded; else SHA-256 fallback)
```

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

### Swarm vs Sequential Cron — Verified Performance

Tested April 6, 2026 — 5 health/monitoring tasks:

| Metric | 5 Sequential Crons | 1 Parallel Swarm | Savings |
|--------|-------------------|------------------|---------|
| Input tokens | 50,800 | 17,700 | **65% less** |
| Wall time | ~25s | ~5s | **80% faster** |
| Cost per run | $0.182 | $0.062 | **66% cheaper** |
| Monthly (6 runs/day) | $32.83 | $11.18 | **$21.65/mo saved** |

The savings come from eliminating redundant context loading — each cron session loads the full system prompt independently. The swarm loads it once and fans out.

## ITP (Identical Twins Protocol)

Context compression for multi-agent communication. When agents share similar context (same model, same workspace), ITP deduplicates the common payload before transmission.

```typescript
import { itpEncode, itpDecode, itpHealthCheck, encodeTaskDescription, decodeSwarmResult } from 'clawpowers';

// Graceful fallback — works without ITP server running
const encoded = await encodeTaskDescription('Analyze quarterly revenue data');
const decoded = await decodeSwarmResult(result);

// Health check
const serverUp = await itpHealthCheck(); // false = passthrough mode
```

ITP is most effective in parallel swarm scenarios where multiple tasks share the same model context. Cross-model savings (e.g., Opus → Sonnet) also compound because LLM providers inject similar preambles across model tiers.

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
- `generateWallet(config)` — Generate new wallet
- `importWallet(key, config)` — Import existing wallet
- `signMessage(msg, keyFile, passphrase)` — Sign a message

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
