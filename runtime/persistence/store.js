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

const STATE_DIR = path.join(
  process.env.CLAWPOWERS_DIR || path.join(os.homedir(), '.clawpowers'),
  'state'
);

function ensureDir() {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  }
}

function validateKey(key) {
  if (!key || key.length === 0) {
    throw new Error('key cannot be empty');
  }
  if (key.includes('/') || key.includes('\\')) {
    throw new Error(`key cannot contain '/' or '\\': ${key}`);
  }
  if (key.includes('..')) {
    throw new Error(`key cannot contain '..': ${key}`);
  }
}

// Convert key to safe filename (replace ':' with '__')
function keyToFile(key) {
  return path.join(STATE_DIR, key.replace(/:/g, '__'));
}

// Convert filename back to key (replace '__' with ':')
function fileToKey(filename) {
  return path.basename(filename).replace(/__/g, ':');
}

// Atomic write via temp file + rename
function atomicWrite(filepath, value) {
  const tmp = `${filepath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, value + '\n', { mode: 0o600 });
  fs.renameSync(tmp, filepath);
  // Ensure permissions on final file (rename preserves temp perms on most OSes)
  try { fs.chmodSync(filepath, 0o600); } catch (_) { /* non-fatal on Windows */ }
}

function cmdSet(key, value = '') {
  validateKey(key);
  ensureDir();
  atomicWrite(keyToFile(key), value);
}

function cmdGet(key, defaultVal) {
  const NOTSET = Symbol('NOTSET');
  const fallback = arguments.length >= 2 ? defaultVal : NOTSET;
  validateKey(key);
  ensureDir();

  const filepath = keyToFile(key);
  if (fs.existsSync(filepath)) {
    // Strip trailing newline that atomicWrite appends
    return fs.readFileSync(filepath, 'utf8').replace(/\n$/, '');
  }
  if (fallback !== NOTSET) {
    return fallback;
  }
  throw new Error(`key not found: ${key}`);
}

function cmdDelete(key) {
  validateKey(key);
  const filepath = keyToFile(key);
  if (fs.existsSync(filepath)) {
    fs.unlinkSync(filepath);
    return `Deleted: ${key}`;
  }
  return `Key not found (nothing deleted): ${key}`;
}

function cmdList(prefix = '') {
  ensureDir();
  const filePrefix = prefix.replace(/:/g, '__');
  const entries = fs.readdirSync(STATE_DIR);
  const keys = [];
  for (const entry of entries) {
    if (entry.startsWith(filePrefix)) {
      const fullPath = path.join(STATE_DIR, entry);
      if (fs.statSync(fullPath).isFile()) {
        keys.push(fileToKey(entry));
      }
    }
  }
  return keys;
}

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
        const value = fs.readFileSync(fullPath, 'utf8').replace(/\n$/, '');
        pairs.push(`${key}=${value}`);
      }
    }
  }
  return pairs;
}

function cmdExists(key) {
  validateKey(key);
  return fs.existsSync(keyToFile(key));
}

function cmdAppend(key, value = '') {
  validateKey(key);
  ensureDir();
  const filepath = keyToFile(key);
  if (fs.existsSync(filepath)) {
    fs.appendFileSync(filepath, value + '\n', { mode: 0o600 });
  } else {
    atomicWrite(filepath, value);
  }
}

function cmdIncr(key, amount = 1) {
  validateKey(key);
  ensureDir();
  const filepath = keyToFile(key);

  let current = 0;
  if (fs.existsSync(filepath)) {
    const raw = fs.readFileSync(filepath, 'utf8').trim();
    if (!/^-?[0-9]+$/.test(raw)) {
      throw new Error(`value is not an integer: ${raw}`);
    }
    current = parseInt(raw, 10);
  }

  const newVal = current + Number(amount);
  atomicWrite(filepath, String(newVal));
  return newVal;
}

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

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
}

module.exports = { cmdSet, cmdGet, cmdDelete, cmdList, cmdListValues, cmdExists, cmdAppend, cmdIncr, STATE_DIR };
