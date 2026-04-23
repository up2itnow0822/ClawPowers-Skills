---
name: coding-discipline.skill
description: "Enforces strict TypeScript coding standards, test-first development, and zero-stub policies for production-grade agent code."
metadata:
  hermes:
    tags: [development, clawpowers-catalog, hermes-compatible]
---

# coding-discipline.skill

This Hermes-compatible skill wrapper exports the ClawPowers catalog entry for `coding-discipline.skill`.

## Purpose

Enforces strict TypeScript coding standards, test-first development, and zero-stub policies for production-grade agent code.

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
