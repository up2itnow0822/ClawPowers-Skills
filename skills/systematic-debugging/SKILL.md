---
name: systematic-debugging
description: Hypothesis-driven debugging with evidence collection. Activate when you encounter unexpected behavior, a failing test, or a bug report.
version: 1.0.0
requires:
  tools: [bash, git]
  runtime: false
metrics:
  tracks: [hypotheses_tested, time_to_root_cause, false_positives, reopen_rate]
  improves: [hypothesis_quality, evidence_collection_speed, known_issue_match_rate]
---

# Systematic Debugging

## When to Use

Apply this skill when:

- A test is failing and the cause isn't immediately obvious
- A bug report describes behavior that shouldn't happen
- Code that worked before suddenly doesn't
- A production alert is firing
- You've tried 2+ fixes without understanding why they work or don't

**Skip when:**
- The cause is obvious from the error message (typo, import missing, syntax error)
- You've seen this exact error before and know the fix
- It's a configuration issue, not a logic bug

**Decision tree:**
```
Is the error message self-explanatory?
├── Yes → fix it directly
└── No  → Have you seen this pattern before?
          ├── Yes → apply the known fix, verify, document
          └── No  → systematic-debugging ← YOU ARE HERE
```

## Core Methodology

### Persistent Hypothesis Memory

Before forming any new hypotheses, check if this error pattern has been seen before. Pattern-matching known bugs is 10-100x faster than fresh investigation.

**Step 0: Check the hypothesis memory store**

```bash
# Compute error signature hash from the error message + test name
ERROR_MSG="ConnectionPool timeout after 50 requests"
ERROR_SIG=$(echo "$ERROR_MSG" | md5)

# Look up prior debugging sessions for this error pattern
KNOWN=$(bash runtime/persistence/store.sh get "debug:hypothesis:$ERROR_SIG:winning" 2>/dev/null)

if [[ -n "$KNOWN" ]]; then
  echo "=== Known error pattern found ==="
  echo "Previously solved. Winning hypothesis:"
  echo "$KNOWN"
  echo ""
  # Start directly with the previously successful hypothesis
  # Verify it applies to the current context before applying
fi
```

**Storage format** — every hypothesis tree is stored keyed by error signature:

```bash
# After solving a bug, always persist the result
ERROR_SIG=$(echo "$ERROR_MSG" | md5)
RESOLVE_TIME=$(( END_TS - START_TS ))

bash runtime/persistence/store.sh set "debug:hypothesis:$ERROR_SIG:error_msg" "$ERROR_MSG"
bash runtime/persistence/store.sh set "debug:hypothesis:$ERROR_SIG:hypotheses_tried" "$H1|$H2|$H3"
bash runtime/persistence/store.sh set "debug:hypothesis:$ERROR_SIG:winning" "$WINNING_HYPOTHESIS"
bash runtime/persistence/store.sh set "debug:hypothesis:$ERROR_SIG:root_cause" "$ROOT_CAUSE"
bash runtime/persistence/store.sh set "debug:hypothesis:$ERROR_SIG:fix_summary" "$FIX_SUMMARY"
bash runtime/persistence/store.sh set "debug:hypothesis:$ERROR_SIG:time_to_resolution" "$RESOLVE_TIME"
bash runtime/persistence/store.sh set "debug:hypothesis:$ERROR_SIG:project" "$(basename $(git rev-parse --show-toplevel))"
bash runtime/persistence/store.sh set "debug:hypothesis:$ERROR_SIG:timestamp" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

**Fuzzy search for similar patterns** (when exact hash doesn't match):

```bash
# Search by keyword across all stored hypotheses
bash runtime/persistence/store.sh list "debug:hypothesis:*:error_msg" | while read key; do
  VALUE=$(bash runtime/persistence/store.sh get "$key")
  if echo "$VALUE" | grep -qi "connection\|pool\|timeout"; then
    SIG=$(echo "$key" | awk -F: '{print $3}')
    echo "=== Similar error ==="
    echo "Error: $VALUE"
    echo "Winning hypothesis: $(bash runtime/persistence/store.sh get "debug:hypothesis:$SIG:winning")"
    echo "Time to resolve: $(bash runtime/persistence/store.sh get "debug:hypothesis:$SIG:time_to_resolution")s"
    echo ""
  fi
done
```

**After 10+ debugging sessions, the memory pays dividends:**

| Scenario | Without memory | With memory |
|---------|---------------|-------------|
| Same error exact match | 30-90 min investigation | < 2 min (known fix) |
| Similar error pattern | 20-60 min | 5-10 min (start from best hypothesis) |
| Novel error | Same as before | Same — no false acceleration |

**When to override the memory:**
- The error signature matches but the context differs (different library version, different project type)
- The previously winning hypothesis was marked as "project-specific"
- The fix was a workaround, not a root cause fix

```bash
# Flag a fix as project-specific (won't suggest for other projects)
bash runtime/persistence/store.sh set "debug:hypothesis:$ERROR_SIG:scope" "project-specific"
```

### The Scientific Debugging Loop

```
Observe → Form hypothesis → Design experiment → Execute → Collect evidence → Conclude → Repeat
```

Never skip steps. The most common debugging failure is jumping from "observe" directly to "try a fix" — which produces random mutations until something accidentally works, with no understanding of why.

### Step 1: Observation (Gather All Evidence First)

Before forming any hypothesis, collect:

**Required evidence:**
- [ ] Exact error message (full stack trace, not a summary)
- [ ] Steps to reproduce (minimal reproducible case)
- [ ] What changed recently (git log since last known good)
- [ ] Environment (OS, language version, dependency versions)
- [ ] Frequency (always, intermittent, under specific conditions)

**Observation template:**
```markdown
## Bug Observation

**Error:** [Paste exact error/stack trace]
**Reproduces:** [Always / Intermittent (N/M times) / Only when X]
**Environment:** [OS, runtime version, key dependency versions]
**Last known good:** [commit hash or date when this worked]
**Recent changes:** [output of: git log --oneline --since="3 days ago"]
**Minimal repro:** 
[Smallest possible code that triggers the error]
```

**The minimal repro is not optional.** Debugging without a minimal repro is debugging the wrong problem. Strip everything until you have the smallest code that still fails.

### Step 2: Hypothesis Formation

From the observation, generate 2-4 hypotheses. Rules:

- Each hypothesis must be **specific** (names a cause, not a category)
- Each hypothesis must be **falsifiable** (an experiment can prove it wrong)
- Hypotheses must be **ranked by probability** (investigate most likely first)

**Bad hypothesis:** "There might be an issue with the database"
**Good hypothesis:** "The connection pool is exhausted because we're not releasing connections in the error path of `process_payment()`"

**Hypothesis template:**
```markdown
## Hypothesis N: [Specific cause]

**Mechanism:** [How this cause produces the observed symptom]
**Probability:** [High/Medium/Low] because [reason]
**Experiment:** [Specific test that proves or disproves this hypothesis]
**Expected evidence if TRUE:** [What you'd see if this is the cause]
**Expected evidence if FALSE:** [What you'd see if this is not the cause]
```

### Step 3: Experiments (Investigate, Don't Fix)

**Critical rule:** Run experiments to gather evidence, not to fix the bug. The fix comes after you understand the cause.

**Experiment types:**

**Isolation:** Narrow the failure scope
```bash
# Does it fail with a fresh database?
docker run --rm -e POSTGRES_DB=test postgres:15
python -m pytest tests/test_payment.py --db-url postgresql://localhost/test

# Does it fail with a specific user only?
python -m pytest tests/test_payment.py -k "user_123"
```

**Binary search:** Git bisect for regressions
```bash
git bisect start
git bisect bad HEAD
git bisect good v2.3.1  # last known good
git bisect run python -m pytest tests/test_payment.py -x
# Git finds the exact commit that introduced the bug
```

**Logging:** Add targeted logging at the hypothesis boundary
```python
# Don't add logging everywhere — add it exactly where the hypothesis predicts the failure
import logging
logger = logging.getLogger(__name__)

def process_payment(payment_id: str):
    conn = get_db_connection()
    logger.debug(f"process_payment: got connection {id(conn)}, pool size: {pool.size()}")
    try:
        # ... payment logic
        return result
    except Exception as e:
        logger.error(f"process_payment FAILED: {e}, conn being released: {id(conn)}")
        # BUG: connection not released here → pool exhaustion
        raise  # Fix: conn.close() before raise
```

**State inspection:** Check system state at the failure point
```bash
# Check connection pool state before/during/after
psql -c "SELECT count(*), state FROM pg_stat_activity GROUP BY state;"

# Check event queue depth
redis-cli LLEN payment_queue

# Check file descriptor usage
lsof -p $(pgrep -f payment_service) | wc -l
```

### Step 4: Evidence Collection

After each experiment, record what you found:

```markdown
## Evidence: Hypothesis N Test

**Experiment run:** [command or action taken]
**Result:** [what actually happened]
**Conclusion:** [does this support or refute the hypothesis?]
**Next step:** [if supported: deeper investigation | if refuted: next hypothesis]
```

**Never interpret evidence to fit the hypothesis.** If the experiment contradicts the hypothesis, the hypothesis is wrong. Form a new one.

### Step 5: Root Cause Identification

When an experiment strongly confirms a hypothesis:

1. State the root cause precisely: "The root cause is [mechanism], which occurs because [condition], resulting in [symptom]"
2. Trace back: Is this the root cause or a symptom of a deeper cause? Ask "why" 3-5 times.
3. Identify the fix that addresses the root cause, not just the symptom.

**Root cause template:**
```markdown
## Root Cause

**Statement:** [precise description of the cause]
**Why it happens:** [condition that triggers it]
**Why it wasn't caught:** [test gap, code review miss, etc.]

**Fix:** [specific code change that addresses the root cause]
**Regression test:** [test that would have caught this]
**Prevention:** [process change to prevent this class of bug]
```

### Step 6: Fix and Verify

1. Apply the minimal fix (don't refactor while fixing — that's scope creep)
2. Verify the original reproduction case no longer fails
3. Verify the fix doesn't break other tests
4. Write the regression test
5. Commit fix and test together

## ClawPowers Enhancement

When `~/.clawpowers/` runtime is initialized:

**Persistent Hypothesis Tree:**

The full investigation is saved and never lost between sessions:

```bash
# Save investigation state
bash runtime/persistence/store.sh set "debug:payment-pool-exhaustion:observation" "ConnectionPool timeout after 50 requests"
bash runtime/persistence/store.sh set "debug:payment-pool-exhaustion:hypothesis1" "Connection not released in error path"
bash runtime/persistence/store.sh set "debug:payment-pool-exhaustion:h1_result" "CONFIRMED: no conn.close() in except block"
bash runtime/persistence/store.sh set "debug:payment-pool-exhaustion:root_cause" "Missing conn.close() in process_payment error path"
bash runtime/persistence/store.sh set "debug:payment-pool-exhaustion:fix_commit" "a3f9b2c"
```

If debugging spans multiple sessions, resume with:
```bash
bash runtime/persistence/store.sh list "debug:payment-pool-exhaustion:*"
```

**Known-Issue Pattern Matching:**

Past root causes are searchable. Before forming hypotheses:
```bash
bash runtime/persistence/store.sh list "debug:*:root_cause" | grep -i "connection"
# → Found 2 prior connection-related bugs
# → Shows fixes applied, saving re-investigation time
```

**Debugging Metrics:**

```bash
bash runtime/metrics/collector.sh record \
  --skill systematic-debugging \
  --outcome success \
  --duration 1800 \
  --notes "payment-pool: 3 hypotheses, 1 correct, git bisect narrowed to 1 commit"
```

Tracks: time-to-root-cause, hypothesis accuracy rate, which experiment types are most effective.

## Anti-Patterns

| Anti-Pattern | Why It Fails | Correct Approach |
|-------------|-------------|-----------------|
| "Try-and-see" debugging | Random mutations, no understanding | Form hypothesis before changing code |
| Fixing without reproducing | Can't verify the fix worked | Minimal repro first, always |
| Investigating without isolation | Debugging the wrong level | Binary search / isolate the scope first |
| Multiple changes at once | Can't attribute which change fixed it | One change per experiment |
| Interpreting evidence to fit hypothesis | Confirmation bias, wrong fix | Evidence disproves or confirms; update hypothesis |
| Debugging by adding logs everywhere | Signal-to-noise ratio collapses | Targeted logging at hypothesis boundary only |
| Not writing regression test | Same bug recurs | Regression test is non-optional |
| Fixing symptoms, not root cause | Bug returns in a different form | Ask "why" 3-5 times to reach root cause |

## Examples

### Example 1: Intermittent Test Failure

**Observation:** `test_concurrent_writes` fails 20% of the time with `AssertionError: expected 100 rows, got 97-99`

**Hypothesis 1:** Race condition — concurrent writes arrive after the assertion reads
- Experiment: Add sleep(0.1) before assertion
- Result: Still fails
- Conclusion: Not a timing issue

**Hypothesis 2:** Lost update — concurrent transactions overwrite each other
- Experiment: Add row-level locking to write path
- Result: 0 failures in 100 runs
- Conclusion: CONFIRMED — missing `SELECT FOR UPDATE` in the read-modify-write cycle

**Root cause:** `update_counter()` reads then writes without a lock — concurrent execution loses updates.

### Example 2: Production Alert

**Observation:** Memory usage grows 50MB/hour until OOM restart

**Hypothesis 1:** Memory leak — objects not garbage collected
- Experiment: `objgraph.most_common_types()` before and after request batches
- Result: `WeakValueDictionary` count grows monotonically
- Conclusion: CONFIRMED — cache holds strong refs despite `WeakValue` (values are themselves containers)

**Root cause:** Cache stores lists as values, lists are containers that prevent GC of their contents.
