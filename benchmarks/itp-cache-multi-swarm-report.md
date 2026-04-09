# Live ITP + Modeled Prompt Caching Multi-Swarm Validation

We reran the benchmark across three different five-task swarm sets to check whether the original result was stable or just a favorable one-off.

It held up well.

Across three swarm sets, the combined hybrid result, live ITP compression plus modeled prompt-caching economics, ranged from **61.89%** to **63.25%** reduction in effective input cost, with a mean of **62.56%** and a standard deviation of **0.56**.

## Benchmark environment

- Benchmark runner model: `openai-codex/gpt-5.4`
- Machine: MacBook Pro
- Chip: Apple M1
- Memory: 16 GB RAM
- CPU cores: 8
- Node: `v25.8.1`
- ITP server: `http://127.0.0.1:8100`
- Codebook: `v1.0.0`, 99 entries

## Important methodology note

This benchmark measures live ITP compression and live encode latency against the running ITP server.

The prompt-caching portion is still a pricing model, not a billed API receipt. It uses Anthropic-style cache multipliers on the same live prompt sizes:

- First cached prefix write: `1.25x`
- Later cached prefix reads: `0.10x`

So the compression and latency numbers are live. The cache economics are modeled.

## Three-set comparison

| Swarm set | Workload focus | Payload compression | Combined reduction | Cache-only reduction | ITP-only reduction | Avg encode latency |
|-----------|----------------|---------------------|--------------------|----------------------|--------------------|--------------------|
| Set A | Launch ops | 27.32% | 63.25% | 60.41% | 2.84% | 12.2 ms |
| Set B | Release readiness | 16.41% | 61.89% | 60.07% | 1.83% | 4.4 ms |
| Set C | Infra and trading | 22.16% | 62.54% | 60.03% | 2.51% | 5.2 ms |

## Consistency summary

| Metric | Result |
|--------|--------|
| Combined reduction mean | 62.56% |
| Combined reduction standard deviation | 0.56 |
| Payload reduction mean | 21.96% |
| Payload reduction standard deviation | 4.46 |

## What this means

The total savings stayed tight because prompt caching dominates the economics when the swarm shares a large common prompt frame. That part remained stable across all three sets.

ITP still mattered. Its payload compression varied more by workload, from 16.41% to 27.32%, which is what you would expect. Release-oriented and status-heavy messages compress differently. But because prompt caching already removes most of the repeated prefix cost, the combined hybrid result stayed in a narrow band.

That gives us a stronger hybrid benchmark claim than a single run:

- On a five-task swarm with a large shared prompt prefix, prompt caching delivered about 60% savings by itself.
- Adding live ITP payload compression pushed the combined modeled reduction into the **61.89% to 63.25%** range across three different swarm sets.
- The three-run mean was **62.56%** on a MacBook Pro with an Apple M1 chip and 16 GB RAM.

## Files

- `benchmarks/itp-cache-multi-swarm-benchmark.mjs`
- `benchmarks/itp-cache-multi-swarm-results.json`

## Reproduce

```bash
BENCHMARK_RUNNER_MODEL='openai-codex/gpt-5.4' node benchmarks/itp-cache-multi-swarm-benchmark.mjs
```
