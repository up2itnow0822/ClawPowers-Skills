---
name: business-strategy
description: "PMF validation, beachhead identification, activity ROI analysis, kill/invest decisions, and strategic metrics for the AI Agent Economy."
metadata:
  hermes:
    tags: [productivity, clawpowers-catalog, hermes-compatible]
---

# business-strategy

This Hermes-compatible skill wrapper exports the ClawPowers catalog entry for `business-strategy`.

## Purpose

PMF validation, beachhead identification, activity ROI analysis, kill/invest decisions, and strategic metrics for the AI Agent Economy.

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
