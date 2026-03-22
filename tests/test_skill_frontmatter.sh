#!/usr/bin/env bash
# tests/test_skill_frontmatter.sh — Validate each skill has valid YAML frontmatter
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILLS_DIR="$REPO_ROOT/skills"
RESULT_FILE="/tmp/clawpowers_test_skill_frontmatter.result"
PASS=0; FAIL=0; SKIP=0

pass() { echo "  PASS: $1"; ((PASS++)) || true; }
fail() { echo "  FAIL: $1"; ((FAIL++)) || true; }

REQUIRED_FIELDS=("name:" "description:" "version:" "requires:" "metrics:")

# Expected skill directories
EXPECTED_SKILLS=(
  "agent-payments"
  "brainstorming"
  "content-pipeline"
  "dispatching-parallel-agents"
  "executing-plans"
  "finishing-a-development-branch"
  "learn-how-to-learn"
  "market-intelligence"
  "prospecting"
  "receiving-code-review"
  "requesting-code-review"
  "security-audit"
  "subagent-driven-development"
  "systematic-debugging"
  "test-driven-development"
  "using-clawpowers"
  "using-git-worktrees"
  "verification-before-completion"
  "writing-plans"
  "writing-skills"
)

# Test: All 20 expected skill directories exist
for skill in "${EXPECTED_SKILLS[@]}"; do
  skill_dir="$SKILLS_DIR/$skill"
  if [[ -d "$skill_dir" ]]; then
    pass "skill directory exists: $skill"
  else
    fail "skill directory missing: $skill"
    continue
  fi

  skill_file="$skill_dir/SKILL.md"
  if [[ -f "$skill_file" ]]; then
    pass "SKILL.md exists: $skill"
  else
    fail "SKILL.md missing: $skill"
    continue
  fi

  # Check SKILL.md starts with YAML frontmatter (---)
  first_line=$(head -1 "$skill_file")
  if [[ "$first_line" == "---" ]]; then
    pass "frontmatter opens correctly: $skill"
  else
    fail "frontmatter missing opening ---: $skill (got: $first_line)"
    continue
  fi

  # Check frontmatter closes
  if awk 'NR>1 && /^---$/ { found=1; exit } END { exit !found }' "$skill_file"; then
    pass "frontmatter closes correctly: $skill"
  else
    fail "frontmatter not closed with ---: $skill"
    continue
  fi

  # Extract frontmatter content (between first and second ---)
  frontmatter=$(awk '/^---$/{if(++count==2) exit; next} count==1{print}' "$skill_file")

  # Check required fields
  for field in "${REQUIRED_FIELDS[@]}"; do
    if echo "$frontmatter" | grep -q "^${field}"; then
      pass "frontmatter has '$field': $skill"
    else
      fail "frontmatter missing '$field': $skill"
    fi
  done

  # Check version format (should be semantic version)
  version=$(echo "$frontmatter" | grep "^version:" | awk '{print $2}')
  if [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    pass "version is semver: $skill ($version)"
  else
    fail "version is not semver: $skill (got: '$version')"
  fi

  # Check SKILL.md is non-trivial (> 50 lines)
  line_count=$(wc -l < "$skill_file" | tr -d ' ')
  if [[ $line_count -gt 50 ]]; then
    pass "SKILL.md is substantive: $skill (${line_count} lines)"
  else
    fail "SKILL.md too short: $skill (${line_count} lines, need > 50)"
  fi

  # Check required sections exist
  REQUIRED_SECTIONS=("## When to Use" "## Core Methodology" "## Anti-Patterns")
  for section in "${REQUIRED_SECTIONS[@]}"; do
    if grep -q "^${section}" "$skill_file"; then
      pass "has section '${section}': $skill"
    else
      fail "missing section '${section}': $skill"
    fi
  done

done

# Save results
cat > "$RESULT_FILE" << EOF
pass=$PASS
fail=$FAIL
skip=$SKIP
EOF

echo "  Frontmatter tests: $PASS passed, $FAIL failed"
