# Live ITP + Modeled Prompt Caching Benchmark

## A 5-task swarm hybrid benchmark showed 63.25% modeled effective input-cost reduction

We ran a hybrid benchmark on the live Identical Twins Protocol (ITP) server and then applied a prompt-caching pricing model to those same prompt sizes for a five-task agent swarm.

The short version is simple. Prompt caching did most of the work. Live ITP compression added another layer on top. Together they produced a **modeled** 63.25% effective input-cost reduction in the tested swarm.

## What we tested

The benchmark covered four cases:

1. Baseline with no ITP and no prompt caching
2. ITP only
3. Prompt caching only
4. ITP plus prompt caching

The ITP server was live during the run at `http://127.0.0.1:8100`. We also verified the active codebook and server health before scoring results.

## Test setup

- Swarm size: 5 tasks
- Shared prefix: 1,372 characters, about 343 estimated input tokens
- ITP server: live FastAPI server on port 8100
- Codebook version: `v1.0.0`
- Codebook size: 99 entries
- Message token estimation: `ceil(chars / 4)`
- Prompt caching model: Anthropic cache pricing multipliers
  - First cached prefix write: `1.25x`
  - Later cached prefix reads: `0.10x`

## Benchmark table

### Scenario results

| Scenario | Effective input units | Reduction vs baseline | Measurement type |
|----------|-----------------------|-----------------------|------------------|
| Baseline | 1902.00 | 0.00% | Derived from live prompt sizes |
| ITP only | 1848.00 | 2.84% | Live ITP compression |
| Prompt cache only | 752.95 | 60.41% | Modeled from cache pricing |
| ITP + prompt cache | 698.95 | 63.25% | Live ITP + modeled cache pricing |

### Live ITP server metrics

| Metric | Result | Notes |
|--------|--------|-------|
| Server health | `ok` | Live check passed |
| Protocol | `ITP v1.0.0` | FastAPI server |
| Codebook entries | 99 | Seven active categories |
| Avg encode latency | 10.8 ms | Five-task swarm run |
| Compressed tasks | 5 of 5 | All swarm tasks compressed |
| Task token reduction | 27.32% | 183 to 133 tokens |

### Baseline corpus metrics

| Metric | Result |
|--------|--------|
| Corpus size | 25 messages |
| Compressed messages | 11 of 25 |
| Token reduction | 11.95% |
| Avg round-trip time | 7.8 ms/message |

## What the numbers say

The test swarm shared a large common prefix. That matters because prompt caching only pays off when several tasks reuse the same prompt frame. In this run, the shared prefix was about 343 tokens, while the task-specific payload across all five jobs totaled 183 tokens before ITP compression.

That split explains the outcome.

ITP did a good job on the task payload itself. It cut those task-message tokens by 27.32%, from 183 to 133. But once the full prompt is counted, the repeated shared prefix still dominates the input bill. So ITP alone only moved the full swarm from 1902 to 1848 effective input units, a 2.84% drop.

Prompt caching changed the picture. Once the first shared prefix was written to cache, the next four tasks reused it at the lower cache-read rate. That dropped the effective input cost from 1902 to 752.95, a 60.41% reduction.

When both methods were combined, the result improved again. Prompt caching cut the repeated prefix cost, and ITP reduced the task-specific payload that still had to be sent each time. The combined result was 698.95 effective input units, which is a **modeled** 63.25% reduction from baseline using live ITP compression plus Anthropic-style cache multipliers.

## Why this matters

This benchmark gives a useful rule of thumb for multi-agent systems:

- If your swarm shares a large prompt frame, prompt caching will drive most of the savings.
- If your agents exchange repeated operational language, ITP adds another layer of savings on the changing part of the prompt.
- If your traffic is mostly unique long-form research or technical writing, ITP will help less unless the codebook expands.

In other words, prompt caching handles repeated structure. ITP handles repeated language inside the task payload. They are additive, not competing.

## Caveats

A publishable benchmark should be honest about what is live and what is modeled.

Live measurements in this report:

- ITP server health check
- Codebook version and size
- Message compression on real benchmark prompts
- Encode latency
- Baseline corpus compression results

Modeled parts of this report:

- Prompt caching economics use Anthropic cache write and cache read pricing multipliers
- Token counts use the benchmark convention `ceil(chars / 4)` rather than a provider tokenizer
- Output token costs are not included

So, the compression and latency figures are real. The prompt caching cost numbers are a pricing model built on real prompt sizes.

## Reproduce the benchmark

Run these commands from `ClawPowers-Skills/`:

```bash
node benchmarks/itp-measurement.mjs
node benchmarks/itp-cache-swarm-benchmark.mjs
```

Generated result files:

- `benchmarks/itp-measurement-results.json`
- `benchmarks/itp-cache-swarm-results.json`

## Takeaway

For this five-task swarm, the hybrid setup of live ITP compression plus modeled prompt caching cut effective input cost by 63.25% while keeping encode latency near 10.8 ms. The compression and latency numbers are real. The cache-economics result is modeled.

The practical takeaway is even simpler. If you want the biggest savings, cache the shared prompt. If you want the next layer, compress the task payload. Use both.

> *This article was written with AI assistance. All technical claims, code, and architectural decisions were validated by the author.*
