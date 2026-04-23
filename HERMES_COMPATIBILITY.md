# Hermes compatibility

This branch exists to expose the **Hermes-compatible** ClawPowers surface only.

## Support contract on this branch

The Hermes-supported surface is the top-level `skills/` directory.

Currently validated:

- `skills/itp/SKILL.md`

## What is not part of the Hermes compatibility claim

The following may still be useful in other environments, but they are **not** currently claimed as native Hermes-compatible surfaces on this branch:

- the broader `clawpowers` npm capability library
- wallet APIs
- payments / x402 runtime flows
- RSI, memory, swarm, and other library modules unless and until they are exported and validated as Hermes-ready skill bundles

## Validation rule

A ClawPowers surface should only be called Hermes-compatible on this branch if it:

1. is exported as a standard `SKILL.md` bundle under `skills/`
2. can be discovered by Hermes from `~/.hermes/skills/`
3. loads cleanly through Hermes' own skill tooling
4. passes requirement checks without hidden patches

## Current status

Validated first wedge:

- `itp` skill bundle

Anything broader than that should be treated as future work, not current support.
