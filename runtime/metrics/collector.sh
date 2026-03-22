#!/usr/bin/env bash
# runtime/metrics/collector.sh — Skill execution outcome tracking
#
# Appends one JSON line per skill execution to ~/.clawpowers/metrics/YYYY-MM.jsonl
# Each line records: skill name, timestamp, duration, outcome, and notes.
#
# Usage:
#   collector.sh record --skill <name> --outcome <success|failure|partial> [options]
#   collector.sh show [--skill <name>] [--limit <n>]
#   collector.sh summary [--skill <name>]
#
# Options for record:
#   --skill <name>         Skill name (required)
#   --outcome <result>     success, failure, or partial (required)
#   --duration <seconds>   Execution duration in seconds (optional)
#   --notes <text>         Free-text notes about this execution (optional)
#   --session-id <id>      Session identifier for grouping (optional)
#
# Output format (one JSON line per execution):
#   {"ts":"ISO8601","skill":"name","outcome":"success","duration_s":47,"notes":"...","session":"..."}
set -euo pipefail

## === Configuration ===

# Metrics directory — override parent with CLAWPOWERS_DIR env var for testing
METRICS_DIR="${CLAWPOWERS_DIR:-$HOME/.clawpowers}/metrics"

## === Internal Utilities ===

# Creates the metrics directory if it doesn't already exist.
# Mode 700 ensures log files are accessible only to the current user.
ensure_dir() {
  if [[ ! -d "$METRICS_DIR" ]]; then
    mkdir -p "$METRICS_DIR"
    chmod 700 "$METRICS_DIR"
  fi
}

# Returns the path to the current month's JSONL log file.
# Files are named YYYY-MM.jsonl and rotated automatically each month.
# Monthly rotation keeps individual files manageable without any cleanup overhead.
current_logfile() {
  local month
  month=$(date +%Y-%m)
  echo "$METRICS_DIR/${month}.jsonl"
}

# Escapes a string for safe embedding in a JSON double-quoted value.
# Order matters: backslashes must be escaped before quotes, then control characters.
json_string() {
  local s="$1"
  s="${s//\\/\\\\}"   # Escape backslashes first (must be before quote escaping)
  s="${s//\"/\\\"}"   # Escape double quotes
  s="${s//$'\n'/\\n}" # Escape newlines (notes may span multiple lines)
  s="${s//$'\r'/\\r}" # Escape carriage returns (Windows line endings)
  s="${s//$'\t'/\\t}" # Escape tabs
  echo "$s"
}

## === Command Implementations ===

# record — Append one JSONL record to the current month's log file.
# Parses --flag value style arguments and validates required fields before writing.
cmd_record() {
  local skill="" outcome="" duration="" notes="" session_id=""

  ## --- Argument Parsing ---
  # Parse --key value style flags; reject unknown arguments
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --skill)      skill="$2";      shift 2 ;;
      --outcome)    outcome="$2";    shift 2 ;;
      --duration)   duration="$2";   shift 2 ;;
      --notes)      notes="$2";      shift 2 ;;
      --session-id) session_id="$2"; shift 2 ;;
      *)            echo "Unknown option: $1" >&2; exit 1 ;;
    esac
  done

  ## --- Validation ---
  if [[ -z "$skill" ]]; then
    echo "Error: --skill is required" >&2
    exit 1
  fi
  if [[ -z "$outcome" ]]; then
    echo "Error: --outcome is required (success|failure|partial)" >&2
    exit 1
  fi
  # Only allow the three defined outcome values to maintain data consistency
  if [[ ! "$outcome" =~ ^(success|failure|partial)$ ]]; then
    echo "Error: --outcome must be success, failure, or partial" >&2
    exit 1
  fi
  # Duration must be a non-negative number (integer or decimal seconds)
  if [[ -n "$duration" ]] && ! [[ "$duration" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
    echo "Error: --duration must be a number (seconds)" >&2
    exit 1
  fi

  ensure_dir

  local ts
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  ## --- Optional JSON Field Fragments ---
  # Build optional field strings only when values are present; empty fields
  # are omitted entirely from the JSON record to keep file sizes minimal

  local session_part=""
  if [[ -n "$session_id" ]]; then
    session_part=',"session":"'"$(json_string "$session_id")"'"'
  fi

  local duration_part=""
  if [[ -n "$duration" ]]; then
    # duration_s is a JSON number, not a string — no quotes around the value
    duration_part=',"duration_s":'"$duration"
  fi

  local notes_part=""
  if [[ -n "$notes" ]]; then
    notes_part=',"notes":"'"$(json_string "$notes")"'"'
  fi

  local logfile
  logfile=$(current_logfile)

  # Construct the JSON line manually (no jq dependency — pure bash string ops)
  local json_line="{\"ts\":\"${ts}\",\"skill\":\"$(json_string "$skill")\",\"outcome\":\"${outcome}\"${duration_part}${notes_part}${session_part}}"

  # appendFileSync equivalent — each append is a complete JSON line
  echo "$json_line" >> "$logfile"
  # Restrict log file permissions to owner-only after every write
  chmod 600 "$logfile"

  echo "Recorded: $skill → $outcome ($(basename "$logfile"))"
}

# show — Print recent execution records as raw JSON lines to stdout.
# Supports optional skill filter (--skill) and record count limit (--limit).
cmd_show() {
  local skill_filter="" limit=20

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --skill) skill_filter="$2"; shift 2 ;;
      --limit) limit="$2"; shift 2 ;;
      *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
  done

  ensure_dir

  ## --- Read All Records Into Array ---
  # Collect all JSONL files sorted by filename (YYYY-MM.jsonl = chronological)
  local lines=()
  for f in "$METRICS_DIR"/*.jsonl; do
    [[ -f "$f" ]] || continue  # Skip if glob expands to literal string (no files)
    while IFS= read -r line; do
      [[ -z "$line" ]] && continue  # Skip blank separator lines
      if [[ -n "$skill_filter" ]]; then
        # Grep-based filter avoids jq dependency — exact JSON field match
        echo "$line" | grep -q "\"skill\":\"${skill_filter}\"" || continue
      fi
      lines+=("$line")
    done < "$f"
  done

  ## --- Output Last N Records ---
  # Tail semantics: show the most recent `limit` records
  local total=${#lines[@]}
  local start=$((total - limit))
  [[ $start -lt 0 ]] && start=0

  for ((i=start; i<total; i++)); do
    echo "${lines[$i]}"
  done
}

# summary — Print aggregated statistics across all recorded executions.
# Uses awk for JSON field extraction without requiring jq or python.
# When no skill filter is provided, also shows a per-skill breakdown.
cmd_summary() {
  local skill_filter=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --skill) skill_filter="$2"; shift 2 ;;
      *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
  done

  ensure_dir

  ## --- Collect All Matching Records ---
  # Accumulate all matching JSON lines into a single variable for awk processing
  local all_lines=""
  for f in "$METRICS_DIR"/*.jsonl; do
    [[ -f "$f" ]] || continue
    while IFS= read -r line; do
      [[ -z "$line" ]] && continue
      if [[ -n "$skill_filter" ]]; then
        echo "$line" | grep -q "\"skill\":\"${skill_filter}\"" || continue
      fi
      all_lines+="$line"$'\n'
    done < "$f"
  done

  if [[ -z "$all_lines" ]]; then
    echo "No metrics recorded${skill_filter:+ for skill: $skill_filter}"
    return 0
  fi

  ## --- Compute and Print Stats via awk ---
  # Pure awk JSON parsing — extracts outcome counts, duration averages, and skill breakdown
  # without any external dependencies beyond the POSIX awk that's on every Unix system.
  echo "$all_lines" | awk '
  BEGIN {
    total = 0; success = 0; failure = 0; partial = 0
    total_duration = 0; duration_count = 0
    split("", skill_counts)
  }
  # Count outcomes by matching the JSON "outcome" field value
  /\"outcome\":\"success\"/ { success++ }
  /\"outcome\":\"failure\"/ { failure++ }
  /\"outcome\":\"partial\"/ { partial++ }
  # Extract duration_s numeric value using string operations (no regex group captures in awk)
  /\"duration_s\":/ {
    p = index($0, "\"duration_s\":")
    if (p > 0) {
      rest = substr($0, p + 13)
      val = rest + 0
      if (val > 0 || substr(rest, 1, 1) == "0") {
        total_duration += val
        duration_count++
      }
    }
  }
  # Extract skill name for the per-skill breakdown table
  /\"skill\":/ {
    p = index($0, "\"skill\":\"")
    if (p > 0) {
      rest = substr($0, p + 9)
      q = index(rest, "\"")
      if (q > 0) skill_counts[substr(rest, 1, q - 1)]++
    }
  }
  { total++ }
  END {
    print "Total executions:", total
    print "  Success:", success, "(" int(success/total*100+0.5) "%)"
    print "  Failure:", failure, "(" int(failure/total*100+0.5) "%)"
    print "  Partial:", partial, "(" int(partial/total*100+0.5) "%)"
    if (duration_count > 0) {
      print "Avg duration:", int(total_duration/duration_count+0.5) "s"
    }
    # Show skill breakdown only when no skill filter was applied
    if (!'"$([ -n "$skill_filter" ] && echo 1 || echo 0)"') {
      print "\nSkill breakdown:"
      for (s in skill_counts) {
        print "  " s ": " skill_counts[s]
      }
    }
  }
  '
}

## === Usage ===

cmd_usage() {
  cat << 'EOF'
Usage: collector.sh <command> [options]

Commands:
  record   Record a skill execution outcome
  show     Show recent execution records
  summary  Show aggregated statistics

record options:
  --skill <name>         Skill name (required)
  --outcome <result>     success | failure | partial (required)
  --duration <seconds>   Execution time in seconds
  --notes <text>         Notes about this execution
  --session-id <id>      Session identifier

Examples:
  collector.sh record --skill systematic-debugging --outcome success --duration 1800 \
    --notes "payment-pool: 3 hypotheses, root cause found in git bisect"

  collector.sh show --skill test-driven-development --limit 10

  collector.sh summary
  collector.sh summary --skill systematic-debugging
EOF
}

## === Main Dispatch ===

# Route the first positional argument to the appropriate command function.
# Arguments after the command name are forwarded with `shift` before each call.
case "${1:-}" in
  record)         shift; cmd_record "$@" ;;
  show)           shift; cmd_show "$@" ;;
  summary)        shift; cmd_summary "$@" ;;
  help|-h|--help) cmd_usage ;;
  "")             cmd_usage; exit 1 ;;
  *)              echo "Unknown command: $1"; cmd_usage; exit 1 ;;
esac
