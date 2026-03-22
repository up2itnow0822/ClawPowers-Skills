---
name: using-git-worktrees
description: Manage isolated Git worktrees for parallel branch development. Activate when you need to work on multiple branches simultaneously or isolate subagent work.
version: 1.0.0
requires:
  tools: [git, bash]
  runtime: false
metrics:
  tracks: [worktrees_created, conflicts_encountered, isolation_violations, lifecycle_completion_rate]
  improves: [conflict_prediction, worktree_naming, cleanup_timing]
---

# Using Git Worktrees

## When to Use

Apply this skill when:

- Working on 2+ branches simultaneously without switching
- Running subagents in parallel (each needs its own working directory)
- Testing a feature while bug-fixing on another branch
- Reviewing a colleague's branch while continuing your own work
- Running long-running processes (tests, builds) on one branch while editing another

**Skip when:**
- You only have one branch active at a time
- Your editor doesn't handle multiple root directories well
- The branches share files that would conflict on disk (same path, different content)

## Core Methodology

### Understanding Worktrees

A Git worktree is a separate working directory linked to the same repository. Each worktree:
- Has its own checked-out branch
- Has its own working tree state (staged/unstaged changes)
- Shares the repository's history, objects, and refs
- Cannot have the same branch checked out as another worktree

```
.git/                           ← Shared repository database
  worktrees/
    feature-auth/               ← Worktree metadata
    feature-payments/           ← Worktree metadata

../feature-auth/                ← Separate directory on disk
  src/
  tests/
  
../feature-payments/            ← Separate directory on disk
  src/
  tests/
```

### Worktree Lifecycle

#### Create

```bash
# Create worktree for existing branch
git worktree add ../feature-auth feature/auth-service

# Create worktree and new branch simultaneously
git worktree add -b feature/payments ../feature-payments main

# Create worktree from specific commit
git worktree add ../hotfix-3.1 v3.1.0
```

**Naming convention for parallel subagent work:**
```bash
# Use task or feature name as both branch and directory
git worktree add ../clawpowers-task-auth feature/task-auth
git worktree add ../clawpowers-task-db feature/task-db
git worktree add ../clawpowers-task-api feature/task-api
```

#### Verify

```bash
git worktree list
# output:
# /Users/you/project                  a3f9b2c [main]
# /Users/you/feature-auth             0000000 [feature/auth-service]
# /Users/you/feature-payments         0000000 [feature/payments]
```

#### Work in the Worktree

Each worktree is a full working directory. Navigate to it and work normally:

```bash
cd ../feature-auth
git status          # Independent of main working tree
git add src/auth.py
git commit -m "feat(auth): implement JWT issuance"
```

Changes in one worktree are invisible to others until merged.

#### Sync with Main

When you need to update a worktree with latest main:

```bash
cd ../feature-auth
git fetch origin
git rebase origin/main  # Preferred: linear history
# or
git merge origin/main   # If rebase would cause conflicts
```

Run `git worktree list` first — if another worktree has the same base, check for merge conflicts proactively.

#### Cleanup

When the branch is merged:

```bash
# From main repository directory
git worktree remove ../feature-auth          # Removes directory
git branch -d feature/auth-service            # Remove branch

# If the worktree has uncommitted changes and you want to force:
git worktree remove --force ../feature-auth

# List remaining worktrees to verify
git worktree list
```

**Cleanup checklist:**
- [ ] Branch is merged to main (or PR is approved)
- [ ] Worktree has no uncommitted changes
- [ ] No processes are running in the worktree directory
- [ ] Remove directory, then remove branch

### Conflict Prevention

Worktrees share the index but have separate working trees. Common conflicts:

**Same branch in two worktrees:** Git prevents this — you'll get an error:
```
fatal: 'feature/auth-service' is already checked out
```

**Solution:** Use separate branches even for related work.

**Both worktrees editing the same file:** Legal, but merging will require conflict resolution:
```bash
# Check overlap before creating worktrees
git diff --name-only main..feature/branch-a
git diff --name-only main..feature/branch-b
# If outputs overlap, consider sequential rather than parallel work
```

**Submodule issues:** Worktrees and submodules interact poorly. If your repo uses submodules, test worktree creation in a non-submodule path first.

### Pattern: Subagent Work Isolation

The primary ClawPowers use case: give each subagent its own worktree.

```bash
# Main orchestrator creates worktrees
TASKS=("auth" "db" "api" "tests")
for task in "${TASKS[@]}"; do
  git worktree add "../${REPO_NAME}-task-${task}" -b "feature/task-${task}" main
  echo "Created worktree for task-${task} at ../${REPO_NAME}-task-${task}"
done

# Each subagent receives its worktree path
# Subagent-auth works in: ../project-task-auth/
# Subagent-db works in: ../project-task-db/
# They cannot interfere with each other's files

# After all subagents complete, merge in dependency order
MERGE_ORDER=("db" "auth" "api" "tests")
git checkout main
for task in "${MERGE_ORDER[@]}"; do
  git merge --no-ff "feature/task-${task}" -m "merge: task-${task}"
  git worktree remove "../${REPO_NAME}-task-${task}"
  git branch -d "feature/task-${task}"
done
```

### Pattern: Hotfix While Feature Work Continues

```bash
# You're in the middle of a long feature
git worktree list
# /Users/you/project           [feature/auth-service]

# Production alert fires — need to hotfix
git worktree add ../hotfix main
cd ../hotfix
# ... fix the bug ...
git commit -m "fix: critical payment timeout in production"
git push origin hotfix/payment-timeout
# PR/merge the hotfix from this worktree

# Back to feature work
cd ../project  # Original feature work untouched
git status  # Clean, feature work is exactly where you left it
```

## ClawPowers Enhancement

When `~/.clawpowers/` runtime is initialized:

**Worktree Lifecycle Management:**

```bash
# Register a worktree
bash runtime/persistence/store.sh set "worktree:task-auth:path" "../project-task-auth"
bash runtime/persistence/store.sh set "worktree:task-auth:branch" "feature/task-auth"
bash runtime/persistence/store.sh set "worktree:task-auth:status" "active"
bash runtime/persistence/store.sh set "worktree:task-auth:created_at" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# List all active worktrees with their status
bash runtime/persistence/store.sh list "worktree:*:status"
```

If a session is interrupted, the worktree registry shows which are active and which branches they hold — preventing orphaned worktrees.

**Conflict Prediction:**

Before creating parallel worktrees, the framework checks for file overlap:

```bash
# For each planned worktree pair, check for overlapping file changes
# High overlap = schedule sequentially; low overlap = safe to parallelize
bash runtime/persistence/store.sh set "worktree:conflict_check:task-auth_vs_task-db" "no_overlap"
```

**Cleanup Automation:**

After merge detection, automatically prompt for worktree cleanup:

```bash
bash runtime/feedback/analyze.sh --worktrees
# Output:
# Merged branches with active worktrees:
#   - feature/task-auth (merged 3 hours ago) → worktree at ../project-task-auth
# Run: git worktree remove ../project-task-auth && git branch -d feature/task-auth
```

## Anti-Patterns

| Anti-Pattern | Why It Fails | Correct Approach |
|-------------|-------------|-----------------|
| Checking out same branch in two worktrees | Git prevents this — error on checkout | Each worktree must have a unique branch |
| Never cleaning up worktrees | Disk fills up, confusion about active branches | Cleanup immediately after branch merges |
| `--force` on worktree with uncommitted work | Loses uncommitted changes permanently | Commit or stash before removing |
| Parallel worktrees editing the same file | Merge conflicts on integration | Check file overlap before creating parallel worktrees |
| Forgetting which worktree you're in | Wrong branch gets commits | `git worktree list` before committing |
| Long-lived worktrees diverging from main | Painful rebase/merge on integration | Regularly sync worktrees with `git rebase origin/main` |

## Integration with Other Skills

- Used by `subagent-driven-development` for task isolation
- Used by `dispatching-parallel-agents` for concurrent work
- Used by `finishing-a-development-branch` when cleaning up
