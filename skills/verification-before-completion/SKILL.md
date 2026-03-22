---
name: verification-before-completion
description: Run quality gates before any merge, deployment, or handoff. Activate when you're about to declare work done.
version: 1.0.0
requires:
  tools: [git, bash]
  runtime: false
metrics:
  tracks: [gate_pass_rate, gates_failed, defect_escape_rate, verification_duration]
  improves: [gate_selection, gate_ordering, parallel_gate_execution]
---

# Verification Before Completion

## When to Use

Apply this skill when:

- You're about to open a PR or request a merge
- You're handing work to another agent or team member
- You're about to tag a release
- You've completed all tasks in a plan
- Someone says "are we done?"

**The rule:** Nothing moves forward until verification passes. This is a hard gate, not a suggestion.

**Skip when:**
- This is a work-in-progress (WIP) commit — label it as such
- You're committing to a draft branch specifically for CI to run (CI is the verification)
- The change is a single-line config fix with zero behavior impact

## Core Methodology

### The Verification Checklist

Run these gates in order. A failure at any gate stops the process — fix and restart verification from that gate.

#### Gate 1: Completeness

- [ ] All tasks in the plan are marked complete
- [ ] All done criteria in the plan are verified
- [ ] No TODOs, stubs, or `# FIXME` in production code paths
- [ ] All specified features are implemented

```bash
# Check for stubs
grep -r "TODO\|FIXME\|STUB\|NOTIMPLEMENTED\|raise NotImplementedError\|pass  # " src/ --include="*.py"
grep -r "TODO\|FIXME\|STUB" src/ --include="*.ts" --include="*.js"
```

#### Gate 2: Tests Pass

- [ ] Full test suite passes with zero failures
- [ ] Zero flaky tests in this run
- [ ] Test coverage meets threshold (≥80% line coverage for new code)

```bash
# Python
pytest --tb=short -q
pytest --cov=src --cov-report=term-missing --cov-fail-under=80

# JavaScript/TypeScript
npm test -- --passWithNoTests
npx jest --coverage --coverageThreshold='{"global":{"lines":80}}'

# Go
go test ./... -count=1 -race
go test ./... -cover -covermode=atomic
```

#### Gate 3: Static Analysis

- [ ] No linting errors
- [ ] No type errors (if typed language)
- [ ] No security scan findings (high/critical)

```bash
# Python
ruff check src/
mypy src/ --strict
bandit -r src/ -ll  # medium+ severity only

# JavaScript/TypeScript
npx eslint src/
npx tsc --noEmit

# Go
go vet ./...
staticcheck ./...
```

#### Gate 4: Build Succeeds

- [ ] Project builds without errors or warnings
- [ ] Dependencies are pinned (no floating versions in production)
- [ ] Build artifacts are reproducible

```bash
# Python
pip install -e . --quiet
python -c "import your_package"  # smoke test import

# Node.js
npm ci  # use ci not install (honors package-lock.json)
npm run build

# Go
go build ./...
```

#### Gate 5: Integration Tests

- [ ] Integration tests pass (database, external services, etc.)
- [ ] API contract tests pass (if applicable)
- [ ] No regression in end-to-end test suite

```bash
# Integration tests (requires real DB, may need Docker)
pytest tests/integration/ -v
# Or
docker-compose up -d && pytest tests/integration/ && docker-compose down
```

#### Gate 6: Security Scan

- [ ] No hardcoded secrets in new code
- [ ] Dependencies have no critical CVEs
- [ ] No SQL injection / XSS vectors in new endpoints

```bash
# Secret scanning
gitleaks detect --no-git -v

# Dependency audit
npm audit --audit-level=high
pip-audit --desc on
trivy fs . --severity HIGH,CRITICAL --exit-code 1

# SAST for known vulnerability patterns
bandit -r src/ -l  # Python
semgrep --config=auto src/  # multi-language
```

#### Gate 7: Documentation

- [ ] Public API changes have updated docstrings/JSDoc
- [ ] README reflects any changed setup steps
- [ ] CHANGELOG updated with this change
- [ ] Any new environment variables are documented

```bash
# Check for undocumented public functions (Python)
pydocstyle src/ --add-ignore=D100,D104

# Verify CHANGELOG was updated
git diff HEAD~1 CHANGELOG.md | grep "^+" | wc -l  # should be > 0
```

### Verification Report

After running all gates, produce a report:

```markdown
## Verification Report — [Feature Name]

**Date:** [timestamp]
**Branch:** [branch name]
**Commit:** [short hash]

### Gate Results
| Gate | Status | Notes |
|------|--------|-------|
| 1. Completeness | ✅ PASS | All 8 plan tasks verified |
| 2. Tests | ✅ PASS | 127 tests, 0 failures, 84% coverage |
| 3. Static Analysis | ✅ PASS | 0 ruff errors, 0 mypy errors |
| 4. Build | ✅ PASS | Clean build, deps pinned |
| 5. Integration | ✅ PASS | 12 integration tests passing |
| 6. Security | ✅ PASS | 0 secrets, 0 critical CVEs |
| 7. Documentation | ✅ PASS | Docstrings updated, CHANGELOG updated |

**Verdict: READY FOR REVIEW**
```

If any gate fails:

```markdown
| 2. Tests | ❌ FAIL | test_payment_retry: AssertionError: expected 3 retries, got 1 |

**Verdict: NOT READY — address test failure before proceeding**
```

### Failure Protocol

When a gate fails:

1. **Stop** — don't open the PR
2. **Fix the specific failure** — don't work around it
3. **Re-run the full gate sequence from Gate 1** — a fix can break something earlier
4. **If the same gate fails twice**, escalate to `systematic-debugging`

**Exception:** If Gates 2-6 pass but Gate 7 (documentation) is being updated in a separate follow-up PR with a tracking issue, this is the only acceptable skip with documented justification.

## ClawPowers Enhancement

When `~/.clawpowers/` runtime is initialized:

**Automated Verification Suite Execution:**

Instead of running gates manually, execute the full suite:

```bash
# Run all verification gates automatically
bash runtime/persistence/store.sh set "verification:feature-name:started_at" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Gates execute in parallel where safe (Gates 3, 4, 6 can parallelize)
# Results saved to state store for resumability

bash runtime/persistence/store.sh set "verification:feature-name:gate2:status" "pass"
bash runtime/persistence/store.sh set "verification:feature-name:gate2:details" "127 tests, 0 failures"
```

**Historical Pass Rates:**

After 20+ verifications, `runtime/feedback/analyze.sh` reports:
- Which gate fails most often (target for process improvement)
- Average verification duration
- Defect escape rate (bugs found in review or production vs. caught by verification)
- Gates that catch zero issues over N runs (candidates for removal or replacement)

**Gate Configuration:**

Store project-specific gate thresholds:
```bash
bash runtime/persistence/store.sh set "config:verification:coverage_threshold" "85"
bash runtime/persistence/store.sh set "config:verification:security_level" "medium"
```

## Anti-Patterns

| Anti-Pattern | Why It Fails | Correct Approach |
|-------------|-------------|-----------------|
| "Tests probably pass" without running | False confidence, bugs escape | Run every time — no exceptions |
| Disabling tests to pass gate | Silences real bugs | Fix the code, never the test |
| Running only unit tests | Integration issues escape | All gates required |
| Skipping security scan "because it's internal" | Internal breaches exist | Security scan always |
| Fixing gate failures without re-running from Gate 1 | Fix introduces new failures | Full restart after any fix |
| Annotating known issues as "acceptable" | Debt accumulates, gets shipped | Fix it or don't ship |

## Integration with Other Skills

- Preceded by `executing-plans` (all plan tasks must be complete)
- Use `systematic-debugging` if tests fail
- Followed by `finishing-a-development-branch` or `requesting-code-review`
- Use `security-audit` for extended security coverage beyond Gate 6
