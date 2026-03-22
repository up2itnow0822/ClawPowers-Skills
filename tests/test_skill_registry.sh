#!/usr/bin/env bash
# tests/test_skill_registry.sh — Verify all skills are referenced in using-clawpowers
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REGISTRY="$REPO_ROOT/skills/using-clawpowers/SKILL.md"
SKILLS_DIR="$REPO_ROOT/skills"
RESULT_FILE="/tmp/clawpowers_test_skill_registry.result"
PASS=0; FAIL=0; SKIP=0

pass() { echo "  PASS: $1"; ((PASS++)) || true; }
fail() { echo "  FAIL: $1"; ((FAIL++)) || true; }

# Test: Registry file exists
if [[ ! -f "$REGISTRY" ]]; then
  fail "using-clawpowers/SKILL.md not found (registry file)"
  cat > "$RESULT_FILE" << EOF
pass=$PASS
fail=$FAIL
skip=$SKIP
EOF
  exit 0
fi

pass "using-clawpowers/SKILL.md exists"

# Test: All skill directories are referenced in the registry
for skill_dir in "$SKILLS_DIR"/*/; do
  skill_name=$(basename "$skill_dir")

  # Skip using-clawpowers itself
  if [[ "$skill_name" == "using-clawpowers" ]]; then
    pass "using-clawpowers skipped (it IS the registry)"
    continue
  fi

  # Check if skill name appears in the registry (backtick format)
  if grep -q "\`${skill_name}\`" "$REGISTRY"; then
    pass "skill referenced in registry: $skill_name"
  else
    fail "skill NOT referenced in registry: $skill_name"
  fi
done

# Test: Registry has a trigger map (the pattern → skill table)
if grep -q "When you encounter" "$REGISTRY" || grep -q "Pattern.*Skill" "$REGISTRY"; then
  pass "registry contains trigger map section"
else
  fail "registry missing trigger map (pattern → skill table)"
fi

# Test: Registry has Quick Reference section
if grep -q "Quick Reference" "$REGISTRY"; then
  pass "registry contains Quick Reference section"
else
  fail "registry missing Quick Reference section"
fi

# Test: Registry references all 20 skills (count by backtick skill names)
skill_count=$(grep -o '\`[a-z][a-z-]*\`' "$REGISTRY" | sort -u | wc -l | tr -d ' ')
if [[ $skill_count -ge 19 ]]; then
  pass "registry references $skill_count distinct skills (≥19 expected)"
else
  fail "registry references only $skill_count skills (expected ≥19)"
fi

# Test: Registry explains runtime detection
if grep -q "runtime" "$REGISTRY"; then
  pass "registry explains runtime layer"
else
  fail "registry missing runtime layer explanation"
fi

# Test: Registry has 'How Skills Work' or equivalent instruction section
if grep -q "How Skills Work\|Pattern.*Skill\|trigger" "$REGISTRY"; then
  pass "registry explains skill activation mechanism"
else
  fail "registry missing skill activation explanation"
fi

# Test: Package.json exists and has correct name
PACKAGE_JSON="$REPO_ROOT/package.json"
if [[ -f "$PACKAGE_JSON" ]]; then
  pass "package.json exists"

  if grep -q '"name": "clawpowers"' "$PACKAGE_JSON"; then
    pass "package.json has correct name: clawpowers"
  else
    fail "package.json has wrong name (expected 'clawpowers')"
  fi

  if grep -q '"version"' "$PACKAGE_JSON"; then
    pass "package.json has version field"
  else
    fail "package.json missing version field"
  fi

  if grep -q '"license"' "$PACKAGE_JSON"; then
    pass "package.json has license field"
  else
    fail "package.json missing license field"
  fi

  if grep -q '"bin"' "$PACKAGE_JSON"; then
    pass "package.json has bin entry (npx support)"
  else
    fail "package.json missing bin entry"
  fi
else
  fail "package.json not found"
fi

# Test: Plugin manifests exist
MANIFESTS=(
  ".claude-plugin/manifest.json"
  ".cursor-plugin/manifest.json"
  ".codex/INSTALL.md"
  ".opencode/INSTALL.md"
  "gemini-extension.json"
)

for manifest in "${MANIFESTS[@]}"; do
  if [[ -f "$REPO_ROOT/$manifest" ]]; then
    pass "plugin manifest exists: $manifest"
  else
    fail "plugin manifest missing: $manifest"
  fi
done

# Save results
cat > "$RESULT_FILE" << EOF
pass=$PASS
fail=$FAIL
skip=$SKIP
EOF

echo "  Registry tests: $PASS passed, $FAIL failed"
