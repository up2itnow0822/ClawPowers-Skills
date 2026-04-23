---
name: agent-nexus-2
description: "Multi-agent coordination and task delegation for complex workflows requiring parallel agent execution."
metadata:
  hermes:
    tags: [development, clawpowers-catalog, hermes-compatible]
---

# agent-nexus-2

This Hermes-compatible skill wrapper exports the ClawPowers catalog entry for `agent-nexus-2`.

## Purpose

Multi-agent coordination and task delegation for complex workflows requiring parallel agent execution.

## When to use

Use this skill when the task matches the capability described above.

## Current branch note

This wrapper is included so Hermes can discover and load the ClawPowers skill surface from this branch. It reflects the cataloged capability and category from ClawPowers.

## Source of truth

- Catalog source: `src/skills/catalog.ts`
- Catalog entry source class: `managed`
- Category: `development`

## Compatibility boundary

This wrapper makes the skill discoverable and loadable by Hermes as a standard `SKILL.md` bundle. It does not, by itself, claim that every underlying runtime, CLI, API integration, or library dependency behind the broader ClawPowers ecosystem is fully configured in Hermes.
