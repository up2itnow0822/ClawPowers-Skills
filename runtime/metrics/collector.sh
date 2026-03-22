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

METRICS_DIR="${CLAWPOWERS_DIR:-$HOME/.clawpowers}/metrics"

ensure_dir() {
  if [[ ! -d "$METRICS_DIR" ]]; then
    mkdir -p "$METRICS_DIR"
    chmod 700 "$METRICS_DIR"
  fi
}

current_logfile() {
  local month
  month=$(date +%Y-%m)
  echo "$METRICS_DIR/${month}.jsonl"
}

# Escape a string for JSON
json_string() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\t'/\\t}"
  echo "$s"
}

cmd_record() {
  local skill="" outcome="" duration="" notes="" session_id=""

  # Parse arguments
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --skill)     skill="$2";      shift 2 ;;
      --outcome)   outcome="$2";    shift 2 ;;
      --duration)  duration="$2";   shift 2 ;;
      --notes)     notes="$2";      shift 2 ;;
      --session-id) session_id="$2"; shift 2 ;;
      *)           echo "Unknown option: $1" >&2; exit 1 ;;
    esac
  done

  # Validate required fields
  if [[ -z "$skill" ]]; then
    echo "Error: --skill is required" >&2
    exit 1
  fi
  if [[ -z "$outcome" ]]; then
    echo "Error: --outcome is required (success|failure|partial)" >&2
    exit 1
  fi
  if [[ ! "$outcome" =~ ^(success|failure|partial)$ ]]; then
    echo "Error: --outcome must be success, failure, or partial" >&2
    exit 1
  fi

  # Validate duration if provided
  if [[ -n "$duration" ]] && ! [[ "$duration" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
    echo "Error: --duration must be a number (seconds)" >&2
    exit 1
  fi

  ensure_dir

  local ts
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  local session_part=""
  if [[ -n "$session_id" ]]; then
    session_part=',"session":"'"$(json_string "$session_id")"'"'
  fi

  local duration_part=""
  if [[ -n "$duration" ]]; then
    duration_part=',"duration_s":'"$duration"
  fi

  local notes_part=""
  if [[ -n "$notes" ]]; then
    notes_part=',"notes":"'"$(json_string "$notes")"'"'
  fi

  local logfile
  logfile=$(current_logfile)

  local json_line="{\"ts\":\"${ts}\",\"skill\":\"$(json_string "$skill")\",\"outcome\":\"${outcome}\"${duration_part}${notes_part}${session_part}}"

  echo "$json_line" >> "$logfile"
  chmod 600 "$logfile"

  echo "Recorded: $skill → $outcome ($(basename "$logfile"))"
}

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

  # Collect all JSONL files sorted by date
  local lines=()
  for f in "$METRICS_DIR"/*.jsonl; do
    [[ -f "$f" ]] || continue
    while IFS= read -r line; do
      [[ -z "$line" ]] && continue
      if [[ -n "$skill_filter" ]]; then
        # Simple grep filter (no jq dependency)
        echo "$line" | grep -q "\"skill\":\"${skill_filter}\"" || continue
      fi
      lines+=("$line")
    done < "$f"
  done

  # Show last N lines
  local total=${#lines[@]}
  local start=$((total - limit))
  [[ $start -lt 0 ]] && start=0

  for ((i=start; i<total; i++)); do
    echo "${lines[$i]}"
  done
}

cmd_summary() {
  local skill_filter=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --skill) skill_filter="$2"; shift 2 ;;
      *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
  done

  ensure_dir

  # Accumulate stats (no jq/python dependency — pure bash + awk)
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

  # Use awk to parse JSON lines and compute stats
  echo "$all_lines" | awk '
  BEGIN {
    total = 0; success = 0; failure = 0; partial = 0
    total_duration = 0; duration_count = 0
    split("", skill_counts)
  }
  /\"outcome\":\"success\"/ { success++ }
  /\"outcome\":\"failure\"/ { failure++ }
  /\"outcome\":\"partial\"/ { partial++ }
  /\"duration_s\":/ {
    match($0, /"duration_s":([0-9.]+)/, arr)
    if (arr[1] != "") {
      total_duration += arr[1]
      duration_count++
    }
  }
  /\"skill\":/ {
    match($0, /"skill":"([^"]+)"/, arr)
    if (arr[1] != "") skill_counts[arr[1]]++
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
    if (!'"$([ -n "$skill_filter" ] && echo 1 || echo 0)"') {
      print "\nSkill breakdown:"
      for (s in skill_counts) {
        print "  " s ": " skill_counts[s]
      }
    }
  }
  '
}

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

# Dispatch
case "${1:-}" in
  record)  shift; cmd_record "$@" ;;
  show)    shift; cmd_show "$@" ;;
  summary) shift; cmd_summary "$@" ;;
  help|-h|--help) cmd_usage ;;
  "") cmd_usage; exit 1 ;;
  *) echo "Unknown command: $1"; cmd_usage; exit 1 ;;
esac
