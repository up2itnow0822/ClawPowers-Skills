#!/usr/bin/env bash
# test_session_hook.sh — Validate session hook output for all platforms
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HOOK="$REPO_ROOT/hooks/session-start"

passed=0
failed=0

pass() { echo "  PASS: $1"; ((passed++)); }
fail() { echo "  FAIL: $1"; ((failed++)); }

echo "── Test 1: Session Hook Platform Detection ──"

# Basic file checks
if [[ -f "$HOOK" ]]; then pass "hook file exists at hooks/session-start"; else fail "hook file missing"; fi
if [[ -f "$REPO_ROOT/skills/using-clawpowers/SKILL.md" ]]; then pass "using-clawpowers SKILL.md exists"; else fail "using-clawpowers SKILL.md missing"; fi

# Test each platform by setting the env var
test_platform() {
  local platform_env="$1" platform_name="$2"
  local output
  
  # Run hook with platform env set
  output=$(env -i HOME="$HOME" PATH="$PATH" "$platform_env"="$REPO_ROOT" bash "$HOOK" 2>/dev/null) || {
    fail "platform=$platform_name: hook exited with error"
    return
  }
  
  # Check it's valid JSON (has opening and closing braces)
  if echo "$output" | head -1 | grep -q '{' && echo "$output" | tail -1 | grep -q '}'; then
    pass "platform=$platform_name: outputs valid JSON"
  else
    fail "platform=$platform_name: invalid JSON output"
    return
  fi
  
  # Check required fields exist in output
  echo "$output" | grep -q '"platform"' && pass "platform=$platform_name: has platform field" || fail "platform=$platform_name: missing platform field"
  echo "$output" | grep -q '"skill"' && pass "platform=$platform_name: has skill content" || fail "platform=$platform_name: missing skill content"
  echo "$output" | grep -q 'using-clawpowers' && pass "platform=$platform_name: references using-clawpowers" || fail "platform=$platform_name: missing skill name"
}

test_platform "CLAUDE_PLUGIN_ROOT" "claude-code"
test_platform "CURSOR_PLUGIN_ROOT" "cursor"

# Codex detection (uses CODEX env var)
output=$(env -i HOME="$HOME" PATH="$PATH" CODEX="1" bash "$HOOK" 2>/dev/null) || true
if echo "$output" | grep -q '"platform"'; then
  pass "platform=codex: outputs JSON with platform field"
  echo "$output" | grep -q '"skill"' && pass "platform=codex: has skill content" || fail "platform=codex: missing skill"
else
  fail "platform=codex: no platform field"
fi

# Generic (no platform env)
output=$(env -i HOME="$HOME" PATH="$PATH" bash "$HOOK" 2>/dev/null) || true
if echo "$output" | grep -q '{'; then
  pass "platform=generic: outputs JSON"
  echo "$output" | grep -q 'clawpowers' && pass "platform=generic: contains clawpowers content" || fail "platform=generic: missing content"
else
  fail "platform=generic: no JSON output"
fi

# Check hook includes version
output=$(env -i HOME="$HOME" PATH="$PATH" CLAUDE_PLUGIN_ROOT="$REPO_ROOT" bash "$HOOK" 2>/dev/null) || true
echo "$output" | grep -q '"version"' && pass "hook output includes version field" || fail "hook output missing version field"
echo "$output" | grep -q '"type"' && pass "hook output includes type field" || fail "hook output missing type field"

echo "  Session hook tests: $passed passed, $failed failed"
echo "SESSION_HOOK_PASSED=$passed"
echo "SESSION_HOOK_FAILED=$failed"
