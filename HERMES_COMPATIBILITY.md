# Hermes compatibility

This branch exists to expose the **Hermes-compatible** ClawPowers surface only.

## Support contract on this branch

The Hermes-supported surface is the top-level `skills/` directory.

Current exported Hermes-loadable skill bundles:

- total exported skills: 67
- richer validated proof bundle: `skills/itp/SKILL.md`
- remaining 66 skills exported as catalog-derived Hermes wrappers sourced from `src/skills/catalog.ts`

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

## Current status

The branch now exports the full catalog as Hermes-loadable bundles. The `itp` skill remains the deepest manually validated wedge. The rest are catalog-derived wrappers that now pass Hermes discovery/load expectations as `SKILL.md` skills.
