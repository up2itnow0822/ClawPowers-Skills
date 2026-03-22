#!/usr/bin/env bash
# runtime/init.sh — Initialize the ClawPowers runtime directory structure
#
# Creates ~/.clawpowers/ with all required subdirectories on first run.
# Safe to run multiple times (idempotent).
#
# Usage:
#   bash runtime/init.sh
#   npx clawpowers init
set -euo pipefail

CLAWPOWERS_DIR="${CLAWPOWERS_DIR:-$HOME/.clawpowers}"
VERSION="1.0.0"

# Create directory structure
create_structure() {
  local dirs=(
    "$CLAWPOWERS_DIR"
    "$CLAWPOWERS_DIR/state"
    "$CLAWPOWERS_DIR/metrics"
    "$CLAWPOWERS_DIR/checkpoints"
    "$CLAWPOWERS_DIR/feedback"
    "$CLAWPOWERS_DIR/memory"
    "$CLAWPOWERS_DIR/logs"
  )

  local created=0
  for dir in "${dirs[@]}"; do
    if [[ ! -d "$dir" ]]; then
      mkdir -p "$dir"
      chmod 700 "$dir"
      ((created++)) || true
    fi
  done

  echo "$created"
}

# Write version file
write_version() {
  local version_file="$CLAWPOWERS_DIR/.version"
  if [[ ! -f "$version_file" ]]; then
    cat > "$version_file" << EOF
version=$VERSION
initialized=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
    chmod 600 "$version_file"
  fi
}

# Write README in the runtime dir
write_readme() {
  local readme="$CLAWPOWERS_DIR/README"
  if [[ ! -f "$readme" ]]; then
    cat > "$readme" << 'EOF'
ClawPowers Runtime Directory
============================

This directory is managed by ClawPowers (https://github.com/up2itnow0822/clawpowers).

Directory Structure:
  state/        Key-value state store for skill data (managed by persistence/store.sh)
  metrics/      Skill execution outcome logs in JSONL format
  checkpoints/  Resumable workflow state (created by executing-plans skill)
  feedback/     RSI analysis output and recommendations
  memory/       Cross-session knowledge base
  logs/         Debug and audit logs

Safe to delete: Yes — ClawPowers recreates this directory on next init.
Never share: Contains agent state and potentially sensitive workflow data.

Manage with: npx clawpowers status
EOF
    chmod 600 "$readme"
  fi
}

# Migrate from older versions (future-proofing)
run_migrations() {
  local current_version
  current_version=$(grep "^version=" "$CLAWPOWERS_DIR/.version" 2>/dev/null | cut -d= -f2 || echo "0.0.0")

  # Placeholder for future migrations
  # if [[ "$current_version" < "2.0.0" ]]; then
  #   migrate_v1_to_v2
  # fi

  # Update version stamp
  sed -i.bak "s/^version=.*/version=$VERSION/" "$CLAWPOWERS_DIR/.version" 2>/dev/null || true
  rm -f "$CLAWPOWERS_DIR/.version.bak"
}

# Main
main() {
  local created
  created=$(create_structure)

  write_version
  write_readme

  if [[ -f "$CLAWPOWERS_DIR/.version" ]]; then
    run_migrations
  fi

  if [[ "${CLAWPOWERS_QUIET:-}" != "1" ]]; then
    if [[ $created -gt 0 ]]; then
      echo "ClawPowers runtime initialized at $CLAWPOWERS_DIR"
      echo "  Directories created: $created"
      echo "  Version: $VERSION"
    else
      echo "ClawPowers runtime already initialized at $CLAWPOWERS_DIR"
      local stored_version
      stored_version=$(grep "^version=" "$CLAWPOWERS_DIR/.version" | cut -d= -f2)
      echo "  Version: $stored_version"
    fi
  fi
}

main "$@"
