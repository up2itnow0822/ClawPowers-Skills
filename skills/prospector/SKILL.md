---
name: prospector
description: "Find leads, prospects, and contacts matching an Ideal Customer Profile. Searches companies via Exa and enriches contacts via Apollo, outputting to CSV and optionally syncing to Attio CRM."
metadata:
  hermes:
    tags: [productivity, clawpowers-catalog, hermes-compatible]
---

# prospector

This Hermes-compatible skill wrapper exports the ClawPowers catalog entry for `prospector`.

## Purpose

Find leads, prospects, and contacts matching an Ideal Customer Profile. Searches companies via Exa and enriches contacts via Apollo, outputting to CSV and optionally syncing to Attio CRM.

## When to use

Use this skill when the task matches the capability described above.

## Current branch note

This wrapper is included so Hermes can discover and load the ClawPowers skill surface from this branch. It reflects the cataloged capability and category from ClawPowers.

## Source of truth

- Catalog source: `src/skills/catalog.ts`
- Catalog entry source class: `managed`
- Category: `productivity`

## Compatibility boundary

This wrapper makes the skill discoverable and loadable by Hermes as a standard `SKILL.md` bundle. It does not, by itself, claim that every underlying runtime, CLI, API integration, or library dependency behind the broader ClawPowers ecosystem is fully configured in Hermes.
