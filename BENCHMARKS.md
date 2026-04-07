# ClawPowers — Performance Benchmarks

> **Status: Initial findings.** Automated benchmark runs on BillsPC hardware. Two runs: ITP offline (passthrough baseline) and ITP server active (real compression). We will continue adding runs across different hardware and real-world workloads.

## Methodology

All benchmarks use `benchmarks/itp-swarm-benchmark.ts` — a reproducible script:

```bash
git clone https://github.com/up2itnow0822/ClawPowers-Skills.git
cd ClawPowers-Skills
npm install

# Run with ITP server offline (passthrough baseline)
npx tsx benchmarks/itp-swarm-benchmark.ts

# Run with ITP server active
cd tools/itp && python -m uvicorn itp_server:app --host 127.0.0.1 --port 8101 &
ITP_BASE_URL=http://127.0.0.1:8101 npx tsx benchmarks/itp-swarm-benchmark.ts
```

Results are written to `benchmarks/results/benchmark-<timestamp>.json`.

### What we measure

| Test | What it measures | How |
|------|-----------------|-----|
| **ITP encode/decode** | Context compression ratio and latency | Encode 5 tasks (each ~850 chars with shared system preamble) through ITP, measure output size and round-trip time |
| **Swarm: sequential vs parallel** | Wall-time speedup from parallel execution | Run 5 simulated tasks sequentially, then in parallel with ConcurrencyManager (bounded at 5 slots) |
| **Model router** | Classification throughput | Classify 50,000 task descriptions (10,000 iterations × 5 tasks) and measure wall time |

### What we do NOT measure (yet)

- Real LLM API calls (the benchmark uses simulated task execution to isolate framework overhead)
- End-to-end token cost with live models (requires API keys and costs money per run)
- Native (.node addon) vs WASM vs pure-TS tier comparison on the same hardware
- Disk I/O for memory persistence (episodic/procedural writes)

These are planned for future benchmark rounds.

### Test Workload

5 infrastructure health-check tasks with a shared system preamble (~580 chars) prepended to each. The preamble contains common agent instructions (role definition, format requirements, access permissions) — exactly the kind of repeated context ITP is designed to compress.

| Task ID | Description | Complexity | Unique message length |
|---------|-------------|------------|-----------------------|
| health-1 | Docker container health status | simple | ~270 chars |
| health-2 | API endpoint availability | simple | ~300 chars |
| health-3 | Disk usage analysis | moderate | ~280 chars |
| health-4 | Memory & process review | moderate | ~260 chars |
| health-5 | Error log audit | complex | ~320 chars |

---

## Equipment

| Component | Spec |
|-----------|------|
| **Host** | BillsPC |
| **CPU** | AMD Ryzen Threadripper 9970X (32 cores / 64 threads) |
| **Memory** | 127.4 GB DDR5 |
| **OS** | Windows 11 (10.0.26200) x64 |
| **Node.js** | v24.14.1 |
| **Python** | 3.13.12 (miniconda3) |
| **ClawPowers tier** | Tier 2 (WASM) — native .node addon not compiled |
| **ITP server** | FastAPI + uvicorn, 54-entry codebook, SQLite history |

---

## Run 1 — Baseline (ITP Offline / Passthrough)

**Date:** April 7, 2026 07:11 CDT  
**ITP server:** Offline — all encode/decode calls returned original message unchanged

### ITP Passthrough Results

| Task | Input (chars) | Output (chars) | Compressed? | Savings | Encode latency |
|------|--------------|----------------|-------------|---------|----------------|
| health-1 | 851 | 851 | No | 0% | 6ms |
| health-2 | 878 | 878 | No | 0% | 2ms |
| health-3 | 863 | 863 | No | 0% | 2ms |
| health-4 | 845 | 845 | No | 0% | 2ms |
| health-5 | 906 | 906 | No | 0% | 2ms |

**Passthrough overhead:** 2–6ms per encode, 1–3ms per decode. Confirms ITP adds negligible latency when server is unavailable.

### Swarm Results

| Mode | Wall time | Speedup |
|------|-----------|---------|
| Sequential | 541ms | — |
| Parallel (5 slots) | 205ms | **2.6x** |

### Model Router

| Metric | Value |
|--------|-------|
| Throughput | **1,612,903 classifications/sec** |

---

## Run 2 — ITP Server Active (Real Compression)

**Date:** April 7, 2026 12:24 CDT  
**ITP server:** Active on port 8101 (FastAPI + uvicorn, 54-entry codebook)

### ITP Compression Results

| Task | Input (chars) | Output (chars) | Compressed? | Savings | Encode latency |
|------|--------------|----------------|-------------|---------|----------------|
| health-1 | 851 | 218 | ✓ | **74.4%** | 12ms |
| health-2 | 878 | 343 | ✓ | **60.9%** | 8ms |
| health-3 | 863 | 304 | ✓ | **64.8%** | 9ms |
| health-4 | 845 | 266 | ✓ | **68.5%** | 8ms |
| health-5 | 906 | 280 | ✓ | **69.1%** | 8ms |

### Summary

| Metric | Value |
|--------|-------|
| **Average compression** | **67.5%** |
| **Best compression** | 74.4% (health-1: Docker health check) |
| **Worst compression** | 60.9% (health-2: API endpoint check) |
| **Avg encode latency** | 9ms |
| **Avg decode latency** | 7ms |
| **Total input tokens (est)** | 1,088 |
| **Total output tokens (est)** | 354 |
| **Token reduction** | **67.5%** |

### Why health-1 compressed best

Task health-1 (Docker health check) hit the most codebook entries — its description and message contain multiple exact-match phrases like "check docker container health status", "flag any containers in unhealthy or restarting state", and "run docker ps and report container status". The shared system preamble also compressed heavily across all tasks.

### Swarm Results

| Mode | Wall time | Speedup |
|------|-----------|---------|
| Sequential | 546ms | — |
| Parallel (5 slots) | 205ms | **2.7x** |

### Model Router

| Metric | Value |
|--------|-------|
| Throughput | **1,612,903 classifications/sec** |

---

## Comparison: ITP Off vs ITP On

| Metric | ITP Off | ITP On | Improvement |
|--------|---------|--------|-------------|
| Avg message size | 869 chars | 282 chars | **-67.5%** |
| Est. tokens per batch | 1,088 | 354 | **-734 tokens** |
| Encode latency | 2-6ms | 8-12ms | +6ms avg overhead |
| Swarm speedup | 2.6x | 2.7x | Same (simulated tasks) |

### Interpretation

- **67.5% character/token reduction** on infrastructure monitoring tasks with repeated system context. This is a favorable workload for ITP — all 5 tasks share a ~580 char system preamble that compresses heavily.
- **Encode overhead is ~7ms** above passthrough. For tasks that take seconds (real LLM calls), this is negligible.
- **Swarm speedup is consistent** (2.6–2.7x) regardless of ITP — expected since we used simulated tasks. Real LLM calls would show ITP savings in actual API costs rather than wall time.
- **Compression varies by task** (61–74%) depending on how many codebook entries match. Tasks with more infrastructure-specific vocabulary compress better.

### Caveats

- These are **character-level compression ratios**, not verified token-level savings. Actual tokenizer behavior may differ slightly from the ~4 chars/token estimate.
- The codebook is tuned for infrastructure/operations vocabulary. Other domains (creative writing, code generation) would see different ratios.
- All tasks shared the same system preamble — real-world swarm tasks may have more varied context, reducing compression.
- No real LLM API calls were made. True cost savings depend on provider pricing and tokenization.

---

## ITP Server

The ITP server (`tools/itp/itp_server.py`) is included in this repo. It's a FastAPI service with:

- **54-entry codebook** of common agent operations, roles, and infrastructure phrases
- **Greedy longest-first matching** for maximum compression
- **SQLite history** for audit trail
- **Stats endpoint** for observability

```bash
# Start
cd tools/itp
python -m uvicorn itp_server:app --host 127.0.0.1 --port 8101

# Health check
curl http://127.0.0.1:8101/health

# View codebook
curl http://127.0.0.1:8101/tools/codebook

# View stats
curl http://127.0.0.1:8101/tools/stats
```

The TypeScript client (`src/itp/index.ts`) auto-discovers the server. Set `ITP_BASE_URL` env var to override the default port:

```bash
ITP_BASE_URL=http://127.0.0.1:8101 npx tsx benchmarks/itp-swarm-benchmark.ts
```

---

## Pending Tests

- [ ] **Real LLM API calls** — Replace simulated tasks with actual Claude/GPT API calls to measure end-to-end token usage and cost savings
- [ ] **Native tier comparison** — Compile the Rust native addon and compare crypto/compression performance against WASM and pure-TS tiers
- [ ] **Mac hardware** — Run the same benchmark on Apple Silicon for cross-platform comparison
- [ ] **Larger workloads** — Scale to 10, 20, and 50 concurrent tasks to measure ConcurrencyManager behavior under load
- [ ] **Diverse workloads** — Test ITP compression on non-infrastructure tasks (code review, content generation, research)
- [ ] **Codebook expansion** — Measure compression improvement as codebook grows beyond 54 entries
- [ ] **Memory persistence** — Benchmark episodic (JSONL append) and procedural (JSON atomic write) memory operations at scale

---

## How to reproduce

1. Clone the repo and `npm install`
2. Optionally start the ITP server: `cd tools/itp && python -m uvicorn itp_server:app --host 127.0.0.1 --port 8101`
3. Run: `ITP_BASE_URL=http://127.0.0.1:8101 npx tsx benchmarks/itp-swarm-benchmark.ts`
4. Results JSON is in `benchmarks/results/`

---

*Last updated: April 7, 2026*
