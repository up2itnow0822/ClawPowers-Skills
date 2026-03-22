---
name: writing-plans
description: Transform a specification or goal into a sequenced implementation plan of concrete 2-5 minute tasks with dependency graph. Activate when someone asks you to plan work, before starting any substantial feature.
version: 1.0.0
requires:
  tools: []
  runtime: false
metrics:
  tracks: [plan_accuracy, task_count, estimation_error, dependency_violations]
  improves: [task_granularity, estimation_calibration, dependency_detection]
---

# Writing Plans

## When to Use

Apply this skill when:

- You receive a specification that requires multiple distinct steps
- Work will take more than 30 minutes total
- Multiple people or agents will execute the work
- The execution order matters (dependencies exist)
- You need to communicate progress against milestones
- The risk of missing a step is high

**Skip when:**
- The task is a single, obvious action (just do it)
- The task is exploratory — you can't plan what you haven't understood yet
- The plan would take longer to write than the work itself

**Decision tree:**
```
Is the task > 30 min or > 1 context window?
├── No  → execute directly
└── Yes → Do you understand the full scope?
          ├── No  → brainstorming first, then write-plans
          └── Yes → writing-plans ← YOU ARE HERE
```

## Core Methodology

### Phase 1: Specification Analysis

Before writing a single task, decompose the spec into its logical components:

1. **Parse the goal** — What is the desired end state? Not "build auth" but "users can register, log in, and maintain sessions securely"
2. **Identify components** — What distinct systems or modules need to exist?
3. **Find dependencies** — Which components require others to exist first?
4. **Identify risks** — What's most likely to go wrong? Plan for it early.
5. **Define done criteria** — How will you know the goal is achieved?

**Specification analysis template:**
```markdown
## Goal
[Single sentence: what exists when this is done that didn't exist before]

## Components
- [Component A]: [what it is and what it does]
- [Component B]: [what it is and what it does]

## Dependencies
- Component B requires Component A's [interface/data/service]
- Component C requires both A and B

## Risks
1. [Risk]: [mitigation]
2. [Risk]: [mitigation]

## Done Criteria
- [ ] [Observable, testable condition]
- [ ] [Observable, testable condition]
```

### Phase 2: Task Sequencing

Break each component into atomic tasks. Rules for task granularity:

**Target size:** 2-5 minutes of execution time (not wall clock time — agent execution time)
**Signs a task is too large:**
- It contains "and" (two things)
- Its done criteria has more than 3 bullet points
- It could fail in more than 2 different ways
- It would produce more than 200 lines of code

**Signs a task is too small:**
- It produces less than 10 lines of code
- Its setup (imports, scaffolding) outweighs its work
- It has zero decision points

**Task format:**
```markdown
### Task N: [Action verb] [specific thing]

**Input:** [What this task needs to exist before it can run]
**Output:** [Exact file, function, or artifact produced]
**Duration:** [2-5 min]
**Done when:**
- [ ] [Specific, verifiable criterion]
- [ ] Tests pass (if applicable)

**Notes:** [Edge cases, non-obvious decisions, references]
```

### Phase 3: Dependency Graph

After listing tasks, draw the dependency graph explicitly:

```
Task 1: Database schema       ──→ Task 3: Repository layer
Task 2: Domain models         ──→ Task 3: Repository layer
Task 3: Repository layer      ──→ Task 5: Service layer
Task 4: Auth middleware        ──→ Task 6: Protected routes
Task 5: Service layer          ──→ Task 6: Protected routes
Task 6: Protected routes       ──→ Task 7: Integration tests
Task 7: Integration tests      ──→ Task 8: Documentation
```

**Parallel execution opportunities** — tasks with no shared dependencies:
- Task 1 and Task 2 can run in parallel
- Task 4 can run in parallel with Tasks 1-3

Label these explicitly. If using `subagent-driven-development`, parallel tasks become parallel subagent dispatches.

### Phase 4: Risk-First Ordering

Within the constraint of the dependency graph, sequence tasks to:
1. **Prove the spike first** — If there's a technical uncertainty, make a task that resolves it early
2. **Hard tasks early** — Don't save the hardest part for last (discovery of blockers costs less time early)
3. **Reviewable checkpoints** — Insert verification tasks at natural boundaries

**Risk-first example:**
```
# BAD ordering (risk deferred to end)
Task 1: Build entire frontend
Task 2: Build entire backend
Task 3: Integrate (discovery: API shape is wrong, redo Task 1)

# GOOD ordering (risk surfaced early)
Task 1: Define API contract (OpenAPI spec)
Task 2: Backend stub that satisfies contract
Task 3: Frontend stub that calls contract
Task 4: Integration smoke test ← risk surfaced HERE, at task 4 not task 20
Task 5: Full backend implementation
Task 6: Full frontend implementation
```

### Phase 5: The Written Plan

Final output format:

```markdown
# Plan: [Goal Name]

**Goal:** [Single sentence]
**Total tasks:** N
**Estimated duration:** [sum of task durations]
**Parallel opportunities:** [task numbers that can run concurrently]

## Done Criteria
- [ ] [Observable, testable condition]
- [ ] [Observable, testable condition]

## Dependency Graph
[ASCII or description]

## Tasks

### Task 1: [Name]
[Full task block]

### Task 2: [Name]
[Full task block]

...
```

## ClawPowers Enhancement

When `~/.clawpowers/` runtime is initialized:

**Historical Estimation Calibration:**

Plans get compared to actual execution. After 5+ plans, calibration data is available:

```bash
# After plan execution completes
bash runtime/persistence/store.sh set "plan:auth-service:estimated_duration" "180"
bash runtime/persistence/store.sh set "plan:auth-service:actual_duration" "240"

# Read calibration
bash runtime/feedback/analyze.sh --skill writing-plans
# Output: Your 2-5 min tasks average 7.3 min actual. Adjust estimates by 1.5x.
```

**Dependency Graph Validation:**

Before executing a plan, validate the dependency graph has no cycles and all task inputs exist:

```bash
bash runtime/persistence/store.sh set "plan:current:task_count" "8"
bash runtime/persistence/store.sh set "plan:current:deps" "3:1,2 4:- 5:3,4 6:4 7:5,6 8:7"
# Analyzer checks for cycles and unreachable tasks
```

**Plan Quality Scoring:**

Stored metrics enable quality scoring of plans over time:
- Estimation accuracy (actual / estimated)
- Task rework rate (tasks that required re-execution)
- Dependency violation rate (tasks executed out of order)
- Done criteria completeness (criteria met on first attempt)

## Anti-Patterns

| Anti-Pattern | Why It Fails | Correct Approach |
|-------------|-------------|-----------------|
| Tasks with "and" | Two risks, two outcomes, ambiguous done criteria | Split into two tasks |
| Vague done criteria | "Done" is subjective, causes rework debates | Observable, testable criteria only |
| Skipping dependency mapping | Execution order violations cause rework | Always draw the dependency graph |
| Planning with no spike | Technical unknown bites you at Task 15 | Schedule spike task first if uncertainty exists |
| Giant tasks (2 hours each) | Hard to track progress, hard to parallelize | Break down to 2-5 min granularity |
| Tiny tasks (1-2 min each) | Plan overhead exceeds value | Group related micro-tasks |
| Over-planning volatile specs | Plan becomes invalid before execution starts | Plan only what's stable, leave flexibility for the rest |

## Examples

### Example 1: Small Plan (4 tasks)

**Goal:** Add rate limiting to the API

```markdown
# Plan: API Rate Limiting

**Goal:** All API endpoints enforce per-user rate limits with 429 response on exceeded limits.
**Total tasks:** 4 | **Estimated:** 16 min

## Done Criteria
- [ ] Requests beyond limit receive 429 with Retry-After header
- [ ] Rate limit state persists across server restarts
- [ ] Tests cover limit enforcement and reset behavior

## Tasks

### Task 1: Write rate limit tests (RED)
**Input:** None | **Output:** tests/test_rate_limit.py (failing) | **Duration:** 3 min
**Done when:** Tests run and fail with ImportError

### Task 2: Implement RedisRateLimiter
**Input:** tests/test_rate_limit.py | **Output:** src/rate_limiter.py | **Duration:** 5 min
**Done when:** All rate limiter unit tests pass

### Task 3: Integrate rate limiter into middleware
**Input:** src/rate_limiter.py | **Output:** src/middleware/rate_limit.py | **Duration:** 4 min
**Done when:** Integration tests pass, middleware applies limits per endpoint

### Task 4: Add 429 response and Retry-After header
**Input:** src/middleware/rate_limit.py | **Output:** Modified middleware | **Duration:** 2 min
**Done when:** 429 response includes Retry-After with correct TTL
```

### Example 2: Dependency-heavy Plan (8 tasks with parallel opportunities)

**Goal:** Build notification service

**Parallel opportunities:** Tasks 1+2 concurrent, Tasks 4+5 concurrent

```markdown
### Task 1: Define notification event schema [parallel with Task 2]
### Task 2: Database migration for notification store [parallel with Task 1]
### Task 3: NotificationRepository (depends on 1, 2)
### Task 4: Email provider integration (depends on 1) [parallel with Task 5]
### Task 5: Push notification provider integration (depends on 1) [parallel with Task 4]
### Task 6: NotificationService orchestrator (depends on 3, 4, 5)
### Task 7: API endpoints (depends on 6)
### Task 8: Integration tests (depends on 7)
```
