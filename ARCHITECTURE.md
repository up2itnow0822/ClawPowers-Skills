# ClawPowers Architecture

## Design Principles

1. **Skills execute, not just instruct.** Every skill can invoke tools, persist state, and measure outcomes.
2. **Simplicity is a feature.** Complex functionality, simple interface. One SKILL.md per skill. Zero mandatory dependencies.
3. **Progressive enhancement.** Works as static markdown (like competitors). Gains runtime powers when the persistence layer is available.
4. **Platform-agnostic.** Same skills, same format, every platform: Claude Code, Cursor, Codex, OpenCode, Gemini CLI.
5. **Self-improving.** The system gets better at helping you the more you use it.

## Skill Format

Every skill is a directory containing a `SKILL.md` with YAML frontmatter:

```yaml
---
name: skill-name
description: When to trigger this skill
version: 1.0.0
requires:
  tools: []          # Optional: CLI tools needed (e.g., git, npm, trivy)
  runtime: false     # Optional: true if skill needs persistence layer
metrics:
  tracks: []         # What outcomes this skill measures
  improves: []       # What parameters RSI can adjust
---
```

## Runtime Layer (Optional, Additive)

The runtime layer lives at `~/.clawpowers/` and provides three services:

### 1. Persistence (`runtime/persistence/`)
- File-based key-value store for cross-session state
- Checkpoint system for resumable workflows
- Schema: flat file key-value store under `state/`

### 2. Metrics (`runtime/metrics/`)
- Outcome tracking per skill execution
- Time-to-completion, success rate, error patterns
- Statistical process control for anomaly detection
- Export to JSON for dashboard consumption

### 3. Feedback (`runtime/feedback/`)
- RSI engine: measure → analyze → adapt cycle
- Parameter adjustment recommendations
- Skill effectiveness scoring
- Anti-pattern detection from execution history

## Session Hook

The session-start hook (`hooks/session-start`) injects the `using-clawpowers` skill content into the agent context. This is the only mandatory injection — all other skills load on-demand via trigger matching.

The hook:
1. Detects platform (Claude Code, Cursor, Codex, OpenCode, Gemini)
2. Reads `skills/using-clawpowers/SKILL.md`
3. Outputs platform-appropriate JSON for context injection
4. Optionally initializes persistence layer if not present

## Graceful Degradation

If the runtime layer is not installed:
- Skills still function as static methodology guides (same as competitors)
- Persistence features degrade to session-only memory
- Metrics are not collected
- RSI feedback is not available
- All extended skills that require tool execution note the limitation

This means ClawPowers works everywhere Superpowers works, and does more everywhere the runtime is available.
