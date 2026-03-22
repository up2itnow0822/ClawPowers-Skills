# ClawPowers Build Specification — For Cursor Agent

## Context
You are building ClawPowers — a skills framework for coding agents that competes with obra/superpowers (103K stars). ClawPowers does everything superpowers does, but adds runtime execution, persistence, self-improvement, and domain skills that static frameworks can't touch.

Read README.md and ARCHITECTURE.md first for the full vision.

## What To Build (Priority Order)

### Phase 1: Core Infrastructure

1. **`hooks/session-start`** — Bash script that detects platform (Claude Code, Cursor, Codex, OpenCode, Gemini) and injects using-clawpowers SKILL.md. Model after superpowers' hook but cleaner — no EXTREMELY_IMPORTANT tags, use standard skill injection format. Must handle: CLAUDE_PLUGIN_ROOT, CURSOR_PLUGIN_ROOT, CODEX env, OpenCode, and Gemini. Output platform-appropriate JSON.

2. **`package.json`** — Name: "clawpowers", version: "1.0.0", MIT license, bin entry for `npx clawpowers init`. Zero runtime dependencies.

3. **Plugin manifests:**
   - `.claude-plugin` — Claude Code plugin manifest
   - `.cursor-plugin` — Cursor plugin manifest  
   - `.codex` — Codex configuration
   - `.opencode/INSTALL.md` — OpenCode setup instructions
   - `gemini-extension.json` — Gemini CLI extension

### Phase 2: Core Development Skills (14 skills)

For EACH skill, create a `SKILL.md` in the skill's directory. Each skill MUST:
- Have YAML frontmatter (name, description, version, requires, metrics)
- Be genuinely useful — not a stub, not a summary
- Include "When to Use" decision tree
- Include the core methodology with concrete steps
- Include "ClawPowers Enhancement" section describing what the runtime layer adds
- Be at LEAST as detailed as the superpowers equivalent, preferably more
- Include anti-patterns section
- Include examples

Here are the 14 core skills to build:

1. **subagent-driven-development** — Fresh subagent per task, two-stage review (spec + quality), Git worktree isolation. Enhancement: persistent execution DB, resumable checkpoints, outcome metrics per subagent.

2. **test-driven-development** — RED-GREEN-REFACTOR with mandatory failure witness. Enhancement: mutation analysis integration, test portfolio lifecycle, effectiveness scoring.

3. **writing-plans** — Spec → sequenced implementation tasks (2-5 min each). Enhancement: historical task estimation calibration, dependency graph validation.

4. **executing-plans** — Execute plans with progress tracking. Enhancement: milestone persistence, interruption recovery, progress dashboards.

5. **brainstorming** — Structured ideation with convergence. Enhancement: cross-session idea persistence, pattern linking.

6. **systematic-debugging** — Hypothesis-driven debugging with evidence collection. Enhancement: persistent hypothesis tree, known-issue pattern matching.

7. **verification-before-completion** — Quality gates before merge/completion. Enhancement: automated verification suite execution, historical pass rates.

8. **finishing-a-development-branch** — Branch cleanup, changelog, merge prep. Enhancement: automated squash strategy, conventional commit enforcement.

9. **requesting-code-review** — Prepare review request with context. Enhancement: reviewer matching based on code area expertise.

10. **receiving-code-review** — Process feedback constructively. Enhancement: feedback pattern database, common issues tracking.

11. **using-git-worktrees** — Isolated branch development. Enhancement: worktree lifecycle management, conflict prediction.

12. **using-clawpowers** — Meta-skill: how the framework works, how to trigger skills. This is the one injected at session start.

13. **writing-skills** — TDD-for-skills: write test scenarios, watch agent fail, write skill, watch pass. Enhancement: skill quality scoring.

14. **dispatching-parallel-agents** — Fan-out work to parallel agents. Enhancement: load balancing, failure isolation, result aggregation.

### Phase 3: Extended Skills (6 skills)

These are ClawPowers exclusives — capabilities static frameworks cannot provide:

15. **agent-payments** — x402 payment protocol for agents. Non-custodial wallets, EVM spending limits, HTTP 402 negotiation. Reference: agentpay-mcp documentation.

16. **security-audit** — Automated security scanning. Trivy for containers, gitleaks for secrets, npm audit for dependencies, bandit for Python. Produces actionable reports.

17. **content-pipeline** — Write technical content → humanize for natural voice → format for platform → publish. Covers blog posts, social media, documentation.

18. **learn-how-to-learn** — Metacognitive skill. 5-layer learning stack, anti-pattern detection (14 cognitive failure modes), confidence calibration, common sense checks. Reference: our existing learn-how-to-learn skill.

19. **market-intelligence** — Competitive analysis, trend detection, opportunity scoring. Web research methodology, source validation, insight extraction.

20. **prospecting** — Lead generation workflow. ICP definition → company search → contact enrichment → outreach prep. CRM integration patterns.

### Phase 4: Runtime Layer

Build lightweight implementations of:

1. **`runtime/persistence/store.sh`** — Bash-based key-value persistence using `~/.clawpowers/state/`. Simple file-based store that works everywhere. No database dependency.

2. **`runtime/metrics/collector.sh`** — Outcome tracking. Appends JSON lines to `~/.clawpowers/metrics/`. One line per skill execution with: skill name, timestamp, duration, outcome (success/failure), notes.

3. **`runtime/feedback/analyze.sh`** — Reads metrics, computes per-skill success rates, identifies skills with declining performance, outputs recommendations.

4. **`runtime/init.sh`** — Creates `~/.clawpowers/` directory structure on first run.

### Phase 5: Tests

Create test scripts that validate:
- Session hook outputs correct JSON for each platform
- Each skill has valid YAML frontmatter
- All skills are referenced in using-clawpowers
- Runtime scripts create correct directory structure
- Metrics collector produces valid JSON lines

## Quality Requirements

- Every SKILL.md must be complete and useful — no stubs, no TODOs
- Shell scripts must be POSIX-compatible where possible (bash for advanced features)
- Zero external dependencies for core functionality
- Every file must have proper headers/documentation
- The README.md already exists — don't overwrite it, but you can improve it
