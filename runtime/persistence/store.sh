#!/usr/bin/env bash
# runtime/persistence/store.sh — File-based key-value persistence
#
# Stores skill state in ~/.clawpowers/state/ using flat files.
# Each key maps to a file. Safe for concurrent reads; writes are atomic via temp file.
#
# Usage:
#   store.sh set <key> <value>       Set a key-value pair
#   store.sh get <key>               Get value for key (exits 1 if not found)
#   store.sh get <key> <default>     Get value, return default if not found
#   store.sh delete <key>            Delete a key
#   store.sh list [prefix]           List all keys (optionally filtered by prefix)
#   store.sh list-values [prefix]    List key=value pairs
#   store.sh exists <key>            Exit 0 if key exists, 1 if not
#   store.sh append <key> <value>    Append value to existing (newline-separated)
#   store.sh incr <key>              Increment a numeric value by 1
#   store.sh incr <key> <n>          Increment by n
#
# Key naming convention:
#   namespace:entity:attribute
#   Example: "execution:auth-plan:task_3:status"
#
# Keys may contain: [a-zA-Z0-9:_.-]
# Values may contain any printable characters
# Keys with '/' are rejected (no path traversal)
set -euo pipefail

STATE_DIR="${CLAWPOWERS_DIR:-$HOME/.clawpowers}/state"

# Ensure state directory exists
ensure_dir() {
  if [[ ! -d "$STATE_DIR" ]]; then
    mkdir -p "$STATE_DIR"
    chmod 700 "$STATE_DIR"
  fi
}

# Validate key: only safe characters, no path traversal
validate_key() {
  local key="$1"
  if [[ -z "$key" ]]; then
    echo "Error: key cannot be empty" >&2
    exit 1
  fi
  if [[ "$key" =~ [/\\] ]]; then
    echo "Error: key cannot contain '/' or '\\': $key" >&2
    exit 1
  fi
  if [[ "$key" =~ \.\. ]]; then
    echo "Error: key cannot contain '..': $key" >&2
    exit 1
  fi
}

# Convert key to safe filename (replace ':' with '__')
key_to_file() {
  local key="$1"
  echo "$STATE_DIR/${key//:/__}"
}

# Atomic write using temp file + mv
atomic_write() {
  local file="$1"
  local value="$2"
  local tmpfile="${file}.tmp.$$"

  echo "$value" > "$tmpfile"
  chmod 600 "$tmpfile"
  mv "$tmpfile" "$file"
}

cmd_set() {
  local key="$1"
  local value="${2:-}"
  validate_key "$key"
  ensure_dir

  local file
  file=$(key_to_file "$key")
  atomic_write "$file" "$value"
}

cmd_get() {
  local key="$1"
  local default_val="${2:-__NOTSET__}"
  validate_key "$key"
  ensure_dir

  local file
  file=$(key_to_file "$key")

  if [[ -f "$file" ]]; then
    cat "$file"
  elif [[ "$default_val" != "__NOTSET__" ]]; then
    echo "$default_val"
  else
    echo "Error: key not found: $key" >&2
    exit 1
  fi
}

cmd_delete() {
  local key="$1"
  validate_key "$key"

  local file
  file=$(key_to_file "$key")
  if [[ -f "$file" ]]; then
    rm -f "$file"
    echo "Deleted: $key"
  else
    echo "Key not found (nothing deleted): $key" >&2
  fi
}

cmd_list() {
  local prefix="${1:-}"
  ensure_dir

  # Convert prefix from key format to filename format
  local file_prefix="${prefix//:/__}"

  local found=0
  for f in "$STATE_DIR"/${file_prefix}*; do
    if [[ -f "$f" ]]; then
      # Convert filename back to key format
      local basename
      basename=$(basename "$f")
      local key="${basename//__/:}"
      echo "$key"
      ((found++)) || true
    fi
  done

  if [[ $found -eq 0 && -n "$prefix" ]]; then
    echo "No keys found with prefix: $prefix" >&2
  fi
}

cmd_list_values() {
  local prefix="${1:-}"
  ensure_dir

  local file_prefix="${prefix//:/__}"

  local found=0
  for f in "$STATE_DIR"/${file_prefix}*; do
    if [[ -f "$f" ]]; then
      local basename
      basename=$(basename "$f")
      local key="${basename//__/:}"
      local value
      value=$(cat "$f")
      echo "${key}=${value}"
      ((found++)) || true
    fi
  done

  if [[ $found -eq 0 && -n "$prefix" ]]; then
    echo "No keys found with prefix: $prefix" >&2
  fi
}

cmd_exists() {
  local key="$1"
  validate_key "$key"

  local file
  file=$(key_to_file "$key")
  [[ -f "$file" ]]
}

cmd_append() {
  local key="$1"
  local value="${2:-}"
  validate_key "$key"
  ensure_dir

  local file
  file=$(key_to_file "$key")

  if [[ -f "$file" ]]; then
    # Append to existing content
    echo "$value" >> "$file"
  else
    # Create new file with value
    atomic_write "$file" "$value"
  fi
}

cmd_incr() {
  local key="$1"
  local amount="${2:-1}"
  validate_key "$key"
  ensure_dir

  local file
  file=$(key_to_file "$key")

  local current=0
  if [[ -f "$file" ]]; then
    current=$(cat "$file" | tr -d '[:space:]')
    if ! [[ "$current" =~ ^-?[0-9]+$ ]]; then
      echo "Error: value is not an integer: $current" >&2
      exit 1
    fi
  fi

  local new_val=$((current + amount))
  atomic_write "$file" "$new_val"
  echo "$new_val"
}

cmd_usage() {
  cat << 'EOF'
Usage: store.sh <command> [args]

Commands:
  set <key> <value>        Set a key-value pair
  get <key> [default]      Get value (returns default or error if not found)
  delete <key>             Delete a key
  list [prefix]            List all keys matching prefix
  list-values [prefix]     List key=value pairs matching prefix
  exists <key>             Exit 0 if key exists, 1 if not
  append <key> <value>     Append value (newline-separated)
  incr <key> [amount]      Increment integer value by amount (default: 1)

Key format: namespace:entity:attribute (e.g., "execution:auth-plan:task_3:status")
State stored in: ~/.clawpowers/state/

Examples:
  store.sh set "execution:my-plan:task_1:status" "complete"
  store.sh get "execution:my-plan:task_1:status"
  store.sh get "missing-key" "default-value"
  store.sh list "execution:my-plan:"
  store.sh incr "metrics:session:payment_count"
  store.sh exists "execution:my-plan:task_1:status" && echo "exists"
EOF
}

# Dispatch
case "${1:-}" in
  set)     cmd_set "${2:-}" "${3:-}" ;;
  get)     cmd_get "${2:-}" "${3:-__NOTSET__}" ;;
  delete)  cmd_delete "${2:-}" ;;
  list)    cmd_list "${2:-}" ;;
  list-values) cmd_list_values "${2:-}" ;;
  exists)  cmd_exists "${2:-}" ;;
  append)  cmd_append "${2:-}" "${3:-}" ;;
  incr)    cmd_incr "${2:-}" "${3:-1}" ;;
  help|-h|--help) cmd_usage ;;
  "")      cmd_usage; exit 1 ;;
  *)       echo "Unknown command: $1"; cmd_usage; exit 1 ;;
esac
