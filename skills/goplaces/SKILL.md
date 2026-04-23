---
name: goplaces
description: "Query Google Places API (New) via the goplaces CLI for text search, place details, resolve, and reviews. Use for human-friendly place lookup or JSON output for scripts."
metadata:
  hermes:
    tags: [utilities, clawpowers-catalog, hermes-compatible]
---

# goplaces

This Hermes-compatible skill wrapper exports the ClawPowers catalog entry for `goplaces`.

## Purpose

Query Google Places API (New) via the goplaces CLI for text search, place details, resolve, and reviews. Use for human-friendly place lookup or JSON output for scripts.

## When to use

Use this skill when the task matches the capability described above.

## Current branch note

This wrapper is included so Hermes can discover and load the ClawPowers skill surface from this branch. It reflects the cataloged capability and category from ClawPowers.

## Source of truth

- Catalog source: `src/skills/catalog.ts`
- Catalog entry source class: `openclaw-bundled`
- Category: `utilities`

## Compatibility boundary

This wrapper makes the skill discoverable and loadable by Hermes as a standard `SKILL.md` bundle. It does not, by itself, claim that every underlying runtime, CLI, API integration, or library dependency behind the broader ClawPowers ecosystem is fully configured in Hermes.
