#!/usr/bin/env bash
# runtime/feedback/analyze.sh — RSI feedback engine
#
# Reads metrics, computes per-skill success rates, identifies declining performance,
# and outputs actionable recommendations for skill improvement.
#
# Usage:
#   analyze.sh                        Full analysis of all skills
#   analyze.sh --skill <name>         Analysis for one skill
#   analyze.sh --plan <name>          Plan execution analysis
#   analyze.sh --worktrees            Worktree lifecycle report
#   analyze.sh --recommendations      Show improvement recommendations only
#   analyze.sh --format json          Output as JSON instead of human-readable
#
# RSI Cycle: measure → analyze → adapt
#   This script implements the "analyze" step of the cycle.
#   The "adapt" output is human-readable recommendations that agents apply.
set -euo pipefail

## === Configuration ===

# All runtime paths derived from CLAWPOWERS_DIR for testability
CLAWPOWERS_DIR="${CLAWPOWERS_DIR:-$HOME/.clawpowers}"
METRICS_DIR="$CLAWPOWERS_DIR/metrics"
STATE_DIR="$CLAWPOWERS_DIR/state"
FEEDBACK_DIR="$CLAWPOWERS_DIR/feedback"

## === Internal Utilities ===

# Creates required runtime directories if they don't exist yet.
# Allows analysis to run even without a prior `clawpowers init`.
ensure_dirs() {
  for dir in "$METRICS_DIR" "$STATE_DIR" "$FEEDBACK_DIR"; do
    [[ -d "$dir" ]] || mkdir -p "$dir"
  done
}

## === Metrics Loading ===

# Reads all JSONL metric records from every monthly log file.
# Files are read in alphabetical (chronological) order.
# An optional skill filter restricts output to records for a specific skill.
# Blank lines are skipped; malformed JSON lines are silently passed through
# (awk handles the actual parsing and can skip bad records).
#
# Arguments:
#   $1 (optional) — skill name to filter by (empty = load all records)
#   $2 (optional) — look-back in months (unused placeholder for future filtering)
load_metrics() {
  local skill_filter="${1:-}"
  local months="${2:-6}"  # Reserved for future date-range filtering

  for f in "$METRICS_DIR"/*.jsonl; do
    [[ -f "$f" ]] || continue  # Skip if glob expands to literal string (no files)
    while IFS= read -r line; do
      [[ -z "$line" ]] && continue  # Skip blank separator lines
      if [[ -n "$skill_filter" ]]; then
        # Grep-based filter avoids jq dependency — exact JSON field match
        echo "$line" | grep -q "\"skill\":\"${skill_filter}\"" || continue
      fi
      echo "$line"
    done < "$f"
  done
}

## === Statistics ===

# Computes aggregate statistics for a single skill using awk JSON parsing.
# Output format (one line): "skill=<name> total=<n> success=<n> failure=<n> rate=<n> avg_duration=<n>"
# The key=value format allows easy extraction with grep -o and cut -d= -f2.
#
# avg_duration is -1 when no records include a duration_s field.
compute_skill_stats() {
  local skill="$1"
  load_metrics "$skill" | awk -v skill="$skill" '
  BEGIN { total=0; success=0; failure=0; partial=0; dur_total=0; dur_count=0 }
  /\"outcome\":\"success\"/ { success++ }
  /\"outcome\":\"failure\"/ { failure++ }
  /\"outcome\":\"partial\"/ { partial++ }
  # Extract duration_s numeric value using string operations
  /\"duration_s\":/ {
    p = index($0, "\"duration_s\":")
    if (p > 0) {
      rest = substr($0, p + 13)
      val = rest + 0
      if (val > 0 || substr(rest, 1, 1) == "0") { dur_total += val; dur_count++ }
    }
  }
  { total++ }
  END {
    if (total > 0) {
      rate = int(success/total*100+0.5)
      avg_dur = (dur_count > 0) ? int(dur_total/dur_count+0.5) : -1
      print "skill=" skill " total=" total " success=" success " failure=" failure " rate=" rate " avg_duration=" avg_dur
    }
  }
  '
}

# Returns a sorted, deduplicated list of all skill names present in the metrics store.
# Used to iterate over all tracked skills without needing an external registry.
get_all_skills() {
  load_metrics | awk '
  /\"skill\":/ {
    p = index($0, "\"skill\":\"")
    if (p > 0) {
      rest = substr($0, p + 9)
      q = index(rest, "\"")
      if (q > 0) skills[substr(rest, 1, q - 1)] = 1
    }
  }
  END { for (s in skills) print s }
  ' | sort
}

## === Trend Detection ===

# Detects declining performance by comparing the last N executions to the
# all-time success rate. A decline is flagged when the gap is >= 20 percentage points.
#
# Requires at least 2×window total records for a meaningful comparison;
# silently returns nothing for skills with insufficient data.
#
# Arguments:
#   $1 — skill name
detect_decline() {
  local skill="$1"
  local window=5  # Compare recent N executions vs. all-time average

  local all_lines
  all_lines=$(load_metrics "$skill")

  if [[ -z "$all_lines" ]]; then
    return 0  # No data, no decline to report
  fi

  echo "$all_lines" | awk -v window="$window" '
  BEGIN { total=0; success_all=0; recent_success=0; recent_total=0 }
  { lines[total] = $0; total++ }
  /\"outcome\":\"success\"/ { success_all++ }
  END {
    # Only compare when we have enough data for both windows
    start = (total > window) ? total - window : 0
    for (i=start; i<total; i++) {
      recent_total++
      if (lines[i] ~ /"outcome":"success"/) recent_success++
    }
    if (total >= window*2 && recent_total > 0) {
      all_rate = success_all/total * 100
      recent_rate = recent_success/recent_total * 100
      # Flag a 20+ percentage point drop as a significant decline
      if (all_rate - recent_rate >= 20) {
        printf "DECLINING: %s (all-time %.0f%% → recent %.0f%%)\n", ARGV[1], all_rate, recent_rate
      }
    }
  }
  ' /dev/null "$skill"
}

## === Recommendations ===

# Generates human-readable improvement recommendations based on success rate tier.
# Three tiers: <60% (low), 60-79% (moderate), ≥80% (good).
# Requires at least 3 executions; prints an "insufficient data" message otherwise.
#
# Arguments:
#   $1 — skill name (used in output messages)
#   $2 — success rate percentage (integer 0-100)
#   $3 — total execution count
generate_recommendations() {
  local skill="$1"
  local rate="$2"
  local total="$3"

  if [[ $total -lt 3 ]]; then
    echo "  Not enough data (${total} executions). Need 3+ to analyze."
    return
  fi

  if [[ $rate -lt 60 ]]; then
    echo "  ⚠ LOW SUCCESS RATE (${rate}%): Review skill methodology."
    echo "    Consider: Is the 'When to Use' triggering at wrong times?"
    echo "    Consider: Are anti-patterns in the skill being followed anyway?"
  elif [[ $rate -lt 80 ]]; then
    echo "  ℹ MODERATE RATE (${rate}%): Some improvement opportunity."
    echo "    Review recent failure notes for common causes."
  else
    echo "  ✓ GOOD RATE (${rate}%): Skill performing well."
  fi
}

## === Command Implementations ===

## --- Full Analysis ---

# Full RSI analysis across all tracked skills.
# Prints per-skill statistics, recommendations, decline warnings, and an overall summary.
# Also saves a compact plain-text report to the feedback directory for later reference.
# This is the default view shown by `clawpowers status`.
cmd_full_analysis() {
  local output_format="${1:-human}"  # Reserved: 'json' format planned for future

  ensure_dirs

  echo "ClawPowers RSI Feedback Analysis"
  echo "================================="
  echo "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo ""

  local skills
  skills=$(get_all_skills)

  if [[ -z "$skills" ]]; then
    echo "No metrics found. Run some skills and record outcomes with:"
    echo "  bash runtime/metrics/collector.sh record --skill <name> --outcome success"
    return 0
  fi

  echo "## Per-Skill Analysis"
  echo ""

  local overall_total=0
  local overall_success=0
  local declining_skills=""

  ## --- Per-Skill Loop ---
  while IFS= read -r skill; do
    [[ -z "$skill" ]] && continue

    local stats
    stats=$(compute_skill_stats "$skill")
    [[ -z "$stats" ]] && continue

    # Extract individual fields from the key=value output of compute_skill_stats
    local total rate avg_dur
    total=$(echo "$stats" | grep -o 'total=[0-9]*' | cut -d= -f2)
    local success
    success=$(echo "$stats" | grep -o 'success=[0-9]*' | cut -d= -f2)
    rate=$(echo "$stats" | grep -o 'rate=[0-9]*' | cut -d= -f2)
    avg_dur=$(echo "$stats" | grep -o 'avg_duration=-\?[0-9]*' | cut -d= -f2)

    # Accumulate aggregate counters for the overall summary section
    overall_total=$((overall_total + total))
    overall_success=$((overall_success + success))

    printf "### %s\n" "$skill"
    # Print avg duration only when records include timing data (-1 means no data)
    printf "  Executions: %d | Success rate: %d%%" "$total" "$rate"
    if [[ "$avg_dur" -gt 0 ]]; then
      printf " | Avg duration: %ds" "$avg_dur"
    fi
    echo ""

    # Print improvement recommendations based on the success rate tier
    generate_recommendations "$skill" "$rate" "$total"

    # Check for a significant performance drop in recent executions
    local decline
    decline=$(detect_decline "$skill" 2>/dev/null || true)
    if [[ -n "$decline" ]]; then
      echo "  ⚠ $decline"
      declining_skills+="$skill "
    fi

    echo ""
  done <<< "$skills"

  ## --- Overall Summary ---
  echo "## Overall Summary"
  if [[ $overall_total -gt 0 ]]; then
    local overall_rate
    overall_rate=$((overall_success * 100 / overall_total))
    echo "  Total executions: $overall_total"
    echo "  Overall success rate: ${overall_rate}%"

    if [[ -n "$declining_skills" ]]; then
      echo ""
      echo "  ⚠ Declining skills: $declining_skills"
      echo "    These skills show degraded performance in recent executions."
      echo "    Recommended: Review skill methodology and recent failure notes."
    fi
  fi

  ## --- Runtime State Snapshot ---
  # Count state keys and metrics files for the health display section
  local state_keys
  state_keys=$(ls "$STATE_DIR" 2>/dev/null | wc -l | tr -d ' ')
  echo ""
  echo "## Runtime State"
  echo "  State keys stored: $state_keys"
  echo "  Metrics files: $(ls "$METRICS_DIR"/*.jsonl 2>/dev/null | wc -l | tr -d ' ')"

  ## --- Persist Report ---
  # Save a compact summary to the feedback directory for trend tracking over time
  local report_file="$FEEDBACK_DIR/analysis-$(date +%Y-%m-%d).txt"
  {
    echo "Analysis generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "Overall success rate: $((overall_success * 100 / (overall_total > 0 ? overall_total : 1)))%"
    echo "Total executions: $overall_total"
    [[ -n "$declining_skills" ]] && echo "Declining: $declining_skills"
  } > "$report_file"
  chmod 600 "$report_file"
}

## --- Skill Analysis ---

# Detailed analysis for a single named skill.
# Shows statistics, recommendations, the 5 most recent executions, and
# any related keys in the state store.
cmd_skill_analysis() {
  local skill="$1"
  ensure_dirs

  echo "Skill Analysis: $skill"
  # Dynamic separator matching the header length
  echo "$(printf '=%.0s' {1..40})"
  echo "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo ""

  local stats
  stats=$(compute_skill_stats "$skill")
  if [[ -z "$stats" ]]; then
    echo "No metrics found for skill: $skill"
    echo "Record some executions with:"
    echo "  bash runtime/metrics/collector.sh record --skill $skill --outcome success"
    return 0
  fi

  # Extract all stat fields from compute_skill_stats output
  local total success failure rate avg_dur
  total=$(echo "$stats" | grep -o 'total=[0-9]*' | cut -d= -f2)
  success=$(echo "$stats" | grep -o 'success=[0-9]*' | cut -d= -f2)
  failure=$(echo "$stats" | grep -o 'failure=[0-9]*' | cut -d= -f2)
  rate=$(echo "$stats" | grep -o 'rate=[0-9]*' | cut -d= -f2)
  avg_dur=$(echo "$stats" | grep -o 'avg_duration=-\?[0-9]*' | cut -d= -f2)

  echo "## Statistics"
  echo "  Total executions: $total"
  echo "  Success: $success (${rate}%)"
  echo "  Failure: $failure ($((100 - rate))%)"
  if [[ "$avg_dur" -gt 0 ]]; then
    # Show duration in both seconds and minutes+seconds for readability
    echo "  Average duration: ${avg_dur}s ($((avg_dur / 60))m $((avg_dur % 60))s)"
  fi

  echo ""
  echo "## Recommendations"
  generate_recommendations "$skill" "$rate" "$total"

  ## --- Recent Executions ---
  # Show last 5 executions as a quick sanity check on recent behavior
  echo ""
  echo "## Recent Executions"
  load_metrics "$skill" | tail -5 | while IFS= read -r line; do
    local ts outcome notes
    ts=$(echo "$line" | grep -o '"ts":"[^"]*"' | cut -d'"' -f4)
    outcome=$(echo "$line" | grep -o '"outcome":"[^"]*"' | cut -d'"' -f4)
    # Notes are optional — default to "(no notes)" when absent
    notes=$(echo "$line" | grep -o '"notes":"[^"]*"' | cut -d'"' -f4 || echo "")
    printf "  %s | %-10s | %s\n" "$ts" "$outcome" "${notes:-(no notes)}"
  done

  ## --- Related State Keys ---
  # List any store keys that belong to this skill's namespace
  echo ""
  echo "## Related State Keys"
  if command -v bash >/dev/null 2>&1; then
    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    if [[ -f "$script_dir/persistence/store.sh" ]]; then
      bash "$script_dir/persistence/store.sh" list "${skill}:" 2>/dev/null || echo "  (none)"
    fi
  fi
}

## --- Plan Analysis ---

# Analyzes the execution of a named plan.
# Reads estimated vs. actual duration from the store and computes estimation accuracy.
# Also lists all task statuses tracked under this plan's namespace.
#
# Arguments:
#   $1 — plan name (as used in store keys, e.g. "auth-service")
cmd_plan_analysis() {
  local plan_name="$1"
  ensure_dirs

  echo "Plan Execution Analysis: $plan_name"
  echo "$(printf '=%.0s' {1..50})"
  echo ""

  # Locate store.sh relative to this script (analyze.sh is in feedback/, store.sh in persistence/)
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  local store="$script_dir/persistence/store.sh"

  if [[ ! -f "$store" ]]; then
    echo "Error: store.sh not found at $store" >&2
    return 1
  fi

  # Read plan timing metadata — set by the executing-plans skill during plan execution
  local estimated actual
  estimated=$(bash "$store" get "plan:${plan_name}:estimated_duration" "unknown" 2>/dev/null)
  actual=$(bash "$store" get "plan:${plan_name}:actual_duration" "unknown" 2>/dev/null)

  echo "Estimated duration: ${estimated}min"
  echo "Actual duration: ${actual}min"

  if [[ "$estimated" != "unknown" && "$actual" != "unknown" ]]; then
    # Compute accuracy ratio via awk (bash can't do floating point arithmetic)
    local error
    error=$(awk "BEGIN { printf \"%.1f\", $actual / $estimated }")
    echo "Estimation accuracy: ${error}x (1.0 = perfect)"
    # Flag significant underestimates (>30% over estimate) with a concrete recommendation
    if (( $(echo "$error > 1.3" | awk '{print ($1 > 0)}') )); then
      echo "Recommendation: Increase task time estimates by ${error}x for similar work"
    fi
  fi

  echo ""
  echo "Task Status:"
  # Task keys follow the pattern: execution:<planName>:task_<n>:status
  bash "$store" list-values "execution:${plan_name}:task_" 2>/dev/null | while IFS='=' read -r key val; do
    # Pad the key to 40 chars for aligned two-column output
    printf "  %-40s %s\n" "$key" "$val"
  done
}

## --- Worktree Report ---

# Reports on all active git worktrees tracked in the state store.
# Worktrees are registered by the using-git-worktrees skill and should be
# cleaned up after branch merges to avoid stale worktree accumulation.
cmd_worktree_report() {
  ensure_dirs

  echo "Worktree Lifecycle Report"
  echo "========================="
  echo ""

  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  local store="$script_dir/persistence/store.sh"

  if [[ ! -f "$store" ]]; then
    echo "Error: store.sh not found" >&2
    return 1
  fi

  echo "Active Worktrees:"
  # Worktree keys are registered under the "worktree:" namespace by the using-git-worktrees skill
  bash "$store" list-values "worktree:" 2>/dev/null | while IFS='=' read -r key val; do
    printf "  %s: %s\n" "$key" "$val"
  done || echo "  (none registered)"

  echo ""
  echo "Tip: After merging a branch, clean up its worktree:"
  echo "  git worktree remove <path> && git branch -d <branch>"
}

## --- Recommendations Only ---

# Shows only skills that have improvement recommendations (success rate <80%).
# Useful for quick triage without the full analysis output.
# Skills with fewer than 3 executions are excluded (insufficient data).
cmd_recommendations() {
  ensure_dirs

  echo "ClawPowers Recommendations"
  echo "=========================="
  echo ""

  local skills
  skills=$(get_all_skills)

  if [[ -z "$skills" ]]; then
    echo "No metrics yet. Record skill outcomes to get recommendations."
    return 0
  fi

  local has_recommendations=0

  while IFS= read -r skill; do
    [[ -z "$skill" ]] && continue
    local stats
    stats=$(compute_skill_stats "$skill")
    [[ -z "$stats" ]] && continue

    local total rate
    total=$(echo "$stats" | grep -o 'total=[0-9]*' | cut -d= -f2)
    rate=$(echo "$stats" | grep -o 'rate=[0-9]*' | cut -d= -f2)

    # Only surface skills with enough data that are underperforming
    if [[ $total -ge 3 && $rate -lt 80 ]]; then
      echo "[$skill] Success rate: ${rate}% ($total executions)"
      generate_recommendations "$skill" "$rate" "$total"
      echo ""
      has_recommendations=1
    fi
  done <<< "$skills"

  if [[ $has_recommendations -eq 0 ]]; then
    echo "All tracked skills performing well (≥80% success rate)."
    echo "Keep recording outcomes to refine this analysis."
  fi
}

## === Usage ===

cmd_usage() {
  cat << 'EOF'
Usage: analyze.sh [options]

Options:
  (no args)                Full analysis of all skills
  --skill <name>           Analysis for one specific skill
  --plan <name>            Plan execution analysis (duration, task status)
  --worktrees              Worktree lifecycle report
  --recommendations        Show improvement recommendations only
  --format json            JSON output (future: human is default)

Examples:
  analyze.sh
  analyze.sh --skill systematic-debugging
  analyze.sh --plan auth-service
  analyze.sh --worktrees
  analyze.sh --recommendations
EOF
}

## === Main Dispatch ===

# Route the first positional argument to the appropriate command function.
# Each flag corresponds to one analysis mode.
case "${1:-}" in
  --skill)           cmd_skill_analysis "${2:-}" ;;
  --plan)            cmd_plan_analysis "${2:-}" ;;
  --worktrees)       cmd_worktree_report ;;
  --recommendations) cmd_recommendations ;;
  # --format accepts a format name but human-readable is the only current output
  --format)          cmd_full_analysis "${2:-human}" ;;
  help|-h|--help)    cmd_usage ;;
  "")                cmd_full_analysis ;;
  *)                 echo "Unknown option: $1"; cmd_usage; exit 1 ;;
esac
