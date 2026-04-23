---
name: validator-agent
description: "Multi-round automated validation pipeline for TypeScript/Solidity projects. Runs 8 rounds of checks before any publish or deploy: compile gate, lint, test suite, security audit, type coverage, docs, changelog, and final review."
metadata:
  hermes:
    tags: [development, clawpowers-catalog, hermes-compatible]
---

# validator-agent

This Hermes-compatible skill wrapper exports the ClawPowers catalog entry for `validator-agent`.

## Purpose

Multi-round automated validation pipeline for TypeScript/Solidity projects. Runs 8 rounds of checks before any publish or deploy: compile gate, lint, test suite, security audit, type coverage, docs, changelog, and final review.

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
