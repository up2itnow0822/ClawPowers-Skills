#!/usr/bin/env bash
# clawpowers — CLI entry point
# Usage: npx clawpowers init | status | update
set -euo pipefail

CLAWPOWERS_DIR="${CLAWPOWERS_DIR:-$HOME/.clawpowers}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

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

cmd_init() {
  echo "Initializing ClawPowers runtime..."
  bash "$REPO_ROOT/runtime/init.sh"
  echo "Done. ClawPowers runtime ready at $CLAWPOWERS_DIR"
}

cmd_status() {
  if [[ ! -d "$CLAWPOWERS_DIR" ]]; then
    echo "Runtime not initialized. Run: npx clawpowers init"
    exit 1
  fi
  bash "$REPO_ROOT/runtime/feedback/analyze.sh"
}

cmd_update() {
  local repo_url="https://github.com/up2itnow0822/clawpowers"
  if command -v git >/dev/null 2>&1; then
    echo "Pulling latest skill definitions..."
    git -C "$REPO_ROOT" pull --ff-only origin main 2>/dev/null || \
      echo "Warning: could not auto-update. Visit $repo_url for latest."
  else
    echo "git not found. Visit $repo_url to update manually."
  fi
}

cmd_inject() {
  bash "$REPO_ROOT/hooks/session-start"
}

case "${1:-}" in
  init)    cmd_init ;;
  status)  cmd_status ;;
  update)  cmd_update ;;
  inject)  cmd_inject ;;
  help|-h|--help) usage ;;
  "")      usage; exit 1 ;;
  *)       echo "Unknown command: $1"; usage; exit 1 ;;
esac
