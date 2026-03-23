---
name: validator
description: Multi-round automated validation pipeline for any software project. Runs 14 rounds of checks — compile gates, lint, tests, security scanning, documentation, secrets detection, link verification, spelling, cross-platform compatibility, dependency health, and PR-readiness. Auto-detects project language. Use before publish, deploy, merge, or external PR submission.
version: 1.0.0
requires:
  tools: [bash, node, npm]
  optional_tools: [trivy, gitleaks, codespell, markdownlint-cli2, eslint, cargo, go, python3]
  runtime: false
metrics:
  tracks: [rounds_passed, rounds_failed, rounds_warned, total_issues, critical_issues, test_count, test_pass_rate, type_coverage_pct, vulnerability_count]
  improves: [code_quality, security_posture, documentation_completeness, publish_readiness]
---

# Validator

## When to Use

- Before `npm publish` / `cargo publish` / any package release
- Before merging a PR to your own repo
- Before submitting a PR to an external repo (NVIDIA, Google, CNCF, etc.)
- After a major refactor or dependency update
- On any project — auto-detects language from marker files

**Skip when:**
- Trivial docs-only changes (run rounds 5, 8 only)
- Quick iteration cycles (run round 0 + 2 only: compile + test)

## Quick Start

```text
Run the Validator on ~/DevDrive/my-project
```

Target specific rounds:

```text
Run Validator round 0-2 on my-project (compile + lint + test only)
```

PR-readiness for external submission:

```text
Run Validator PR-readiness checks on my-project for NVIDIA/NeMo-Agent-Toolkit-Examples
```

## Language Auto-Detection

Detect project type from marker files. When multiple markers exist, run checks for ALL detected languages.

| Marker File(s) | Language | Compile | Lint | Test | Security |
|---|---|---|---|---|---|
| `package.json` + `tsconfig.json` | TypeScript | `tsc --noEmit` | ESLint | `npm test` | `npm audit` |
| `package.json` (no tsconfig) | JavaScript | `node --check *.js` | ESLint | `npm test` | `npm audit` |
| `Cargo.toml` | Rust | `cargo check` | Clippy + rustfmt | `cargo test` | `cargo audit` |
| `go.mod` | Go | `go build ./...` | golangci-lint | `go test ./...` | `govulncheck` |
| `pyproject.toml` / `setup.py` | Python | `py_compile` | Ruff + Bandit | pytest | Bandit |
| `Dockerfile` | Docker | `docker build --check` | Hadolint | — | Trivy |
| `foundry.toml` | Solidity | `forge build` | `forge fmt --check` | `forge test` | Slither |
| `*.sh` | Shell | `bash -n` | ShellCheck | — | — |

## The 14 Rounds

Execute in order. Round 0 is a **blocking gate** — if it fails, stop everything.

### Round 0 — Compile Gate (BLOCKING)

If this fails, ALL subsequent rounds are blocked. Fix compile errors first.

```bash
# TypeScript
npx tsc --noEmit

# JavaScript
find . -name "*.js" -not -path "*/node_modules/*" -exec node --check {} \;

# Rust
cargo check

# Python
python3 -m py_compile <each .py file>
```

**Pass criteria:** Zero compile errors.

### Round 1 — Lint

```bash
# TypeScript/JavaScript
npx eslint . --ext .ts,.js,.tsx,.jsx 2>&1

# Rust
cargo clippy -- -D warnings

# Python
ruff check . 2>&1

# Go
golangci-lint run ./...
```

**Pass criteria:** Zero errors. Warnings are advisory.

### Round 2 — Test Suite

```bash
# Node.js
npm test

# Rust
cargo test

# Python
pytest -v

# Go
go test ./...
```

**Pass criteria:** All tests pass. Report total count and pass rate.

### Round 3 — Security Audit

```bash
# Node.js
npm audit --audit-level=high

# Rust
cargo audit

# Python
pip-audit

# Container
trivy fs --severity HIGH,CRITICAL .
```

**Pass criteria:** Zero HIGH or CRITICAL vulnerabilities. LOW/MODERATE are advisory.

### Round 4 — Type Coverage

```bash
# TypeScript
npx type-coverage --at-least 90

# JavaScript (JSDoc)
# Count @param, @returns, @type annotations
grep -r "@param\|@returns\|@type" --include="*.js" -l | wc -l
```

**Pass criteria:** ≥90% for TypeScript. For JS, report JSDoc annotation count.

### Round 5 — Documentation

Check that these exist and are non-trivial:
- [ ] README.md (≥50 lines)
- [ ] Version mentioned in README or badge
- [ ] Installation instructions
- [ ] Usage examples with real code
- [ ] License declared (package.json or LICENSE file)
- [ ] CHANGELOG.md (if versioned package)

**Pass criteria:** All items checked.

### Round 6 — Changelog

- [ ] CHANGELOG.md exists
- [ ] Current version has an entry
- [ ] Entry describes what changed (not just "bug fixes")

**Pass criteria:** Current version documented.

### Round 7 — Secrets Detection

```bash
# gitleaks (git history)
gitleaks detect --source . -v 2>&1

# detect-secrets (current files)
detect-secrets scan . 2>&1
```

**Pass criteria:** Zero real secrets. Document false positives (contract addresses, example values) and recommend `.gitleaksignore` entries.

### Round 8 — Spelling

```bash
codespell --skip="node_modules,dist,.git,package-lock.json,*.min.js" .
```

**Pass criteria:** Zero typos in source code and documentation.

### Round 9 — Link Verification

Check all URLs in README.md and documentation:

```bash
# Extract URLs and test each
grep -oP 'https?://[^\s\)\"]+' README.md | while read url; do
  code=$(curl -o /dev/null -s -w "%{http_code}" "$url")
  if [ "$code" != "200" ] && [ "$code" != "301" ]; then
    echo "BROKEN: $url → $code"
  fi
done
```

**Pass criteria:** All links return 200 or 301. Flag example.com/placeholder URLs as advisory.

### Round 10 — PR-Readiness (for external submissions)

- [ ] Conventional commit messages (`feat:`, `fix:`, `docs:`, etc.)
- [ ] DCO sign-off on commits (`git commit -s`)
- [ ] SPDX license headers in source files
- [ ] No merge commits (rebase-clean history)
- [ ] Branch is up-to-date with target

**Pass criteria:** All items for external PR targets. DCO/SPDX are advisory for own repos.

### Round 11 — Cross-Platform Compatibility

- [ ] No hardcoded absolute paths
- [ ] No macOS-only or Linux-only commands without guards
- [ ] No case-sensitive filename conflicts
- [ ] `engines` field in package.json (Node.js)
- [ ] `.env.example` exists if `.env` is used

**Pass criteria:** Works on macOS, Linux, and CI runners.

### Round 12 — Dependency Health

```bash
# All deps pinned (no * or latest)
grep -E '"[\*]"|"latest"' package.json

# Lock file committed
ls package-lock.json || ls yarn.lock || ls pnpm-lock.yaml

# Clean install
npm ci --dry-run
```

**Pass criteria:** Deps pinned, lock file committed, clean install works.

### Round 13 — Summary & Verdict

Compile results from all rounds:

```
## Validator Report — [Project] v[Version]

| Round | Check | Result |
|-------|-------|--------|
| 0 | Compile | ✅/❌ |
| 1 | Lint | ✅/⚠️/❌ |
| ... | ... | ... |

**Verdict:** PASS ✅ / WARN ⚠️ / FAIL ❌
**Score:** X/14 rounds clean

Blocking issues: [list or "none"]
Advisory warnings: [list or "none"]
```

## Verdicts

| Verdict | Meaning |
|---------|---------|
| **PASS ✅** | All rounds clean. Safe to publish/merge. |
| **WARN ⚠️** | No blockers but advisory issues exist. Safe to publish, address warnings when convenient. |
| **FAIL ❌** | Blocking issues in Round 0-3. Fix before proceeding. |

## Output

Save the full report to `ops/reports/validator-YYYY-MM-DD-HH-<project>.md` in the workspace.

## Tips

- Run rounds 0-2 frequently during development (fast feedback)
- Run full 14 rounds before any publish or external PR
- Round 7 (secrets) is critical before pushing to public repos
- Round 10 (PR-readiness) only matters for external repo submissions
- Use `--skip-round N` to skip specific rounds when re-running after fixes
