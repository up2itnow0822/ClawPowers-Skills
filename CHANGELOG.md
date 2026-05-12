# Changelog

All notable changes to ClawPowers are documented here.

## Unreleased

## [2.2.7] - 2026-05-12

### Fixed

- Launch-critical API fix: generated/imported wallets now return or accept caller-supplied passphrases so encrypted key files remain signable through `signMessage(message, keyFile, passphrase)`.
- Fixed skill discovery for Windows/CRLF `SKILL.md` frontmatter so packaged skills are actually visible after clean npm installs on Windows.
- Added a clean consumer-install smoke gate that packs the npm tarball, installs it in a fresh project, imports public ESM exports, verifies packaged skills, and exercises the WASM Ethereum wallet fallback.
- Published the current dependency metadata as an npm-visible patch release.

## [2.2.6] - 2026-04-14

### Fixed

- Corrected stale internal version surfaces that were still reporting older values inside the published package
- Added `skill.json` back to the npm tarball so the manifest ships with the package again
- Aligned compatibility/docs metadata to the repaired 2.2.6 release

## [2.2.5] - 2026-04-09

### Fixed

- Added clawpowers.ai canonical links across package metadata and docs
- Synced internal version surfaces so package metadata, manifest, and source constants all report 2.2.5

## [2.2.4] - 2026-04-09

### Fixed

- GitHub Actions CI WASM-artifact verification now correctly handles `npm pack --dry-run --json` output when `prepack` logs are present
- Added `scripts/verify-wasm-artifacts.mjs` so packaged WASM checks are deterministic and reusable
- Final GitHub release/version surfaces aligned to the live npm package version

## [2.2.3] - 2026-04-09

### Fixed

- Added Dependabot, CodeQL, release automation, ROADMAP, and CI badge surfaces
- Elevated wallet safety warning for Tier 3 fallback behavior
- Added Node 22 coverage in CI and tightened launch-readiness docs

## [2.2.2] - 2026-04-09

### Fixed

- `package.json` homepage corrected to npm page
- Compatibility matrix updated to reflect current supported release lines
- `skill.json` version synced to the published package version

## [2.2.1] - 2026-04-08

### Fixed

- `skill.json` version bumped to 2.2.1
- `package.json` homepage corrected to npm page
- CHANGELOG publish dates corrected to 2026-04-08
- RELEASING.md populated with published versions table
- `npm pkg fix` repository URL normalization applied

## [2.2.0] - 2026-04-08

### Added

- **Full secp256k1 Ethereum wallet derivation** (MetaMask-compatible): private key → uncompressed public key (64 bytes) → Keccak-256 → last 20 bytes as EIP-55 checksummed address.
- **Pure Rust `k256`** (RustCrypto) in `native/crates/evm-eth`, wired into **WASM** and **FFI** with exports: `deriveEthereumAddress`, `derivePublicKey`, `signEcdsa`, `verifyEcdsa`.
- **TypeScript loader** (`src/native/index.ts`): `keccak256Digest`, `deriveEthereumAddress`, `derivePublicKey`, `signEcdsa`, `verifyEcdsa` (Tier 1 → Tier 2 → `null` / `false` as documented).
- **`signMessage` overload**: `(privateKeyHex, message)` returns a 65-byte ECDSA signature hex (`r‖s‖v`); existing `(message, keyFile, passphrase)` unchanged in shape, now uses ECDSA+Keccak when tiers allow, else HMAC fallback.
- **Tests**: `tests/wallet/secp256k1.test.ts` (Hardhat default account #0 vector).

### Notes

- **WASM**: `getrandom` 0.2 `js` feature enabled for `wasm32` so `k256` builds under `wasm-pack`.
- **Loader**: If Tier 1 (native) loads, Tier 2 (WASM) is still initialized when available so newer exports (e.g. secp256k1) work when an older `.node` lacks them. `getActiveTier()` remains `native` when the addon is present.
- Existing keyfiles still use the stored `address` field as the source of truth; newly generated/imported keys use real Ethereum addresses when native or WASM is loaded.

## [2.1.0] - 2026-04-06

### Added

- **Native acceleration layer** (parity with ClawPowers-Agent): `native/` Rust workspace (wallet, tokens, policy, fee, x402, canonical, compression, index, verification, security, ffi, WASM crate, PyO3 bindings).
- **Pre-built WASM** in `native/wasm/pkg-node` and `native/wasm/pkg` so npm installs work **without** `wasm-pack` or Rust.
- **3-tier TypeScript loader** (`src/native/index.ts`): Tier 1 optional `.node` addon, Tier 2 WASM, Tier 3 pure TypeScript fallbacks. Exported from the package root (`getActiveTier`, `isNativeAvailable`, `isWasmAvailable`, `getCapabilitySummary`, `computeSha256`, `digestForWalletAddress`, `tokenAmountFromHuman`, `calculateFee`, `evaluateWriteFirewall`, etc.).
- **Payment bridges** (`calculateTransactionFee`, `createPaymentHeader`, `generateWalletAddress`) and **memory bridges** (`getBestCanonicalStore`, `compressVector`, `evaluateWriteSecurity`, …) via `src/payments/native-bridge.ts` and `src/memory/native-store.ts`.
- **npm scripts:** `build:native`, `build:wasm`.
- **WASM / native Keccak-256** for wallet address digest when Tier 1 or Tier 2 is active; **SHA-256** remains the Tier 3 fallback only.

### Notes

- Tier 1 (native) is **optional**; building `native/ffi` requires Rust locally. Published tarballs focus on Tier 2 WASM + Tier 3 TS.
- Backward compatible at the **API** level for v2.0.0 importers; wallet **address strings** for newly generated keys may differ from v2.0.0 when WASM/native is loaded (Keccak-256 vs former SHA-256-only digest). Existing keyfiles keep their stored `address` field.

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

- agent-payments skill rewritten around wallet workflow helpers
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
