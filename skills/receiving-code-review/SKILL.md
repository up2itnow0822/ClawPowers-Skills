---
name: receiving-code-review
description: Process code review feedback constructively and systematically. Activate when you receive review comments on a PR.
version: 1.0.0
requires:
  tools: [git, bash]
  runtime: false
metrics:
  tracks: [feedback_items_addressed, response_time, clarification_requests, approved_on_cycle]
  improves: [feedback_categorization, response_quality, pattern_detection]
---

# Receiving Code Review

## When to Use

Apply this skill when:

- You've received review comments on a PR
- You need to process reviewer feedback before responding
- You want to make sure you're addressing feedback effectively, not just defensively

**The mindset:** Reviewers are helping you ship better code. Feedback is information, not judgment. The goal is to understand it, not to defend against it.

## Core Methodology

### Step 1: Read Everything Before Responding to Anything

Before replying to any comment:

1. Read all comments start to finish
2. Identify the reviewer's primary concerns (often one theme across many comments)
3. Distinguish between required changes and suggestions

**Don't respond in real-time as notifications arrive.** You'll respond to symptoms without seeing the root concern, leading to back-and-forth rather than resolution.

### Step 2: Categorize Feedback

For each comment, assign a category:

| Category | Definition | Action |
|----------|-----------|--------|
| **Bug** | Reviewer found a real bug | Fix unconditionally |
| **Security** | Security concern identified | Fix unconditionally, escalate if in scope |
| **Clarity** | Code is correct but hard to understand | Rename / add comment / restructure |
| **Suggestion** | Optional improvement, not blocking | Evaluate on merit; implement or decline with reason |
| **Style** | Formatting, naming conventions | Align with team standard; if no standard, discuss |
| **Question** | Reviewer wants to understand, not change | Explain in response; add inline comment if confusion likely for others |
| **Out of scope** | Valid concern, but not for this PR | Acknowledge, create tracking issue, respond with issue number |
| **Nitpick** | Low-impact preference | Implement if quick; decline with "minor — deferred" if not |

**Never suppress a Bug or Security comment by arguing it's not a bug.** If you disagree, explain your reasoning and request explicit sign-off from the reviewer. Don't merge until that sign-off is given.

### Step 3: Create a Response Plan

Before touching code, plan your responses:

```markdown
## Review Response Plan

**PR:** feature/auth-service
**Reviewer:** Alice
**Total comments:** 12

### Required (must fix before merge)
1. Line 61 — Token expiry check order: [AGREED — will move expiry check before signature validation]
2. Line 88 — Error message leaks algorithm name: [AGREED — will generalize to "Invalid token"]

### Will Fix (optional but clearly right)
3. Line 44 — Rename `u` to `user_id`: [AGREED — will rename throughout]
4. Line 102 — Missing test for empty audience claim: [AGREED — will add test]

### Will Discuss (need alignment)
5. Line 78 — Algorithm enforcement via allowlist vs. blocklist: [DISAGREE — will explain RS256-only policy in response]

### Out of Scope (create issues)
6. Line 30 — Refresh token support: [Valid — creating issue #263, not in this PR's scope]

### Questions (need to understand before acting)
7. Line 55 — "Is this safe?" — need clarification: what specifically concerns you?
```

### Step 4: Implement Changes

Work through required and agreed changes:

1. Create a new commit for the review changes (don't squash yet — reviewer needs to see what changed)
2. Address each comment with a corresponding code change
3. For each change, reply to the comment in GitHub explaining what you did

**Commit message format:**
```
review: address auth service review feedback from Alice

- Move token expiry check before signature validation (line 61)
- Generalize error message to avoid algorithm disclosure (line 88)
- Rename u → user_id for clarity throughout auth.py
- Add test for empty audience claim
```

### Step 5: Respond to Every Comment

Every comment deserves a response, even if the response is "acknowledged" or "disagree — see explanation":

**For implemented changes:**
```
Fixed in commit a3f9b2c. Moved expiry check to line 47, now before signature 
validation as you suggested. Tests updated to reflect new check order.
```

**For agreed suggestions:**
```
Good catch — added test for empty audience claim in test_auth.py:147.
```

**For disagreements:**
```
I understand the concern. The reason I chose an allowlist (RS256 only) rather than 
a blocklist (exclude HS256) is that new algorithms get added periodically — an 
allowlist stays secure as the JWT spec evolves, a blocklist can be bypassed by 
a newly-added algorithm we haven't blocked yet. Happy to add a comment to the 
code explaining this if it's not obvious.
```

**For out-of-scope items:**
```
Valid point — this is outside this PR's scope but worth addressing. 
Created issue #263 for refresh token support. Added it to the next sprint backlog.
```

**Tone rules:**
- Never sarcastic or defensive
- Explain your reasoning when disagreeing
- Thank reviewers for catches that were genuine bugs or security issues
- Don't over-apologize — brief acknowledgment is sufficient

### Step 6: Request Re-review

After addressing all feedback:

```bash
# Push changes
git push origin feature/auth-service

# In GitHub: mark all addressed conversations as "Resolved"
# (only resolve conversations you've addressed — let reviewer resolve their own)
# Re-request review from reviewer
```

Notify the reviewer:
```
Hi Alice — addressed all your feedback. Main changes:
1. Moved expiry check before signature validation
2. Generalized error message
3. Added 3 new tests for edge cases you identified

Disagreed on one point (algorithm allowlist) and explained reasoning in the thread — 
would appreciate your thoughts. PR is ready for re-review.
```

### Step 7: Iterate Until Approved

Repeat Steps 4-6 until all required changes are addressed and reviewer approves.

**If review is dragging:**
- If reviewer hasn't responded in 2 business days after re-request: follow up in Slack/Teams
- If a comment thread is becoming a lengthy debate: move it to a real conversation, then update the PR based on the conclusion

## ClawPowers Enhancement

When `~/.clawpowers/` runtime is initialized:

**Feedback Pattern Database:**

Every piece of review feedback gets stored (with PR and reviewer context):

```bash
bash runtime/persistence/store.sh set "feedback:pattern:token-expiry-order" "expiry check must precede signature check"
bash runtime/persistence/store.sh set "feedback:pattern:error-message-leakage" "error messages must not disclose algorithm or implementation details"
```

Before writing code in the future:
```bash
bash runtime/persistence/store.sh list "feedback:pattern:*"
# → Shows common feedback patterns → prevents them from being submitted in the first place
```

**Common Issues Tracking:**

After 20+ PR cycles:
```bash
bash runtime/feedback/analyze.sh --skill receiving-code-review
# Output:
# Most common feedback category: Bug (38%) — improving test coverage recommended
# Most common feedback type: Security (22%) — consider security review checklist in verification step
# Average review cycles: 2.1 — target: 1.5
# Longest threads: algorithm selection, error handling, naming conventions
```

**Response Quality Metrics:**

```bash
bash runtime/metrics/collector.sh record \
  --skill receiving-code-review \
  --outcome success \
  --notes "auth-service: 12 comments, 10 fixed, 1 declined (explained), 1 deferred (#263), approved on cycle 2"
```

## Anti-Patterns

| Anti-Pattern | Why It Fails | Correct Approach |
|-------------|-------------|-----------------|
| Responding to comments as they arrive | Miss the theme, respond to symptoms | Read all comments first, then respond |
| Defensive responses | Damages reviewer relationship, slows iteration | Assume good faith, explain reasoning when disagreeing |
| Ignoring comments | Reviewer marks "changes requested" forever | Respond to every comment |
| Resolving reviewer's conversations yourself | Reviewer loses track of what was addressed | Only resolve your own acknowledged items |
| "Fixed" with no explanation | Reviewer can't verify without re-reading diff | Explain what you changed and where |
| Silently closing out-of-scope items | Valid concerns get lost | Create issues for deferred items, reference in response |
| Merging without re-request | Reviewer never sees the updated code | Always re-request after addressing feedback |

## Integration with Other Skills

- Preceded by `requesting-code-review`
- Use `systematic-debugging` if review feedback reveals a deeper architectural issue
- Use `writing-plans` if review feedback requires substantial new work
