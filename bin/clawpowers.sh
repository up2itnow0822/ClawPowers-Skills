#!/usr/bin/env bash
# bin/clawpowers.sh — Bash CLI entry point for ClawPowers
#
# Provides the same commands as clawpowers.js for Unix environments that
# prefer bash over Node.js. The JS version (clawpowers.js) is the primary
# cross-platform entry point; this script is a convenience wrapper.
#
# Commands: init, status, update, inject
# Requires: bash, git (optional, for update command)
set -euo pipefail

# Runtime data directory — override with CLAWPOWERS_DIR env var for custom locations
CLAWPOWERS_DIR="${CLAWPOWERS_DIR:-$HOME/.clawpowers}"

# Resolve the repo root from this script's location (bin/ → repo root)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

## === Usage ===

usage() {
  cat <<EOF
Usage: clawpowers <command>

Commands:
  init      Initialize ClawPowers runtime in ~/.clawpowers/
  status    Show runtime health and skill metrics summary
  update    Pull latest skill definitions from repo
  inject    Inject using-clawpowers skill into current session context

Examples:
  npx clawpowers init
  npx clawpowers status
EOF
}

## === Command Implementations ===

# init — Set up the runtime directory structure
# Delegates to runtime/init.sh which is idempotent (safe to run multiple times)
cmd_init() {
  echo "Initializing ClawPowers runtime..."
  bash "$REPO_ROOT/runtime/init.sh"
  echo "Done. ClawPowers runtime ready at $CLAWPOWERS_DIR"
}

# status — Show RSI feedback analysis and runtime health
# Requires the runtime to be initialized; exits 1 with a helpful message if not
cmd_status() {
  if [[ ! -d "$CLAWPOWERS_DIR" ]]; then
    echo "Runtime not initialized. Run: npx clawpowers init"
    exit 1
  fi
  bash "$REPO_ROOT/runtime/feedback/analyze.sh"
}

# update — Pull the latest skill definitions from the GitHub repository
# Uses git fast-forward only (--ff-only) to avoid overwriting local modifications.
# Falls back gracefully when git is not installed.
cmd_update() {
  local repo_url="https://github.com/up2itnow0822/clawpowers"
  if command -v git >/dev/null 2>&1; then
    echo "Pulling latest skill definitions..."
    # Redirect stderr so git verbose output doesn't clutter the terminal
    git -C "$REPO_ROOT" pull --ff-only origin main 2>/dev/null || \
      echo "Warning: could not auto-update. Visit $repo_url for latest."
  else
    echo "git not found. Visit $repo_url to update manually."
  fi
}

# inject — Run the session-start hook to push the using-clawpowers skill
# into the current AI platform's context window.
# Calls the bash hook (hooks/session-start) which auto-detects the platform.
cmd_inject() {
  bash "$REPO_ROOT/hooks/session-start"
}

## === Main Dispatch ===

# Route the first positional argument to the appropriate command function.
# Unknown commands print usage and exit 1 so shell scripts can detect errors.
case "${1:-}" in
  init)           cmd_init ;;
  status)         cmd_status ;;
  update)         cmd_update ;;
  inject)         cmd_inject ;;
  help|-h|--help) usage ;;
  "")             usage; exit 1 ;;
  *)              echo "Unknown command: $1"; usage; exit 1 ;;
esac
