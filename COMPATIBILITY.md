# Compatibility Matrix

## Supported release line

| clawpowers | Recommended consumer |
| --- | --- |
| 2.2.x (latest: 2.2.6) | capability-library consumers and `clawpowers-agent` 1.1.x |

## Notes

- `clawpowers` is the capability library, not the stock OpenClaw wrapper runtime.
- `clawpowers-agent` is the wrapper runtime that consumes this package.
- When `clawpowers` ships updated skills or capability implementations, `clawpowers-agent` should pick them up through package updates and skill sync.

## Hermes-compatible branch contract

On branch `hermes-compatible-2026-04-22`, the Hermes-supported surface is intentionally narrowed to the top-level `skills/` directory.

Currently validated on Hermes:

- `skills/itp/SKILL.md`

Not part of the current Hermes-native support claim on that branch:

- the broader `clawpowers` npm library
- wallet APIs
- payments / x402 runtime flows
- RSI, memory, swarm, and other library modules unless they are separately exported and validated as Hermes-ready skill bundles

Reference: `HERMES_COMPATIBILITY.md`
