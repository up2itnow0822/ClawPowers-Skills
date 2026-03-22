# ClawPowers for OpenCode — Installation

Fetch and follow these instructions to install ClawPowers skills in your OpenCode session.

## Quick Install

Paste this into your OpenCode session:

```
Fetch and follow instructions from https://raw.githubusercontent.com/up2itnow0822/clawpowers/main/.opencode/INSTALL.md
```

## What Gets Installed

ClawPowers injects 20 skills into your agent context:

- **14 Core Development Skills** — TDD, subagent orchestration, systematic debugging, code review, git worktrees, planning, and more
- **6 Extended Skills** — Agent payments (x402), security auditing, content pipeline, market intelligence, lead prospecting, and metacognitive learning

## Session Hook Setup

To auto-inject ClawPowers on every OpenCode session start, add to your OpenCode configuration:

```json
{
  "hooks": {
    "session_start": "bash /path/to/clawpowers/hooks/session-start"
  }
}
```

## Manual Context Injection

Copy the contents of `skills/using-clawpowers/SKILL.md` and prepend it to your OpenCode session context. This gives you all skill triggers without the runtime layer.

## Runtime Layer (Optional)

For persistent memory, outcome tracking, and self-improvement:

```bash
npx clawpowers init
```

Creates `~/.clawpowers/` with:
- `state/` — cross-session key-value store
- `metrics/` — JSONL outcome logs per skill
- `checkpoints/` — resumable workflow state
- `feedback/` — RSI analysis outputs

## Skills Reference

Skills activate on pattern recognition. See `skills/using-clawpowers/SKILL.md` for the full list of 20 skills and their trigger conditions.
