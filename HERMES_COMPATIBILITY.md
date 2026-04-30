# Hermes compatibility

ClawPowers supports Hermes Agent through the exported standard skill bundles in the top-level `skills/` directory.

## CI-backed support contract

The supported Hermes surface is:

- every direct child directory under `skills/` that contains a Hermes-loadable `SKILL.md` bundle
- discovery through Hermes Agent's own `tools.skills_tool.skills_list()` implementation
- sample loading through Hermes Agent's own `tools.skills_tool.skill_view()` implementation
- requirement checks through Hermes Agent's own `check_skills_requirements()` implementation

This is verified by `.github/workflows/hermes-compatibility.yml`, which checks out latest `NousResearch/hermes-agent` on `main`, installs it, syntax-checks `scripts/verify_hermes_wrappers.py`, and runs the verifier against this repo's exported skills.

## Current exported Hermes-loadable skill bundles

- total exported skills: 67
- deeper manually validated proof bundle: `skills/itp/SKILL.md`
- catalog-derived wrappers: 66
- richer generated wrappers with extra operator guidance: 10

## What this repo claims for Hermes

This repo claims that the top-level `skills/` directory is loadable by the latest Hermes Agent skill tooling as standard `SKILL.md` bundles.

This compatibility layer is intentionally skill-bundle compatibility. It does not claim that Hermes natively runs the full `clawpowers` npm runtime library.

## OpenClaw compatibility boundary

The latest OpenClaw compatibility is owned by `clawpowers-agent`, not this library package. Current launch pairing:

- `clawpowers-agent` 1.1.x
- `clawpowers` 2.2.x
- `openclaw` 2026.4.14
- Node.js 22+

The Hermes compatibility workflow validates the ClawPowers skill-bundle surface against latest Hermes Agent. The Agent repo validates the OpenClaw wrapper/runtime surface.

## What remains outside the Hermes-native runtime claim

The following are valid ClawPowers npm/library features, but they are not claimed as native Hermes runtime/package integrations merely because the skill bundles load:

- the broader `clawpowers` npm capability library
- wallet APIs as native Hermes package APIs
- payments / x402 runtime flows as native Hermes package APIs
- RSI, memory, swarm, and other TypeScript library modules unless separately validated as Hermes-ready skill bundles or a Hermes plugin/runtime integration

## Validation rule

A ClawPowers skill is treated as Hermes-compatible when it:

1. is exported as a standard `SKILL.md` bundle under `skills/`
2. can be discovered by Hermes from `~/.hermes/skills/`
3. loads cleanly through Hermes' own skill tooling
4. passes requirement checks without hidden patches
5. is covered by the `hermes-compatibility` workflow against latest Hermes Agent `main`

## Fast verification

Against the latest Hermes Agent `main` checkout, run from the ClawPowers-Skills repo root:

```bash
python3 scripts/verify_hermes_wrappers.py
```

To verify against an already-cloned Hermes checkout:

```bash
python3 scripts/verify_hermes_wrappers.py --hermes-agent /path/to/hermes-agent
```

To pin a specific Hermes ref:

```bash
python3 scripts/verify_hermes_wrappers.py --hermes-ref <git-ref>
```

## Current status

The repo exports the full catalog as Hermes-loadable bundles and has a dedicated CI workflow for latest-Hermes compatibility. The `itp` skill remains the deepest manually validated wedge. High-value generated wrappers include additional operator guidance while preserving the same Hermes skill-bundle boundary.
