---
name: wacli
description: "Send WhatsApp messages to other people or search/sync WhatsApp history via the wacli CLI (not for normal user chats)."
metadata:
  hermes:
    tags: [communication, clawpowers-catalog, hermes-compatible]
---

# wacli

This Hermes-compatible skill wrapper exports the ClawPowers catalog entry for `wacli`.

## Purpose

Send WhatsApp messages to other people or search/sync WhatsApp history via the wacli CLI (not for normal user chats).

## When to use

Use this skill when the task matches the capability described above.

## Current branch note

This wrapper is included so Hermes can discover and load the ClawPowers skill surface from this branch. It reflects the cataloged capability and category from ClawPowers.

## Source of truth

- Catalog source: `src/skills/catalog.ts`
- Catalog entry source class: `openclaw-bundled`
- Category: `communication`

## Compatibility boundary

This wrapper makes the skill discoverable and loadable by Hermes as a standard `SKILL.md` bundle. It does not, by itself, claim that every underlying runtime, CLI, API integration, or library dependency behind the broader ClawPowers ecosystem is fully configured in Hermes.
