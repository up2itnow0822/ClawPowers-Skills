---
name: security
description: "Infrastructure threat detection, vulnerability management, and security audit workflows for the OpenClaw workspace."
metadata:
  hermes:
    tags: [utilities, clawpowers-catalog, hermes-compatible]
---

<!-- generated-by: scripts/generate_hermes_wrappers.py -->

# Security

Security workflow wrapper for threat detection, vulnerability management, and audit-oriented checks across the workspace.

## Purpose

Infrastructure threat detection, vulnerability management, and security audit workflows for the OpenClaw workspace.

## When to use

- when investigating vulnerabilities or suspicious behavior
- when auditing a project before release or after changes
- when tracking remediation work for security findings
## Quickstart

- start with the concrete finding, alert, or attack surface
- separate severity assessment from remediation steps
- prefer verification and containment before claiming a fix
## Source of truth

- Catalog source: `src/skills/catalog.ts`
- Catalog entry source class: `managed`
- Category: `utilities`

## Notes

- The catalog positions this as an infrastructure and vulnerability workflow, not a generic coding skill.
- This wrapper does not claim bundled scanners, credentials, or external security services are preconfigured in Hermes.
## Compatibility boundary

This file is part of the Hermes-compatible top-level `skills/` surface for this branch. It should be read as a discoverable skill bundle, not as a blanket claim that the wider `clawpowers` library/runtime surface is fully configured inside Hermes.
