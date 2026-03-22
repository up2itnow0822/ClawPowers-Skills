---
name: dispatching-parallel-agents
description: Fan out independent tasks to parallel agent processes with load balancing, failure isolation, and result aggregation. Activate when you have N independent tasks that can execute concurrently.
version: 1.0.0
requires:
  tools: [bash, git]
  runtime: false
metrics:
  tracks: [agents_dispatched, success_rate, parallel_efficiency, aggregation_errors]
  improves: [task_partitioning, failure_isolation_strategy, aggregation_method]
---

# Dispatching Parallel Agents

## When to Use

Apply this skill when:

- You have 3+ independent tasks with no shared dependencies
- Each task can be described with a complete, self-contained spec
- You have access to multiple agent processes or context windows
- The tasks are roughly equal in complexity (or can be load-balanced)
- A failure in one task should not abort others

**Skip when:**
- Tasks share state that would conflict under concurrent access
- Tasks must execute in sequence (use `executing-plans` instead)
- You have fewer than 3 tasks (overhead outweighs benefit)
- You can't isolate failure — one bad result corrupts all results

**Relationship to `subagent-driven-development`:**
```
subagent-driven-development: full development methodology (spec, review, worktree, integrate)
dispatching-parallel-agents: execution mechanism (fan-out, monitor, aggregate)

Use dispatching-parallel-agents for runtime parallelism.
Use subagent-driven-development for development task orchestration.
They are complementary — subagent-driven-development USES dispatching-parallel-agents.
```

## Core Methodology

### Step 1: Task Decomposition for Parallelism

Before dispatching, verify each task is:

1. **Self-contained** — has all inputs it needs, produces a defined output
2. **Isolated** — doesn't write to shared state other tasks read
3. **Specced** — has clear success criteria (you'll need these for aggregation)
4. **Sized appropriately** — not so small that dispatch overhead dominates

**Task spec format for parallel dispatch:**
```markdown
## Task ID: [unique identifier]

**Input:**
- [File or data this task starts from]
- [Any context this task needs]

**Objective:** [Single sentence]

**Output:**
- [Exact artifact produced: file path, JSON structure, etc.]

**Success criteria:**
- [ ] [Verifiable criterion]

**Failure behavior:**
- [What this task does when it encounters an error]
- [What it outputs on failure so the aggregator can detect it]
```

### Step 2: Failure Isolation Design

Decide how failures propagate:

| Strategy | When to Use | Implementation |
|----------|-------------|----------------|
| **Continue on failure** | Tasks are independent, partial results are valuable | Failed tasks return error object, aggregator handles |
| **Fail fast** | Any failure invalidates all results | Use process groups; kill siblings on first failure |
| **Retry on failure** | Tasks are idempotent and failures are transient | Retry N times with exponential backoff |
| **Fallback on failure** | Alternative task exists for same output | Dispatch fallback when primary fails |

**Output envelope for failure isolation:**
```json
{
  "task_id": "auth-api",
  "status": "success|failure|partial",
  "output": { ... },
  "error": null,
  "duration_seconds": 47.3,
  "checksum": "sha256_of_output"
}
```

Every task must produce this envelope — the aggregator depends on it.

### Step 3: Dispatch Mechanism

**Option A: Process-level parallelism (Bash)**

```bash
#!/usr/bin/env bash
# Fan out tasks in background, wait for all, aggregate results

RESULTS_DIR=$(mktemp -d)
PIDS=()

dispatch_task() {
  local task_id="$1"
  local spec_file="$2"
  
  (
    # Each task runs in a subshell with its own output file
    output_file="$RESULTS_DIR/${task_id}.json"
    
    if run_task "$spec_file" > "$output_file" 2>&1; then
      # Wrap output in envelope
      echo '{"task_id":"'"$task_id"'","status":"success","output":'"$(cat "$output_file")"'}'
    else
      exit_code=$?
      echo '{"task_id":"'"$task_id"'","status":"failure","error":"exit code '"$exit_code"'","output":null}'
    fi
  ) > "$RESULTS_DIR/${task_id}_envelope.json" &
  
  PIDS+=($!)
  echo "Dispatched task $task_id (PID: ${PIDS[-1]})"
}

# Dispatch all tasks
dispatch_task "auth-api" "specs/auth-api.md"
dispatch_task "auth-db" "specs/auth-db.md"
dispatch_task "auth-tests" "specs/auth-tests.md"

# Wait for all tasks
echo "Waiting for ${#PIDS[@]} tasks..."
for pid in "${PIDS[@]}"; do
  wait "$pid"
done

echo "All tasks complete. Results in $RESULTS_DIR/"
```

**Option B: Agent-level parallelism (Multi-context)**

When you have multiple agent contexts (e.g., multiple Claude Code sessions, multiple Cursor instances):

1. For each parallel task, open a new agent context
2. Inject the complete task spec
3. Each agent works independently in its assigned worktree
4. Orchestrator aggregates results after all agents complete

**Worktree-per-agent setup:**
```bash
TASKS=("auth-api" "auth-db" "auth-tests")
for task in "${TASKS[@]}"; do
  git worktree add "../project-${task}" -b "feature/${task}" main
  echo "Worktree ready for ${task}: ../project-${task}"
done
```

### Step 4: Monitoring

Track task progress during execution:

```bash
# Check which tasks are still running
for pid in "${PIDS[@]}"; do
  if kill -0 "$pid" 2>/dev/null; then
    echo "Still running: PID $pid"
  fi
done

# Or: watch output files for progress indicators
watch -n 5 'ls -la '"$RESULTS_DIR"'/'

# Timeout monitoring — kill tasks that run too long
MAX_DURATION=600  # 10 minutes
for i in "${!PIDS[@]}"; do
  pid="${PIDS[$i]}"
  task="${TASKS[$i]}"
  if kill -0 "$pid" 2>/dev/null; then
    elapsed=$(ps -p "$pid" -o etimes= 2>/dev/null | tr -d ' ')
    if [[ ${elapsed:-0} -gt $MAX_DURATION ]]; then
      kill "$pid"
      echo "TIMEOUT: Task $task (PID $pid) exceeded ${MAX_DURATION}s"
    fi
  fi
done
```

### Step 5: Result Aggregation

After all tasks complete, aggregate results:

```bash
#!/usr/bin/env bash
# Aggregate results from all parallel tasks

aggregate_results() {
  local results_dir="$1"
  local success_count=0
  local failure_count=0
  local failures=()
  
  for envelope_file in "$results_dir"/*_envelope.json; do
    status=$(python3 -c "import json,sys; d=json.load(open('$envelope_file')); print(d['status'])")
    task_id=$(python3 -c "import json,sys; d=json.load(open('$envelope_file')); print(d['task_id'])")
    
    if [[ "$status" == "success" ]]; then
      ((success_count++))
      echo "✓ $task_id"
    else
      ((failure_count++))
      failures+=("$task_id")
      error=$(python3 -c "import json,sys; d=json.load(open('$envelope_file')); print(d.get('error','unknown'))")
      echo "✗ $task_id: $error"
    fi
  done
  
  echo ""
  echo "Results: $success_count succeeded, $failure_count failed"
  
  if [[ $failure_count -gt 0 ]]; then
    echo "Failed tasks: ${failures[*]}"
    return 1
  fi
  
  return 0
}

aggregate_results "$RESULTS_DIR"
```

**Aggregation decisions:**
- All succeeded → proceed to integration
- Some failed → re-dispatch only failed tasks (not successful ones)
- Critical task failed → abort, fix, re-dispatch all dependent tasks

### Step 6: Integration

After successful aggregation:

1. Verify outputs are compatible (no conflicting interfaces)
2. Merge in dependency order (see `using-git-worktrees`)
3. Run integration tests across all task outputs
4. Clean up worktrees

## ClawPowers Enhancement

When `~/.clawpowers/` runtime is initialized:

**Execution Registry:**

```bash
# Register dispatch batch
BATCH_ID="auth-$(date +%s)"
bash runtime/persistence/store.sh set "dispatch:${BATCH_ID}:tasks" "auth-api,auth-db,auth-tests"
bash runtime/persistence/store.sh set "dispatch:${BATCH_ID}:started_at" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Update per-task status as they complete
bash runtime/persistence/store.sh set "dispatch:${BATCH_ID}:auth-api:status" "success"
bash runtime/persistence/store.sh set "dispatch:${BATCH_ID}:auth-db:status" "running"

# On session interrupt: resume knows exactly which tasks to re-dispatch
bash runtime/persistence/store.sh list "dispatch:${BATCH_ID}:*:status"
```

**Load Balancing:**

Track task execution times to balance future dispatches:
```bash
bash runtime/persistence/store.sh set "task-timing:auth-api" "47"
bash runtime/persistence/store.sh set "task-timing:auth-db" "23"
```

Future dispatches group tasks to equalize total runtime across agents.

**Failure Isolation Metrics:**

```bash
bash runtime/metrics/collector.sh record \
  --skill dispatching-parallel-agents \
  --outcome success \
  --notes "auth: 3 tasks, all succeeded, 47s wall time vs 117s sequential"
```

Tracks parallel efficiency (wall time vs. theoretical serial time), helps tune batch sizes.

## Anti-Patterns

| Anti-Pattern | Why It Fails | Correct Approach |
|-------------|-------------|-----------------|
| Dispatching tasks that share mutable state | Race conditions, data corruption | Verify isolation before dispatch |
| No output envelope format | Aggregator can't distinguish success from failure | Every task must produce structured output |
| Waiting for all tasks when partial results suffice | Slowest task blocks all results | Consider streaming aggregation for independent outputs |
| No timeout on tasks | One hung task blocks aggregation forever | Always set timeouts |
| Re-dispatching succeeded tasks on retry | Wastes time, may produce different results | Track task status, retry only failed tasks |
| No result verification after aggregation | Corrupted output passes through | Verify each task output against spec before integration |

## Integration with Other Skills

- Used by `subagent-driven-development` for task fan-out
- Requires `using-git-worktrees` for file isolation
- Outputs consumed by `verification-before-completion`
