# Measurements

This file is where we publish **real, measured** performance numbers for ClawPowers. We pulled specific percentages out of the main README because earlier numbers were modeled, not measured. Everything here is from live server calls and can be reproduced from the repo.

## Why this file exists

Early README drafts quoted specific percentages for parallel swarm and ITP savings. Those numbers came from a cost **model** with configurable overhead constants, not from real API traces. We've pulled the specific numbers out of the marketing copy and moved measurement to this file, where each result links to a reproducible benchmark script.

---

## ITP (Identical Twins Protocol) — Initial Measurements

### Summary

**Measured token reduction: 11.9% aggregate (range: 0% to 26.1% by category).**

These are real numbers from live ITP server calls on a 25-message corpus across 6 categories. The server is the authoritative implementation at `~/.openclaw/workspace/tools/itp/` (the same one running under the `com.agenteconomy.itp-server` LaunchAgent). All 13 server-side Python tests pass. The server was restarted clean immediately before the benchmark run to ensure no state leaked from prior runs.

The magnitude is **much more modest than early modeled estimates suggested** (~65%). The mechanism works, but savings scale with codebook coverage, not with the raw size of the messages. Research vocabulary, long technical messages, and short messages see zero benefit; task delegation and status reports see the most.

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

- **Corpus size:** 25 representative agent-to-agent messages
- **Categories:** delegation (5), status (5), ops (5), research (3), technical (2), short (5)
- **Each message:** encoded via `POST /tools/encode`, round-tripped through `POST /tools/decode`, token counts recorded
- **Server state:** restarted clean via `launchctl unload/load` immediately before the run
- **Server validation:** all 13 Python tests in `tests/test_encoder.py` passing before the benchmark
- **Benchmark script:** `benchmarks/itp-measurement.mjs`
- **Reproducible:** yes, given a running ITP server at `127.0.0.1:8100`
- **Results JSON:** `benchmarks/itp-measurement-results.json`

### Results — Aggregate

| Metric | Value |
|---|---|
| Messages in corpus | 25 |
| Compressed | 11 |
| Passthrough | 14 |
| Original total tokens | 862 |
| Encoded total tokens | 759 |
| **Token reduction** | **103 tokens (11.9%)** |
| Total round-trip time | 201 ms |
| Average per message | 8.0 ms |

### Results — By Category

| Category | n | Compressed | Original tokens | Encoded tokens | Reduction |
|---|---|---|---|---|---|
| delegation | 5 | 5/5 | 184 | 136 | **26.1%** |
| status | 5 | 3/5 | 193 | 163 | **15.5%** |
| ops | 5 | 3/5 | 186 | 161 | **13.4%** |
| research | 3 | 0/3 | 122 | 122 | **0.0%** |
| technical | 2 | 0/2 | 166 | 166 | **0.0%** |
| short | 5 | 0/5 | 11 | 11 | **0.0%** |

### Observations

1. **Delegation messages compress best (~26%)** because the codebook has dense coverage of agent names, operation verbs, and target repos (`DL`, `EX`, `CPS`, `AW`, etc.). All 5 delegation messages in the corpus compressed.

2. **Research and technical messages compress at 0%** because the v1 codebook doesn't cover domain vocabulary (Rust crate names, API names, competitor names, algorithm names). These are exactly the gaps a v2 codebook expansion should target.

3. **Short messages pass through unchanged** by design — the 30-token compression threshold exists because the ITP prefix (`ITP:`) adds overhead that wipes out any gains on tiny messages.

4. **Round-trip speed is fast:** ~8ms per message round-trip (encode + decode) over HTTP to a local FastAPI server. ITP adds negligible latency relative to the LLM call it's wrapping.

5. **Compression is deterministic, not probabilistic.** Same input always produces the same output. This makes the protocol debuggable and predictable, but means savings are bounded by codebook coverage — ML-based approaches could potentially do better at the cost of determinism.

6. **Results are stable across corpus size.** A 15-message preliminary run produced 12.4% aggregate; the expanded 25-message run produced 11.9%. The per-category numbers also hold up (delegation: 23.6% → 26.1%), suggesting ~12% is a defensible aggregate for the v1 codebook on realistic agent traffic.

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

_Last updated: 2026-04-07 07:45 CDT_
_Initial ITP measurements: 2026-04-07 on MacBook Pro M1 (25-message corpus, fresh server restart)_
_PC (RTX 5090) measurements: pending_
