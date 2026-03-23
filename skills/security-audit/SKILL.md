---
name: security-audit
description: Run automated security scanning with Trivy, gitleaks, dependency audits, and SAST tools. Produces an actionable vulnerability report. Activate before any production deployment or release.
version: 1.0.0
requires:
  tools: [bash, trivy, gitleaks, npm, python3]
  runtime: false
metrics:
  tracks: [vulnerabilities_found, critical_count, high_count, false_positive_rate, fix_rate]
  improves: [scan_coverage, reporting_clarity, fix_prioritization]
---

# Security Audit

## When to Use

Apply this skill when:

- Preparing for a production release
- A new dependency has been added
- Infrastructure code (Dockerfiles, K8s manifests) has changed
- A security incident occurred and you need to understand scope
- Before merging a PR with authentication/authorization changes
- Onboarding a new codebase (baseline security posture assessment)

**Skip when:**
- Running on every trivial PR (overhead too high — use pre-commit hooks for that)
- Dependencies haven't changed and no new code paths touch auth/IO/crypto

## Tools Reference

| Tool | What It Scans | Install |
|------|-------------|---------|
| `trivy` | Containers, filesystems, IaC, SBOMs for CVEs | `brew install trivy` / `apt install trivy` |
| `gitleaks` | Secret detection in git history | `brew install gitleaks` / `go install` |
| `npm audit` | Node.js dependency CVEs | Bundled with npm |
| `pip-audit` | Python dependency CVEs | `pip install pip-audit` |
| `bandit` | Python SAST (hardcoded creds, injection) | `pip install bandit` |
| `semgrep` | Multi-language SAST patterns | `pip install semgrep` |
| `cargo audit` | Rust dependency CVEs | `cargo install cargo-audit` |

## Core Methodology

### Step 1: Secret Scanning (Run First)

Secrets in code are the highest-priority finding. Scan before any other step:

```bash
# Scan the entire git history (not just current commit)
gitleaks detect --source . --verbose

# Scan current filesystem (for CI/CD pipelines where git history isn't available)
gitleaks detect --no-git --source . --verbose

# Scan a specific branch range
gitleaks detect --log-opts="main..HEAD"
```

**What gitleaks finds:**
- API keys (AWS, Google Cloud, Stripe, GitHub, etc.)
- Database connection strings with credentials
- Private keys (RSA, ECDSA, PGP)
- OAuth tokens and session secrets
- Generic high-entropy strings that look like credentials

**Critical:** Any detected secret must be rotated immediately — not just removed from code. The secret was exposed from the moment it was committed, regardless of whether the commit still exists.

**Secret rotation protocol:**
1. Identify the secret type (API key, DB password, etc.)
2. Rotate/regenerate the secret at the source (AWS console, GitHub settings, etc.)
3. Update all deployments with the new secret
4. Remove the old secret from git history (`git filter-branch` or BFG Repo Cleaner)
5. Force-push the cleaned history (with team coordination)
6. Verify old secret no longer works

### Step 2: Dependency CVE Scanning

```bash
# Node.js
npm audit --audit-level=moderate
# For a non-zero exit on vulnerabilities:
npm audit --audit-level=high 2>&1 | tee npm-audit-results.txt

# Python
pip-audit --desc on --output json > pip-audit-results.json
pip-audit --fix --dry-run  # See what would be auto-fixed

# Containers (Dockerfile + base image)
trivy image your-image:tag --severity HIGH,CRITICAL --exit-code 1
trivy image your-image:tag --format json -o trivy-image-results.json

# Filesystem (all languages + config files)
trivy fs . --severity HIGH,CRITICAL
trivy fs . --format json -o trivy-fs-results.json

# Infrastructure as Code (Terraform, K8s, Helm, CloudFormation)
trivy config ./infrastructure/ --severity HIGH,CRITICAL
trivy config k8s/ --format table

# Rust
cargo audit

# Go
govulncheck ./...
```

### Step 3: SAST (Static Application Security Testing)

Find security-relevant code patterns:

```bash
# Python — bandit
bandit -r src/ -ll -f json -o bandit-results.json
bandit -r src/ -ll --skip B101  # Skip assert_used if it's test code

# Multi-language — semgrep
semgrep --config=auto src/ --json -o semgrep-results.json
semgrep --config=p/python src/ --json  # Language-specific rules
semgrep --config=p/javascript src/ --json
semgrep --config=p/owasp-top-ten src/ --json  # OWASP rules

# Node.js — eslint-plugin-security
npx eslint --plugin security --rule 'security/detect-non-literal-regexp: warn' src/
```

**High-priority bandit checks:**
- `B105-B107`: Hardcoded password/credentials
- `B301-B302`: Pickle deserialization (arbitrary code execution)
- `B501-B511`: TLS/SSL configuration weaknesses
- `B601-B614`: Shell injection, subprocess calls
- `B701-B703`: Jinja2/Mako template injection

**High-priority semgrep rules:**
- SQL injection patterns
- Path traversal
- XSS (reflected, stored)
- SSRF (server-side request forgery)
- Authentication bypass patterns
- Insecure deserialization

### Step 4: Container Security

If the project uses Docker:

```bash
# Scan Dockerfile for misconfigurations
trivy config Dockerfile

# Common Dockerfile issues trivy finds:
# - Running as root (ADD USER directive missing)
# - COPY . . (copies .env, .git, sensitive files)
# - Latest tag (non-deterministic base image)
# - Exposed ports beyond what's necessary
# - Unverified downloads (curl | bash patterns)
# - Secrets passed as ENV vars or ARG

# Scan built image
docker build -t myapp:audit .
trivy image myapp:audit --severity HIGH,CRITICAL
```

**Critical Dockerfile security checks:**
```dockerfile
# BAD
FROM ubuntu:latest
RUN curl -fsSL https://example.com/install.sh | bash
ENV DB_PASSWORD=secretpassword123
COPY . .
CMD ["npm", "start"]

# GOOD
FROM node:20-alpine@sha256:PINNED_HASH
USER node
COPY --chown=node:node package*.json ./
RUN npm ci --only=production
COPY --chown=node:node src/ ./src/
CMD ["node", "src/index.js"]
```

### Step 5: Generate Actionable Report

```markdown
# Security Audit Report

**Date:** [timestamp]
**Scope:** [repository name, branch, version]
**Tools:** gitleaks v8, trivy v0.48, bandit v1.7, semgrep v1.50

---

## Executive Summary

| Severity | Count | Status |
|----------|-------|--------|
| Critical | 0 | ✅ None found |
| High | 3 | ⚠️ Action required |
| Medium | 7 | ℹ️ Review recommended |
| Low | 12 | — Informational |
| Secrets | 0 | ✅ None found |

---

## Critical Findings (Fix Before Deploy)

[None]

---

## High Findings (Fix This Sprint)

### H1: CVE-2024-XXXXX in lodash@4.17.20
- **Tool:** npm audit
- **Severity:** High (CVSS 7.5)
- **Description:** Prototype pollution vulnerability
- **Affected:** `node_modules/lodash`
- **Fix:** `npm install lodash@4.17.21`
- **Effort:** 15 min

### H2: Running as root in production container
- **Tool:** trivy config
- **Severity:** High
- **Description:** Dockerfile has no USER directive — container runs as root
- **Fix:** Add `USER node` before CMD
- **Effort:** 5 min

### H3: Hardcoded development credential
- **Tool:** bandit B105
- **Severity:** High
- **File:** `src/config/defaults.py:47`
- **Description:** Default password `"dev_password_123"` in production config path
- **Fix:** Remove default; require explicit environment variable
- **Effort:** 20 min

---

## Medium Findings (Fix This Month)

[...]

---

## Remediation Priority

1. H3 (hardcoded credential) — rotate first, fix second
2. H1 (lodash CVE) — `npm install lodash@4.17.21`
3. H2 (root container) — add USER directive

**Estimated total remediation time:** 40 min
```

### Step 6: Fix and Verify

For each finding in priority order:

1. Fix the issue (specific code change or dependency update)
2. Re-run the specific scan that found it
3. Verify the finding is gone
4. Add to regression prevention (pre-commit hook, CI gate, or code review checklist)

```bash
# After fixing all High findings, re-run full suite to verify
gitleaks detect --no-git --source .
npm audit --audit-level=high
trivy fs . --severity HIGH,CRITICAL
bandit -r src/ -ll
```

### Premium Scanner Escalation

The default audit pipeline uses **free local scanners**: `npm audit`, `gitleaks`, `trivy`, `bandit`, and `semgrep`. These cover the vast majority of findings and require no payment.

When free scanners surface critical or high-severity findings, premium scanners can provide deeper analysis: broader CVE databases, behavioral analysis, license compliance, supply-chain attack detection, and exploit chain mapping.

**Payment gate logic for scanner escalation:**

| Config state | Behavior |
|-------------|---------|
| `payments.enabled = false` | Log the premium scanner option. Skip it. Proceed with free scan results only. |
| `payments.mode = "dry_run"` | Log what would happen: `[dry-run: would pay $0.05 for Snyk deep scan]`. No charge. |
| `payments.mode = "live"` | Evaluate cost vs. severity. If cost fits policy limits and severity is Critical/High, pay and run the premium scan. |

**Example escalation scenarios:**

```
Trivy found 2 critical vulns in base image.
Premium scanner (Snyk container) available for $0.05.
[dry-run: would pay — severity=critical, cost=$0.05 < per_tx_limit=$0.10]
```

```
gitleaks found 0 secrets in current HEAD.
Premium deep-history scan available for $0.20.
[skipped — payments.enabled=false]
```

**When to escalate:**
- `CRITICAL` findings from free scanners → always consider premium for exploit chain analysis
- `HIGH` findings with active CVEs → premium scanner may have fresher signature database
- Pre-production release gates → deep scan is worth the cost
- Compliance requirements (SOC 2, PCI) → premium scanners generate compliance-ready reports

**Check payment config before escalating:**

```bash
cat ~/.clawpowers/config.json | grep -A8 '"payments"'

# After audit session, review any payment decisions made
npx clawpowers payments log
```

**Escalation is always optional.** The free scanner suite is production-grade. Premium escalation improves coverage at the margin — it never replaces the free baseline.

## ClawPowers Enhancement

When `~/.clawpowers/` runtime is initialized:

**Historical Vulnerability Tracking:**

```bash
bash runtime/persistence/store.sh set "audit:$(date +%Y%m%d):critical" "0"
bash runtime/persistence/store.sh set "audit:$(date +%Y%m%d):high" "3"
bash runtime/persistence/store.sh set "audit:$(date +%Y%m%d):secrets" "0"
bash runtime/persistence/store.sh set "audit:$(date +%Y%m%d):tools" "gitleaks,trivy,bandit,semgrep"
```

**Trend Analysis:**

`runtime/feedback/analyze.sh` tracks:
- Vulnerability count over time (is your security posture improving?)
- Most common finding types (what to add to code review checklists)
- Fix rate and time (how quickly are findings remediated)
- Repeat findings (findings that recur indicate a systemic issue)

**Automated Report Generation:**

```bash
bash runtime/metrics/collector.sh record \
  --skill security-audit \
  --outcome success \
  --notes "audit: 0 critical, 3 high, 7 medium — lodash CVE, root container, hardcoded default"
```

## Anti-Patterns

| Anti-Pattern | Why It Fails | Correct Approach |
|-------------|-------------|-----------------|
| Scanning only current HEAD | Misses secrets in history | `gitleaks detect --source .` scans full history |
| Dismissing medium findings as "not urgent" | Medium findings compound into exploitable chains | Review all medium findings; schedule fixes |
| Not rotating leaked secrets | Rotated-but-historical secrets are still active | Rotate at the source, not just in code |
| Suppressing all bandit warnings | Masks real issues | Suppress only proven false positives, with comment |
| No regression prevention | Same vulnerability reappears | Add findings to pre-commit hooks or CI gates |
| Scanning without context | False positives waste time | Run tools in repo root with proper config files |
| Fixing without re-scanning | Fix may be incomplete or introduce new issue | Re-run full scan after every remediation |
