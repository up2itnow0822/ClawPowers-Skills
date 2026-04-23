---
name: github
description: "GitHub operations via `gh` CLI: issues, PRs, CI runs, code review, API queries. Use when: (1) checking PR status or CI, (2) creating/commenting on issues, (3) listing/filtering PRs or issues, (4) viewing diffs."
metadata:
  hermes:
    tags: [development, clawpowers-catalog, hermes-compatible]
---

# github

This Hermes-compatible skill wrapper exports the ClawPowers catalog entry for `github`.

## Purpose

GitHub operations via `gh` CLI: issues, PRs, CI runs, code review, API queries. Use when: (1) checking PR status or CI, (2) creating/commenting on issues, (3) listing/filtering PRs or issues, (4) viewing diffs.

## When to use

Use this skill when the task matches the capability described above.

## Current branch note

This wrapper is included so Hermes can discover and load the ClawPowers skill surface from this branch. It reflects the cataloged capability and category from ClawPowers.

## Source of truth

- Catalog source: `src/skills/catalog.ts`
- Catalog entry source class: `openclaw-bundled`
- Category: `development`

## Compatibility boundary

This wrapper makes the skill discoverable and loadable by Hermes as a standard `SKILL.md` bundle. It does not, by itself, claim that every underlying runtime, CLI, API integration, or library dependency behind the broader ClawPowers ecosystem is fully configured in Hermes.
