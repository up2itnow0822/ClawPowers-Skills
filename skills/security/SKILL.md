---
name: security
description: "Infrastructure threat detection, vulnerability management, and security audit workflows for the OpenClaw workspace."
metadata:
  hermes:
    tags: [utilities, clawpowers-catalog, hermes-compatible]
---

# security

This Hermes-compatible skill wrapper exports the ClawPowers catalog entry for `security`.

## Purpose

Infrastructure threat detection, vulnerability management, and security audit workflows for the OpenClaw workspace.

## When to use

Use this skill when the task matches the capability described above.

## Current branch note

This wrapper is included so Hermes can discover and load the ClawPowers skill surface from this branch. It reflects the cataloged capability and category from ClawPowers.

## Source of truth

- Catalog source: `src/skills/catalog.ts`
- Catalog entry source class: `managed`
- Category: `utilities`

## Compatibility boundary

This wrapper makes the skill discoverable and loadable by Hermes as a standard `SKILL.md` bundle. It does not, by itself, claim that every underlying runtime, CLI, API integration, or library dependency behind the broader ClawPowers ecosystem is fully configured in Hermes.
