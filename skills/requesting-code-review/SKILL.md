---
name: requesting-code-review
description: Prepare and submit a code review request with full context, risk areas, and reviewer guidance. Activate when a branch is finished and needs peer review.
version: 1.0.0
requires:
  tools: [git, bash]
  runtime: false
metrics:
  tracks: [review_response_time, review_cycles, reviewer_match_score, feedback_actionability]
  improves: [context_completeness, risk_identification_accuracy, reviewer_selection]
---

# Requesting Code Review

## When to Use

Apply this skill when:

- `finishing-a-development-branch` is complete
- You need peer review before merging
- The change is non-trivial (> 50 lines of production code)
- You want to give reviewers the best chance of catching issues

**Skip when:**
- Trivial typo fix or single-line change
- Emergency hotfix where time doesn't permit (document post-hoc)
- The change is documentation-only with no logic

## Core Methodology

### Step 1: Pre-Review Self-Review

Before requesting review, do a self-review as if you were the reviewer:

```bash
git diff main...HEAD
```

Go through the diff and ask:
- Would I understand what this code does without explanation?
- Are there any obvious bugs I can see fresh?
- Is anything over-engineered or unnecessarily complex?
- Would a new team member be able to maintain this?

Fix anything you find. Requesting review of code you know has issues wastes the reviewer's time.

### Step 2: Identify Risk Areas

Proactively identify what deserves the most scrutiny:

**Risk categories:**
- **Security-sensitive paths** — authentication, authorization, input validation, crypto
- **Concurrency code** — locks, goroutines, async patterns, shared state
- **External integrations** — third-party APIs, payment processors, auth providers
- **Database changes** — schema migrations, query performance, transaction handling
- **Performance-critical paths** — hot loops, cached data invalidation, N+1 queries
- **Backward compatibility** — changed interfaces, removed fields, modified contracts

For each risk area, note:
- What the risk is
- What you did to mitigate it
- What the reviewer should specifically examine

### Step 3: Choose Reviewers

Select reviewers based on:

1. **Domain expertise** — Who has worked with this code area before?
2. **Security knowledge** — For any security-sensitive changes, at least one reviewer with security background
3. **Fresh eyes** — For complex logic, someone unfamiliar with the code (catches implicit assumptions)
4. **Availability** — Don't block on a reviewer who won't be available for 3+ days

**Reviewer load:** Don't request review from someone who already has 3+ open review requests.

**Minimum reviewers:** 1 for low-risk changes, 2 for security changes, 2 for schema migrations.

### Step 4: Write the Review Request

Build on the PR description from `finishing-a-development-branch` and add reviewer-specific guidance:

```markdown
## Code Review Request: [Feature Name]

**Branch:** feature/auth-service → main
**PR:** [link]
**Priority:** [Normal / Urgent / Low]
**Review by:** [date — give at least 24 hours]

### What This Does
[2-3 sentences for someone who hasn't seen any of the work]

### What's Changed (Key Files)
- `src/auth/service.py` — Core JWT issuance and validation logic (NEW)
- `src/middleware/auth.py` — Request authentication middleware (MODIFIED)
- `tests/test_auth.py` — 34 new tests (NEW)
- `migrations/003_auth_sessions.sql` — Session storage schema (NEW)

### What to Focus On

**[HIGH PRIORITY] `src/auth/service.py:47-89` — JWT validation logic**
This is the most security-critical path. Specifically review:
- Token expiry check (line 61) — must reject expired tokens before checking signature
- Algorithm enforcement (line 78) — must reject HS256, accept RS256 only
- Error handling (lines 84-89) — must not leak token contents in error messages

**[MEDIUM] `migrations/003_auth_sessions.sql`**
Irreversible change. Verify the rollback migration is correct before approving.

**[LOW] `src/middleware/auth.py`**
Standard middleware pattern. Verify session cache key structure is consistent.

### Known Tradeoffs Accepted
- Sessions stored in Redis (not DB) for performance — accepted: Redis is already a dependency
- TTL is fixed at 1 hour — accepted: configurable TTL deferred to follow-up issue #247

### Not in Scope
- Password reset flow — tracked in issue #248
- MFA support — tracked in issue #249

### Testing Summary
- 34 unit tests (all auth logic paths)
- 8 integration tests (real Redis, real DB)
- Manual test: registered, logged in, made authenticated request, logged out
- Security test: expired token rejected, tampered token rejected, algorithm confusion rejected

### Questions for Reviewers
1. Is the error message at line 88 safe to expose to clients? (no token contents, but mentions "signature verification failed")
2. Should the session TTL be in seconds or milliseconds in the Redis key expiry? Currently seconds — consistent with Python's time.time().
```

### Step 5: Notify Reviewers

Don't just assign in GitHub and wait. Notify:

```
[Message to reviewer]
Hey, I've opened a PR for the auth service implementation. About 400 lines of 
new code + a schema migration. Review should take 30-45 minutes. 

High priority focus: the JWT validation logic in src/auth/service.py (lines 47-89).

PR: [link]
No rush on today — tomorrow EOD works. Let me know if you have questions 
before diving in.
```

Direct notification (Slack, Teams, etc.) gets 3x faster response than GitHub assignment alone.

### Step 6: Be Available for Questions

During review:
- Check for review comments every few hours
- Answer questions promptly — blocking the reviewer = slower iteration
- If you need to make changes during review, push to the same branch (don't open a new PR)
- Respond to every comment — even "acknowledged" or "agreed, will fix" counts

## ClawPowers Enhancement

When `~/.clawpowers/` runtime is initialized:

**Reviewer Matching Based on Code Area:**

Track which reviewers have reviewed which paths:

```bash
bash runtime/persistence/store.sh set "reviewer:alice:areas" "src/auth/,src/middleware/"
bash runtime/persistence/store.sh set "reviewer:bob:areas" "migrations/,src/models/"
bash runtime/persistence/store.sh set "reviewer:carol:areas" "src/api/,tests/"

# Get suggested reviewers for current diff
CHANGED_DIRS=$(git diff main...HEAD --name-only | xargs -I{} dirname {} | sort -u | tr '\n' ',')
bash runtime/persistence/store.sh list "reviewer:*:areas" | grep -f <(echo "$CHANGED_DIRS" | tr ',' '\n')
```

**Review History:**

```bash
bash runtime/persistence/store.sh set "review:auth-service:requested_at" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
bash runtime/persistence/store.sh set "review:auth-service:reviewers" "alice,bob"
# After review completes:
bash runtime/persistence/store.sh set "review:auth-service:response_time_hours" "6"
bash runtime/persistence/store.sh set "review:auth-service:cycles" "2"
bash runtime/persistence/store.sh set "review:auth-service:outcome" "approved"
```

**Review Request Quality Metrics:**

Correlates review request quality (risk areas identified, context completeness) with number of review cycles required. PRs with complete context average 1.3 cycles; PRs without average 2.8 cycles.

## Anti-Patterns

| Anti-Pattern | Why It Fails | Correct Approach |
|-------------|-------------|-----------------|
| No context in PR description | Reviewers waste time figuring out what the PR does | Complete description with focus areas |
| Requesting review of known-bad code | Wastes reviewer time, undermines trust | Self-review first, fix what you find |
| Assigning everyone to every PR | Diffusion of responsibility, everyone waits for someone else | 1-2 targeted reviewers |
| No risk areas identified | Reviewers apply uniform attention, miss high-risk areas | Explicitly call out what needs scrutiny |
| Requesting review on Friday afternoon | Review blocked until Monday | Time requests for prompt turnaround |
| Not notifying reviewers directly | Notification gets buried | Direct message in addition to GitHub assignment |
| "Take your time" with security changes | Security review gets deprioritized | State urgency explicitly |

## Integration with Other Skills

- Preceded by `finishing-a-development-branch`
- Followed by `receiving-code-review`
- Use `security-audit` to pre-scan before requesting security-sensitive reviews
