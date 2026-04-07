# Measurements

This file is where we publish **real, measured** performance numbers for ClawPowers. We pulled specific percentages out of the main README because earlier numbers were modeled, not measured. Everything here is from live server calls and can be reproduced from the repo.

## Why this file exists

Early README drafts quoted specific percentages for parallel swarm and ITP savings. Those numbers came from a cost **model** with configurable overhead constants, not from real API traces. We've pulled the specific numbers out of the marketing copy and moved measurement to this file, where each result links to a reproducible benchmark script.

---

## ITP (Identical Twins Protocol) — Initial Measurements

### Summary

**Measured token reduction: 12.4% aggregate (range: 0% to 23.6% by category).**

These are real numbers from live ITP server calls on a 15-message corpus across 5 categories. The magnitude is **much more modest than early modeled estimates suggested** (~65%). The mechanism works, but savings scale with codebook coverage, not with the raw size of the messages. Research vocabulary and short messages see zero benefit; task delegation and status reports see the most.

### Test Environment

| Component | Value |
|---|---|
| Host | MacBook Pro M1 (Apple Silicon) |
| CPU | Apple M1 |
| OS | Darwin 25.4.0 (arm64) |
| Node.js | v25.8.1 |
| Python | 3.14.3 |
| ITP server | FastAPI on 127.0.0.1:8100 |
| ITP codebook | v1.0.0 (99 entries across 7 categories: operations, targets, agents, priorities, status codes, report formats, common phrases) |
| Compression threshold | Messages under 30 tokens pass through unchanged |
| Token estimator | Server-side tokenizer (4 chars per token for English) |

### Test Parameters

- **Corpus size:** 15 representative agent-to-agent messages
- **Categories:** delegation (3), status (3), ops (3), research (2), short (4)
- **Each message:** encoded via `POST /tools/encode`, round-tripped through `POST /tools/decode`, token counts recorded
- **Benchmark script:** `benchmarks/itp-measurement.mjs`
- **Reproducible:** yes, given a running ITP server
- **Results JSON:** `benchmarks/itp-measurement-results.json`

### Results — Aggregate

| Metric | Value |
|---|---|
| Messages in corpus | 15 |
| Compressed | 6 |
| Passthrough | 9 |
| Original total tokens | 437 |
| Encoded total tokens | 383 |
| **Token reduction** | **54 tokens (12.4%)** |
| Total round-trip time | 172 ms |
| Average per message | 11.5 ms |

### Results — By Category

| Category | n | Compressed | Original tokens | Encoded tokens | Reduction |
|---|---|---|---|---|---|
| delegation | 3 | 3/3 | 110 | 84 | **23.6%** |
| status | 3 | 2/3 | 124 | 109 | **12.1%** |
| ops | 3 | 1/3 | 114 | 101 | **11.4%** |
| research | 2 | 0/2 | 81 | 81 | **0.0%** |
| short | 4 | 0/4 | 8 | 8 | **0.0%** |

### Observations

1. **Delegation messages compress best (~24%)** because the codebook has dense coverage of agent names, operation verbs, and target repos (`DL`, `EX`, `CPS`, `AW`, etc.).

2. **Research messages compress poorly (~0%)** because the codebook doesn't yet include research vocabulary (competitor names, technical terms, domain-specific language).

3. **Short messages pass through unchanged** by design — the 30-token compression threshold exists because the ITP prefix (`ITP:`) adds overhead that wipes out any gains on tiny messages.

4. **Round-trip speed is fast:** ~11.5ms per message round-trip (encode + decode) over HTTP to a local FastAPI server. ITP adds negligible latency relative to the LLM call it's wrapping.

5. **Compression is deterministic, not probabilistic.** Same input always produces the same output. This makes the protocol debuggable and predictable, but means savings are bounded by codebook coverage — ML-based approaches could potentially do better at the cost of determinism.

### How to grow the savings

The codebook is v1.0.0 with 99 entries. Each additional entry that matches real agent traffic increases the aggregate reduction. Path to larger savings:

1. **Expand the codebook** with the vocabulary that actually shows up in production agent logs (currently ~50% of research and ops messages are passing through)
2. **Add multi-word phrase support** — currently single-word substitutions dominate
3. **Tune the compression threshold** — 30 tokens is conservative; some messages in the 15-25 token range might net positive if the codebook is dense enough

### What's NOT measured yet

| Claim | Why it's not here |
|---|---|
| Token reduction on multi-turn conversations | Requires instrumenting a real agent session, not just single messages |
| Savings when ITP is combined with parallel swarm | Requires end-to-end swarm + ITP integration test |
| Cross-model savings (Opus → Sonnet prompt dedup) | Requires LLM-side instrumentation beyond the server's own counter |
| PC / RTX 5090 host comparison | PC tests pending — will add to this doc once run |

---

## Parallel Swarm — Pending Measurement

The parallel swarm benefit is real but has not been measured with live LLM traces yet. The model in `benchmarks/swarm-vs-sequential.mjs` computes expected savings from configurable overhead constants — it's useful for sizing decisions, not for marketing claims.

**What's confirmed directionally:**
- Parallel fan-out is significantly faster than sequential execution (measured wall clock)
- Avoids reloading system prompt, workspace context, and tool schemas for every task (trivially true by architecture)

**What's pending:**
- Exact % token reduction on production workloads
- Real API cost comparison against equivalent sequential sessions

We will measure and publish once we have a production swarm workload running long enough to collect meaningful traces.

---

## What's Confirmed Elsewhere

| Claim | Method | Status |
|---|---|---|
| Real secp256k1 Ethereum addresses | Hardhat test vector `0xac0974...ff80` → `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` | ✅ `tests/wallet/secp256k1.test.ts` |
| 261 tests passing | `npm test` | ✅ |
| 100% type coverage | `npx type-coverage` | ✅ (5635/5635) |
| ITP round-trip correctness | Encode → decode produces semantically equivalent output | ✅ Verified in all 15 corpus messages |
| ITP graceful fallback | Server down → messages pass through unchanged | ✅ Implemented and tested |

---

## How to Contribute Measurements

If you run ClawPowers in production and want to share real numbers:

1. Collect per-request token counts from your LLM gateway or proxy
2. Run the same workload sequentially and as a swarm
3. Open an issue with the workload description, token counts, and wall-clock times
4. We'll aggregate community measurements and add them here with credit

For ITP specifically, the bottleneck is **codebook coverage for your domain**. If you have a specific agent use case, we can tune the codebook to it and measure the improvement.

---

_Last updated: 2026-04-07_
_Initial ITP measurements: 2026-04-07 07:13 CDT on MacBook Pro M1_
_PC (RTX 5090) measurements: pending_
