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

## === Configuration ===

# State directory — override parent with CLAWPOWERS_DIR env var for testing
STATE_DIR="${CLAWPOWERS_DIR:-$HOME/.clawpowers}/state"

## === Internal Utilities ===

# Creates the state directory if it doesn't already exist.
# Mode 700 ensures the directory is accessible only to the current user.
ensure_dir() {
  if [[ ! -d "$STATE_DIR" ]]; then
    mkdir -p "$STATE_DIR"
    chmod 700 "$STATE_DIR"
  fi
}

# Validates a key before use. Rejects empty keys, path separators, and '..'
# to prevent directory traversal attacks when constructing filenames.
validate_key() {
  local key="$1"
  if [[ -z "$key" ]]; then
    echo "Error: key cannot be empty" >&2
    exit 1
  fi
  # Reject '/' and '\' — they would allow writing outside STATE_DIR
  if [[ "$key" =~ [/\\] ]]; then
    echo "Error: key cannot contain '/' or '\\': $key" >&2
    exit 1
  fi
  # Reject '..' segments to prevent directory traversal
  if [[ "$key" =~ \.\. ]]; then
    echo "Error: key cannot contain '..': $key" >&2
    exit 1
  fi
}

# Converts a colon-separated key to a safe filesystem filename.
# Colons are replaced with double underscores because ':' is not valid in
# Windows filenames and can be ambiguous on some filesystems.
#
# Example: "execution:my-plan:task_1" → "$STATE_DIR/execution__my-plan__task_1"
key_to_file() {
  local key="$1"
  echo "$STATE_DIR/${key//:/__}"
}

# Atomically writes a value to a file using temp-file-then-mv.
# This prevents partial writes — readers see either the old value or the new
# value, never an intermediate truncated state.
atomic_write() {
  local file="$1"
  local value="$2"
  # Use PID in temp filename to avoid collisions with concurrent writes
  local tmpfile="${file}.tmp.$$"

  echo "$value" > "$tmpfile"
  chmod 600 "$tmpfile"
  # mv is atomic on POSIX filesystems when source and dest are on the same mount
  mv "$tmpfile" "$file"
}

## === Command Implementations ===

# set — Write a value to a key, overwriting any existing value.
cmd_set() {
  local key="$1"
  local value="${2:-}"  # Default to empty string if no value provided
  validate_key "$key"
  ensure_dir

  local file
  file=$(key_to_file "$key")
  atomic_write "$file" "$value"
}

# get — Read the value for a key.
# If the key doesn't exist and a default is provided, print the default.
# If the key doesn't exist and no default is provided, print an error and exit 1.
# The sentinel "__NOTSET__" distinguishes "no default provided" from "empty default".
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

# delete — Remove a key and its file.
# Prints a confirmation on success, or a "not found" message to stderr.
cmd_delete() {
  local key="$1"
  validate_key "$key"

  local file
  file=$(key_to_file "$key")
  if [[ -f "$file" ]]; then
    rm -f "$file"
    echo "Deleted: $key"
  else
    # Route "not found" to stderr so shell scripts can distinguish from success output
    echo "Key not found (nothing deleted): $key" >&2
  fi
}

# list — Print all keys matching an optional prefix (one key per line).
# The prefix uses colon notation (e.g. "execution:my-plan:") which is converted
# to filename notation before globbing.
cmd_list() {
  local prefix="${1:-}"
  ensure_dir

  # Convert prefix from key format (colons) to filename format (double underscores)
  local file_prefix="${prefix//:/__}"

  local found=0
  for f in "$STATE_DIR"/${file_prefix}*; do
    if [[ -f "$f" ]]; then
      # Convert filename back to colon-separated key format for output
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

# list-values — Print all key=value pairs matching an optional prefix.
# Output format: "key=value" (one pair per line), suitable for shell parsing.
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

# exists — Exit 0 if the key exists, exit 1 if not.
# Designed for use in shell conditionals: `store.sh exists my:key && echo "found"`
cmd_exists() {
  local key="$1"
  validate_key "$key"

  local file
  file=$(key_to_file "$key")
  # The [[ -f "$file" ]] test returns 0/1 directly — no explicit exit needed
  [[ -f "$file" ]]
}

# append — Add a value to an existing key, separated by a newline.
# Creates the key if it doesn't exist (same behavior as set on first call).
# Useful for maintaining lists, logs, or multi-line notes in a single key.
cmd_append() {
  local key="$1"
  local value="${2:-}"
  validate_key "$key"
  ensure_dir

  local file
  file=$(key_to_file "$key")

  if [[ -f "$file" ]]; then
    # Append to existing content — echo adds the trailing newline separator
    echo "$value" >> "$file"
  else
    # First write: use atomic write to properly create the file with permissions
    atomic_write "$file" "$value"
  fi
}

# incr — Increment the integer value stored at a key.
# Creates the key with value equal to `amount` if it doesn't exist (treating missing as 0).
# Rejects non-integer values with an error.
cmd_incr() {
  local key="$1"
  local amount="${2:-1}"  # Default increment is 1
  validate_key "$key"
  ensure_dir

  local file
  file=$(key_to_file "$key")

  # Read the current value; default to 0 if the key doesn't exist
  local current=0
  if [[ -f "$file" ]]; then
    # tr removes all whitespace including the trailing newline written by atomic_write
    current=$(cat "$file" | tr -d '[:space:]')
    # Validate that the stored value is a plain integer (no decimals, no whitespace)
    if ! [[ "$current" =~ ^-?[0-9]+$ ]]; then
      echo "Error: value is not an integer: $current" >&2
      exit 1
    fi
  fi

  local new_val=$((current + amount))
  atomic_write "$file" "$new_val"
  echo "$new_val"
}

## === Usage ===

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

## === Main Dispatch ===

# Route the first positional argument to the appropriate command function.
# Arguments after the command name are forwarded directly to each function.
case "${1:-}" in
  set)          cmd_set "${2:-}" "${3:-}" ;;
  get)          cmd_get "${2:-}" "${3:-__NOTSET__}" ;;
  delete)       cmd_delete "${2:-}" ;;
  list)         cmd_list "${2:-}" ;;
  list-values)  cmd_list_values "${2:-}" ;;
  exists)       cmd_exists "${2:-}" ;;
  append)       cmd_append "${2:-}" "${3:-}" ;;
  incr)         cmd_incr "${2:-}" "${3:-1}" ;;
  help|-h|--help) cmd_usage ;;
  "")           cmd_usage; exit 1 ;;
  *)            echo "Unknown command: $1"; cmd_usage; exit 1 ;;
esac
