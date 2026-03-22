#!/usr/bin/env bash
# tests/run_all.sh — ClawPowers test suite runner
#
# Validates:
#   1. Session hook outputs correct JSON for each platform
#   2. Each skill has valid YAML frontmatter
#   3. All skills are referenced in using-clawpowers
#   4. Runtime scripts create correct directory structure
#   5. Metrics collector produces valid JSON lines
#
# Usage:
#   bash tests/run_all.sh
#   bash tests/run_all.sh --verbose
#
# Exit code: 0 if all tests pass, 1 if any fail
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERBOSE="${1:-}"

# Cleanup any stale result files
rm -f /tmp/clawpowers_test_*.result

# Colors (only if terminal supports it)
if [[ -t 1 ]]; then
  GREEN='\033[0;32m'
  RED='\033[0;31m'
  RESET='\033[0m'
else
  GREEN='' RED='' RESET=''
fi

section() {
  echo ""
  echo "── $1 ──"
}

# Run each test suite
section "Test 1: Session Hook Platform Detection"
bash "$REPO_ROOT/tests/test_session_hook.sh" "${VERBOSE:-}"

section "Test 2: Skill YAML Frontmatter Validation"
bash "$REPO_ROOT/tests/test_skill_frontmatter.sh" "${VERBOSE:-}"

section "Test 3: Skill Registry Completeness"
bash "$REPO_ROOT/tests/test_skill_registry.sh" "${VERBOSE:-}"

section "Test 4: Runtime Init and Directory Structure"
bash "$REPO_ROOT/tests/test_runtime_init.sh" "${VERBOSE:-}"

section "Test 5: Metrics Collector JSON Output"
bash "$REPO_ROOT/tests/test_metrics_collector.sh" "${VERBOSE:-}"

# ─── Aggregate Results ─────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════"
echo "ClawPowers Test Results"
echo "═══════════════════════════════"

total_pass=0
total_fail=0
total_skip=0

RESULT_FILES=(
  /tmp/clawpowers_test_session_hook.result
  /tmp/clawpowers_test_skill_frontmatter.result
  /tmp/clawpowers_test_skill_registry.result
  /tmp/clawpowers_test_runtime_init.result
  /tmp/clawpowers_test_metrics_collector.result
)

for result_file in "${RESULT_FILES[@]}"; do
  if [[ -f "$result_file" ]]; then
    while IFS='=' read -r key val; do
      case "$key" in
        pass) total_pass=$((total_pass + val)) ;;
        fail) total_fail=$((total_fail + val)) ;;
        skip) total_skip=$((total_skip + val)) ;;
      esac
    done < "$result_file"
    rm -f "$result_file"
  fi
done

echo "  Passed:  $total_pass"
echo "  Failed:  $total_fail"
echo "  Skipped: $total_skip"
echo "  Total:   $((total_pass + total_fail + total_skip))"
echo ""

if [[ $total_fail -eq 0 ]]; then
  echo -e "${GREEN}All tests passed.${RESET}"
  exit 0
else
  echo -e "${RED}${total_fail} test(s) failed.${RESET}"
  exit 1
fi
