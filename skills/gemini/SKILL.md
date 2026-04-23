---
name: gemini
description: "Gemini CLI for one-shot Q&A, summaries, and generation."
metadata:
  hermes:
    tags: [ai, clawpowers-catalog, hermes-compatible]
---

# gemini

This Hermes-compatible skill wrapper exports the ClawPowers catalog entry for `gemini`.

## Purpose

Gemini CLI for one-shot Q&A, summaries, and generation.

## When to use

Use this skill when the task matches the capability described above.

## Current branch note

This wrapper is included so Hermes can discover and load the ClawPowers skill surface from this branch. It reflects the cataloged capability and category from ClawPowers.

## Source of truth

- Catalog source: `src/skills/catalog.ts`
- Catalog entry source class: `openclaw-bundled`
- Category: `ai`

## Compatibility boundary

This wrapper makes the skill discoverable and loadable by Hermes as a standard `SKILL.md` bundle. It does not, by itself, claim that every underlying runtime, CLI, API integration, or library dependency behind the broader ClawPowers ecosystem is fully configured in Hermes.
