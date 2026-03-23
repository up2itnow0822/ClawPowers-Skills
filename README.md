# 🦞 ClawPowers

> **v1.1.4** · 27 skills · 372 tests · MIT · **Patent Pending**

**Your agent needs to pay for APIs. ClawPowers makes that work.**

When your agent hits a premium API and gets back HTTP 402 Payment Required, it needs to pay and retry — automatically, within limits you set, with your approval before anything moves. That's the core problem ClawPowers solves. The other 26 skills are a bonus.

## The Pay-to-Complete Flow

```
Agent calls API
      │
      ▼
  HTTP 402  ←── "Payment required: $0.50 USDC"
      │
      ▼
ClawPowers evaluates:
  • Is this within your spend cap? ($5/tx limit → ✅)
  • Is this on the allowlist?     (api.example.com → ✅)
  • Human approval required?      (under $1 threshold → auto)
      │
      ▼
  Payment sent → API retried → Result returned
      │
      ▼
  Outcome logged (for RSI analysis)
```

## Quick Start

```bash
npx clawpowers init          # Set up ~/.clawpowers/ runtime
npx clawpowers demo x402     # See the full 402 → pay → 200 flow (no real money)
npx clawpowers status        # Check what's running
```

## Human-Approval Mode (the default)

ClawPowers defaults to supervised payments — your agent proposes, you approve. No funds move until you say so.

```typescript
import { createX402Client } from 'agentwallet-sdk';
import { createWallet, setSpendPolicy } from 'agentwallet-sdk';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';

const account = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY as `0x${string}`);
const walletClient = createWalletClient({ account, chain: base, transport: http() });

const wallet = createWallet({
  accountAddress: process.env.AGENT_WALLET_ADDRESS as `0x${string}`,
  chain: 'base',
  walletClient,
});

// Spend policy — enforced on-chain, not in application code
await setSpendPolicy(wallet, {
  token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC on Base
  perTxLimit: 1_000_000n,    // $1 auto-approved per transaction
  periodLimit: 10_000_000n,  // $10/day hard cap
  periodLength: 86400,
});

const x402 = createX402Client(wallet, {
  supportedNetworks: ['base:8453'],
  globalDailyLimit: 10_000_000n,    // matches spend policy
  globalPerRequestMax: 1_000_000n,  // $1 per request
  requireApproval: true,            // human-in-the-loop mode (default)
});

// Agent hits a paid API
const response = await x402.fetch('https://api.example.com/premium-data');
// If cost < $1: auto-approved and paid
// If cost > $1: queued — you get a notification to approve or reject
const data = await response.json();
```

## Simulation Mode

Test the full payment flow before enabling live payments.

```bash
# Run a local mock x402 merchant — full 402 → pay → 200 cycle
npx clawpowers demo x402
```

In code:

```typescript
const x402 = createX402Client(wallet, {
  supportedNetworks: ['base:8453'],
  globalDailyLimit: 10_000_000n,
  globalPerRequestMax: 1_000_000n,
  dryRun: true,  // logs exactly what would happen, no funds move
});

const response = await x402.fetch('https://api.example.com/premium-data');
// Response includes: { simulated: true, wouldHavePaid: '0.50 USDC', withinLimits: true }
```

## Explicit Spend Caps

Caps are enforced by smart contract, not application code. Even a prompt injection or jailbreak can't bypass them.

```
Agent wants to spend $0.50  → ✅ Auto-approved (under $1/tx cap)
Agent wants to spend $5.00  → ⏳ Queued for your approval
Agent spent $9.00 today     → 🛑 Next tx blocked ($10/day cap hit)
```

```bash
# Check what your agent has spent
npx clawpowers store get agent-payments:daily-total
# → "2.50 USDC spent today, $7.50 remaining"

# Review and approve queued payments
npx clawpowers payments queue
# → [1] $5.00 USDC — api.example.com/premium-report — approve? (y/n)
```

## Why Supervised, Not Autonomous

Fully autonomous agent payments sound great until an agent in a loop runs up $500 in API calls overnight. ClawPowers is built around three constraints:

1. **Caps enforced on-chain** — the agent *cannot* exceed them, full stop
2. **Human approval by default** — auto-approve only below thresholds you set
3. **Full audit trail** — every payment logged at `~/.clawpowers/metrics/`

When you've verified the agent behaves correctly, raise the auto-approve threshold. Start low.

## Validator Skill

The built-in validator runs 14 rounds of automated checks on any project. It auto-detects the language and selects the right tools.

```text
Run the Validator on ~/DevDrive/my-project
```

### What It Checks

| Round | Check | Blocking? |
|-------|-------|-----------|
| 0 | **Compile Gate** | ✅ Yes — stops everything if this fails |
| 1 | Lint (ESLint, Clippy, Ruff) | No |
| 2 | Test Suite | No |
| 3 | Security Audit (npm audit, cargo audit, Trivy) | No |
| 4 | Type Coverage | No |
| 5 | Documentation completeness | No |
| 6 | Changelog | No |
| 7 | Secrets detection (gitleaks) | No |
| 8 | Spelling (codespell) | No |
| 9 | Link verification | No |
| 10 | PR-readiness (DCO, conventional commits, SPDX) | No |
| 11 | Cross-platform compatibility | No |
| 12 | Dependency health | No |
| 13 | Summary + verdict | — |

### Example Output

```
Validator Report — my-project v2.1.0

Score: 12/14 rounds clean | 2 advisory warnings | 0 blockers
Verdict: WARN ⚠️ → PUBLISH ✅

Blocking issues: none
Advisory: missing SPDX headers (round 10), placeholder URL in docs (round 9)
```

### Targeted Runs

```text
# Quick check — compile + test only
Run Validator rounds 0-2 on my-project

# Before submitting a PR to NVIDIA
Run Validator PR-readiness checks on my-project for NVIDIA/NeMo-Agent-Toolkit-Examples

# Security-focused
Run Validator rounds 3 and 7 on my-project
```

### Supported Languages

TypeScript, JavaScript, Rust, Go, Python, Ruby, Java/Kotlin, Solidity, C/C++, Swift, Docker, Shell, Markdown, YAML — auto-detected from project files.

---

## Installation

### Universal (Windows, macOS, Linux)

```bash
npx clawpowers init
```

### OpenClaw

```bash
openclaw skills install clawpowers
# or from GitHub
openclaw skills install github:up2itnow0822/clawpowers
```

### Claude Code

```bash
/plugin install clawpowers@claude-plugins-official
```

### Cursor

```text
/add-plugin clawpowers
```

### Codex / OpenCode

```text
Fetch and follow instructions from https://raw.githubusercontent.com/up2itnow0822/clawpowers/main/.codex/INSTALL.md
```

### Manual

```bash
git clone https://github.com/up2itnow0822/clawpowers.git
cd clawpowers
node bin/clawpowers.js init
```

## All 27 Skills

### Core Development (15)

| Skill | What It Does |
|-------|-------------|
| `subagent-driven-development` | Orchestrate parallel subagents — persistent execution DB, resumable checkpoints |
| `test-driven-development` | RED-GREEN-REFACTOR with mutation analysis to verify tests actually catch bugs |
| `writing-plans` | Spec → implementation plan with historical estimation and dependency validation |
| `executing-plans` | Execute plans with interruption recovery and milestone tracking |
| `brainstorming` | Structured ideation with cross-session idea persistence |
| `systematic-debugging` | Persistent hypothesis tree so you never re-investigate the same dead end |
| `validator` | 14-round automated validation pipeline — compile, lint, test, security, docs, secrets, spelling, links, PR-readiness. Auto-detects project language. Run before publish, deploy, or merge. |
| `verification-before-completion` | Pre-merge quality gates that actually run the verification suite |
| `finishing-a-development-branch` | Branch cleanup, changelog, merge prep |
| `requesting-code-review` | Reviewer match scoring, review history |
| `receiving-code-review` | Feedback pattern tracking, common issues database |
| `using-git-worktrees` | Isolated branch development with conflict prediction |
| `using-clawpowers` | Meta-skill: how to use ClawPowers |
| `writing-skills` | Create new skills via TDD with quality scoring |
| `dispatching-parallel-agents` | Fan-out with load balancing, failure isolation, result aggregation |

### Extended Capabilities (6)

| Skill | What It Does |
|-------|-------------|
| `agent-payments` | x402 payment protocol — supervised, capped, human-in-the-loop by default |
| `security-audit` | Automated vulnerability scanning (Trivy, gitleaks, npm audit) |
| `content-pipeline` | Write → humanize → format → publish with platform-specific formatting |
| `learn-how-to-learn` | Metacognitive protocols, anti-pattern detection, confidence calibration |
| `market-intelligence` | Competitive research, trend detection, opportunity scoring |
| `prospecting` | Lead generation, contact enrichment, CRM sync (Exa + Apollo) |

### RSI Intelligence Layer (4)

Skills that require runtime execution and persistent state — not available in static frameworks.

| Skill | What It Does |
|-------|-------------|
| `meta-skill-evolution` | Every 50 tasks: analyzes outcomes, identifies weakest skill, rewrites its methodology |
| `self-healing-code` | On test failure: hypothesis tree → 2+ patches → applies best → auto-commits |
| `cross-project-knowledge` | Pattern library across all repos — bug fixes and solutions transfer between projects |
| `formal-verification-lite` | Property-based testing (fast-check/Hypothesis/QuickCheck) — 1000+ examples per property |

## Cross-Session Memory

Skills persist state across sessions. Your agent's debugging hypotheses, payment outcomes, and learned patterns survive session restarts.

```
~/.clawpowers/
├── state/        # Key-value store
├── metrics/      # Outcome tracking per skill (JSONL)
├── checkpoints/  # Resumable workflow state
├── feedback/     # RSI self-improvement data
└── logs/         # Execution logs
```

## CLI Reference

```bash
npx clawpowers init                          # Set up runtime
npx clawpowers status                        # Health check
npx clawpowers demo x402                     # Payment demo (no real money)
npx clawpowers metrics record --skill <name> --outcome success|failure
npx clawpowers metrics summary               # Per-skill stats
npx clawpowers analyze                       # RSI performance analysis
npx clawpowers store get <key>               # Read persistent state
npx clawpowers store set <key> <value>       # Write persistent state
npx clawpowers payments queue                # Review pending approvals
```

## Platform Support

| Platform | Windows | macOS | Linux | WSL2 |
|----------|:-------:|:-----:|:-----:|:----:|
| Claude Code | ✅ | ✅ | ✅ | ✅ |
| Cursor | ✅ | ✅ | ✅ | ✅ |
| Codex | ✅ | ✅ | ✅ | ✅ |
| OpenCode | ✅ | ✅ | ✅ | ✅ |
| Gemini CLI | ✅ | ✅ | ✅ | ✅ |

## Requirements

- **Node.js >= 16** (for cross-platform runtime)
- **OR bash** (for Unix-native runtime)
- **Zero runtime dependencies** — `package.json` has an empty `dependencies` object

## Security Model

- State directory (`~/.clawpowers/`) uses `700` permissions — owner-only
- No network access in runtime scripts — store, metrics, and analyze are fully offline
- No `eval()`, `Function()`, or dynamic code execution anywhere in the runtime
- Payment guardrails enforced by smart contract — application code cannot override them

## Credential

Built by [AI Agent Economy](https://github.com/up2itnow0822):
- Payment infrastructure in [NVIDIA's official NeMo Agent Toolkit](https://github.com/NVIDIA/NeMo-Agent-Toolkit-Examples/pull/17)
- [agentwallet-sdk](https://www.npmjs.com/package/agentwallet-sdk) — 741+ downloads/week
- [agentpay-mcp](https://github.com/up2itnow0822/agentpay-mcp) — MCP payment server

## Patent Notice

**Patent Pending** — The underlying financial infrastructure (agentwallet-sdk, agentpay-mcp) is covered by USPTO provisional patent application filed March 2026: "Non-Custodial Multi-Chain Financial Infrastructure System for Autonomous AI Agents."

We support the open x402 standard. Our provisional filing is defensive — intended to prevent hostile monopolization of open payment rails, not to restrict builders.

## Disclaimer

ClawPowers and agentwallet-sdk are non-custodial developer tooling. You control your own keys and set your own spending limits. You are responsible for compliance with applicable laws in your jurisdiction. This software is provided as-is under the MIT license. Nothing here constitutes financial advice, custody services, or money transmission.

## License

MIT
