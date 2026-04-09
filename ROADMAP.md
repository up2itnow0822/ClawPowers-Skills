# Roadmap

This document tracks planned improvements to the `clawpowers` capability library. Items are roughly prioritized — top items are nearest-term.

## Near-term (v2.3.x)

- **ClawHub registry entry** — list `clawpowers` on clawhub.ai so OpenClaw users can discover and install it through the standard skill discovery flow
- **SQLite-backed episodic memory** — replace JSONL append-only log with embedded SQLite for high-concurrency swarm writes (addresses filesystem thrashing under heavy parallel workloads)
- **Atomic spending policy lock** — wrap the daily-limit check + deduction in a mutex-backed atomic operation in the Rust layer to prevent the race condition where concurrent swarm tasks each read a stale balance and over-spend
- **Self-hosted ITP server documentation** — instructions for running your own ITP codebook server
- **Dependabot + CodeQL** — automated dependency updates and SAST scanning

## Medium-term (v2.4.x / v2.5.x)

- **Zero-copy buffer path for ITP** — use `Uint8Array` views into shared memory when passing large context windows into WASM compression to eliminate serialization overhead at high token counts
- **Rust-layer key loading** — move private key material loading entirely into the `napi-rs` tier so key bytes never touch V8 heap; JavaScript only passes a file path or credential reference
- **Reproducible WASM build verification** — CI job that rebuilds WASM artifacts and hash-compares against shipped artifacts to detect tampering
- **Coverage thresholds** — enforce minimum test coverage in CI
- **Multi-platform install docs** — explicit Windows/macOS/Linux filesystem and path behavior for `~/.clawpowers`

## Longer-term

- **Full DGM (Darwin Godel Machine) RSI loop** — empirical benchmark-gated self-improvement beyond parameter and strategy tuning
- **Production payment audit** — third-party security review of the x402 payment path and key storage
- **Python bindings (PyO3)** — stable, pip-installable `clawpowers-core` for NemoClaw and Python agent integrations
- **Additional chain support** — Solana, Base mainnet, L2 payment routing

## Post roadmap (community-driven)

Features in this category depend on community adoption and feedback:
- Multi-maintainer governance
- Plugin marketplace for custom RSI operators
- Benchmark leaderboard for A/B mutation strategies
