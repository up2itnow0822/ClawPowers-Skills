#!/usr/bin/env bash
# tests/test_runtime_init.sh — Validate runtime init creates correct directory structure
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INIT_SCRIPT="$REPO_ROOT/runtime/init.sh"
RESULT_FILE="/tmp/clawpowers_test_runtime_init.result"
PASS=0; FAIL=0; SKIP=0

# Use a temporary directory for testing (don't touch real ~/.clawpowers)
TEST_DIR=$(mktemp -d)
cleanup() { rm -rf "$TEST_DIR"; }
trap cleanup EXIT

pass() { echo "  PASS: $1"; ((PASS++)) || true; }
fail() { echo "  FAIL: $1"; ((FAIL++)) || true; }

# Test: Init script exists
if [[ -f "$INIT_SCRIPT" ]]; then
  pass "runtime/init.sh exists"
else
  fail "runtime/init.sh missing"
  cat > "$RESULT_FILE" << EOF
pass=$PASS
fail=$FAIL
skip=$SKIP
EOF
  exit 0
fi

# Test: Init script runs without error (using test dir)
if CLAWPOWERS_DIR="$TEST_DIR" bash "$INIT_SCRIPT" >/dev/null 2>&1; then
  pass "runtime/init.sh runs without error"
else
  fail "runtime/init.sh exited with error"
fi

# Test: All required directories created
EXPECTED_DIRS=(
  ""                # Root ~/.clawpowers/
  "/state"
  "/metrics"
  "/checkpoints"
  "/feedback"
  "/memory"
  "/logs"
)

for dir_suffix in "${EXPECTED_DIRS[@]}"; do
  dir_path="${TEST_DIR}${dir_suffix}"
  if [[ -d "$dir_path" ]]; then
    pass "directory created: $(basename "$dir_path" || echo 'root')"
  else
    fail "directory not created: $dir_path"
  fi
done

# Test: Version file created
if [[ -f "$TEST_DIR/.version" ]]; then
  pass ".version file created"

  if grep -q "^version=" "$TEST_DIR/.version"; then
    pass ".version contains version field"
  else
    fail ".version missing version= field"
  fi

  if grep -q "^initialized=" "$TEST_DIR/.version"; then
    pass ".version contains initialized timestamp"
  else
    fail ".version missing initialized= field"
  fi
else
  fail ".version file not created"
fi

# Test: README created
if [[ -f "$TEST_DIR/README" ]]; then
  pass "README created in runtime dir"
else
  fail "README not created in runtime dir"
fi

# Test: Init is idempotent (run twice, no error, same state)
if CLAWPOWERS_DIR="$TEST_DIR" bash "$INIT_SCRIPT" >/dev/null 2>&1; then
  pass "runtime/init.sh is idempotent (second run succeeds)"
else
  fail "runtime/init.sh failed on second run (not idempotent)"
fi

# Verify nothing was duplicated
dir_count=$(find "$TEST_DIR" -maxdepth 1 -type d | wc -l | tr -d ' ')
# Should be: root + 6 subdirs = 7 directories
if [[ $dir_count -eq 7 ]]; then
  pass "idempotent: correct number of directories after 2 runs ($dir_count)"
else
  fail "idempotent: unexpected directory count after 2 runs (got $dir_count, expected 7)"
fi

# Test: store.sh exists
STORE_SCRIPT="$REPO_ROOT/runtime/persistence/store.sh"
if [[ -f "$STORE_SCRIPT" ]]; then
  pass "runtime/persistence/store.sh exists"
else
  fail "runtime/persistence/store.sh missing"
fi

# Test: store.sh basic operations
if [[ -f "$STORE_SCRIPT" ]]; then
  # Set
  if CLAWPOWERS_DIR="$TEST_DIR" bash "$STORE_SCRIPT" set "test:key1" "test-value-123" >/dev/null 2>&1; then
    pass "store.sh set operation"
  else
    fail "store.sh set operation failed"
  fi

  # Get
  result=$(CLAWPOWERS_DIR="$TEST_DIR" bash "$STORE_SCRIPT" get "test:key1" 2>/dev/null || echo "ERROR")
  if [[ "$result" == "test-value-123" ]]; then
    pass "store.sh get operation returns correct value"
  else
    fail "store.sh get returned: '$result' (expected: 'test-value-123')"
  fi

  # Default value
  default_result=$(CLAWPOWERS_DIR="$TEST_DIR" bash "$STORE_SCRIPT" get "test:nonexistent" "my-default" 2>/dev/null || echo "ERROR")
  if [[ "$default_result" == "my-default" ]]; then
    pass "store.sh get returns default for missing key"
  else
    fail "store.sh default value: got '$default_result' (expected 'my-default')"
  fi

  # Exists
  if CLAWPOWERS_DIR="$TEST_DIR" bash "$STORE_SCRIPT" exists "test:key1" 2>/dev/null; then
    pass "store.sh exists returns true for set key"
  else
    fail "store.sh exists returned false for set key"
  fi

  # Exists (missing key)
  if ! CLAWPOWERS_DIR="$TEST_DIR" bash "$STORE_SCRIPT" exists "test:no-such-key" 2>/dev/null; then
    pass "store.sh exists returns false for missing key"
  else
    fail "store.sh exists returned true for missing key"
  fi

  # List
  CLAWPOWERS_DIR="$TEST_DIR" bash "$STORE_SCRIPT" set "test:key2" "value2" >/dev/null 2>&1
  list_result=$(CLAWPOWERS_DIR="$TEST_DIR" bash "$STORE_SCRIPT" list "test:" 2>/dev/null || echo "")
  if echo "$list_result" | grep -q "test:key1"; then
    pass "store.sh list returns keys with prefix"
  else
    fail "store.sh list: got '$list_result' (expected keys with 'test:' prefix)"
  fi

  # Incr
  CLAWPOWERS_DIR="$TEST_DIR" bash "$STORE_SCRIPT" set "test:counter" "5" >/dev/null 2>&1
  incr_result=$(CLAWPOWERS_DIR="$TEST_DIR" bash "$STORE_SCRIPT" incr "test:counter" 2>/dev/null || echo "ERROR")
  if [[ "$incr_result" == "6" ]]; then
    pass "store.sh incr increments value correctly"
  else
    fail "store.sh incr: got '$incr_result' (expected '6')"
  fi

  # Delete
  CLAWPOWERS_DIR="$TEST_DIR" bash "$STORE_SCRIPT" delete "test:key1" >/dev/null 2>&1
  if ! CLAWPOWERS_DIR="$TEST_DIR" bash "$STORE_SCRIPT" exists "test:key1" 2>/dev/null; then
    pass "store.sh delete removes key"
  else
    fail "store.sh delete: key still exists after delete"
  fi

  # Key traversal prevention
  if CLAWPOWERS_DIR="$TEST_DIR" bash "$STORE_SCRIPT" set "../evil" "bad" 2>/dev/null; then
    fail "store.sh: key with path traversal was accepted (security issue)"
  else
    pass "store.sh rejects path traversal in key names"
  fi
fi

# Test: collector.sh exists
COLLECTOR="$REPO_ROOT/runtime/metrics/collector.sh"
if [[ -f "$COLLECTOR" ]]; then
  pass "runtime/metrics/collector.sh exists"
else
  fail "runtime/metrics/collector.sh missing"
fi

# Test: analyze.sh exists
ANALYZER="$REPO_ROOT/runtime/feedback/analyze.sh"
if [[ -f "$ANALYZER" ]]; then
  pass "runtime/feedback/analyze.sh exists"
else
  fail "runtime/feedback/analyze.sh missing"
fi

# Save results
cat > "$RESULT_FILE" << EOF
pass=$PASS
fail=$FAIL
skip=$SKIP
EOF

echo "  Runtime init tests: $PASS passed, $FAIL failed"
