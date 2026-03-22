#!/usr/bin/env node
// bin/clawpowers.js — Cross-platform CLI entry point
//
// Commands: init, status, update, inject, metrics, analyze, store
// Works on Windows CMD, PowerShell, macOS, Linux.
// Zero npm dependencies — only Node.js built-ins.
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');

// __dirname is the bin/ directory; repo root is one level up
const SCRIPT_DIR = __dirname;
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');

// Runtime data directory — override with CLAWPOWERS_DIR env var for testing
const CLAWPOWERS_DIR = process.env.CLAWPOWERS_DIR || path.join(os.homedir(), '.clawpowers');

// Absolute paths to each runtime module — resolved once at startup so
// error messages can include the full path if a module is missing
const INIT_JS       = path.join(REPO_ROOT, 'runtime', 'init.js');
const ANALYZE_JS    = path.join(REPO_ROOT, 'runtime', 'feedback', 'analyze.js');
const STORE_JS      = path.join(REPO_ROOT, 'runtime', 'persistence', 'store.js');
const COLLECTOR_JS  = path.join(REPO_ROOT, 'runtime', 'metrics', 'collector.js');
const SESSION_JS    = path.join(REPO_ROOT, 'hooks', 'session-start.js');

/**
 * Prints the top-level command usage to stdout.
 * Called when no command is given or when 'help'/'-h'/'--help' is passed.
 */
function printUsage() {
  console.log(`Usage: clawpowers <command> [args]

Commands:
  init               Initialize ClawPowers runtime in ~/.clawpowers/
  status             Show runtime health and skill metrics summary
  update             Pull latest skill definitions from repo
  inject             Inject using-clawpowers skill into current session context
  metrics <cmd>      Record or query skill execution metrics
  analyze [opts]     RSI feedback analysis of skill performance
  store <cmd>        Key-value state store operations

Examples:
  npx clawpowers init
  npx clawpowers status
  npx clawpowers metrics record --skill my-skill --outcome success
  npx clawpowers metrics summary
  npx clawpowers analyze --skill systematic-debugging
  npx clawpowers store set "my:key" "my value"
  npx clawpowers store get "my:key"

Run 'npx clawpowers <command> help' for command-specific help.`);
}

/**
 * Safely require() a runtime module, exiting with a helpful error if the
 * file doesn't exist (i.e., user hasn't run `init` yet).
 *
 * @param {string} filepath - Absolute path to the module to load.
 * @returns {object} The module's exports.
 */
function requireModule(filepath) {
  if (!fs.existsSync(filepath)) {
    process.stderr.write(`Error: runtime module not found: ${filepath}\n`);
    process.stderr.write('Try running: npx clawpowers init\n');
    process.exit(1);
  }
  return require(filepath);
}

/**
 * `clawpowers init` — Set up ~/.clawpowers/ directory structure.
 * Delegates to runtime/init.js which is idempotent (safe to run repeatedly).
 */
function cmdInit() {
  console.log('Initializing ClawPowers runtime...');
  const init = requireModule(INIT_JS);
  init.main();
}

/**
 * `clawpowers status` — Show runtime health and full RSI analysis.
 * Requires the runtime to be initialized; exits with an error if not.
 */
function cmdStatus() {
  if (!fs.existsSync(CLAWPOWERS_DIR)) {
    process.stderr.write('Runtime not initialized. Run: npx clawpowers init\n');
    process.exit(1);
  }
  const analyze = requireModule(ANALYZE_JS);
  analyze.cmdFullAnalysis();
}

/**
 * `clawpowers update` — Pull the latest skill definitions from the GitHub repo.
 * Uses git fast-forward only to avoid overwriting local modifications.
 * Falls back gracefully if git is not installed.
 */
function cmdUpdate() {
  const repoUrl = 'https://github.com/up2itnow0822/clawpowers';
  const result = spawnSync('git', ['-C', REPO_ROOT, 'pull', '--ff-only', 'origin', 'main'], {
    stdio: 'inherit',
    // On Windows, git must be launched through the shell so PATH is resolved
    shell: os.platform() === 'win32',
  });

  if (result.error) {
    // git binary not found or OS-level spawn error
    console.log(`git not found or failed. Visit ${repoUrl} to update manually.`);
  } else if (result.status !== 0) {
    console.log(`Warning: could not auto-update. Visit ${repoUrl} for latest.`);
  } else {
    console.log('Pulling latest skill definitions...');
  }
}

/**
 * `clawpowers inject` — Run the session-start hook to inject the
 * using-clawpowers skill into the current AI platform session.
 * Spawns hooks/session-start.js as a child process so it inherits stdio.
 */
function cmdInject() {
  const result = spawnSync(process.execPath, [SESSION_JS], {
    stdio: 'inherit',
  });
  if (result.error) {
    process.stderr.write(`Error running session-start.js: ${result.error.message}\n`);
    process.exit(1);
  }
  process.exit(result.status || 0);
}

/**
 * `clawpowers metrics <subcmd> [args]` — Delegate to collector.js.
 * Supported subcommands: record, show, summary.
 *
 * @param {string[]} args - Remaining argv after 'metrics'.
 */
function cmdMetrics(args) {
  const collector = requireModule(COLLECTOR_JS);
  const [subcmd, ...rest] = args;

  // No subcommand or explicit help request: print metrics-specific usage
  if (!subcmd || subcmd === 'help' || subcmd === '--help' || subcmd === '-h') {
    printCollectorUsage();
    return;
  }

  const mod = requireModule(COLLECTOR_JS);

  switch (subcmd) {
    case 'record':
      // cmdRecord expects the remaining args array (e.g. ['--skill', 'foo', '--outcome', 'success'])
      mod.cmdRecord ? mod.cmdRecord(rest) : delegateToNode(COLLECTOR_JS, ['record', ...rest]);
      break;
    case 'show':
      mod.cmdShow ? mod.cmdShow(rest) : delegateToNode(COLLECTOR_JS, ['show', ...rest]);
      break;
    case 'summary':
      mod.cmdSummary ? mod.cmdSummary(rest) : delegateToNode(COLLECTOR_JS, ['summary', ...rest]);
      break;
    default:
      process.stderr.write(`Unknown metrics subcommand: ${subcmd}\n`);
      printCollectorUsage();
      process.exit(1);
  }
}

/**
 * Prints usage information for the `metrics` sub-command group.
 */
function printCollectorUsage() {
  console.log(`Usage: clawpowers metrics <command> [options]

Commands:
  record   Record a skill execution outcome
  show     Show recent execution records
  summary  Show aggregated statistics

record options:
  --skill <name>         Skill name (required)
  --outcome <result>     success | failure | partial | skipped (required)
  --duration <seconds>   Execution time in seconds
  --notes <text>         Notes about this execution
  --session-id <id>      Session identifier`);
}

/**
 * `clawpowers analyze [flag] [value]` — RSI feedback analysis.
 * Dispatches to the appropriate analyze.js function based on the flag.
 *
 * @param {string[]} args - Remaining argv after 'analyze'.
 */
function cmdAnalyze(args) {
  const analyze = requireModule(ANALYZE_JS);
  const [flag, value] = args;

  switch (flag) {
    case '--skill':           analyze.cmdSkillAnalysis(value); break;
    case '--plan':            analyze.cmdPlanAnalysis(value); break;
    case '--worktrees':       analyze.cmdWorktreeReport(); break;
    case '--recommendations': analyze.cmdRecommendations(); break;
    // --format accepts a format name but human-readable is the only current output
    case '--format':          analyze.cmdFullAnalysis(); break;
    case 'help':
    case '-h':
    case '--help':            printAnalyzeUsage(); break;
    // No flag = full analysis of all skills
    case undefined:
    case '':                  analyze.cmdFullAnalysis(); break;
    default:
      process.stderr.write(`Unknown analyze option: ${flag}\n`);
      printAnalyzeUsage();
      process.exit(1);
  }
}

/**
 * Prints usage information for the `analyze` sub-command.
 */
function printAnalyzeUsage() {
  console.log(`Usage: clawpowers analyze [options]

Options:
  (no args)                Full analysis of all skills
  --skill <name>           Analysis for one specific skill
  --plan <name>            Plan execution analysis
  --worktrees              Worktree lifecycle report
  --recommendations        Show improvement recommendations only
  --format json            JSON output (default: human-readable)`);
}

/**
 * `clawpowers store <subcmd> [args]` — Key-value state store operations.
 * Maps CLI subcommands to store.js exported functions.
 *
 * @param {string[]} args - Remaining argv after 'store'.
 */
function cmdStore(args) {
  const store = requireModule(STORE_JS);
  const [subcmd, ...rest] = args;

  if (!subcmd || subcmd === 'help' || subcmd === '--help' || subcmd === '-h') {
    printStoreUsage();
    return;
  }

  try {
    switch (subcmd) {
      case 'set':
        // rest[1] may be undefined for empty-string value; default to ''
        store.cmdSet(rest[0], rest[1] !== undefined ? rest[1] : '');
        break;

      case 'get': {
        // Pass default value only when it was explicitly supplied (args.length >= 2)
        let val;
        try {
          val = rest.length >= 2 ? store.cmdGet(rest[0], rest[1]) : store.cmdGet(rest[0]);
          console.log(val);
        } catch (err) {
          process.stderr.write(`Error: ${err.message}\n`);
          process.exit(1);
        }
        break;
      }

      case 'delete': {
        const msg = store.cmdDelete(rest[0]);
        // cmdDelete returns a "Key not found" prefix for missing keys — route to stderr
        if (msg.startsWith('Key not found')) process.stderr.write(msg + '\n');
        else console.log(msg);
        break;
      }

      case 'list': {
        const keys = store.cmdList(rest[0] || '');
        if (keys.length === 0 && rest[0]) {
          process.stderr.write(`No keys found with prefix: ${rest[0]}\n`);
        } else {
          keys.forEach(k => console.log(k));
        }
        break;
      }

      case 'list-values': {
        const pairs = store.cmdListValues(rest[0] || '');
        if (pairs.length === 0 && rest[0]) {
          process.stderr.write(`No keys found with prefix: ${rest[0]}\n`);
        } else {
          pairs.forEach(p => console.log(p));
        }
        break;
      }

      case 'exists': {
        // Exit 0 if key exists, exit 1 if not — compatible with shell conditionals
        const exists = store.cmdExists(rest[0]);
        process.exit(exists ? 0 : 1);
        break;
      }

      case 'append':
        store.cmdAppend(rest[0], rest[1] !== undefined ? rest[1] : '');
        break;

      case 'incr': {
        // Parse increment amount as base-10 integer; defaults to 1 inside cmdIncr
        const newVal = store.cmdIncr(rest[0], rest[1] !== undefined ? parseInt(rest[1], 10) : 1);
        console.log(newVal);
        break;
      }

      default:
        process.stderr.write(`Unknown store command: ${subcmd}\n`);
        printStoreUsage();
        process.exit(1);
    }
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
}

/**
 * Prints usage information for the `store` sub-command group.
 */
function printStoreUsage() {
  console.log(`Usage: clawpowers store <command> [args]

Commands:
  set <key> <value>        Set a key-value pair
  get <key> [default]      Get value (returns default or error if not found)
  delete <key>             Delete a key
  list [prefix]            List all keys matching prefix
  list-values [prefix]     List key=value pairs matching prefix
  exists <key>             Exit 0 if key exists, 1 if not
  append <key> <value>     Append value (newline-separated)
  incr <key> [amount]      Increment integer value by amount (default: 1)

Key format: namespace:entity:attribute`);
}

/**
 * Fallback dispatcher: spawn `node <script> [...args]` as a child process.
 * Used when a module function isn't directly exported but can be triggered
 * via its CLI entry point.
 *
 * @param {string} script - Absolute path to the Node.js script to run.
 * @param {string[]} args - Arguments to forward to the script.
 */
function delegateToNode(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], { stdio: 'inherit' });
  process.exit(result.status || 0);
}

// ============================================================
// Main dispatch — parse the first positional argument as the command
// ============================================================
const [cmd, ...args] = process.argv.slice(2);

try {
  switch (cmd) {
    case 'init':    cmdInit(); break;
    case 'status':  cmdStatus(); break;
    case 'update':  cmdUpdate(); break;
    case 'inject':  cmdInject(); break;
    case 'metrics': cmdMetrics(args); break;
    case 'analyze': cmdAnalyze(args); break;
    case 'store':   cmdStore(args); break;
    case 'help':
    case '-h':
    case '--help':  printUsage(); break;
    // No command or empty string: show usage and exit 1 (non-zero for scripts)
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
} catch (err) {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
}
