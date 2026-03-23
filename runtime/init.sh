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

# Runtime root — override with CLAWPOWERS_DIR env var for testing or custom locations
CLAWPOWERS_DIR="${CLAWPOWERS_DIR:-$HOME/.clawpowers}"
VERSION="1.1.1"

## === Directory Setup ===

# Creates all required runtime subdirectories.
# Each directory is created with mode 700 (owner-only) so skill state
# and metrics aren't readable by other users on the system.
# Prints the count of newly created directories (0 if already initialized).
create_structure() {
  local dirs=(
    "$CLAWPOWERS_DIR"              # Root runtime directory
    "$CLAWPOWERS_DIR/state"        # Key-value persistence (store.sh / store.js)
    "$CLAWPOWERS_DIR/metrics"      # Skill outcome JSONL logs, rotated monthly
    "$CLAWPOWERS_DIR/checkpoints"  # Resumable plan state (executing-plans skill)
    "$CLAWPOWERS_DIR/feedback"     # RSI analysis reports (analyze.sh / analyze.js)
    "$CLAWPOWERS_DIR/memory"       # Cross-session knowledge base
    "$CLAWPOWERS_DIR/logs"         # Debug and audit logs
  )

  local created=0
  for dir in "${dirs[@]}"; do
    if [[ ! -d "$dir" ]]; then
      mkdir -p "$dir"
      chmod 700 "$dir"
      # Bash arithmetic in set -e contexts requires || true to suppress exit on 0-return
      ((created++)) || true
    fi
  done

  echo "$created"
}

## === Version File ===

# Writes .version on first initialization. Contains the ClawPowers version and
# an ISO timestamp so we can track install date and run future migrations.
# No-op if the file already exists.
write_version() {
  local version_file="$CLAWPOWERS_DIR/.version"
  if [[ ! -f "$version_file" ]]; then
    cat > "$version_file" << EOF
version=$VERSION
initialized=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
    # 0o600 = owner read/write only
    chmod 600 "$version_file"
  fi
}

## === README ===

# Writes a human-readable README into CLAWPOWERS_DIR explaining its purpose.
# Helps users who discover the directory understand what it is and that it
# is safe to delete (ClawPowers recreates it on next run).
# No-op if the README already exists.
write_readme() {
  local readme="$CLAWPOWERS_DIR/README"
  if [[ ! -f "$readme" ]]; then
    # Single-quoted heredoc prevents variable expansion inside the README
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

## === Config File ===

# Writes the default config.json on first initialization.
# No-op if config.json already exists — user settings are always preserved.
# The file is written with mode 600 (owner read/write only).
write_config() {
  local config_file="$CLAWPOWERS_DIR/config.json"
  if [[ ! -f "$config_file" ]]; then
    cat > "$config_file" << EOF
{
  "version": "$VERSION",
  "payments": {
    "enabled": false,
    "mode": "dry_run",
    "per_tx_limit_usd": 0,
    "daily_limit_usd": 0,
    "weekly_limit_usd": 0,
    "allowlist": [],
    "require_approval_above_usd": 0
  },
  "telemetry": {
    "enabled": false
  },
  "skills": {
    "auto_load": true
  }
}
EOF
    chmod 600 "$config_file"
  fi
}

## === Migrations ===

# Updates the version stamp in .version to the current version.
# Placeholder for future schema migrations (e.g., restructuring state/ layout).
# The sed command replaces the version= line in place; .bak is cleaned up immediately.
run_migrations() {
  local current_version
  # current_version=$(grep "^version=" "$CLAWPOWERS_DIR/.version" 2>/dev/null | cut -d= -f2 || echo "0.0.0")

  # Future migration hooks go here, e.g.:
  # if [[ "$current_version" < "2.0.0" ]]; then
  #   migrate_v1_to_v2
  # fi

  # Always update the version stamp to reflect the currently running version
  sed -i.bak "s/^version=.*/version=$VERSION/" "$CLAWPOWERS_DIR/.version" 2>/dev/null || true
  rm -f "$CLAWPOWERS_DIR/.version.bak"
}

## === Main ===

main() {
  local created
  created=$(create_structure)

  write_version
  write_readme
  write_config

  # Migrations only apply when the version file exists (guaranteed after write_version)
  if [[ -f "$CLAWPOWERS_DIR/.version" ]]; then
    run_migrations
  fi

  # CLAWPOWERS_QUIET=1 suppresses all output when called from a hook or
  # another script that needs clean stdout (e.g., session-start emitting JSON)
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
