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

const SCRIPT_DIR = __dirname;
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const CLAWPOWERS_DIR = process.env.CLAWPOWERS_DIR || path.join(os.homedir(), '.clawpowers');

// Resolve runtime module paths
const INIT_JS       = path.join(REPO_ROOT, 'runtime', 'init.js');
const ANALYZE_JS    = path.join(REPO_ROOT, 'runtime', 'feedback', 'analyze.js');
const STORE_JS      = path.join(REPO_ROOT, 'runtime', 'persistence', 'store.js');
const COLLECTOR_JS  = path.join(REPO_ROOT, 'runtime', 'metrics', 'collector.js');
const SESSION_JS    = path.join(REPO_ROOT, 'hooks', 'session-start.js');

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

function requireModule(filepath) {
  if (!fs.existsSync(filepath)) {
    process.stderr.write(`Error: runtime module not found: ${filepath}\n`);
    process.stderr.write('Try running: npx clawpowers init\n');
    process.exit(1);
  }
  return require(filepath);
}

function cmdInit() {
  console.log('Initializing ClawPowers runtime...');
  const init = requireModule(INIT_JS);
  init.main();
}

function cmdStatus() {
  if (!fs.existsSync(CLAWPOWERS_DIR)) {
    process.stderr.write('Runtime not initialized. Run: npx clawpowers init\n');
    process.exit(1);
  }
  const analyze = requireModule(ANALYZE_JS);
  analyze.cmdFullAnalysis();
}

function cmdUpdate() {
  const repoUrl = 'https://github.com/up2itnow0822/clawpowers';
  const result = spawnSync('git', ['-C', REPO_ROOT, 'pull', '--ff-only', 'origin', 'main'], {
    stdio: 'inherit',
    shell: os.platform() === 'win32',
  });

  if (result.error) {
    // git not available or command failed
    console.log(`git not found or failed. Visit ${repoUrl} to update manually.`);
  } else if (result.status !== 0) {
    console.log(`Warning: could not auto-update. Visit ${repoUrl} for latest.`);
  } else {
    console.log('Pulling latest skill definitions...');
  }
}

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

function cmdMetrics(args) {
  // Delegate all args directly to collector.js
  const collector = requireModule(COLLECTOR_JS);
  const [subcmd, ...rest] = args;

  if (!subcmd || subcmd === 'help' || subcmd === '--help' || subcmd === '-h') {
    // Let collector print its own usage
    const saved = process.argv;
    process.argv = [process.argv[0], COLLECTOR_JS, ...(subcmd ? [subcmd] : [])];
    try {
      collector.cmdShow ? undefined : undefined; // just ensure module loaded
    } finally {
      process.argv = saved;
    }
    // Call main directly
    require(COLLECTOR_JS); // side-effect: module is cached; re-invoke main
    const mod = require(COLLECTOR_JS);
    // Inline dispatch since we can't re-run main cleanly
    const { cmdRecord, cmdShow, cmdSummary } = mod;
    printCollectorUsage();
    return;
  }

  const mod = requireModule(COLLECTOR_JS);

  switch (subcmd) {
    case 'record':
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

function cmdAnalyze(args) {
  const analyze = requireModule(ANALYZE_JS);
  const [flag, value] = args;

  switch (flag) {
    case '--skill':          analyze.cmdSkillAnalysis(value); break;
    case '--plan':           analyze.cmdPlanAnalysis(value); break;
    case '--worktrees':      analyze.cmdWorktreeReport(); break;
    case '--recommendations': analyze.cmdRecommendations(); break;
    case '--format':         analyze.cmdFullAnalysis(); break;
    case 'help':
    case '-h':
    case '--help':           printAnalyzeUsage(); break;
    case undefined:
    case '':                 analyze.cmdFullAnalysis(); break;
    default:
      process.stderr.write(`Unknown analyze option: ${flag}\n`);
      printAnalyzeUsage();
      process.exit(1);
  }
}

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

function cmdStore(args) {
  const store = requireModule(STORE_JS);
  const [subcmd, ...rest] = args;

  if (!subcmd || subcmd === 'help' || subcmd === '--help' || subcmd === '-h') {
    printStoreUsage();
    return;
  }

  // Map subcommands to store module functions
  try {
    switch (subcmd) {
      case 'set':
        store.cmdSet(rest[0], rest[1] !== undefined ? rest[1] : '');
        break;
      case 'get': {
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
        const exists = store.cmdExists(rest[0]);
        process.exit(exists ? 0 : 1);
        break;
      }
      case 'append':
        store.cmdAppend(rest[0], rest[1] !== undefined ? rest[1] : '');
        break;
      case 'incr': {
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

// Fallback: spawn node <script> with args as a child process
function delegateToNode(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], { stdio: 'inherit' });
  process.exit(result.status || 0);
}

// Main dispatch
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
