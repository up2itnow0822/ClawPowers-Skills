---
name: humanize
description: "Transforms AI-generated writing into content that reads authentically human — passing AI detectors and resonating with real readers."
metadata:
  hermes:
    tags: [communication, clawpowers-catalog, hermes-compatible]
---

<!-- generated-by: scripts/generate_hermes_wrappers.py -->

# Humanize

Rewrite protocol for making drafts sound like a specific human rather than generic AI copy.

## Purpose

Transforms AI-generated writing into content that reads authentically human — passing AI detectors and resonating with real readers.

## When to use

- after a first draft exists
- before publishing external content
- when the copy sounds too polished, flat, or corporate
## Quickstart

- add specifics such as dates, versions, names, and concrete numbers
- vary sentence length on purpose
- state a real opinion instead of hedging every claim
## Source of truth

- Catalog source: `src/skills/catalog.ts`
- Catalog entry source class: `managed`
- Category: `communication`

## Notes

- The source skill includes a fuller rewrite framework, self-check protocol, and companion files.
- This wrapper exposes the discoverable Hermes skill surface only.
## Compatibility boundary

This file is part of the Hermes-compatible top-level `skills/` surface for this branch. It should be read as a discoverable skill bundle, not as a blanket claim that the wider `clawpowers` library/runtime surface is fully configured inside Hermes.
