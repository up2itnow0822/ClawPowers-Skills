#!/usr/bin/env bash
# tests/test_metrics_collector.sh — Validate metrics collector produces valid JSON lines
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COLLECTOR="$REPO_ROOT/runtime/metrics/collector.sh"
RESULT_FILE="/tmp/clawpowers_test_metrics_collector.result"
PASS=0; FAIL=0; SKIP=0

# Use temp dir for test isolation
TEST_DIR=$(mktemp -d)
cleanup() { rm -rf "$TEST_DIR"; }
trap cleanup EXIT

# Initialize runtime in test dir
bash "$REPO_ROOT/runtime/init.sh" >/dev/null 2>&1 || true
CLAWPOWERS_TEST_DIR="$TEST_DIR"
mkdir -p "$CLAWPOWERS_TEST_DIR/metrics"

pass() { echo "  PASS: $1"; ((PASS++)) || true; }
fail() { echo "  FAIL: $1"; ((FAIL++)) || true; }

# Test: collector.sh exists
if [[ -f "$COLLECTOR" ]]; then
  pass "collector.sh exists"
else
  fail "collector.sh missing"
  cat > "$RESULT_FILE" << EOF
pass=$PASS
fail=$FAIL
skip=$SKIP
EOF
  exit 0
fi

# Test: record command with required args
if CLAWPOWERS_DIR="$TEST_DIR" bash "$COLLECTOR" record \
    --skill "systematic-debugging" \
    --outcome success \
    >/dev/null 2>&1; then
  pass "record command accepts valid required args"
else
  fail "record command failed with valid args"
fi

# Test: record command with all optional args
if CLAWPOWERS_DIR="$TEST_DIR" bash "$COLLECTOR" record \
    --skill "test-driven-development" \
    --outcome failure \
    --duration 120 \
    --notes "test failure: missing edge case" \
    --session-id "sess-abc123" \
    >/dev/null 2>&1; then
  pass "record command accepts all optional args"
else
  fail "record command failed with optional args"
fi

# Test: metrics file is created
MONTH=$(date +%Y-%m)
METRICS_FILE="$TEST_DIR/metrics/${MONTH}.jsonl"
if [[ -f "$METRICS_FILE" ]]; then
  pass "metrics JSONL file created: ${MONTH}.jsonl"
else
  fail "metrics JSONL file not created at: $METRICS_FILE"
fi

# Test: JSONL file has correct number of lines
if [[ -f "$METRICS_FILE" ]]; then
  line_count=$(wc -l < "$METRICS_FILE" | tr -d ' ')
  if [[ $line_count -eq 2 ]]; then
    pass "JSONL file has 2 lines (one per record call)"
  else
    fail "JSONL file has $line_count lines (expected 2)"
  fi

  # Test: Each line is valid JSON (starts with { ends with })
  while IFS= read -r line; do
    if [[ "${line:0:1}" == "{" && "${line: -1}" == "}" ]]; then
      pass "JSONL line is valid JSON object"
    else
      fail "JSONL line is not valid JSON object: ${line:0:50}"
    fi
  done < "$METRICS_FILE"

  # Test: Lines contain required fields
  first_line=$(head -1 "$METRICS_FILE")
  REQUIRED_JSON_FIELDS=("\"ts\":" "\"skill\":" "\"outcome\":")
  for field in "${REQUIRED_JSON_FIELDS[@]}"; do
    if echo "$first_line" | grep -q "$field"; then
      pass "JSONL line contains required field: $field"
    else
      fail "JSONL line missing field: $field (line: ${first_line:0:100})"
    fi
  done

  # Test: skill field has correct value
  if echo "$first_line" | grep -q '"skill":"systematic-debugging"'; then
    pass "JSONL skill field has correct value"
  else
    fail "JSONL skill field wrong: ${first_line:0:100}"
  fi

  # Test: outcome field has correct value
  if echo "$first_line" | grep -q '"outcome":"success"'; then
    pass "JSONL outcome field has correct value"
  else
    fail "JSONL outcome field wrong: ${first_line:0:100}"
  fi

  # Test: timestamp is ISO8601 format
  ts=$(echo "$first_line" | grep -o '"ts":"[^"]*"' | cut -d'"' -f4)
  if [[ "$ts" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]]; then
    pass "JSONL timestamp is ISO8601 format: $ts"
  else
    fail "JSONL timestamp not ISO8601: '$ts'"
  fi

  # Test: second line has all optional fields
  second_line=$(tail -1 "$METRICS_FILE")
  if echo "$second_line" | grep -q '"duration_s":120'; then
    pass "JSONL duration_s field recorded correctly"
  else
    fail "JSONL duration_s missing or wrong: ${second_line:0:100}"
  fi

  if echo "$second_line" | grep -q '"notes":'; then
    pass "JSONL notes field recorded"
  else
    fail "JSONL notes field missing"
  fi

  if echo "$second_line" | grep -q '"session":'; then
    pass "JSONL session field recorded"
  else
    fail "JSONL session field missing"
  fi
fi

# Test: invalid outcome is rejected
if CLAWPOWERS_DIR="$TEST_DIR" bash "$COLLECTOR" record \
    --skill "test-skill" \
    --outcome "invalid_outcome" \
    >/dev/null 2>&1; then
  fail "record accepted invalid outcome value"
else
  pass "record rejects invalid outcome value"
fi

# Test: missing skill is rejected
if CLAWPOWERS_DIR="$TEST_DIR" bash "$COLLECTOR" record \
    --outcome success \
    >/dev/null 2>&1; then
  fail "record accepted missing --skill arg"
else
  pass "record rejects missing --skill arg"
fi

# Test: missing outcome is rejected
if CLAWPOWERS_DIR="$TEST_DIR" bash "$COLLECTOR" record \
    --skill "test-skill" \
    >/dev/null 2>&1; then
  fail "record accepted missing --outcome arg"
else
  pass "record rejects missing --outcome arg"
fi

# Test: summary command runs without error
if CLAWPOWERS_DIR="$TEST_DIR" bash "$COLLECTOR" summary >/dev/null 2>&1; then
  pass "summary command runs without error"
else
  fail "summary command failed"
fi

# Test: show command runs without error
if CLAWPOWERS_DIR="$TEST_DIR" bash "$COLLECTOR" show --limit 5 >/dev/null 2>&1; then
  pass "show command runs without error"
else
  fail "show command failed"
fi

# Test: analyze.sh runs without error (requires metrics data)
ANALYZER="$REPO_ROOT/runtime/feedback/analyze.sh"
if [[ -f "$ANALYZER" ]]; then
  if CLAWPOWERS_DIR="$TEST_DIR" bash "$ANALYZER" >/dev/null 2>&1; then
    pass "analyze.sh runs without error"
  else
    fail "analyze.sh exited with error"
  fi

  # Test: analyze.sh --skill produces output
  output=$(CLAWPOWERS_DIR="$TEST_DIR" bash "$ANALYZER" --skill "systematic-debugging" 2>/dev/null || echo "ERROR")
  if [[ "$output" != "ERROR" && -n "$output" ]]; then
    pass "analyze.sh --skill produces output"
  else
    fail "analyze.sh --skill produced no output"
  fi
else
  skip "analyze.sh not found (5 tests skipped)"
  SKIP=$((SKIP + 5))
fi

# Save results
cat > "$RESULT_FILE" << EOF
pass=$PASS
fail=$FAIL
skip=$SKIP
EOF

echo "  Metrics collector tests: $PASS passed, $FAIL failed, $SKIP skipped"
