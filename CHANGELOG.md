# Changelog

All notable changes to ClawPowers are documented here.

## [2.0.0] - 2026-04-03

### Breaking Changes

- **Complete TypeScript rewrite.** The v1.x shell-script runtime has been replaced with a fully typed TypeScript library.
- **No agent control loop.** ClawPowers is now a pure capability library — bring your own agent framework.
- **ESM-only.** Requires Node.js 20+.

### Added

- **Payments module** — x402 detection (`detect402`), `SpendingPolicy` enforcement, `PaymentExecutor` with append-only audit log. Fees: 0.77% tx / 0.30% swap.
- **Memory module** — `WorkingMemoryManager` (in-process, token-budgeted), `EpisodicMemory` (JSONL append-only), `ProceduralMemory` (atomic JSON), `CheckpointManager` (crash recovery), `ContextInjector` (relevant memory selection).
- **RSI module** — `MetricsCollector`, `HypothesisEngine`, `MutationEngine`, `ABTestManager`, `RSIAuditLog`, `AutoResearcher`. Full measure → hypothesize → mutate → A/B test → promote/rollback cycle.
- **Wallet module** — `WalletManager`, `generateWallet`, `importWallet`, `signMessage` with AES-256-GCM encryption at rest.
- **Skills module** — `discoverSkills`, `loadSkillManifest`, `SkillExecutor` with outcome tracking.
- **Config module** — Zod-validated config, dot-notation access, profile support.
- **Framework demos** — LangChain (`demos/langchain.ts`), Claude Code (`demos/claude-code.md`), ElizaOS (`demos/elizaos.ts`).
- **231 TypeScript tests** — full coverage across all modules.
- **BSL 1.1 license** with Change Date April 3, 2030.
- **SECURITY.md** with vulnerability reporting policy and security design principles.

### Compatibility

Drop-in library for: LangChain, LangGraph, Claude Code, Cursor, ElizaOS, AutoGen, CrewAI, Agent Zero, any MCP-compatible host.

### Removed

- Shell-script runtime (v1.x skills)
- CLI binary (`clawpowers` command)
- Agent control loop (use ClawPowers-Agent for that)


## [1.1.3] - 2026-03-22

### Added

- **Unified Payment Decision Pipeline** (`runtime/payments/pipeline.js`) — 8-step flow for evaluating payment boundaries across all skills
- **Agent-to-Agent Bounties skill** (`skills/agent-bounties/`) — 6-phase escrow lifecycle for agent hiring
- **Premium enrichment** in prospecting skill — x402-aware paid data sources
- **5-minute transaction quickstart** (`docs/quickstart-first-transaction.md`) — JS + Python paths
- **Demo README** (`runtime/demo/README.md`) — x402 flow walkthrough with curl examples
- **30 natural language triggers** in skill.json — purchase intents, payment management, demo commands
- "Payments are optional" README section with regulatory disclaimer and patent positioning
- Smart `update` command — detects npm vs git install

## [1.1.2] - 2026-03-22

### Added

- **Config.json on init** — payments disabled by default, dry-run mode, $0 limits
- **Payment ledger** (`~/.clawpowers/logs/payments.jsonl`) — full audit trail
- **Wallet activation wizard** (`npx clawpowers payments setup`) — interactive, non-scary
- **x402 Mock Merchant** (`npx clawpowers demo x402`) — test payments with zero risk
- **Dry-run mode** documentation in agent-payments skill
- **Payment moment hooks** in market-intelligence + security-audit skills
- Updated using-clawpowers trigger map
- Standardized `.env.example` across all projects

## [1.1.1] - 2026-03-22

### Added

- **economic-code-optimization skill** (25th skill) — ROI-tracked micro-budget spending
- 4 RSI intelligence skills: meta-skill-evolution, self-healing-code, cross-project-knowledge, formal-verification-lite
- 2 skills enhanced: test-driven-development (+mutation testing), systematic-debugging (+hypothesis memory)

### Changed

- README rewritten (381 lines)
- +994 lines inline JSDoc comments across 12 code files

## [1.1.0] - 2026-03-21

### Added

- agent-payments skill rewritten for agentwallet-sdk v6.0.0
- OpenClaw skill.json manifest
- Security Model section in README
- Agent Payment Demo (3-step walkthrough)
- Demo GIF (asciinema recording, 621KB)

## [1.0.0] - 2026-03-21

### Added

- Initial release — 20 core skills
- Dual runtime (bash + Node.js)
- Session hooks for Claude Code, Cursor, Codex, OpenCode, Gemini CLI
- Metrics collection and RSI feedback loop
- 366 tests passing
