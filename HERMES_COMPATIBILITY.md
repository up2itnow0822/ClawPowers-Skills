# Hermes compatibility

This branch exists to expose the **Hermes-compatible** ClawPowers surface only.

## Support contract on this branch

The Hermes-supported surface is the top-level `skills/` directory.

Current exported Hermes-loadable skill bundles:

- total exported skills: 67
- richer validated proof bundle: `skills/itp/SKILL.md`
- catalog-derived wrappers: 66
- richer generated wrappers with extra operator guidance: 10

## What this branch claims

This branch claims that the top-level `skills/` directory is Hermes-loadable as standard `SKILL.md` bundles.

## What is not part of the Hermes-native runtime claim

The following may still be useful in other environments, but they are **not** currently claimed here as native Hermes runtime/package surfaces just because the skill bundles load:

- the broader `clawpowers` npm capability library
- wallet APIs as a native Hermes package feature
- payments / x402 runtime flows as a native Hermes package feature
- RSI, memory, swarm, and other library modules as native Hermes package features unless separately validated in that form

## Validation rule

A ClawPowers skill is treated as Hermes-compatible on this branch when it:

1. is exported as a standard `SKILL.md` bundle under `skills/`
2. can be discovered by Hermes from `~/.hermes/skills/`
3. loads cleanly through Hermes' own skill tooling
4. passes requirement checks without hidden patches

## Fast verification

Run:

```bash
python3 scripts/verify_hermes_wrappers.py
```

## Current status

The branch exports the full catalog as Hermes-loadable bundles. The `itp` skill remains the deepest manually validated wedge. A small set of high-value skills now also gets richer generated guidance from curated overrides while preserving the same Hermes compatibility boundary.
