---
name: subagent-driven-development
description: Orchestrate complex tasks by dispatching fresh subagents with isolated context, two-stage review, and Git worktree isolation. Activate when a task is large enough to benefit from parallelism or context separation.
version: 1.0.0
requires:
  tools: [git, bash]
  runtime: false
metrics:
  tracks: [tasks_dispatched, subagent_success_rate, review_pass_rate, time_to_completion]
  improves: [task_decomposition_quality, spec_clarity, review_threshold]
---

# Subagent-Driven Development

## When to Use

Apply this skill when you encounter:

- A task with 3+ logically independent workstreams
- A task so large it would exhaust a single context window
- A feature requiring multiple specialists (frontend + backend + tests + docs)
- Any work where a bug in one component shouldn't block another
- A task with clear interfaces between components (you can spec them up front)

**Skip this skill when:**
- The task is tightly coupled — one change cascades everywhere
- You need to maintain narrative continuity across all components
- The task is < 2 hours of work for a single agent
- You don't have enough information to spec subagent boundaries yet

**Decision tree:**
```
Can the task be split into N parts with defined interfaces?
├── No  → single-agent execution
└── Yes → Can subagents work concurrently without blocking each other?
          ├── No  → sequential execution with checkpointing (executing-plans)
          └── Yes → subagent-driven-development ← YOU ARE HERE
```

## Core Methodology

### Stage 0: Task Decomposition (do this yourself, not in a subagent)

Before dispatching anything, produce:

1. **Task tree** — hierarchical breakdown of the full work
2. **Subagent boundaries** — where one agent's output is another's input
3. **Interface contracts** — what each subagent accepts and delivers
4. **Dependency order** — which can run in parallel, which must sequence

**Decomposition heuristic:** Each subagent task should be completable in 1 context window (roughly 2-5K tokens of output). If larger, decompose further.

**Example decomposition for "Build authentication service":**
```
auth-service/
├── Subagent A: API design + OpenAPI spec     [no dependencies]
├── Subagent B: Database schema + migrations   [no dependencies]  
├── Subagent C: Core auth logic (JWT, bcrypt)  [depends on: A, B specs]
├── Subagent D: Integration tests              [depends on: C output]
└── Subagent E: Documentation                 [depends on: A, C, D output]
```

### Stage 1: Spec Writing (per subagent)

For each subagent, write a precise spec that includes:

```markdown
## Subagent Spec: [Component Name]

**Objective:** [Single sentence — what this subagent produces]

**Context provided:**
- [File or artifact they receive as input]
- [Interface contract from upstream subagent]

**Deliverables:**
- [Specific file or artifact, not vague output]
- [Test file covering the deliverable]

**Constraints:**
- [Language/framework requirements]
- [Performance requirements if applicable]
- [Must not break: existing interfaces]

**Done criteria:**
- [ ] All tests pass
- [ ] Interface contract satisfied
- [ ] No TODOs or stubs in production code
```

**Anti-pattern:** Vague specs produce vague output. "Build the auth logic" is not a spec. "Implement JWT issuance and validation with RS256, returning {token, expiresAt, userId} from issue() and {valid, userId, error} from validate()" is a spec.

### Stage 2: Worktree Isolation

Each subagent works in an isolated Git worktree to prevent interference:

```bash
# Create worktrees for parallel subagents
git worktree add ../task-auth-api feature/auth-api
git worktree add ../task-auth-db feature/auth-db
git worktree add ../task-auth-core feature/auth-core

# Verify isolation
git worktree list
```

Worktrees share the repo history but have independent working directories. A subagent working in `../task-auth-api` cannot accidentally overwrite files in `../task-auth-core`.

See: `skills/using-git-worktrees/SKILL.md` for full worktree management protocol.

### Stage 3: Subagent Dispatch

Dispatch each subagent with:
1. The spec (complete, not abbreviated)
2. All input artifacts (relevant files, interface contracts)
3. Access to their assigned worktree
4. No instruction to "skip complicated parts" or "use a stub"

**Dispatch instruction template:**
```
You are implementing [component]. Your spec is below. Work only in the provided 
worktree directory. Produce real, working code with tests — no stubs, no TODOs.
Deliver: [specific files]. When done, output a JSON summary of what you built.

[Full spec here]
```

### Stage 4: Two-Stage Review

**Stage 4a: Spec review** — Before running any subagent code, review that:
- The output matches the spec's deliverables
- Interface contracts are satisfied (types match, method signatures match)
- No stubs or mocks in production code paths
- Tests exist and cover the critical paths

**Stage 4b: Quality review** — After running the code:
- All tests pass (zero failing)
- No linting errors
- Performance meets requirements
- Security: no hardcoded credentials, no SQL injection vectors, no unvalidated inputs

**Review failure protocol:**
```
If Stage 4a fails → return spec to subagent with specific failure reason
If Stage 4b fails → return to subagent with exact failing test output
Never merge code that fails either review stage
```

### Stage 5: Integration

After all subagents pass review:

1. Merge worktrees in dependency order
2. Run full integration test suite
3. Resolve any interface mismatches (typically minor type issues)
4. Clean up worktrees

```bash
# Merge in order (B and C are independent, merge alphabetically)
git checkout main
git merge feature/auth-db
git merge feature/auth-api  
git merge feature/auth-core   # depends on both
git merge feature/auth-tests
git merge feature/auth-docs

# Clean up
git worktree remove ../task-auth-api
git worktree remove ../task-auth-db
# ... etc
```

## ClawPowers Enhancement

When `~/.clawpowers/` runtime is initialized:

**Persistent Execution DB:** Every subagent dispatch is logged with spec hash, start time, subagent ID, and outcome. If a session is interrupted, you know exactly which subagents completed and which to re-run.

```bash
# Record dispatch
bash runtime/persistence/store.sh set "subagent:auth-api:status" "dispatched"
bash runtime/persistence/store.sh set "subagent:auth-api:spec_hash" "$(echo "$SPEC" | sha256sum | cut -c1-8)"

# Check on resume
bash runtime/persistence/store.sh get "subagent:auth-api:status"
```

**Resumable Checkpoints:** The framework saves the task tree and each subagent's completion state. A session that crashes mid-dispatch resumes from the last successful checkpoint, not from scratch.

**Outcome Metrics:** After integration, record:
```bash
bash runtime/metrics/collector.sh record \
  --skill subagent-driven-development \
  --outcome success \
  --duration 3600 \
  --notes "auth-service: 5 subagents, 2 review cycles, 0 integration failures"
```

**Metric-driven decomposition:** After 10+ executions, `runtime/feedback/analyze.sh` identifies your optimal subagent granularity — tasks that are too small (high coordination overhead) or too large (high review failure rate).

## Anti-Patterns

| Anti-Pattern | Why It Fails | Correct Approach |
|-------------|-------------|-----------------|
| Vague spec ("build the auth thing") | Subagent guesses, output is wrong | Write spec with deliverables and done criteria |
| Skip the failure witness | Review catches nothing | Require all tests to pass in the review stage |
| Merge before review | Bad code enters main | Two-stage review is non-negotiable |
| Single worktree for multiple agents | Files overwrite each other | One worktree per subagent, always |
| Decompose too fine | Excessive coordination cost | Target 1-context-window tasks (2-5K token output) |
| Decompose too coarse | Subagent context exhaustion | If output > 1 context window, split further |
| Stub the hard parts | Tech debt accumulates | "No stubs" is a hard constraint in the spec |

## Examples

### Example 1: Simple (2 subagents)

**Task:** Add email verification to existing user signup

**Decomposition:**
- Subagent A: Email service integration (SendGrid/SES wrapper, template rendering)
- Subagent B: Verification flow (token generation, storage, verification endpoint)
- Sequential: B depends on A's interface

**Specs:** A delivers `EmailService` class with `send(to, template, vars)` → B uses that interface

### Example 2: Complex (5 subagents)

**Task:** Build real-time dashboard

**Decomposition:**
- Subagent A: WebSocket server (connection mgmt, message routing) [parallel]
- Subagent B: Data aggregation service (query engine, caching) [parallel]
- Subagent C: Frontend dashboard components (React, chart library) [parallel]
- Subagent D: Integration tests (WebSocket + aggregation E2E) [depends on A, B]
- Subagent E: Dashboard state management (connects C to A/B) [depends on A, B, C]

**Parallel dispatch:** A, B, C run concurrently. D and E run after A, B, C complete review.

## Integration with Other Skills

- Use `writing-plans` first if you don't have a clear task tree yet
- Apply `using-git-worktrees` for worktree lifecycle management
- Use `dispatching-parallel-agents` if subagents run as independent processes
- Apply `verification-before-completion` before final integration merge
