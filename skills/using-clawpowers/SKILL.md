---
name: using-clawpowers
description: Meta-skill explaining ClawPowers, available skills, and how to trigger them. Auto-injected at session start.
version: 1.0.0
requires:
  tools: []
  runtime: false
metrics:
  tracks: [session_starts, skill_activations, platform]
  improves: [onboarding_clarity, trigger_accuracy]
---

# ClawPowers — Skills Framework

## When to Use

This skill activates automatically at session start. You never invoke it manually.

- **Session start:** Injected by the session hook to provide skill discovery
- **New user onboarding:** Reference this document when unsure which skill applies
- **Skill lookup:** Check the trigger map below to find the right skill for your task

## Core Methodology

ClawPowers follows a three-layer approach:

1. **Pattern Recognition** — Match your current task to a skill via the trigger map
2. **Skill Application** — Read the matched skill's SKILL.md and follow its methodology
3. **Outcome Tracking** — If runtime is available, record execution outcomes for self-improvement


You have ClawPowers loaded. This gives you 24 skills that go beyond static instructions — they execute tools, persist state across sessions, and track outcomes for self-improvement. The RSI Intelligence Layer (skills 21-24) enables the agent to improve its own methodology over time.

## How Skills Work

Skills activate automatically when you recognize a matching task pattern. You don't announce them. You just apply them.

**Pattern → Skill mapping:**

| When you encounter... | Apply this skill |
|----------------------|-----------------|
| A complex task that should be broken into parallel workstreams | `subagent-driven-development` |
| Writing new code, any feature | `test-driven-development` |
| A request to plan work | `writing-plans` |
| Executing a plan that already exists | `executing-plans` |
| "What should we do about X?" or ideation needed | `brainstorming` |
| A bug, unexpected behavior, or error | `systematic-debugging` |
| About to complete, merge, or hand off work | `verification-before-completion` |
| Done with a feature branch, need to merge | `finishing-a-development-branch` |
| Need someone else to review the code | `requesting-code-review` |
| Received code review feedback | `receiving-code-review` |
| Working on multiple branches simultaneously | `using-git-worktrees` |
| Need to create a new skill | `writing-skills` |
| Multiple independent tasks that can run concurrently | `dispatching-parallel-agents` |
| Making a payment or calling a paid API | `agent-payments` |
| Checking code/containers for vulnerabilities | `security-audit` |
| Writing blog posts, docs, or social content | `content-pipeline` |
| Need to understand how to learn something effectively | `learn-how-to-learn` |
| Competitive research or trend analysis | `market-intelligence` |
| Finding leads or prospects | `prospecting` |
| Task counter hits 50; skill success rates declining | `meta-skill-evolution` |
| Test suite fails; want automatic patch-and-commit | `self-healing-code` |
| Starting a task; want to check cross-project patterns first | `cross-project-knowledge` |
| After fixing a bug or architecture decision; want to store the pattern | `cross-project-knowledge` |
| TDD GREEN phase complete; want invariant property tests | `formal-verification-lite` |
| Need roundtrip/idempotence/commutativity tests for a pure function | `formal-verification-lite` |

## Reading a Skill

Skills are in `skills/<skill-name>/SKILL.md`. Read them with:

```bash
# From repo root
cat skills/systematic-debugging/SKILL.md
```

Or reference them by path in your context: `skills/systematic-debugging/SKILL.md`

## Runtime Layer

If the runtime is initialized (`~/.clawpowers/` exists), skills can:

1. **Persist state** — `runtime/persistence/store.sh get|set|list`
2. **Track outcomes** — `runtime/metrics/collector.sh` appends JSON lines
3. **Analyze performance** — `runtime/feedback/analyze.sh` computes success rates

Check if runtime is available:
```bash
[ -d ~/.clawpowers ] && echo "runtime available" || echo "static mode"
```

Initialize runtime:
```bash
npx clawpowers init
# or directly:
bash runtime/init.sh
```

## Graceful Degradation

Skills work in two modes:

- **Static mode** (no runtime): Skills provide methodology guidance. Same capability as competing frameworks.
- **Runtime mode** (`~/.clawpowers/` initialized): Full capability — persistence, metrics, RSI feedback, resumable workflows.

You never need to check the mode. Skills detect it themselves and adapt their instructions accordingly.

## Anti-Patterns

- **Don't announce skill usage** — Apply the skill silently, don't say "I'm now using the systematic-debugging skill"
- **Don't read the skill on every step** — Read once, apply throughout
- **Don't stack conflicting skills** — If TDD and subagent-driven-development both apply, let subagent-driven-development drive; it includes TDD internally
- **Don't ignore ClawPowers enhancements** — When the runtime is available, use it; the static path is a fallback, not the goal

## Quick Reference: All 24 Skills

### Core Development (14)
1. `subagent-driven-development` — Parallel subagents, two-stage review, worktree isolation
2. `test-driven-development` — RED-GREEN-REFACTOR with failure witness and autonomous mutation testing
3. `writing-plans` — Spec to sequenced 2-5 min tasks with dependency graph
4. `executing-plans` — Tracked execution with resumability and milestone persistence
5. `brainstorming` — Structured ideation with convergence protocol
6. `systematic-debugging` — Hypothesis-driven debugging with persistent hypothesis memory
7. `verification-before-completion` — Quality gates before any merge or handoff
8. `finishing-a-development-branch` — Branch cleanup, changelog, squash, merge prep
9. `requesting-code-review` — Review request with context, risk areas, reviewer matching
10. `receiving-code-review` — Constructive processing, pattern database, response protocol
11. `using-git-worktrees` — Isolated parallel branch development
12. `using-clawpowers` — This document
13. `writing-skills` — TDD for skills: test scenarios → fail → write skill → pass
14. `dispatching-parallel-agents` — Fan-out execution, load balancing, result aggregation

### Extended Capabilities (6)
15. `agent-payments` — x402 payment protocol, non-custodial wallets, spending limits
16. `security-audit` — Trivy, gitleaks, npm audit, bandit — actionable report output
17. `content-pipeline` — Write → humanize → format → publish workflow
18. `learn-how-to-learn` — 5-layer learning stack, 14 anti-patterns, confidence calibration
19. `market-intelligence` — Competitive analysis, trend detection, opportunity scoring
20. `prospecting` — ICP → company search → contact enrichment → outreach prep

### RSI Intelligence Layer (4) — NEW
21. `meta-skill-evolution` — Every 50 tasks: analyze outcomes, find weakest skill, surgically improve it, commit with version bump
22. `self-healing-code` — Test failure → hypothesis tree → ≥2 candidate patches → auto-commit winner or escalate
23. `cross-project-knowledge` — Persistent pattern KB across all projects; search before tasks, store after fixes
24. `formal-verification-lite` — Property-based testing (fast-check/Hypothesis) after TDD GREEN; 1000+ iterations per invariant

## Session Initialization Complete

ClawPowers is ready. 24 skills active. Skills activate on pattern recognition. Runtime enhancements available when `~/.clawpowers/` exists. RSI Intelligence Layer (meta-skill-evolution, self-healing-code, cross-project-knowledge, formal-verification-lite) provides persistent learning across sessions and projects.
