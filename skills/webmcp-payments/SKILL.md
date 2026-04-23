---
name: webmcp-payments
description: "Handle HTTP 402 Payment Required responses via agentpay-mcp, enabling autonomous micropayment execution within configured spending limits."
metadata:
  hermes:
    tags: [finance, clawpowers-catalog, hermes-compatible]
---

<!-- generated-by: scripts/generate_hermes_wrappers.py -->

# WebMCP Payments

Payments workflow wrapper for handling HTTP 402 Payment Required responses through agentpay-mcp within approved spending limits.

## Purpose

Handle HTTP 402 Payment Required responses via agentpay-mcp, enabling autonomous micropayment execution within configured spending limits.

## When to use

- when a workflow hits an HTTP 402 payment-required response
- when an agent needs to decide whether a micropayment is allowed
- when connecting payment-required APIs to a policy-controlled execution path
## Quickstart

- detect the 402 and capture the payment metadata first
- check the spending policy before attempting execution
- route execution through the AgentPay MCP lane instead of treating payment as an unguarded side effect
## Source of truth

- Catalog source: `src/skills/catalog.ts`
- Catalog entry source class: `managed`
- Category: `finance`

## Notes

- Current product naming in the broader workspace is AgentPay MCP, while this catalog entry remains webmcp-payments.
- This wrapper does not imply payment credentials, wallets, or spending policies are already configured inside Hermes.
## Compatibility boundary

This file is part of the Hermes-compatible top-level `skills/` surface for this branch. It should be read as a discoverable skill bundle, not as a blanket claim that the wider `clawpowers` library/runtime surface is fully configured inside Hermes.
