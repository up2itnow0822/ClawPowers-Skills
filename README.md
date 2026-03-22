# 🦞 ClawPowers

**The skills framework that actually does something.**

ClawPowers gives your coding agent superpowers that go beyond instructions. While other frameworks hand your agent a reading list and hope for the best, ClawPowers gives it **runtime tools, persistent memory, self-improvement loops, and the ability to transact autonomously.**

## Why ClawPowers?

| Feature | ClawPowers | Static Skills Frameworks |
|---------|-----------|--------------------------|
| Skills auto-load on session start | ✅ | ✅ |
| Runtime tool execution | ✅ | ❌ |
| Cross-session memory | ✅ | ❌ |
| Self-improvement (RSI) | ✅ | ❌ |
| Outcome tracking & metrics | ✅ | ❌ |
| Agent payments (x402) | ✅ | ❌ |
| Security scanning | ✅ | ❌ |
| Content pipeline | ✅ | ❌ |
| Market intelligence | ✅ | ❌ |
| Resumable workflows | ✅ | ❌ |
| Windows native support | ✅ | ❌ |
| Zero dependencies | ✅ | ✅ |

**20 skills.** 14 cover everything static frameworks do (TDD, subagent dev, debugging, planning, code review, git worktrees). 6 go where they can't — payments, security, content, prospecting, market intelligence, and metacognitive learning.

## Requirements

- **Node.js >= 16** — for cross-platform runtime (Windows, macOS, Linux)
- **OR bash** — for Unix-native runtime (macOS, Linux, WSL2)
- **No other dependencies.** Zero. `package.json` has an empty `dependencies` object.

> Every user of Claude Code, Cursor, Codex, or Gemini CLI already has Node.js installed.
> No `requirements.txt` needed — this is not a Python project.

## Installation

### Universal (recommended — works on Windows, macOS, Linux)

```bash
npx clawpowers init
```

This downloads ClawPowers, creates the `~/.clawpowers/` runtime directory, and you're ready to go. Works in any terminal: Windows CMD, PowerShell, macOS Terminal, Linux shell.

### Claude Code (Plugin Marketplace)

```bash
/plugin install clawpowers@claude-plugins-official
```

Or register the marketplace first, then install:

```bash
/plugin marketplace add up2itnow0822/clawpowers-marketplace
/plugin install clawpowers@clawpowers-marketplace
```

### Cursor

In Cursor Agent chat:

```
/add-plugin clawpowers
```

Or search for "clawpowers" in the Cursor plugin marketplace.

### Codex

Tell Codex:

```
Fetch and follow instructions from https://raw.githubusercontent.com/up2itnow0822/clawpowers/main/.codex/INSTALL.md
```

### OpenCode

Tell OpenCode:

```
Fetch and follow instructions from https://raw.githubusercontent.com/up2itnow0822/clawpowers/main/.opencode/INSTALL.md
```

### Gemini CLI

```bash
gemini extensions install https://github.com/up2itnow0822/clawpowers
```

### Manual (git clone)

```bash
git clone https://github.com/up2itnow0822/clawpowers.git
cd clawpowers
node bin/clawpowers.js init    # Windows, macOS, Linux
# or
bash bin/clawpowers.sh init    # macOS, Linux only
```

### Verify Installation

Start a new session in your chosen platform and ask for something that triggers a skill — for example, "help me plan this feature" or "let's debug this issue." The agent should automatically apply the relevant ClawPowers skill.

Check runtime status anytime:

```bash
npx clawpowers status
```

## What Makes ClawPowers Different

### 1. Skills That Execute, Not Just Instruct

Static skills tell your agent *what to do*. ClawPowers skills can *do things themselves*:

- The **test-driven-development** skill doesn't just describe TDD — it runs mutation analysis on your tests to verify they actually catch bugs
- The **systematic-debugging** skill doesn't just list debugging steps — it maintains a persistent hypothesis tree across sessions so you never re-investigate the same dead end
- The **verification-before-completion** skill doesn't just say "verify" — it runs the actual verification suite and blocks completion until it passes

### 2. Cross-Session Memory

Every ClawPowers skill can read from and write to a persistent state store. When your agent debugs an issue on Monday and encounters the same stack trace on Friday, it remembers what worked and what didn't. No more Groundhog Day debugging.

```
~/.clawpowers/
├── state/            # Cross-session key-value store
├── metrics/          # Outcome tracking per skill (JSONL)
├── checkpoints/      # Resumable workflow state
├── feedback/         # Self-improvement analysis
├── memory/           # Persistent knowledge base
└── logs/             # Execution logs
```

### 3. Self-Improvement (RSI)

ClawPowers tracks what works and what doesn't. After every skill execution:

1. **Measure** — Was the outcome successful? How long did it take? What went wrong?
2. **Analyze** — Are there patterns in failures? Which task types need different approaches?
3. **Adapt** — Adjust skill parameters, decomposition strategies, and review thresholds

```bash
# Record an outcome
npx clawpowers metrics record --skill test-driven-development --outcome success --duration 1800

# Analyze performance
npx clawpowers analyze
```

This isn't theoretical — it's the same RSI framework running in production trading systems with 268+ measured outcomes.

### 4. Agent Payments (x402)

Your agent can pay for premium APIs, compute resources, and services autonomously — within smart-contract-enforced spending limits. No wallet draining. No surprise bills. Built on the payment infrastructure [integrated into NVIDIA's official NeMo Agent Toolkit](https://github.com/NVIDIA/NeMo-Agent-Toolkit-Examples/pull/17).

### 5. Beyond Software Development

Static frameworks stop at coding methodology. ClawPowers includes skills for:

- **Security auditing** — Automated vulnerability scanning with Trivy, dependency checks, secret detection
- **Content pipeline** — Write, humanize, and publish technical content with platform-specific formatting
- **Market intelligence** — Research competitors, track trends, analyze opportunities
- **Prospecting** — Find leads matching your ICP, enrich contacts, output to CRM

## Skills Reference

### Core Development (14 skills)

| Skill | What It Does | Runtime Enhancement |
|-------|-------------|---------------------|
| `subagent-driven-development` | Orchestrate parallel subagents per task | Persistent execution DB, resumable checkpoints, outcome metrics |
| `test-driven-development` | RED-GREEN-REFACTOR enforcement | Mutation analysis, test portfolio management, effectiveness scoring |
| `writing-plans` | Spec → implementation plan | Historical task estimation, dependency validation, plan quality scoring |
| `executing-plans` | Execute plans with verification | Progress persistence, interruption recovery, milestone tracking |
| `brainstorming` | Structured ideation | Cross-session idea persistence, convergence tracking |
| `systematic-debugging` | Hypothesis-driven debugging | Persistent hypothesis tree, pattern matching against known issues |
| `verification-before-completion` | Pre-merge quality gates | Automated verification suite, historical pass rate tracking |
| `finishing-a-development-branch` | Branch cleanup and merge prep | Automated changelog, squash strategy optimization |
| `requesting-code-review` | Prepare and request review | Reviewer match scoring, review history |
| `receiving-code-review` | Process and implement feedback | Feedback pattern tracking, common issues database |
| `using-git-worktrees` | Isolated branch development | Worktree lifecycle management, conflict prediction |
| `using-clawpowers` | Meta-skill: how to use ClawPowers | Adaptive onboarding based on user skill level |
| `writing-skills` | Create new skills via TDD | Skill quality scoring, anti-pattern detection |
| `dispatching-parallel-agents` | Fan-out parallel execution | Load balancing, failure isolation, result aggregation |

### Extended Capabilities (6 skills)

| Skill | What It Does | Why Static Frameworks Can't |
|-------|-------------|----------------------------|
| `agent-payments` | x402 payment protocol, spending limits, autonomous transactions | Requires runtime wallet interaction, smart contract calls |
| `security-audit` | Vulnerability scanning, secret detection, dependency audits | Requires tool execution (Trivy, gitleaks, npm audit) |
| `content-pipeline` | Write → humanize → format → publish | Requires API calls, platform auth, content transformation |
| `learn-how-to-learn` | Metacognitive protocols, anti-pattern detection, confidence calibration | Requires persistent learning state, outcome correlation |
| `market-intelligence` | Competitive analysis, trend detection, opportunity scoring | Requires web access, data aggregation, persistent tracking |
| `prospecting` | Lead generation, contact enrichment, CRM sync | Requires API calls (Exa, Apollo), structured output |

## Architecture

```
clawpowers/
├── skills/                    # 20 skill directories, each with SKILL.md
├── runtime/
│   ├── persistence/           # Cross-session state (store.js + store.sh)
│   ├── metrics/               # Outcome tracking (collector.js + collector.sh)
│   ├── feedback/              # RSI self-improvement (analyze.js + analyze.sh)
│   ├── init.js                # Cross-platform runtime setup
│   └── init.sh                # Unix-native runtime setup
├── hooks/
│   ├── session-start          # Bash session hook (macOS/Linux)
│   ├── session-start.js       # Node.js session hook (all platforms)
│   └── session-start.cmd      # Windows batch wrapper
├── bin/
│   ├── clawpowers.js          # Cross-platform CLI (Windows/macOS/Linux)
│   └── clawpowers.sh          # Unix-native CLI (macOS/Linux)
├── plugins/                   # Platform-specific plugin manifests
│   ├── .claude-plugin/        # Claude Code
│   ├── .cursor-plugin/        # Cursor
│   ├── .codex/                # Codex
│   ├── .opencode/             # OpenCode
│   └── gemini-extension.json  # Gemini CLI
├── tests/                     # 366 test assertions
└── docs/                      # Documentation
```

**Dual runtime:** Every runtime script exists in both bash (`.sh`) and Node.js (`.js`). Unix users get native bash performance. Windows users get full functionality via Node.js. `npx clawpowers` auto-detects the best runtime for your platform.

## Platform Support

| Platform | Windows | macOS | Linux | WSL2 |
|----------|---------|-------|-------|------|
| Claude Code | ✅ | ✅ | ✅ | ✅ |
| Cursor | ✅ | ✅ | ✅ | ✅ |
| Codex | ✅ | ✅ | ✅ | ✅ |
| OpenCode | ✅ | ✅ | ✅ | ✅ |
| Gemini CLI | ✅ | ✅ | ✅ | ✅ |

## Runtime CLI Reference

```bash
npx clawpowers init                                    # Set up ~/.clawpowers/
npx clawpowers status                                  # Runtime health check
npx clawpowers metrics record --skill <name> --outcome success|failure  # Track outcome
npx clawpowers metrics show                            # View recent metrics
npx clawpowers metrics summary                         # Per-skill stats
npx clawpowers analyze                                 # RSI performance analysis
npx clawpowers analyze --skill <name>                  # Analyze specific skill
npx clawpowers store set <key> <value>                 # Store persistent state
npx clawpowers store get <key>                         # Retrieve state
npx clawpowers store list [prefix]                     # List stored keys
```

## Credential

Built by [AI Agent Economy](https://github.com/up2itnow0822) — the team behind:

- Payment infrastructure in [NVIDIA's official NeMo Agent Toolkit](https://github.com/NVIDIA/NeMo-Agent-Toolkit-Examples/pull/17)
- [agentwallet-sdk](https://www.npmjs.com/package/agentwallet-sdk) — agentwallet-sdk v6.0 — Full multi-chain agent wallet: x402 payments, Uniswap V3 swaps, CCTP bridging, ERC-8004 identity, mutual stake escrow, spending policies (741+ downloads/week)
- [agentpay-mcp](https://github.com/up2itnow0822/agentpay-mcp) — MCP payment server for AI agents
- Production trading systems with RSI self-improvement (268+ measured outcomes)

## Contributing

We welcome contributions. Unlike some frameworks, we don't dismiss legitimate skill proposals with one-word responses. Open an issue or PR — every submission gets a genuine technical review.

## License

MIT
