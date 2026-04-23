---
name: strykr-prism
description: "Real-time financial data API for AI agents. Stocks, crypto, forex, ETFs. 120+ endpoints. Alternative to Alpha Vantage, CoinGecko. Works with Claude, Cursor."
metadata:
  hermes:
    tags: [finance, clawpowers-catalog, hermes-compatible]
---

<!-- generated-by: scripts/generate_hermes_wrappers.py -->

# Strykr PRISM

Unified financial data API skill for crypto, stocks, forex, ETFs, and market analysis workflows.

## Purpose

Real-time financial data API for AI agents. Stocks, crypto, forex, ETFs. 120+ endpoints. Alternative to Alpha Vantage, CoinGecko. Works with Claude, Cursor.

## When to use

- when the user needs live market data or symbol resolution
- when checking trending assets, sentiment, or market overview
- when pulling token-risk or venue data for an agent workflow
## Quickstart

- export PRISM_API_KEY before use
- resolve an asset first when the symbol is ambiguous
- use the market overview and price endpoints for fast analyst workflows
## Source of truth

- Catalog source: `src/skills/catalog.ts`
- Catalog entry source class: `managed`
- Category: `finance`

## Notes

- The source skill contains a much larger endpoint catalog and examples.
- This wrapper does not imply the external PRISM service is bundled with this repo.
## Compatibility boundary

This file is part of the Hermes-compatible top-level `skills/` surface for this branch. It should be read as a discoverable skill bundle, not as a blanket claim that the wider `clawpowers` library/runtime surface is fully configured inside Hermes.
