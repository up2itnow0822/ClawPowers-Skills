---
name: finishing-a-development-branch
description: Clean up a completed feature branch, write changelog entry, optimize commit history, and prepare for merge. Activate when feature work is done and verified.
version: 1.0.0
requires:
  tools: [git, bash]
  runtime: false
metrics:
  tracks: [squash_accuracy, changelog_quality, merge_conflicts, review_cycles_after_finish]
  improves: [commit_message_quality, squash_strategy, changelog_format]
---

# Finishing a Development Branch

## When to Use

Apply this skill after:

- `verification-before-completion` passes all gates
- The feature is functionally complete
- You're ready to open a PR or merge to main

**Don't start this skill until verification passes.** Finishing a bad branch just makes it a clean bad branch.

## Core Methodology

### Step 1: Final State Verification

Before touching the branch:

```bash
git status                      # Clean working tree (nothing unstaged)
git log --oneline main..HEAD    # All your commits, review them
git diff main...HEAD            # Full diff against main
```

If there are uncommitted changes: commit them or stash them. If there are WIP commits ("temp", "wip", "debugging"), they need to be cleaned up in Step 3.

### Step 2: Changelog Entry

Write the changelog before squashing. You have the full commit history available now — use it.

**Format:** Follow [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) conventions:

```markdown
## [Unreleased]

### Added
- JWT-based authentication with RS256 signing (`auth.issue()`, `auth.validate()`)
- Session management with configurable TTL
- User registration endpoint with email verification flow

### Changed
- `UserService.create()` now requires email verification before login is permitted

### Fixed
- Connection pool exhaustion under concurrent load (was not releasing connections in error paths)

### Security
- Added bcrypt password hashing (cost factor 12)
- Rate limiting on auth endpoints (10 req/min per IP)
```

**Categories:**
- `Added` — New features
- `Changed` — Changes to existing functionality
- `Deprecated` — Soon-to-be-removed features
- `Removed` — Removed features
- `Fixed` — Bug fixes
- `Security` — Security-related changes

**Rules:**
- Write for humans, not for git log readers
- Link to issue numbers if they exist: `(#123)`
- Be specific about what changed, not how it changed
- One changelog entry per PR, not per commit

### Step 3: Commit History Optimization

Review all commits between your branch and main:

```bash
git log --oneline main..HEAD
```

**Squash strategy:**

| Commit pattern | Action |
|---------------|--------|
| `wip`, `temp`, `debug` commits | Squash into parent |
| Multiple tiny commits for same logical change | Squash into one |
| Fix commits for mistakes in the same PR | Squash into the commit being fixed |
| Logical, independent changes | Keep separate |
| Each commit is one testable unit | Keep as-is |

**Interactive rebase:**
```bash
git rebase -i main
# Opens editor — mark commits as:
# pick: keep as-is
# squash (s): merge into previous commit
# fixup (f): merge into previous commit, discard this commit's message
# reword (r): keep but edit the message
```

**After squash, verify:**
```bash
git log --oneline main..HEAD    # Should show clean, logical commits
git diff main...HEAD            # Diff should be identical to before squash
```

### Step 4: Conventional Commit Messages

Each remaining commit must use Conventional Commits format:

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

**Types:**
- `feat`: New feature (triggers MINOR version bump)
- `fix`: Bug fix (triggers PATCH version bump)
- `perf`: Performance improvement
- `refactor`: Code restructuring (no behavior change)
- `test`: Adding or fixing tests
- `docs`: Documentation only
- `ci`: CI/CD configuration
- `chore`: Dependency updates, tooling

**Breaking changes:** Add `!` after type or `BREAKING CHANGE:` footer
```
feat!: remove deprecated V1 auth endpoints

BREAKING CHANGE: /api/v1/login and /api/v1/logout have been removed.
Use /api/v2/auth/login and /api/v2/auth/logout instead.
```

**Examples:**
```
feat(auth): implement JWT authentication with RS256 signing
fix(auth): release connection in error path of process_payment
perf(cache): add Redis-backed session cache for hot paths
```

### Step 5: Branch Cleanup Check

```bash
# Verify the branch builds and tests pass after rebase
git checkout feature/auth
# [run test suite]
pytest  # or npm test or go test ./...

# Verify clean diff (no accidental deletions)
git diff main...HEAD --stat
```

### Step 6: PR Description

Write the PR description while everything is fresh:

```markdown
## Summary

[2-3 sentences: what this PR does and why]

## Changes

- [Key change 1]
- [Key change 2]
- [Key change 3]

## Testing

- [What tests cover this change]
- [Any manual testing done]
- [Edge cases explicitly tested]

## Breaking Changes

[None / description of any breaking changes]

## Screenshots / Output

[If UI or CLI output changed, show before/after]

## Checklist

- [x] Tests pass (127 passing, 0 failing)
- [x] Coverage ≥ 80% (84% for new code)
- [x] No linting errors
- [x] CHANGELOG updated
- [x] Documentation updated
```

### Step 7: Final Push

```bash
git push origin feature/auth-service
# If after rebase:
git push origin feature/auth-service --force-with-lease  # Never --force alone
```

`--force-with-lease` is safe: it rejects the push if the remote branch has changed since your last fetch, preventing overwriting someone else's work.

## ClawPowers Enhancement

When `~/.clawpowers/` runtime is initialized:

**Automated Squash Strategy:**

Based on commit history patterns, the framework suggests optimal squash boundaries:
```bash
bash runtime/persistence/store.sh get "config:branch-finish:squash_strategy"
# → logical_units (keep separate commits per feature unit)
# → single_commit (squash entire branch to one commit for hotfixes)
```

**Conventional Commit Enforcement:**

Before the push step, validate all commit messages:
```bash
bash runtime/persistence/store.sh get "config:branch-finish:conventional_commits"
# → strict (reject non-conforming messages)
# → warn (flag but allow)
```

**Changelog Quality Scoring:**

Stores past changelog entries and scores them on:
- Specificity (named functions/endpoints vs. vague descriptions)
- Completeness (all changes captured)
- Human readability

```bash
bash runtime/metrics/collector.sh record \
  --skill finishing-a-development-branch \
  --outcome success \
  --notes "auth-service: 12 commits → 4, conventional commits enforced, changelog written"
```

## Anti-Patterns

| Anti-Pattern | Why It Fails | Correct Approach |
|-------------|-------------|-----------------|
| Squashing all commits to one regardless of size | Loses traceability for large PRs | Squash to logical units, not one blob |
| `--force` push (not `--force-with-lease`) | Overwrites teammates' commits silently | Always `--force-with-lease` |
| Vague changelog ("various fixes") | Useless for users and future developers | Specific, named changes with context |
| Writing PR description after review starts | Reviewers lack context | Write description before requesting review |
| Not verifying after rebase | Rebase conflicts silently break behavior | Run full test suite after any rebase |
| WIP commits in merged history | Pollutes git log | Squash WIP commits unconditionally |

## Integration with Other Skills

- Preceded by `verification-before-completion`
- Followed by `requesting-code-review`
- Use `using-git-worktrees` if finishing one of several concurrent branches
