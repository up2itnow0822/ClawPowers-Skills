---
name: execution-validation.skill
description: "Multi-round automated validation pipeline for TypeScript/Solidity projects before publish or deploy."
metadata:
  hermes:
    tags: [development, clawpowers-catalog, hermes-compatible]
---

<!-- generated-by: scripts/generate_hermes_wrappers.py -->

# execution-validation.skill

This Hermes-compatible skill wrapper exports the ClawPowers catalog entry for `execution-validation.skill`.

## Purpose

Multi-round automated validation pipeline for TypeScript/Solidity projects before publish or deploy.

## When to use

- use this skill when the task matches the capability described above
## Source of truth

- Catalog source: `src/skills/catalog.ts`
- Catalog entry source class: `managed`
- Category: `development`

## Notes

- This wrapper makes the skill discoverable and loadable by Hermes as a standard `SKILL.md` bundle.
- It does not, by itself, claim that every underlying runtime, CLI, API integration, or library dependency behind the broader ClawPowers ecosystem is fully configured in Hermes.
## Compatibility boundary

This file is part of the Hermes-compatible top-level `skills/` surface for this branch. It should be read as a discoverable skill bundle, not as a blanket claim that the wider `clawpowers` library/runtime surface is fully configured inside Hermes.
