---
name: writing-skills
description: Create new ClawPowers skills using TDD methodology — write test scenarios, watch the agent fail without the skill, write the skill, verify the agent passes. Activate when you need a new skill that ClawPowers doesn't have.
version: 1.0.0
requires:
  tools: [bash]
  runtime: false
metrics:
  tracks: [skills_written, skill_quality_scores, test_coverage, anti_pattern_count]
  improves: [skill_structure_quality, when_to_use_clarity, example_relevance]
---

# Writing Skills

## When to Use

Apply this skill when:

- ClawPowers lacks a skill you need repeatedly
- You've solved a non-trivial problem 3+ times and want to codify the approach
- A team has domain-specific methodologies that should be agent-accessible
- An existing skill is missing important context or examples
- You're improving an existing skill that consistently produces suboptimal results

**Skip when:**
- The skill would be a one-off
- The methodology is already captured in a skill that could be extended
- You don't have enough real experience with the problem to write a useful skill (skills written from theory, not experience, are worse than no skill)

**Decision tree:**
```
Have you solved this problem multiple times manually?
├── No  → Solve it first. Document later.
└── Yes → Is it covered by an existing skill?
          ├── Yes → Extend the existing skill (new section, new example)
          └── No  → writing-skills ← YOU ARE HERE
```

## Core Methodology

### TDD for Skills

Skills are tested by measuring whether an agent WITHOUT the skill fails a scenario that an agent WITH the skill handles correctly. This is behavioral testing — not unit testing of code.

### Phase 1: Write Test Scenarios (RED)

Before writing any skill content, write test scenarios that the skill must handle.

**Test scenario format:**
```markdown
## Scenario N: [Descriptive name]

**Agent state:** Agent has no knowledge of [skill domain]
**Input:** [Exact prompt or situation the agent receives]
**Without skill:** [Specific wrong behavior the agent exhibits]
**With skill:** [Specific correct behavior the skill produces]
**Success criteria:**
- [ ] [Observable, verifiable outcome]
- [ ] [Observable, verifiable outcome]
```

**Minimum scenarios before writing the skill:**
- 1 happy path (common use case)
- 1 edge case (unusual but valid)
- 1 failure case (when NOT to use the skill)
- 1 anti-pattern case (common mistake the skill prevents)

**Example scenarios for a hypothetical "database-migration" skill:**

```markdown
## Scenario 1: Running migrations safely
Without skill: Agent runs `alembic upgrade head` without backing up first
With skill: Agent follows backup → dry-run → verify → apply sequence

## Scenario 2: Rolling back a bad migration
Without skill: Agent manually deletes rows or drops columns (data loss)
With skill: Agent runs `alembic downgrade -1`, verifies schema, identifies root cause

## Scenario 3: When NOT to use this skill
Input: "Update the user model to add an index"
Without skill: Agent triggers migration skill for every schema change
With skill: Agent recognizes index-only changes don't need this protocol

## Scenario 4: Anti-pattern — concurrent migrations
Without skill: Agent runs migrations in parallel across multiple servers
With skill: Agent ensures single-server serial execution with distributed lock
```

### Phase 2: Verify Failure (The "RED" Moment)

Before writing the skill, verify that an agent without it fails at least Scenario 1. This confirms:
- The skill is actually needed
- The test scenarios are meaningful
- The skill will produce measurable improvement

If an agent without the skill already handles the scenarios correctly, you don't need the skill.

### Phase 3: Write the Skill

Use the ClawPowers skill template:

```markdown
---
name: skill-name-kebab-case
description: [One sentence: when to trigger this skill. Start with "Activate when..."]
version: 1.0.0
requires:
  tools: [tool1, tool2]  # Only tools the skill actually requires
  runtime: false          # true if skill needs ~/.clawpowers/
metrics:
  tracks: [metric1, metric2]  # Observable outcomes
  improves: [param1, param2]  # Parameters RSI can tune
---

# [Skill Name]

## When to Use

[Decision tree. Include when to skip the skill.]

## Core Methodology

[The actual methodology. Numbered steps. Concrete, not abstract.]

## ClawPowers Enhancement

[What the runtime layer adds. Only if runtime: true or if runtime is optional benefit.]

## Anti-Patterns

[Table of common mistakes, why they fail, correct approach.]

## Examples

[1-3 concrete examples with real code/commands, not hypotheticals.]
```

### Phase 4: Quality Gates

Before the skill is "done", it must pass these gates:

**Gate 1: When to Use is a decision tree, not a list**
- Does it tell you when NOT to use the skill?
- Does it handle edge cases in the decision?

**Gate 2: Core Methodology is actionable**
- Can someone follow these steps without guessing?
- Does every step produce a verifiable output?
- Are code/command examples real, not pseudocode?

**Gate 3: Anti-Patterns are specific**
- Each anti-pattern names a specific behavior, not a category
- Each explains WHY it fails (not just "don't do this")
- Each provides a concrete correct approach

**Gate 4: Examples are real**
- Examples use plausible real names (not `foo`, `bar`, `example`)
- Code examples are syntactically correct
- Examples cover the most common real-world use case

**Gate 5: No stubs**
- No "TODO: add examples here"
- No "coming soon" sections
- No placeholder text

### Phase 5: Verify Pass (The "GREEN" Moment)

Apply the test scenarios to the completed skill. Verify:
- Scenario 1 (happy path): skill guides agent to correct outcome
- Scenario 2 (edge case): skill handles it explicitly or provides guidance
- Scenario 3 (skip case): skill's "When to Use" correctly excludes this
- Scenario 4 (anti-pattern): skill's Anti-Patterns section covers it

### Phase 6: Register the Skill

Add the skill to `skills/using-clawpowers/SKILL.md`:

```markdown
# In the "Quick Reference" section, add:
25. `database-migration` — Safe migration sequence with backup, dry-run, and rollback
```

Add trigger pattern to the pattern map:
```markdown
| Running or planning a database schema change | `database-migration` |
```

## ClawPowers Enhancement

When `~/.clawpowers/` runtime is initialized:

**Skill Quality Scoring:**

Each skill is scored on:
- Scenario coverage (how many test scenarios does it pass?)
- Usage frequency (how often is it triggered per session?)
- Outcome rate (when triggered, what % of executions succeed?)
- Anti-pattern prevention (how often does it prevent a documented anti-pattern?)

```bash
bash runtime/persistence/store.sh set "skill-quality:database-migration:scenario_coverage" "4/4"
bash runtime/persistence/store.sh set "skill-quality:database-migration:outcome_rate" "0.92"
```

**Anti-Pattern Detection:**

The feedback engine monitors skill usage for anti-patterns not covered by the skill:
```bash
bash runtime/feedback/analyze.sh --skill database-migration
# → New anti-pattern detected: agents omit the verify step after applying migrations
# → Recommend adding explicit verify step to Core Methodology
```

**Skill Evolution:**

When a skill's outcome rate drops below threshold (< 80%), the feedback engine flags it for revision:
```bash
bash runtime/metrics/collector.sh record \
  --skill writing-skills \
  --outcome success \
  --notes "database-migration: 4 scenarios, all passing, quality gates cleared"
```

## Anti-Patterns

| Anti-Pattern | Why It Fails | Correct Approach |
|-------------|-------------|-----------------|
| Writing from theory | Skill misses real-world edge cases | Write skills from real experience only |
| Skipping test scenarios | No way to verify the skill works | Write scenarios first (TDD) |
| Vague "When to Use" | Skill triggers at wrong times | Decision tree with explicit skip conditions |
| Placeholder sections | Skill is deployed incomplete | All sections must be complete before registration |
| One giant methodology section | Agents lose track of where they are | Numbered steps with verifiable outputs |
| No anti-patterns section | Common mistakes recur | Always include anti-patterns |
| Examples with foo/bar names | Low signal — agents don't recognize applicability | Use realistic domain names in examples |

## Examples

### Example 1: Simple Skill (2 scenarios)

**Skill:** `git-submodule-update`
**Problem:** Agents frequently forget to update submodules after `git pull`

**Scenarios:**
1. After `git pull`, submodule code is stale — skill ensures `git submodule update --init --recursive`
2. New submodule added — skill ensures `git submodule update --init` for new submodules only

**Skill structure:** When to Use → 3-step methodology (detect stale, update, verify) → 2 anti-patterns → 1 example

### Example 2: Complex Skill (4 scenarios)

**Skill:** `zero-downtime-deployment`
**Problem:** Agents deploy without considering traffic impact

**Scenarios:**
1. Deploying new version (happy path) — blue-green or rolling strategy
2. Deploying with schema migration — migration-first, app second
3. Rolling back a bad deploy — revert app before revert migration
4. Skip case — deploying to a dev environment with no traffic

**Skill structure:** When to Use (with explicit skip for dev) → 5-step methodology → 4 anti-patterns → 2 examples (with and without migration)
