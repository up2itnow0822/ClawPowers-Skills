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

> ⚠️ **Important:** The wallet address generated by this library uses **sha256** (not keccak256) for address derivation. Generated addresses are **NOT valid for on-chain Ethereum transactions** and will not match addresses from standard wallets. For production Ethereum/EVM usage, use [`viem`](https://viem.sh) or [`ethers`](https://docs.ethers.org) which implement the correct secp256k1 + keccak256 derivation. This module is suitable for key management, signing, and agent identity — not for sending on-chain transactions.

```typescript
import { WalletManager } from 'clawpowers';

const wallet = new WalletManager({
  chain: 'base',
  dataDir: '~/.clawpowers/wallet',
});

const info = await wallet.generate();
console.log(info.address); // 0x... (NOTE: sha256-derived, not keccak256)
```

> ⚠️ **Wallet Caveat:** Generated addresses use SHA-256 for address derivation, which is **NOT valid for on-chain Ethereum transactions**. The secp256k1 public key derivation and keccak256 hashing required for real Ethereum addresses are not implemented in this library. For production wallet operations — sending transactions, signing EIP-712 messages, or interacting with smart contracts — use [`viem`](https://viem.sh) or [`ethers.js`](https://docs.ethers.org) instead.

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

### Payments
- `detect402(response)` — Parse x402 headers from 402 response
- `isPaymentRequired(error)` — Type guard for 402 errors
- `SpendingPolicy` — Enforce daily/transaction/domain limits
- `PaymentExecutor` — Execute payments via MCP client

### Memory
- `WorkingMemoryManager` — In-process context management
- `EpisodicMemory` — JSONL task history
- `ProceduralMemory` — Skill effectiveness tracking
- `CheckpointManager` — Crash recovery
- `ContextInjector` — Memory-to-context selection

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

> ⚠️ **Address derivation uses sha256, not keccak256.** Addresses are NOT valid for on-chain Ethereum transactions. Use `viem` or `ethers` for production wallet operations.

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
