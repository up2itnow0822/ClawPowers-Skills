# Live ITP + Modeled Prompt Caching Benchmark Table

## Scenario summary

| Scenario | Effective input units | Reduction vs baseline | Source |
|----------|-----------------------|-----------------------|--------|
| Baseline | 1902.00 | 0.00% | Live prompt sizes |
| ITP only | 1848.00 | 2.84% | Live ITP server compression |
| Prompt cache only | 752.95 | 60.41% | Cache pricing model |
| ITP + prompt cache | 698.95 | 63.25% | Hybrid result: live ITP + modeled cache pricing |

## Live system metrics

| Metric | Result | Source |
|--------|--------|--------|
| ITP server health | `ok` | Live `/health` check |
| Codebook version | `v1.0.0` | Live server metadata |
| Codebook entries | 99 | Live server metadata |
| Shared prompt prefix | 1,372 chars, about 343 tokens | Benchmark input |
| Task token compression | 183 to 133 | Live ITP encode results |
| Task token reduction | 27.32% | Live ITP encode results |
| Avg encode latency | 10.8 ms | Live ITP encode results |
| Baseline corpus reduction | 11.95% | Live 25-message corpus run |

## One-line takeaway

On a five-task swarm with a large shared prompt prefix, prompt caching drove most of the savings, and live ITP payload compression pushed the hybrid modeled total to 63.25%.
