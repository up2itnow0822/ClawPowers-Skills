---
name: github
description: "GitHub operations via `gh` CLI: issues, PRs, CI runs, code review, API queries. Use when: (1) checking PR status or CI, (2) creating/commenting on issues, (3) listing/filtering PRs or issues, (4) viewing diffs."
metadata:
  hermes:
    tags: [development, clawpowers-catalog, hermes-compatible]
---

<!-- generated-by: scripts/generate_hermes_wrappers.py -->

# GitHub

GitHub workflow wrapper for PRs, issues, CI runs, diffs, and API queries through the usual gh-driven lane.

## Purpose

GitHub operations via `gh` CLI: issues, PRs, CI runs, code review, API queries. Use when: (1) checking PR status or CI, (2) creating/commenting on issues, (3) listing/filtering PRs or issues, (4) viewing diffs.

## When to use

- when checking PR or CI status
- when creating or commenting on issues and pull requests
- when reviewing diffs or querying GitHub state quickly
## Quickstart

- confirm the repo and target issue or PR first
- use the gh-driven lane for status, comments, diffs, and workflow inspection
- treat auth and repo context as prerequisites before acting
## Source of truth

- Catalog source: `src/skills/catalog.ts`
- Catalog entry source class: `openclaw-bundled`
- Category: `development`

## Notes

- The catalog explicitly scopes this skill to issues, PRs, CI, review, and API queries.
- This Hermes wrapper does not guarantee gh auth or GitHub credentials are already configured in the current environment.
## Compatibility boundary

This file is part of the Hermes-compatible top-level `skills/` surface for this branch. It should be read as a discoverable skill bundle, not as a blanket claim that the wider `clawpowers` library/runtime surface is fully configured inside Hermes.
