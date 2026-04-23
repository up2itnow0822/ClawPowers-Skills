---
name: content-writer
description: "Use this skill everytime you are writing an article, social media post, email, etc."
metadata:
  hermes:
    tags: [communication, clawpowers-catalog, hermes-compatible]
---

<!-- generated-by: scripts/generate_hermes_wrappers.py -->

# Content Writer

Platform-aware writing skill for articles, posts, emails, and other outward-facing copy.

## Purpose

Use this skill everytime you are writing an article, social media post, email, etc.

## When to use

- when writing an article, social post, email, or announcement
- when adapting the same idea to multiple platforms
- when you need concise platform-specific formatting rules
## Quickstart

- Use plain punctuation, straight quotes, and simple bullets.
- Avoid AI-slop phrasing and repetitive listicle structure.
- Match the output to the target platform instead of writing one generic draft.
## Source of truth

- Catalog source: `src/skills/catalog.ts`
- Catalog entry source class: `managed`
- Category: `communication`

## Notes

- The source skill is stricter than this wrapper and includes extensive formatting and tone rules.
- This branch exports a Hermes-loadable version of the skill surface, not the entire external content pipeline.
## Compatibility boundary

This file is part of the Hermes-compatible top-level `skills/` surface for this branch. It should be read as a discoverable skill bundle, not as a blanket claim that the wider `clawpowers` library/runtime surface is fully configured inside Hermes.
