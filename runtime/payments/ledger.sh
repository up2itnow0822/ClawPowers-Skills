#!/usr/bin/env bash
# runtime/payments/ledger.sh — Payment decision ledger (bash version)
#
# Records payment decisions to ~/.clawpowers/logs/payments.jsonl.
# Provides CLI commands to review recent decisions and summarize spending.
#
# Usage:
#   bash ledger.sh log [--limit <n>]
#   bash ledger.sh summary
#   bash ledger.sh record --skill <name> --url <url> --amount <amt> \
#                         --asset <asset> --chain <chain> \
#                         --policy <result> --reason <text> [--would-pay]
set -euo pipefail

# Runtime root — override with CLAWPOWERS_DIR for testing
CLAWPOWERS_DIR="${CLAWPOWERS_DIR:-$HOME/.clawpowers}"
LOGS_DIR="$CLAWPOWERS_DIR/logs"
LEDGER_FILE="$LOGS_DIR/payments.jsonl"

## === Helpers ===

# Ensures the logs directory exists with correct permissions.
ensure_logs_dir() {
  if [[ ! -d "$LOGS_DIR" ]]; then
    mkdir -p "$LOGS_DIR"
    chmod 700 "$LOGS_DIR"
  fi
}

# Returns an ISO 8601 timestamp (seconds precision).
iso_timestamp() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

# Escapes a string for safe embedding in a JSON value.
# Handles backslash, double-quote, and common control characters.
json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"   # backslash
  s="${s//\"/\\\"}"   # double quote
  s="${s//$'\t'/\\t}" # tab
  s="${s//$'\n'/\\n}" # newline
  printf '%s' "$s"
}

## === record command ===

# Appends a single payment decision JSON line to the ledger.
#
# Options:
#   --skill <name>    Skill that triggered the payment gate
#   --type <type>     Entry type: decision | payment | denial (default: decision)
#   --url <url>       Resource URL that required payment
#   --amount <n>      Required amount in smallest unit (default: 0)
#   --asset <sym>     Asset symbol: USDC, ETH, etc. (default: USDC)
#   --chain <name>    Chain name: base, base-sepolia, etc. (default: base)
#   --policy <result> Policy outcome: dry_run | approved | denied | disabled
#   --reason <text>   Human-readable reason for the policy result
#   --would-pay       Flag: set would_have_paid=true
cmd_record() {
  local skill="unknown"
  local type="decision"
  local url=""
  local amount="0"
  local asset="USDC"
  local chain="base"
  local policy="dry_run"
  local reason=""
  local would_pay="false"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --skill)   skill="$2"; shift 2 ;;
      --type)    type="$2"; shift 2 ;;
      --url)     url="$2"; shift 2 ;;
      --amount)  amount="$2"; shift 2 ;;
      --asset)   asset="$2"; shift 2 ;;
      --chain)   chain="$2"; shift 2 ;;
      --policy)  policy="$2"; shift 2 ;;
      --reason)  reason="$2"; shift 2 ;;
      --would-pay) would_pay="true"; shift ;;
      *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
  done

  ensure_logs_dir

  local ts
  ts=$(iso_timestamp)

  # Build the JSON line manually (no jq dependency required)
  local line
  line="{\"timestamp\":\"$(json_escape "$ts")\","
  line+="\"skill\":\"$(json_escape "$skill")\","
  line+="\"type\":\"$(json_escape "$type")\","
  line+="\"url\":\"$(json_escape "$url")\","
  line+="\"required_amount\":\"$(json_escape "$amount")\","
  line+="\"asset\":\"$(json_escape "$asset")\","
  line+="\"chain\":\"$(json_escape "$chain")\","
  line+="\"policy_result\":\"$(json_escape "$policy")\","
  line+="\"reason\":\"$(json_escape "$reason")\","
  line+="\"would_have_paid\":$would_pay}"

  echo "$line" >> "$LEDGER_FILE"
  chmod 600 "$LEDGER_FILE" 2>/dev/null || true

  echo "Recorded: $skill → $policy ($(basename "$LEDGER_FILE"))"
}

## === log command ===

# Shows recent payment decisions from the ledger.
#
# Options:
#   --limit <n>   Maximum records to show (default: 20)
cmd_log() {
  local limit=20

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --limit) limit="$2"; shift 2 ;;
      *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
  done

  if [[ ! -f "$LEDGER_FILE" ]]; then
    echo "No payment decisions recorded yet."
    echo "Ledger location: $LEDGER_FILE"
    return
  fi

  local total
  total=$(wc -l < "$LEDGER_FILE" | tr -d ' ')

  if [[ "$total" -eq 0 ]]; then
    echo "No payment decisions recorded yet."
    return
  fi

  echo "Recent payment decisions (last $limit of $total):"
  echo ""

  # tail the last N lines and pretty-print each JSON record
  tail -n "$limit" "$LEDGER_FILE" | while IFS= read -r line; do
    [[ -z "$line" ]] && continue

    # Extract fields using basic shell tools (no jq dependency)
    local ts skill policy would_pay url amount asset chain reason
    ts=$(echo "$line" | grep -o '"timestamp":"[^"]*"' | cut -d'"' -f4)
    skill=$(echo "$line" | grep -o '"skill":"[^"]*"' | cut -d'"' -f4)
    policy=$(echo "$line" | grep -o '"policy_result":"[^"]*"' | cut -d'"' -f4)
    would_pay=$(echo "$line" | grep -o '"would_have_paid":[a-z]*' | cut -d: -f2)
    url=$(echo "$line" | grep -o '"url":"[^"]*"' | cut -d'"' -f4)
    amount=$(echo "$line" | grep -o '"required_amount":"[^"]*"' | cut -d'"' -f4)
    asset=$(echo "$line" | grep -o '"asset":"[^"]*"' | cut -d'"' -f4)
    chain=$(echo "$line" | grep -o '"chain":"[^"]*"' | cut -d'"' -f4)
    reason=$(echo "$line" | grep -o '"reason":"[^"]*"' | cut -d'"' -f4)

    local paid_label="[would skip]"
    [[ "$would_pay" == "true" ]] && paid_label="[would pay]"

    echo "  $ts | $skill | $policy $paid_label"
    [[ -n "$url" ]] && echo "    URL: $url"
    [[ "$amount" != "0" ]] && echo "    Amount: $amount $asset on $chain"
    [[ -n "$reason" ]] && echo "    Reason: $reason"
    echo ""
  done
}

## === summary command ===

# Shows aggregated payment totals by skill, chain, and outcome.
cmd_summary() {
  if [[ ! -f "$LEDGER_FILE" ]]; then
    echo "No payment decisions recorded yet."
    echo "Ledger location: $LEDGER_FILE"
    return
  fi

  local total
  total=$(grep -c '.' "$LEDGER_FILE" 2>/dev/null || echo 0)

  if [[ "$total" -eq 0 ]]; then
    echo "No payment decisions recorded yet."
    return
  fi

  local would_have_paid
  would_have_paid=$(grep -c '"would_have_paid":true' "$LEDGER_FILE" 2>/dev/null || echo 0)

  echo "Payment Decision Summary"
  echo "========================"
  echo "Total decisions: $total"
  echo "Would have paid: $would_have_paid"
  echo ""

  echo "By skill:"
  grep -o '"skill":"[^"]*"' "$LEDGER_FILE" | \
    cut -d'"' -f4 | sort | uniq -c | sort -rn | \
    while read -r count skill; do echo "  $skill: $count"; done
  echo ""

  echo "By chain:"
  grep -o '"chain":"[^"]*"' "$LEDGER_FILE" | \
    cut -d'"' -f4 | sort | uniq -c | sort -rn | \
    while read -r count chain; do echo "  $chain: $count"; done
  echo ""

  echo "By outcome:"
  grep -o '"policy_result":"[^"]*"' "$LEDGER_FILE" | \
    cut -d'"' -f4 | sort | uniq -c | sort -rn | \
    while read -r count outcome; do echo "  $outcome: $count"; done
}

## === usage ===

print_usage() {
  echo "Usage: ledger.sh <command> [options]"
  echo ""
  echo "Commands:"
  echo "  log [--limit <n>]   Show recent payment decisions (default: last 20)"
  echo "  summary             Show totals by skill, chain, and outcome"
  echo "  record [options]    Record a payment decision"
  echo ""
  echo "record options:"
  echo "  --skill <name>      Skill name (default: unknown)"
  echo "  --type <type>       decision | payment | denial (default: decision)"
  echo "  --url <url>         Resource URL"
  echo "  --amount <n>        Required amount"
  echo "  --asset <sym>       Asset symbol (default: USDC)"
  echo "  --chain <name>      Chain name (default: base)"
  echo "  --policy <result>   dry_run | approved | denied | disabled"
  echo "  --reason <text>     Reason for policy result"
  echo "  --would-pay         Set would_have_paid=true"
  echo ""
  echo "Ledger file: ~/.clawpowers/logs/payments.jsonl"
}

## === main dispatch ===

main() {
  local cmd="${1:-}"
  shift || true

  case "$cmd" in
    log)     cmd_log "$@" ;;
    summary) cmd_summary "$@" ;;
    record)  cmd_record "$@" ;;
    help|-h|--help) print_usage ;;
    "")
      print_usage
      exit 1
      ;;
    *)
      echo "Unknown command: $cmd" >&2
      print_usage >&2
      exit 1
      ;;
  esac
}

main "$@"
