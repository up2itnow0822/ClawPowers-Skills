---
name: executing-plans
description: Execute an existing plan with progress tracking, interruption recovery, and milestone verification. Activate when you have a written plan and are ready to implement it.
version: 1.0.0
requires:
  tools: [bash, git]
  runtime: false
metrics:
  tracks: [tasks_completed, rework_rate, interruption_recovery_time, milestone_hit_rate]
  improves: [task_sequencing, checkpoint_frequency, verification_rigor]
---

# Executing Plans

## When to Use

Apply this skill when:

- You have a written plan (from `writing-plans` or equivalent) ready to execute
- Executing a multi-task sequence where progress matters
- You need to be able to pause and resume without losing context
- You're executing work that someone else is tracking

**Skip when:**
- You don't have a plan yet (use `writing-plans` first)
- The task is a single step (just execute it)
- You're mid-execution and don't need the overhead

**Relationship to other skills:**
```
writing-plans → executing-plans → verification-before-completion → finishing-a-development-branch
```

## Core Methodology

### Pre-Execution Setup

Before executing the first task:

1. **Read the full plan** — Don't start mid-plan. Read it completely.
2. **Verify preconditions** — All inputs for Task 1 must exist. If they don't, stop and get them.
3. **Create execution checkpoint** — Save plan state to resume on interruption.
4. **Identify parallel tasks** — Group concurrent tasks from the dependency graph.

**Checkpoint structure (file-based, no runtime required):**
```json
{
  "plan_name": "auth-service",
  "started_at": "2026-03-21T14:00:00Z",
  "tasks": {
    "1": {"status": "pending"},
    "2": {"status": "pending"},
    "3": {"status": "pending"}
  },
  "current_task": null
}
```

If runtime is available:
```bash
bash runtime/persistence/store.sh set "execution:plan_name" "auth-service"
bash runtime/persistence/store.sh set "execution:task_1:status" "pending"
```

### Task Execution Loop

For each task in the plan (in dependency order):

**Step 1: Mark task in progress**
```bash
# With runtime
bash runtime/persistence/store.sh set "execution:task_N:status" "in_progress"
bash runtime/persistence/store.sh set "execution:task_N:started_at" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

**Step 2: Execute the task**
- Follow the task spec exactly — scope, deliverables, done criteria
- Do not expand scope ("while I'm here, I'll also...")
- Do not shrink scope ("this is probably good enough...")

**Step 3: Verify done criteria**

Each done criterion must be checked explicitly:
```
Task 2 done criteria:
- [ ] Repository layer exists at src/repos/user_repo.py → CHECK: file exists ✓
- [ ] All repository tests pass → CHECK: pytest tests/test_user_repo.py → 8 passed ✓
- [ ] No raw SQL in service layer → CHECK: grep "SELECT\|INSERT\|UPDATE" src/services/ → 0 results ✓
```

If any criterion fails: **stop, diagnose, fix, re-verify** — do not proceed to the next task.

**Step 4: Mark task complete**
```bash
bash runtime/persistence/store.sh set "execution:task_N:status" "complete"
bash runtime/persistence/store.sh set "execution:task_N:completed_at" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

**Step 5: Git commit the task output**

Each completed task gets its own commit:
```bash
git add [task output files]
git commit -m "feat(auth): implement UserRepository with connection pooling

Task 2/8 of auth-service plan. Completes repository layer.
All 8 repository tests passing. Zero raw SQL in service layer."
```

This makes the plan's execution history visible in git log and enables rollback to any task boundary.

### Handling Parallel Tasks

When the plan identifies parallel tasks:

1. Dispatch them concurrently (via `dispatching-parallel-agents` if agents, or concurrent execution)
2. Wait for ALL parallel tasks to complete before proceeding
3. Verify all parallel task done criteria before moving to dependent tasks
4. If one parallel task fails, others continue — don't cancel them

```
parallel_group = [Task 1, Task 2]  # Both have no dependencies

Execute Task 1 and Task 2 concurrently
Wait for both → verify both → only then execute Task 3
```

### Milestone Verification

At natural boundaries (end of a logical phase), run a milestone verification:

1. All tasks in the phase are marked complete
2. All done criteria are checked
3. Integration between phase tasks is verified (not just individual tasks)
4. Run any integration tests that cover the phase boundary

**Example milestone:** After implementing the repository and service layers:
```bash
# Milestone: data layer complete
pytest tests/ -k "repository or service"  # All must pass
# Verify no circular imports
python -c "from src.services.user import UserService"
# Verify interface contracts
python -m mypy src/repos/ src/services/
```

### Interruption Recovery

If execution is interrupted (session ends, error halts, requirement change):

**With runtime:**
```bash
# On resume
bash runtime/persistence/store.sh get "execution:plan_name"
# → auth-service

# Find last completed task
bash runtime/persistence/store.sh list "execution:task_*:status"
# → task_1: complete, task_2: complete, task_3: in_progress, task_4: pending

# Assess task_3: was it actually completed?
# Check: does the output exist? Do tests pass?
# If yes → mark complete, continue from task_4
# If no  → re-execute task_3 from scratch
```

**Without runtime:** Check git log for the last committed task, verify its done criteria, continue from the next task.

**Key principle:** Never assume a task is complete because it was started. Verify the done criteria on resume.

### Scope Change During Execution

If requirements change mid-execution:

1. **Stop** — don't continue executing the current plan
2. **Assess** — how many tasks are invalidated by the change?
3. **If < 20% of tasks affected:** modify affected tasks in place, re-verify done criteria
4. **If > 20% of tasks affected:** return to `writing-plans` — the plan needs revision
5. **Document the change** — what changed and why, update the plan document

Never silently adjust scope while executing. Make the change explicit.

### Progress Reporting

When asked for progress, report against the plan:

```
Plan: auth-service (8 tasks)
Progress: 5/8 complete (62.5%)

✓ Task 1: Database schema
✓ Task 2: Repository layer  
✓ Task 3: Service layer
✓ Task 4: Auth middleware
✓ Task 5: JWT utilities
⟳ Task 6: Protected routes (in progress)
  Task 7: Integration tests (pending)
  Task 8: Documentation (pending)

Current: Implementing route guards for admin endpoints
ETA: ~12 min remaining
Blockers: None
```

## ClawPowers Enhancement

When `~/.clawpowers/` runtime is initialized:

**Milestone Persistence:** Every task completion and milestone hit is saved to `~/.clawpowers/state/`. If your laptop crashes at Task 6 of 8, you resume from Task 7, not Task 1.

```bash
# Full execution history on resume
bash runtime/persistence/store.sh list "execution:*"
```

**Progress Dashboard:** Generate a real-time execution report:

```bash
bash runtime/feedback/analyze.sh --plan auth-service
# Output:
# Plan: auth-service
# Duration so far: 47 min (estimated 60 min total)
# Tasks: 5/8 complete
# Velocity: 1 task / 9.4 min (plan estimated: 1/7.5 min)
# Projected completion: +13 min
# Warning: Task 3 took 24 min vs estimated 5 min (spec was underspecified)
```

**Interruption Recovery Statistics:** Tracks how often execution is interrupted and how long recovery takes, informing optimal checkpoint frequency.

**Rework Tracking:** When a task must be re-executed (done criteria failed), records the cause:
- Spec was ambiguous (improve `writing-plans`)
- Dependency missing (improve dependency mapping)
- Requirement changed (flag as scope change, not rework)
- Implementation error (improve task verification step)

## Anti-Patterns

| Anti-Pattern | Why It Fails | Correct Approach |
|-------------|-------------|-----------------|
| Skipping done criteria verification | Tasks appear complete but aren't | Verify every criterion explicitly |
| Expanding task scope mid-execution | Creates unanticipated dependencies | Strict scope adherence; new scope = new task |
| Proceeding past a failed task | Subsequent tasks build on broken foundation | Stop, fix, re-verify, then continue |
| Not committing per task | Can't identify which task introduced a bug | Commit every task completion |
| Ignoring parallel opportunities | Sequential execution of parallel-safe tasks wastes time | Dispatch parallel tasks concurrently |
| Silently adjusting requirements | Plan/reality divergence | Explicit scope change protocol |
| Skipping milestone verification | Integration problems discovered late | Verify at every phase boundary |

## Integration with Other Skills

- Preceded by `writing-plans` (plan must exist before execution)
- Use `subagent-driven-development` for parallel task dispatch
- Use `using-git-worktrees` for concurrent task isolation
- Followed by `verification-before-completion` before merging
- Use `systematic-debugging` when a task fails unexpectedly
