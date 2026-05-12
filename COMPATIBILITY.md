# Compatibility Matrix

## Supported release line

| clawpowers | Node.js | Recommended consumer | Hermes Agent skill-surface status |
| --- | --- | --- | --- |
| 2.2.x (latest: 2.2.7) | >=22.0.0 | capability-library consumers and `clawpowers-agent` 1.1.x | top-level `skills/` bundles verified against latest `NousResearch/hermes-agent` `main` by CI |

## Notes

- `clawpowers` is the capability library, not the stock OpenClaw wrapper runtime.
- `clawpowers-agent` is the OpenClaw wrapper runtime that consumes this package.
- `clawpowers-agent` 1.1.x currently aligns with `openclaw` 2026.5.7.
- When `clawpowers` ships updated skills or capability implementations, `clawpowers-agent` should pick them up through package updates and skill sync.
- This package requires Node.js 22+. CI and release workflows are aligned to Node 22.

## Hermes Agent compatibility contract

The Hermes-supported surface is the top-level `skills/` directory. These bundles are standard `SKILL.md` skill bundles compatible with Hermes Agent's skills tooling.

Current verification:

- dedicated workflow: `.github/workflows/hermes-compatibility.yml`
- Hermes source: `NousResearch/hermes-agent` on `main`
- verifier: `python3 scripts/verify_hermes_wrappers.py`
- verification scope: discovery of every exported top-level skill plus representative `skill_view` samples

Currently validated sample bundles include:

- `skills/itp/SKILL.md`
- `skills/github/SKILL.md`
- `skills/content-writer/SKILL.md`
- `skills/webmcp-payments/SKILL.md`
- `skills/prospector/SKILL.md`
- `skills/security/SKILL.md`
- `skills/business-strategy/SKILL.md`

## Boundary of the Hermes-native claim

Hermes Agent compatibility means the exported `skills/` bundles load through Hermes' own skill tooling.

It does not claim that the broader `clawpowers` npm library becomes a native Hermes runtime plugin. In particular, the following remain library/runtime APIs unless separately implemented and validated as Hermes-native integrations:

- wallet APIs
- payments / x402 runtime flows
- RSI, memory, swarm, and other TypeScript library modules

Reference: `HERMES_COMPATIBILITY.md`
