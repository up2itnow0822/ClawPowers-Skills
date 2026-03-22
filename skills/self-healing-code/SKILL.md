---
name: self-healing-code
description: On test failure, automatically capture the failure, run hypothesis-driven debugging, generate ≥2 candidate patches, apply and measure each, auto-commit the winner or escalate with full context. Max 3 iteration cycles with coverage guard.
version: 1.0.0
requires:
  tools: [bash, git]
  runtime: true
metrics:
  tracks: [healing_attempts, auto_commits, escalations, patches_generated, coverage_delta, cycles_used]
  improves: [patch_quality, hypothesis_accuracy, escalation_context_completeness]
---

# Self-Healing Code

## When to Use

Apply this skill when:

- A CI run or local test suite produces a failure
- A previously green test suite goes red after a code change
- An automated pipeline fails and needs remediation without human intervention
- Bill runs tests and the output contains `FAILED`, `ERROR`, or non-zero exit code

**Skip when:**
- Tests fail because of a missing environment variable or missing external service (that's a configuration issue, not a code defect)
- The failure is a flaky test known to fail intermittently — check `~/.clawpowers/state/known-flaky.json` first
- A previous healing cycle for this exact error is already in progress (check `~/.clawpowers/state/healing-lock.json`)

**Decision tree:**
```
Did the test suite produce a failure?
├── No  → no action
└── Yes → Is this a known flaky test?
          ├── Yes → skip, add flaky annotation, report
          └── No  → Is a healing cycle already running for this error?
                    ├── Yes → wait for completion or check lock age
                    └── No  → self-healing-code ← YOU ARE HERE
```

## Core Methodology

### Guardrails (enforce before any healing action)

```bash
# Max cycles — never exceed 3 healing iterations per error
MAX_CYCLES=3
HEALING_STATE=~/.clawpowers/state/healing-$(echo "$ERROR_SIG" | md5).json
CURRENT_CYCLE=$(cat "$HEALING_STATE" 2>/dev/null | node -e "const d=require('/dev/stdin');console.log(d.cycle||0)" 2>/dev/null || echo 0)

if (( CURRENT_CYCLE >= MAX_CYCLES )); then
  echo "Max cycles ($MAX_CYCLES) reached. Escalating."
  # → go to Step 6: Escalation
fi

# Coverage guard — baseline before any patch
COVERAGE_BASELINE=$(bash runtime/persistence/store.sh get "coverage:baseline:$PROJECT" 2>/dev/null || echo "0")
```

### Step 1: Capture the Failure

Collect everything needed to understand and reproduce the failure:

```bash
# Run tests and capture full output
TEST_OUTPUT=$(bash -c "$TEST_CMD 2>&1") || true
EXIT_CODE=$?

# Extract structured fields
TEST_NAME=$(echo "$TEST_OUTPUT" | grep -E "^(FAILED|FAIL|Error in)" | head -1)
ERROR_MSG=$(echo "$TEST_OUTPUT" | grep -A5 "AssertionError\|Error:\|Exception:" | head -10)
STACK_TRACE=$(echo "$TEST_OUTPUT" | grep -A20 "Traceback\|at [A-Za-z]" | head -30)

# Diff from last green commit
LAST_GREEN=$(bash runtime/persistence/store.sh get "last-green:$PROJECT" 2>/dev/null || git log --oneline | grep -i "green\|pass\|ci:" | head -1 | awk '{print $1}')
DIFF_FROM_GREEN=""
if [[ -n "$LAST_GREEN" ]]; then
  DIFF_FROM_GREEN=$(git diff "$LAST_GREEN" HEAD -- . 2>/dev/null | head -200)
fi

# Error signature hash (for dedup and state tracking)
ERROR_SIG=$(echo "${TEST_NAME}${ERROR_MSG}" | md5)

# Log the capture
CAPTURE_RECORD=~/.clawpowers/state/healing-$ERROR_SIG-capture.json
cat > "$CAPTURE_RECORD" <<EOF
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "test_name": $(echo "$TEST_NAME" | node -e "process.stdin.on('data',d=>console.log(JSON.stringify(d.toString().trim())))"),
  "error_msg": $(echo "$ERROR_MSG" | node -e "process.stdin.on('data',d=>console.log(JSON.stringify(d.toString().trim())))"),
  "exit_code": $EXIT_CODE,
  "last_green_commit": "$LAST_GREEN",
  "error_signature": "$ERROR_SIG"
}
EOF
```

**Capture checklist:**
- [ ] Test name (exact test identifier)
- [ ] Full error message (not truncated)
- [ ] Stack trace (full, not just last frame)
- [ ] Diff from last green commit
- [ ] Environment snapshot (language version, key deps)

### Step 2: Hypothesis Tree (Systematic Debugging Integration)

Apply the `systematic-debugging` methodology to form ranked hypotheses. This is not optional — random patches without hypotheses produce random results.

```bash
# Check persistent hypothesis memory first (see systematic-debugging enhancement)
KNOWN_HYP=$(bash runtime/persistence/store.sh get "debug:hypothesis:$ERROR_SIG" 2>/dev/null)
if [[ -n "$KNOWN_HYP" ]]; then
  echo "Known error pattern found. Starting with previously successful hypothesis."
  echo "$KNOWN_HYP"
fi
```

**Hypothesis template for common failure patterns:**

| Failure pattern | Likely hypothesis | Experiment |
|----------------|------------------|-----------|
| `AttributeError: 'NoneType' has no attribute X` | Null not guarded in refactored path | Add null check before access |
| `AssertionError: expected X, got Y` | Logic changed in upstream function | Bisect to find commit, inspect callers |
| `ConnectionRefusedError` | Service not started or port changed | Check env config, not a code fix |
| `KeyError: 'field_name'` | Schema changed, consumer not updated | Find all consumers of that key |
| `TypeError: expected str, got int` | Type coercion removed | Restore coercion or fix caller |

Form 2-4 specific hypotheses before generating patches.

### Step 3: Generate Candidate Patches (Minimum 2)

For each top hypothesis, generate a candidate patch. Generate patches **before** applying any:

```bash
# Stash current state for rollback safety
git stash push -m "self-healing-pre-patch-$ERROR_SIG-$(date +%s)"
STASH_REF=$(git stash list | head -1 | awk '{print $1}' | tr -d ':')

# Generate patch candidates (store as files, don't apply yet)
mkdir -p ~/.clawpowers/state/patches/$ERROR_SIG
```

**Patch generation principles:**
- **Patch A:** Minimal fix — smallest change that addresses the hypothesis (prefer this)
- **Patch B:** Alternative approach — different mechanism, same outcome
- **Patch C (if needed):** Defensive fix — add guards to prevent the class of error

**Example (Python null guard):**
```python
# Patch A — minimal: add None check at the failure site
# Before:
result = user.profile.settings["theme"]
# After:
result = user.profile.settings.get("theme", "default") if user.profile else "default"

# Patch B — alternative: fix upstream to guarantee non-null
# Before:
def get_user(user_id):
    return db.query(User).filter_by(id=user_id).first()  # can return None
# After:
def get_user(user_id):
    user = db.query(User).filter_by(id=user_id).first()
    if user is None:
        raise UserNotFoundError(f"User {user_id} not found")
    return user
```

Write each patch to a file:
```bash
# Write patches to staging area
cat > ~/.clawpowers/state/patches/$ERROR_SIG/patch-a.diff <<'EOF'
[patch content here]
EOF

# Capture reasoning for each patch
echo '{"patch":"a","hypothesis":"null not guarded","mechanism":"add get() with default","confidence":"high"}' \
  > ~/.clawpowers/state/patches/$ERROR_SIG/patch-a-meta.json
```

### Step 4: Apply, Test, Measure

Apply patches in order, testing each. Stop at the first winner.

```bash
# Measure baseline coverage before any patch
COVERAGE_BEFORE=$(bash -c "$COVERAGE_CMD 2>&1" | grep -E "TOTAL.*[0-9]+%" | grep -oE "[0-9]+%" | tail -1)

for PATCH in a b c; do
  PATCH_FILE=~/.clawpowers/state/patches/$ERROR_SIG/patch-$PATCH.diff
  [[ -f "$PATCH_FILE" ]] || continue

  echo "=== Applying patch $PATCH ==="

  # Restore clean state from stash before each patch
  git stash pop 2>/dev/null || true
  git stash push -m "self-healing-between-patches-$ERROR_SIG" 2>/dev/null || true
  git checkout -- . 2>/dev/null || true

  # Apply the patch
  git apply "$PATCH_FILE" 2>/dev/null || patch -p1 < "$PATCH_FILE" 2>/dev/null

  # Run full test suite
  TEST_RESULT=$(bash -c "$TEST_CMD 2>&1")
  TEST_EXIT=$?

  # Measure coverage after patch
  COVERAGE_AFTER=$(bash -c "$COVERAGE_CMD 2>&1" | grep -E "TOTAL.*[0-9]+%" | grep -oE "[0-9]+%" | tail -1)

  # Coverage guard: never reduce
  COVERAGE_OK=true
  if [[ -n "$COVERAGE_BEFORE" && -n "$COVERAGE_AFTER" ]]; then
    BEFORE_NUM=$(echo "$COVERAGE_BEFORE" | tr -d '%')
    AFTER_NUM=$(echo "$COVERAGE_AFTER" | tr -d '%')
    if (( AFTER_NUM < BEFORE_NUM )); then
      COVERAGE_OK=false
      echo "Coverage dropped: $COVERAGE_BEFORE → $COVERAGE_AFTER. Patch $PATCH rejected."
    fi
  fi

  if [[ $TEST_EXIT -eq 0 && "$COVERAGE_OK" == "true" ]]; then
    echo "Patch $PATCH PASSED all tests. Coverage: $COVERAGE_BEFORE → $COVERAGE_AFTER"
    WINNING_PATCH=$PATCH
    break
  else
    echo "Patch $PATCH FAILED. Exit: $TEST_EXIT. Coverage OK: $COVERAGE_OK"
  fi
done
```

### Step 5: Auto-Commit the Winner

If a patch passes all tests and maintains coverage:

```bash
if [[ -n "$WINNING_PATCH" ]]; then
  # Commit with full context
  git add -A
  git commit -m "fix: self-healing patch for ${TEST_NAME}

Error signature: $ERROR_SIG
Patch applied: $WINNING_PATCH
Hypothesis: $(cat ~/.clawpowers/state/patches/$ERROR_SIG/patch-$WINNING_PATCH-meta.json | node -e "const d=require('/dev/stdin');process.stdin.pipe(d.hypothesis)")
Coverage: $COVERAGE_BEFORE → $COVERAGE_AFTER
Cycles used: $((CURRENT_CYCLE + 1))/$MAX_CYCLES

[self-healing-code]"

  # Store last-green reference
  bash runtime/persistence/store.sh set "last-green:$PROJECT" "$(git rev-parse HEAD)"

  # Record success
  bash runtime/metrics/collector.sh record \
    --skill self-healing-code \
    --outcome success \
    --notes "patch-$WINNING_PATCH won, coverage $COVERAGE_BEFORE→$COVERAGE_AFTER, cycle $((CURRENT_CYCLE+1))/$MAX_CYCLES"

  # Clean up healing state
  rm -rf ~/.clawpowers/state/patches/$ERROR_SIG
  rm -f ~/.clawpowers/state/healing-$ERROR_SIG*.json
fi
```

### Step 6: Rollback Protocol

If no patch wins after all candidates are tried:

```bash
if [[ -z "$WINNING_PATCH" ]]; then
  # Restore to pre-healing state
  git checkout -- .
  git stash drop 2>/dev/null || true
  echo "All patches failed. State restored to pre-healing baseline."

  # Increment cycle counter
  NEW_CYCLE=$((CURRENT_CYCLE + 1))
  echo "{\"cycle\": $NEW_CYCLE, \"error_sig\": \"$ERROR_SIG\"}" > "$HEALING_STATE"

  if (( NEW_CYCLE < MAX_CYCLES )); then
    echo "Cycle $NEW_CYCLE/$MAX_CYCLES complete. Forming new hypotheses."
    # → Loop back to Step 2 with refined hypotheses
  else
    # → Escalate
    echo "Max cycles reached. Escalating with full context."
  fi
fi
```

### Step 7: Escalation Package

When all cycles are exhausted, escalate with enough context that a human can immediately begin debugging:

```markdown
## Self-Healing Escalation Report

**Error:** [test_name]
**Error signature:** [hash]
**Cycles attempted:** 3/3
**Time spent:** [duration]

### Failure Details
[Full test output — not truncated]

### Patches Attempted
1. Patch A — [hypothesis] — [outcome]
2. Patch B — [hypothesis] — [outcome]
3. Patch C — [hypothesis] — [outcome]

### Diff from Last Green
[git diff output]

### Recommended Next Step
[Best remaining hypothesis with suggested experiment]

### Relevant Files
[files touched by failing test]
```

```bash
# Record escalation
bash runtime/metrics/collector.sh record \
  --skill self-healing-code \
  --outcome failure \
  --notes "escalated: $MAX_CYCLES cycles, $PATCHES_TRIED patches, test: $TEST_NAME"
```

## ClawPowers Enhancement

When `~/.clawpowers/` runtime is initialized:

**Healing state persistence (resumable across sessions):**

```bash
# Save healing progress
bash runtime/persistence/store.sh set "healing:$ERROR_SIG:cycle" "$CURRENT_CYCLE"
bash runtime/persistence/store.sh set "healing:$ERROR_SIG:stash" "$STASH_REF"
bash runtime/persistence/store.sh set "healing:$ERROR_SIG:patches_tried" "$PATCHES_TRIED"

# Resume an interrupted healing session
ERROR_SIG="<hash>"
CYCLE=$(bash runtime/persistence/store.sh get "healing:$ERROR_SIG:cycle")
STASH=$(bash runtime/persistence/store.sh get "healing:$ERROR_SIG:stash")
echo "Resuming healing cycle $CYCLE for error $ERROR_SIG"
```

**Regression detection:**
```bash
# After auto-commit, verify no regressions in related tests
RELATED_TESTS=$(git diff HEAD~1 HEAD --name-only | xargs grep -l "def test_" 2>/dev/null | head -10)
bash -c "$TEST_CMD $RELATED_TESTS 2>&1"
```

**Pattern learning (feeds systematic-debugging):**
```bash
# After successful heal, store the winning pattern
bash runtime/persistence/store.sh set "debug:hypothesis:$ERROR_SIG" \
  "$(cat ~/.clawpowers/state/patches/$ERROR_SIG/patch-$WINNING_PATCH-meta.json)"
```

## Anti-Patterns

| Anti-Pattern | Why It Fails | Correct Approach |
|-------------|-------------|-----------------|
| Apply patches without stashing first | No rollback path if all patches fail | Always stash before first patch |
| Skip hypothesis formation | Random patches waste all 3 cycles | Form ranked hypotheses before any patch |
| Generate only 1 patch | Single point of failure | Always generate ≥ 2 patches before applying |
| Skip coverage check | Patches that delete tests always "pass" | Coverage guard is non-negotiable |
| Apply patches sequentially without reset | Patches contaminate each other | Reset to clean state between each patch |
| Commit without full test suite pass | Partial fixes break other tests | Run full suite, not just the failing test |
| Exceed 3 cycles | Spiraling into a rabbit hole | Hard limit at 3; escalate cleanly |
| Escalate without full context | Human must re-investigate from scratch | Escalation package must include all evidence |
