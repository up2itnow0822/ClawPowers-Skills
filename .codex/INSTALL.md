# ClawPowers for Codex — Installation

Fetch and follow these instructions to install ClawPowers skills in your Codex session.

## Quick Install

Paste this into your Codex session:

```
Fetch and follow instructions from https://raw.githubusercontent.com/up2itnow0822/clawpowers/main/.codex/INSTALL.md
```

## What Gets Installed

ClawPowers injects 20 skills into your agent context:

- **14 Core Development Skills** — TDD, subagent orchestration, systematic debugging, code review, git worktrees, planning, and more
- **6 Extended Skills** — Agent payments (x402), security auditing, content pipeline, market intelligence, lead prospecting, and metacognitive learning

## Manual Setup

If the quick install fails, copy the contents of `skills/using-clawpowers/SKILL.md` from the repository root and paste it into your Codex session context.

## Runtime Layer (Optional)

For persistent memory and self-improvement features:

```bash
npx clawpowers init
```

This creates `~/.clawpowers/` with state, metrics, checkpoints, and feedback directories.

## Skills Reference

Once installed, skills activate automatically when Codex recognizes matching task patterns. See `skills/using-clawpowers/SKILL.md` for the full trigger map.
