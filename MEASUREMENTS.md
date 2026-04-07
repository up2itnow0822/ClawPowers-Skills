# Measurements

This file is where we publish **real, measured** performance numbers for ClawPowers. It is intentionally sparse until we have enough production traces to back the claims.

## Why this file exists

Early versions of this README quoted specific percentages for parallel swarm and ITP savings. Those numbers came from a cost **model**, not live measurement. We've pulled them out of the README because we don't yet have enough real-world data to stand behind a specific number.

We will publish measured results here as we collect them, with enough methodology detail that anyone can reproduce the test.

## What's confirmed

| Claim | Method | Status |
|---|---|---|
| Real secp256k1 Ethereum addresses | Hardhat test vector `0xac0974...ff80` → `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` | ✅ Confirmed via test (`tests/wallet/secp256k1.test.ts`) |
| 261 tests passing | `npm test` | ✅ Confirmed |
| 100% type coverage | `npx type-coverage` | ✅ Confirmed (5635/5635) |
| Parallel swarm fan-out faster than sequential | Wall-clock measurement on internal workloads | ✅ Directionally confirmed, magnitude varies |
| ITP speed improvement on identical-context tasks | Wall-clock measurement on internal workloads | ✅ Directionally confirmed, magnitude varies |

## What's pending measurement

| Claim | Why it's not here yet |
|---|---|
| Exact % token reduction from parallel swarm | Depends heavily on context size and task count. Need real API traces across a range of workloads. |
| Exact % token reduction from ITP | Varies from ~15% to ~40% in preliminary tests depending on context overlap. Need larger sample. |
| Cost savings $/month | Depends on the two above. Will publish after both are measured. |

## How to contribute measurements

If you run ClawPowers in production and want to share real numbers:

1. Collect per-request token counts from your LLM gateway or proxy
2. Run the same workload sequentially and as a swarm
3. Open an issue with the workload description, token counts, and wall-clock times
4. We'll aggregate community measurements and publish them here with credit

## Model vs measurement

`benchmarks/swarm-vs-sequential.mjs` computes an **expected** savings from configurable overhead constants. It is useful for sizing decisions, not for marketing claims. Adjust the constants to match your real gateway traces before trusting the output.

---

_Last updated: 2026-04-07_
