---
name: autoresearch
description: "Autonomous code quality improvement loop using keep-or-revert cycles. Optimizes a composite quality score derived from tests, lint, and type coverage."
metadata:
  hermes:
    tags: [development, clawpowers-catalog, hermes-compatible]
---

<!-- generated-by: scripts/generate_hermes_wrappers.py -->

# Autoresearch — Autonomous Code Quality & RSI Loop

Autonomous code quality and harness-improvement loop for audits, baselines, and keep-or-revert mutation experiments.

## Purpose

Autonomous code quality improvement loop using keep-or-revert cycles. Optimizes a composite quality score derived from tests, lint, and type coverage.

## When to use

- when you need a code audit or quality scan
- when you want a baseline before making changes
- when running a small keep-or-revert improvement loop
- when evaluating prompt or harness mutations
## Quickstart

- python3 tools/autoresearch-mlx/autoresearch_agent.py audit <path>
- python3 tools/autoresearch-mlx/autoresearch_agent.py baseline <path>
- python3 tools/autoresearch-mlx/autoresearch_agent.py scan <path>
## Source of truth

- Catalog source: `src/skills/catalog.ts`
- Catalog entry source class: `managed`
- Category: `development`

## Notes

- Use one mutation per experiment and keep it reversible.
- If quality regresses, revert immediately.
- This wrapper summarizes the real workspace skill without claiming the full local toolchain ships inside this repo.
## Compatibility boundary

This file is part of the Hermes-compatible top-level `skills/` surface for this branch. It should be read as a discoverable skill bundle, not as a blanket claim that the wider `clawpowers` library/runtime surface is fully configured inside Hermes.
