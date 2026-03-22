#!/usr/bin/env node
// runtime/persistence/store.js — File-based key-value persistence
//
// Stores skill state in ~/.clawpowers/state/ using flat files.
// Each key maps to a file. Writes are atomic via temp file + rename.
//
// Usage:
//   node store.js set <key> <value>
//   node store.js get <key> [default]
//   node store.js delete <key>
//   node store.js list [prefix]
//   node store.js list-values [prefix]
//   node store.js exists <key>
//   node store.js append <key> <value>
//   node store.js incr <key> [amount]
//
// Key naming convention: namespace:entity:attribute
// Keys may contain: [a-zA-Z0-9:_.-]
// Keys with '/' or '\' or '..' are rejected (path-traversal protection)
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// State directory — override parent with CLAWPOWERS_DIR env var for testing
const STATE_DIR = path.join(
  process.env.CLAWPOWERS_DIR || path.join(os.homedir(), '.clawpowers'),
  'state'
);

/**
 * Creates the state directory if it doesn't already exist.
 * Mode 0o700 ensures the directory is only accessible by the current user.
 * Called before every read/write operation as a cheap guard.
 */
function ensureDir() {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  }
}

/**
 * Validates a key before use, preventing empty keys and path-traversal attacks.
 * Keys that pass validation are safe to embed in filenames.
 *
 * @param {string} key - The key to validate.
 * @throws {Error} If the key is empty, contains path separators, or contains '..'.
 */
function validateKey(key) {
  if (!key || key.length === 0) {
    throw new Error('key cannot be empty');
  }
  // Reject path separators — they would allow writing outside STATE_DIR
  if (key.includes('/') || key.includes('\\')) {
    throw new Error(`key cannot contain '/' or '\\': ${key}`);
  }
  // Reject '..' segments to prevent directory traversal
  if (key.includes('..')) {
    throw new Error(`key cannot contain '..': ${key}`);
  }
}

/**
 * Converts a colon-separated key to a safe filesystem filename.
 * Colons are replaced with double underscores because ':' is not valid in
 * Windows filenames and can be ambiguous on some filesystems.
 *
 * Example: "execution:my-plan:task_1" → "<STATE_DIR>/execution__my-plan__task_1"
 *
 * @param {string} key - Validated key (colons are safe at this point).
 * @returns {string} Absolute path to the file that stores this key's value.
 */
function keyToFile(key) {
  return path.join(STATE_DIR, key.replace(/:/g, '__'));
}

/**
 * Converts a filesystem filename back to its original colon-separated key.
 * Reverses the transformation applied by keyToFile().
 *
 * @param {string} filename - Base filename (without directory path).
 * @returns {string} Original key with colons restored.
 */
function fileToKey(filename) {
  return path.basename(filename).replace(/__/g, ':');
}

/**
 * Atomically writes a value to a file using a temp-file-then-rename strategy.
 * This prevents partial writes — readers either see the old value or the new
 * value, never a truncated intermediate state.
 *
 * A trailing newline is appended so the file ends cleanly (Unix convention).
 * Mode 0o600 restricts access to the file owner only.
 *
 * @param {string} filepath - Destination file path.
 * @param {string} value - String value to write.
 */
function atomicWrite(filepath, value) {
  // Use PID in temp filename to avoid collisions with concurrent writes
  const tmp = `${filepath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, value + '\n', { mode: 0o600 });
  // rename() is atomic on POSIX; on Windows it may fail if the destination
  // already exists, but Node.js handles this via a copy+delete fallback
  fs.renameSync(tmp, filepath);
  // Ensure permissions on the final file (rename inherits temp perms on most OSes)
  try { fs.chmodSync(filepath, 0o600); } catch (_) { /* non-fatal on Windows */ }
}

/**
 * Sets a key to the given value, overwriting any existing value.
 * Creates the key file if it doesn't exist.
 *
 * @param {string} key - Key to set (validated for safe characters).
 * @param {string} [value=''] - Value to store.
 */
function cmdSet(key, value = '') {
  validateKey(key);
  ensureDir();
  atomicWrite(keyToFile(key), value);
}

/**
 * Gets the value for a key, optionally returning a default if the key is absent.
 *
 * The sentinel `Symbol('NOTSET')` is used internally to distinguish between
 * "caller passed undefined as default" and "caller passed no default argument"
 * — important because `undefined` is a valid JavaScript value.
 *
 * @param {string} key - Key to look up.
 * @param {string} [defaultVal] - Value to return if key doesn't exist.
 *   If omitted, throws when the key is not found.
 * @returns {string} The stored value, or defaultVal if key is absent.
 * @throws {Error} If key is not found and no default was provided.
 */
function cmdGet(key, defaultVal) {
  const NOTSET = Symbol('NOTSET');
  // arguments.length distinguishes cmdGet(k) from cmdGet(k, undefined)
  const fallback = arguments.length >= 2 ? defaultVal : NOTSET;
  validateKey(key);
  ensureDir();

  const filepath = keyToFile(key);
  if (fs.existsSync(filepath)) {
    // Strip the trailing newline that atomicWrite appends to every value
    return fs.readFileSync(filepath, 'utf8').replace(/\n$/, '');
  }
  if (fallback !== NOTSET) {
    return fallback;
  }
  throw new Error(`key not found: ${key}`);
}

/**
 * Deletes a key and its associated file.
 *
 * @param {string} key - Key to delete.
 * @returns {string} Confirmation message or "Key not found" message.
 */
function cmdDelete(key) {
  validateKey(key);
  const filepath = keyToFile(key);
  if (fs.existsSync(filepath)) {
    fs.unlinkSync(filepath);
    return `Deleted: ${key}`;
  }
  return `Key not found (nothing deleted): ${key}`;
}

/**
 * Lists all keys that start with the given prefix.
 * The prefix uses colon notation (e.g. "execution:my-plan:") which is
 * converted to filename notation before filtering.
 *
 * @param {string} [prefix=''] - Key prefix to filter by; empty string returns all keys.
 * @returns {string[]} Sorted array of matching keys in colon notation.
 */
function cmdList(prefix = '') {
  ensureDir();
  // Convert prefix from key format to filename format for comparison
  const filePrefix = prefix.replace(/:/g, '__');
  const entries = fs.readdirSync(STATE_DIR);
  const keys = [];
  for (const entry of entries) {
    if (entry.startsWith(filePrefix)) {
      const fullPath = path.join(STATE_DIR, entry);
      // Skip directories (shouldn't exist, but be defensive)
      if (fs.statSync(fullPath).isFile()) {
        keys.push(fileToKey(entry));
      }
    }
  }
  return keys;
}

/**
 * Lists all key=value pairs that start with the given prefix.
 * Each entry is formatted as "key=value" suitable for parsing with `cut -d= -f2`.
 *
 * @param {string} [prefix=''] - Key prefix to filter by.
 * @returns {string[]} Array of "key=value" strings.
 */
function cmdListValues(prefix = '') {
  ensureDir();
  const filePrefix = prefix.replace(/:/g, '__');
  const entries = fs.readdirSync(STATE_DIR);
  const pairs = [];
  for (const entry of entries) {
    if (entry.startsWith(filePrefix)) {
      const fullPath = path.join(STATE_DIR, entry);
      if (fs.statSync(fullPath).isFile()) {
        const key = fileToKey(entry);
        // Strip trailing newline before embedding in "key=value" output
        const value = fs.readFileSync(fullPath, 'utf8').replace(/\n$/, '');
        pairs.push(`${key}=${value}`);
      }
    }
  }
  return pairs;
}

/**
 * Checks whether a key exists in the store.
 * Does not read the file contents — only checks for file existence.
 *
 * @param {string} key - Key to check.
 * @returns {boolean} True if the key exists, false otherwise.
 */
function cmdExists(key) {
  validateKey(key);
  return fs.existsSync(keyToFile(key));
}

/**
 * Appends a value to an existing key, separated by a newline.
 * If the key doesn't exist, creates it with the given value (same as `set`).
 * Useful for maintaining lists, logs, or multi-line notes in a single key.
 *
 * @param {string} key - Key to append to.
 * @param {string} [value=''] - Value to append.
 */
function cmdAppend(key, value = '') {
  validateKey(key);
  ensureDir();
  const filepath = keyToFile(key);
  if (fs.existsSync(filepath)) {
    // appendFileSync does not need atomic temp-file since partial appends
    // are acceptable (only new data is added, existing data is intact)
    fs.appendFileSync(filepath, value + '\n', { mode: 0o600 });
  } else {
    // First write: use atomic write to properly create the file
    atomicWrite(filepath, value);
  }
}

/**
 * Increments the integer value stored at a key by the given amount.
 * Creates the key with value `amount` if it doesn't exist (treating missing as 0).
 * Rejects non-integer existing values with an error.
 *
 * @param {string} key - Key whose value to increment.
 * @param {number} [amount=1] - Amount to add (can be negative for decrement).
 * @returns {number} The new value after incrementing.
 * @throws {Error} If the existing value is not a valid integer.
 */
function cmdIncr(key, amount = 1) {
  validateKey(key);
  ensureDir();
  const filepath = keyToFile(key);

  let current = 0;
  if (fs.existsSync(filepath)) {
    const raw = fs.readFileSync(filepath, 'utf8').trim();
    // Only allow plain integers — reject floats, whitespace-padded values, etc.
    if (!/^-?[0-9]+$/.test(raw)) {
      throw new Error(`value is not an integer: ${raw}`);
    }
    current = parseInt(raw, 10);
  }

  const newVal = current + Number(amount);
  atomicWrite(filepath, String(newVal));
  return newVal;
}

/**
 * Prints usage information for the store CLI to stdout.
 */
function printUsage() {
  console.log(`Usage: store.js <command> [args]

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
  store.js set "execution:my-plan:task_1:status" "complete"
  store.js get "execution:my-plan:task_1:status"
  store.js get "missing-key" "default-value"
  store.js list "execution:my-plan:"
  store.js incr "metrics:session:payment_count"
  store.js exists "execution:my-plan:task_1:status" && echo "exists"`);
}

/**
 * CLI dispatch — parses argv and routes to the appropriate command function.
 * Called when this module is run directly (not when require()'d).
 *
 * @param {string[]} argv - Argument array (typically process.argv.slice(2)).
 */
function main(argv) {
  const [cmd, ...args] = argv;

  switch (cmd) {
    case 'set': {
      const [key, value = ''] = args;
      cmdSet(key, value);
      break;
    }
    case 'get': {
      const [key, def] = args;
      try {
        // Pass default only when it was explicitly provided on the command line
        const val = args.length >= 2 ? cmdGet(key, def) : cmdGet(key);
        console.log(val);
      } catch (err) {
        process.stderr.write(`Error: ${err.message}\n`);
        process.exit(1);
      }
      break;
    }
    case 'delete': {
      const [key] = args;
      const msg = cmdDelete(key);
      // Route "Key not found" to stderr to allow shell scripts to detect missing keys
      if (msg.startsWith('Key not found')) {
        process.stderr.write(msg + '\n');
      } else {
        console.log(msg);
      }
      break;
    }
    case 'list': {
      const [prefix = ''] = args;
      const keys = cmdList(prefix);
      if (keys.length === 0 && prefix) {
        process.stderr.write(`No keys found with prefix: ${prefix}\n`);
      } else {
        keys.forEach(k => console.log(k));
      }
      break;
    }
    case 'list-values': {
      const [prefix = ''] = args;
      const pairs = cmdListValues(prefix);
      if (pairs.length === 0 && prefix) {
        process.stderr.write(`No keys found with prefix: ${prefix}\n`);
      } else {
        pairs.forEach(p => console.log(p));
      }
      break;
    }
    case 'exists': {
      const [key] = args;
      try {
        validateKey(key);
        // Exit 0/1 for shell-script-friendly boolean check
        process.exit(cmdExists(key) ? 0 : 1);
      } catch (err) {
        process.stderr.write(`Error: ${err.message}\n`);
        process.exit(1);
      }
      break;
    }
    case 'append': {
      const [key, value = ''] = args;
      try {
        cmdAppend(key, value);
      } catch (err) {
        process.stderr.write(`Error: ${err.message}\n`);
        process.exit(1);
      }
      break;
    }
    case 'incr': {
      const [key, amount = '1'] = args;
      try {
        const newVal = cmdIncr(key, parseInt(amount, 10));
        console.log(newVal);
      } catch (err) {
        process.stderr.write(`Error: ${err.message}\n`);
        process.exit(1);
      }
      break;
    }
    case 'help':
    case '-h':
    case '--help':
      printUsage();
      break;
    case undefined:
    case '':
      printUsage();
      process.exit(1);
      break;
    default:
      process.stderr.write(`Unknown command: ${cmd}\n`);
      printUsage();
      process.exit(1);
  }
}

// Guard: only run CLI dispatch when invoked directly, not when require()'d
if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
}

module.exports = { cmdSet, cmdGet, cmdDelete, cmdList, cmdListValues, cmdExists, cmdAppend, cmdIncr, STATE_DIR };
