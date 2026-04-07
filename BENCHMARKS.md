# ClawPowers — Performance Benchmarks

> **Status: Initial findings.** These are early results from automated benchmark runs. We will continue adding runs across different hardware, ITP server configurations, and real-world workloads. Contributions welcome.

## Methodology

All benchmarks use `benchmarks/itp-swarm-benchmark.ts` — a reproducible script you can run yourself:

```bash
git clone https://github.com/up2itnow0822/ClawPowers-Skills.git
cd ClawPowers-Skills
npm install
npx tsx benchmarks/itp-swarm-benchmark.ts
```

Results are written to `benchmarks/results/benchmark-<timestamp>.json` for full machine-readable data.

### What we measure

| Test | What it measures | How |
|------|-----------------|-----|
| **ITP encode/decode** | Context compression ratio and latency | Encode 5 tasks (each ~850 chars with shared preamble) through ITP, measure output size and round-trip time |
| **Swarm: sequential vs parallel** | Wall-time speedup from parallel execution | Run 5 simulated tasks sequentially, then in parallel with ConcurrencyManager (bounded at 5 slots) |
| **Model router** | Classification throughput | Classify 50,000 task descriptions (10,000 iterations × 5 tasks) and measure wall time |

### What we do NOT measure (yet)

- Real LLM API calls (the benchmark uses simulated task execution to isolate framework overhead)
- End-to-end token usage with live models (requires API keys and costs money per run)
- ITP compression with a live ITP server (requires the Python ITP server running on port 8100)
- Disk I/O for memory persistence (episodic/procedural writes)
- Native (.node addon) vs WASM vs pure-TS tier comparison on the same hardware

These are planned for future benchmark rounds.

---

## Run 1 — BillsPC (Windows, Threadripper 9970X)

**Date:** April 7, 2026  
**Ran by:** Max (automated benchmark script)

### Equipment

| Component | Spec |
|-----------|------|
| **CPU** | AMD Ryzen Threadripper 9970X (32 cores / 64 threads) |
| **Memory** | 127.4 GB DDR5 |
| **OS** | Windows 11 (10.0.26200) x64 |
| **Node.js** | v24.14.1 |
| **ClawPowers tier** | Tier 2 (WASM) — native .node addon not compiled |
| **ITP server** | Offline (passthrough mode) |

### ITP Results

The ITP server was **not running** during this test. All encode/decode calls fell through to passthrough mode — messages were returned unchanged. This is the expected graceful degradation behavior.

| Task | Input (chars) | Output (chars) | Compressed? | Savings | Encode latency |
|------|--------------|----------------|-------------|---------|----------------|
| health-1 | 851 | 851 | No | 0% | 6ms |
| health-2 | 878 | 878 | No | 0% | 2ms |
| health-3 | 863 | 863 | No | 0% | 2ms |
| health-4 | 845 | 845 | No | 0% | 2ms |
| health-5 | 906 | 906 | No | 0% | 2ms |

**ITP passthrough overhead:** ~2-6ms per encode, ~1-3ms per decode. Negligible.

> **To get real ITP compression numbers**, the Python ITP server must be running on `localhost:8100`. We plan to run this test with the server active and report actual compression ratios. Until then, **we make no claims about ITP compression percentages.**

### Swarm Parallel Execution

Simulated 5 health-check tasks with delays proportional to complexity (simple=50ms, moderate=100ms, complex=200ms).

| Mode | Wall time | Speedup |
|------|-----------|---------|
| Sequential | 541ms | — |
| Parallel (5 slots) | 205ms | **2.6x** |

**Note:** The 2.6x speedup reflects framework-level parallelization overhead on simulated tasks. Real-world speedups depend on:
- Actual task duration (longer tasks = more parallelization benefit)
- API response times (network-bound tasks benefit most)
- Whether tasks share context that ITP can compress (not tested here — ITP was offline)
- Concurrency limits of downstream APIs

The swarm's primary token savings come from **shared context loading** — in a real deployment, each sequential cron job loads the full system prompt independently, while the swarm loads it once. This structural saving is separate from ITP compression and was not measured in this simulation-only benchmark.

### Model Router

| Metric | Value |
|--------|-------|
| Classification throughput | **1,612,903 /sec** |
| Test tasks | 5 (all classified as `simple` — correct for short descriptions under 100 chars) |

The heuristic router uses keyword matching and description length. It does not call an LLM. At 1.6M classifications/second on a single core, it adds effectively zero overhead to swarm task dispatch.

### WASM Module Availability

The following modules were available via the WASM tier during this run:

- tokens, fee, compression, canonical, verification, security, index

The native `.node` addon was **not compiled** — Rust toolchain is not installed on this machine.

---

## Pending Tests

The following tests are planned. Results will be added as they complete.

- [ ] **ITP with live server** — Run the Python ITP server and measure actual codebook compression ratios on the 5-task health-check workload
- [ ] **Real LLM API calls** — Replace simulated tasks with actual Claude/GPT API calls to measure end-to-end token usage and cost
- [ ] **Native tier comparison** — Compile the Rust native addon and compare crypto/compression performance against WASM and pure-TS tiers
- [ ] **Mac hardware** — Run the same benchmark on the MacBook (Apple Silicon) for cross-platform comparison
- [ ] **Larger workloads** — Scale to 10, 20, and 50 concurrent tasks to measure ConcurrencyManager behavior under load
- [ ] **Memory persistence** — Benchmark episodic (JSONL append) and procedural (JSON atomic write) memory operations at scale
- [ ] **Wallet crypto** — Compare secp256k1 key generation and signing across native/WASM/@noble tiers

---

## How to contribute a benchmark run

1. Clone the repo and install dependencies
2. Run `npx tsx benchmarks/itp-swarm-benchmark.ts`
3. The script outputs a JSON file to `benchmarks/results/`
4. Open a PR with your results JSON and we'll add your hardware to this page

Include your hardware specs and whether you had the ITP server or native addon available.

---

*Last updated: April 7, 2026*
