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

CLAWPOWERS_DIR="${CLAWPOWERS_DIR:-$HOME/.clawpowers}"
METRICS_DIR="$CLAWPOWERS_DIR/metrics"
STATE_DIR="$CLAWPOWERS_DIR/state"
FEEDBACK_DIR="$CLAWPOWERS_DIR/feedback"

ensure_dirs() {
  for dir in "$METRICS_DIR" "$STATE_DIR" "$FEEDBACK_DIR"; do
    [[ -d "$dir" ]] || mkdir -p "$dir"
  done
}

# Load all metrics lines, optionally filtered by skill
load_metrics() {
  local skill_filter="${1:-}"
  local months="${2:-6}"  # Look back N months

  for f in "$METRICS_DIR"/*.jsonl; do
    [[ -f "$f" ]] || continue
    while IFS= read -r line; do
      [[ -z "$line" ]] && continue
      if [[ -n "$skill_filter" ]]; then
        echo "$line" | grep -q "\"skill\":\"${skill_filter}\"" || continue
      fi
      echo "$line"
    done < "$f"
  done
}

# Compute success rate for a skill using awk
compute_skill_stats() {
  local skill="$1"
  load_metrics "$skill" | awk -v skill="$skill" '
  BEGIN { total=0; success=0; failure=0; partial=0; dur_total=0; dur_count=0 }
  /\"outcome\":\"success\"/ { success++ }
  /\"outcome\":\"failure\"/ { failure++ }
  /\"outcome\":\"partial\"/ { partial++ }
  /\"duration_s\":/ {
    match($0, /"duration_s":([0-9.]+)/, a)
    if (a[1]) { dur_total += a[1]; dur_count++ }
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

# Get all unique skill names from metrics
get_all_skills() {
  load_metrics | awk '
  /\"skill\":/ {
    match($0, /"skill":"([^"]+)"/, a)
    if (a[1]) skills[a[1]] = 1
  }
  END { for (s in skills) print s }
  ' | sort
}

# Detect declining performance: compare last N executions to overall
detect_decline() {
  local skill="$1"
  local window=5  # Compare recent N vs. all-time

  local all_lines
  all_lines=$(load_metrics "$skill")

  if [[ -z "$all_lines" ]]; then
    return 0
  fi

  echo "$all_lines" | awk -v window="$window" '
  BEGIN { total=0; success_all=0; recent_success=0; recent_total=0 }
  { lines[total] = $0; total++ }
  /\"outcome\":\"success\"/ { success_all++ }
  END {
    # Count recent window
    start = (total > window) ? total - window : 0
    for (i=start; i<total; i++) {
      recent_total++
      if (lines[i] ~ /"outcome":"success"/) recent_success++
    }
    if (total >= window*2 && recent_total > 0) {
      all_rate = success_all/total * 100
      recent_rate = recent_success/recent_total * 100
      if (all_rate - recent_rate >= 20) {
        printf "DECLINING: %s (all-time %.0f%% → recent %.0f%%)\n", ARGV[1], all_rate, recent_rate
      }
    }
  }
  ' /dev/null "$skill"
}

# Generate recommendations based on stats
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

# Full analysis report
cmd_full_analysis() {
  local output_format="${1:-human}"

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

  while IFS= read -r skill; do
    [[ -z "$skill" ]] && continue

    local stats
    stats=$(compute_skill_stats "$skill")
    [[ -z "$stats" ]] && continue

    local total rate avg_dur
    total=$(echo "$stats" | grep -o 'total=[0-9]*' | cut -d= -f2)
    local success
    success=$(echo "$stats" | grep -o 'success=[0-9]*' | cut -d= -f2)
    rate=$(echo "$stats" | grep -o 'rate=[0-9]*' | cut -d= -f2)
    avg_dur=$(echo "$stats" | grep -o 'avg_duration=-\?[0-9]*' | cut -d= -f2)

    overall_total=$((overall_total + total))
    overall_success=$((overall_success + success))

    printf "### %s\n" "$skill"
    printf "  Executions: %d | Success rate: %d%%" "$total" "$rate"
    if [[ "$avg_dur" -gt 0 ]]; then
      printf " | Avg duration: %ds" "$avg_dur"
    fi
    echo ""

    generate_recommendations "$skill" "$rate" "$total"

    # Check for decline
    local decline
    decline=$(detect_decline "$skill" 2>/dev/null || true)
    if [[ -n "$decline" ]]; then
      echo "  ⚠ $decline"
      declining_skills+="$skill "
    fi

    echo ""
  done <<< "$skills"

  # Overall summary
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

  # State store summary
  local state_keys
  state_keys=$(ls "$STATE_DIR" 2>/dev/null | wc -l | tr -d ' ')
  echo ""
  echo "## Runtime State"
  echo "  State keys stored: $state_keys"
  echo "  Metrics files: $(ls "$METRICS_DIR"/*.jsonl 2>/dev/null | wc -l | tr -d ' ')"

  # Save analysis to feedback dir
  local report_file="$FEEDBACK_DIR/analysis-$(date +%Y-%m-%d).txt"
  {
    echo "Analysis generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "Overall success rate: $((overall_success * 100 / (overall_total > 0 ? overall_total : 1)))%"
    echo "Total executions: $overall_total"
    [[ -n "$declining_skills" ]] && echo "Declining: $declining_skills"
  } > "$report_file"
  chmod 600 "$report_file"
}

cmd_skill_analysis() {
  local skill="$1"
  ensure_dirs

  echo "Skill Analysis: $skill"
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
    echo "  Average duration: ${avg_dur}s ($((avg_dur / 60))m $((avg_dur % 60))s)"
  fi

  echo ""
  echo "## Recommendations"
  generate_recommendations "$skill" "$rate" "$total"

  # Show recent failure notes
  echo ""
  echo "## Recent Executions"
  load_metrics "$skill" | tail -5 | while IFS= read -r line; do
    local ts outcome notes
    ts=$(echo "$line" | grep -o '"ts":"[^"]*"' | cut -d'"' -f4)
    outcome=$(echo "$line" | grep -o '"outcome":"[^"]*"' | cut -d'"' -f4)
    notes=$(echo "$line" | grep -o '"notes":"[^"]*"' | cut -d'"' -f4 || echo "")
    printf "  %s | %-10s | %s\n" "$ts" "$outcome" "${notes:-(no notes)}"
  done

  # Check state store for related keys
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

cmd_plan_analysis() {
  local plan_name="$1"
  ensure_dirs

  echo "Plan Execution Analysis: $plan_name"
  echo "$(printf '=%.0s' {1..50})"
  echo ""

  # Read plan state from store
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  local store="$script_dir/persistence/store.sh"

  if [[ ! -f "$store" ]]; then
    echo "Error: store.sh not found at $store" >&2
    return 1
  fi

  local estimated actual
  estimated=$(bash "$store" get "plan:${plan_name}:estimated_duration" "unknown" 2>/dev/null)
  actual=$(bash "$store" get "plan:${plan_name}:actual_duration" "unknown" 2>/dev/null)

  echo "Estimated duration: ${estimated}min"
  echo "Actual duration: ${actual}min"

  if [[ "$estimated" != "unknown" && "$actual" != "unknown" ]]; then
    local error
    error=$(awk "BEGIN { printf \"%.1f\", $actual / $estimated }")
    echo "Estimation accuracy: ${error}x (1.0 = perfect)"
    if (( $(echo "$error > 1.3" | awk '{print ($1 > 0)}') )); then
      echo "Recommendation: Increase task time estimates by ${error}x for similar work"
    fi
  fi

  echo ""
  echo "Task Status:"
  bash "$store" list-values "execution:${plan_name}:task_" 2>/dev/null | while IFS='=' read -r key val; do
    printf "  %-40s %s\n" "$key" "$val"
  done
}

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
  bash "$store" list-values "worktree:" 2>/dev/null | while IFS='=' read -r key val; do
    printf "  %s: %s\n" "$key" "$val"
  done || echo "  (none registered)"

  echo ""
  echo "Tip: After merging a branch, clean up its worktree:"
  echo "  git worktree remove <path> && git branch -d <branch>"
}

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

# Dispatch
case "${1:-}" in
  --skill)         cmd_skill_analysis "${2:-}" ;;
  --plan)          cmd_plan_analysis "${2:-}" ;;
  --worktrees)     cmd_worktree_report ;;
  --recommendations) cmd_recommendations ;;
  --format)        cmd_full_analysis "${2:-human}" ;;
  help|-h|--help)  cmd_usage ;;
  "")              cmd_full_analysis ;;
  *)               echo "Unknown option: $1"; cmd_usage; exit 1 ;;
esac
