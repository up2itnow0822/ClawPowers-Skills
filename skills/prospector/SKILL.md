---
name: prospector
description: "Find leads, prospects, and contacts matching an Ideal Customer Profile. Searches companies via Exa and enriches contacts via Apollo, outputting to CSV and optionally syncing to Attio CRM."
metadata:
  hermes:
    tags: [productivity, clawpowers-catalog, hermes-compatible]
---

<!-- generated-by: scripts/generate_hermes_wrappers.py -->

# Prospector

Lead-generation workflow for finding companies and enriching contacts against an ICP.

## Purpose

Find leads, prospects, and contacts matching an Ideal Customer Profile. Searches companies via Exa and enriches contacts via Apollo, outputting to CSV and optionally syncing to Attio CRM.

## When to use

- when the user asks to find leads or prospects
- when building a contact list that matches an ICP
- when exporting prospect results to CSV or syncing to CRM
## Quickstart

- configure Exa and Apollo API keys first
- collect ICP inputs such as industry, company size, geography, and contact count
- run the search and export results to CSV
## Source of truth

- Catalog source: `src/skills/catalog.ts`
- Catalog entry source class: `managed`
- Category: `productivity`

## Notes

- The source skill expects Exa and Apollo, with optional Attio sync.
- This wrapper does not claim those third-party credentials or integrations are preconfigured in Hermes.
## Compatibility boundary

This file is part of the Hermes-compatible top-level `skills/` surface for this branch. It should be read as a discoverable skill bundle, not as a blanket claim that the wider `clawpowers` library/runtime surface is fully configured inside Hermes.
