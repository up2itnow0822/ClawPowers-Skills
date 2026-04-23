---
name: validator-agent
description: "Multi-round automated validation pipeline for TypeScript/Solidity projects. Runs 8 rounds of checks before any publish or deploy: compile gate, lint, test suite, security audit, type coverage, docs, changelog, and final review."
metadata:
  hermes:
    tags: [development, clawpowers-catalog, hermes-compatible]
---

<!-- generated-by: scripts/generate_hermes_wrappers.py -->

# Validator Agent

Multi-round validation gate for TypeScript and Solidity projects before merge or publish.

## Purpose

Multi-round automated validation pipeline for TypeScript/Solidity projects. Runs 8 rounds of checks before any publish or deploy: compile gate, lint, test suite, security audit, type coverage, docs, changelog, and final review.

## When to use

- before merging a PR
- before npm publish or release
- after dependency or build-system changes
## Quickstart

- run compile or typecheck first
- then run tests, security checks, and docs/changelog verification
- treat any blocking issue as a stop signal until fixed
## Source of truth

- Catalog source: `src/skills/catalog.ts`
- Catalog entry source class: `managed`
- Category: `development`

## Notes

- The source skill is read-only and produces a verdict rather than modifying code.
- This wrapper summarizes the validation lane without claiming the full project-specific toolchain is present in Hermes.
## Compatibility boundary

This file is part of the Hermes-compatible top-level `skills/` surface for this branch. It should be read as a discoverable skill bundle, not as a blanket claim that the wider `clawpowers` library/runtime surface is fully configured inside Hermes.
