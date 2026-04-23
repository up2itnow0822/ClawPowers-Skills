---
name: 1password
description: "Set up and use 1Password CLI (op). Use when installing the CLI, enabling desktop app integration, signing in (single or multi-account), or reading/injecting/running secrets via op."
metadata:
  hermes:
    tags: [productivity, clawpowers-catalog, hermes-compatible]
---

<!-- generated-by: scripts/generate_hermes_wrappers.py -->

# 1password

This Hermes-compatible skill wrapper exports the ClawPowers catalog entry for `1password`.

## Purpose

Set up and use 1Password CLI (op). Use when installing the CLI, enabling desktop app integration, signing in (single or multi-account), or reading/injecting/running secrets via op.

## When to use

- use this skill when the task matches the capability described above
## Source of truth

- Catalog source: `src/skills/catalog.ts`
- Catalog entry source class: `openclaw-bundled`
- Category: `productivity`

## Notes

- This wrapper makes the skill discoverable and loadable by Hermes as a standard `SKILL.md` bundle.
- It does not, by itself, claim that every underlying runtime, CLI, API integration, or library dependency behind the broader ClawPowers ecosystem is fully configured in Hermes.
## Compatibility boundary

This file is part of the Hermes-compatible top-level `skills/` surface for this branch. It should be read as a discoverable skill bundle, not as a blanket claim that the wider `clawpowers` library/runtime surface is fully configured inside Hermes.
