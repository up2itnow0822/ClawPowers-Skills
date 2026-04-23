---
name: webmcp-payments
description: "Handle HTTP 402 Payment Required responses via agentpay-mcp, enabling autonomous micropayment execution within configured spending limits."
metadata:
  hermes:
    tags: [finance, clawpowers-catalog, hermes-compatible]
---

# webmcp-payments

This Hermes-compatible skill wrapper exports the ClawPowers catalog entry for `webmcp-payments`.

## Purpose

Handle HTTP 402 Payment Required responses via agentpay-mcp, enabling autonomous micropayment execution within configured spending limits.

## When to use

Use this skill when the task matches the capability described above.

## Current branch note

This wrapper is included so Hermes can discover and load the ClawPowers skill surface from this branch. It reflects the cataloged capability and category from ClawPowers.

## Source of truth

- Catalog source: `src/skills/catalog.ts`
- Catalog entry source class: `managed`
- Category: `finance`

## Compatibility boundary

This wrapper makes the skill discoverable and loadable by Hermes as a standard `SKILL.md` bundle. It does not, by itself, claim that every underlying runtime, CLI, API integration, or library dependency behind the broader ClawPowers ecosystem is fully configured in Hermes.
