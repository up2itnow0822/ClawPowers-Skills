#!/usr/bin/env node
// runtime/metrics/collector.js — Skill execution outcome tracking
//
// Appends one JSON line per skill execution to ~/.clawpowers/metrics/YYYY-MM.jsonl
// Each line records: skill name, timestamp, duration, outcome, and notes.
//
// Usage:
//   node collector.js record --skill <name> --outcome <success|failure|partial|skipped> [options]
//   node collector.js show [--skill <name>] [--limit <n>]
//   node collector.js summary [--skill <name>]
//
// Options for record:
//   --skill <name>         Skill name (required)
//   --outcome <result>     success, failure, partial, or skipped (required)
//   --duration <seconds>   Execution duration in seconds (optional)
//   --notes <text>         Free-text notes about this execution (optional)
//   --session-id <id>      Session identifier for grouping (optional)
//
// Output format (one JSON line per execution):
//   {"ts":"ISO8601","skill":"name","outcome":"success","duration_s":47,"notes":"...","session":"..."}
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const METRICS_DIR = path.join(
  process.env.CLAWPOWERS_DIR || path.join(os.homedir(), '.clawpowers'),
  'metrics'
);

const VALID_OUTCOMES = new Set(['success', 'failure', 'partial', 'skipped']);

function ensureDir() {
  if (!fs.existsSync(METRICS_DIR)) {
    fs.mkdirSync(METRICS_DIR, { recursive: true, mode: 0o700 });
  }
}

function currentLogfile() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return path.join(METRICS_DIR, `${year}-${month}.jsonl`);
}

function isoTimestamp() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// Parse key=value style args like --skill foo --outcome success
function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`Option ${arg} requires a value`);
      }
      opts[key] = value;
      i++;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return opts;
}

function cmdRecord(argv) {
  const opts = parseArgs(argv);

  if (!opts.skill) throw new Error('--skill is required');
  if (!opts.outcome) throw new Error('--outcome is required (success|failure|partial|skipped)');
  if (!VALID_OUTCOMES.has(opts.outcome)) {
    throw new Error(`--outcome must be success, failure, partial, or skipped`);
  }

  const duration = opts.duration !== undefined ? opts.duration : null;
  if (duration !== null && !/^\d+(\.\d+)?$/.test(duration)) {
    throw new Error('--duration must be a number (seconds)');
  }

  ensureDir();

  const record = {
    ts: isoTimestamp(),
    skill: opts.skill,
    outcome: opts.outcome,
  };

  if (duration !== null) record.duration_s = parseFloat(duration);
  if (opts.notes) record.notes = opts.notes;
  if (opts['session-id']) record.session = opts['session-id'];

  const jsonLine = JSON.stringify(record);
  const logfile = currentLogfile();

  fs.appendFileSync(logfile, jsonLine + '\n');
  try { fs.chmodSync(logfile, 0o600); } catch (_) { /* non-fatal on Windows */ }

  console.log(`Recorded: ${opts.skill} → ${opts.outcome} (${path.basename(logfile)})`);
}

function loadAllLines(skillFilter) {
  if (!fs.existsSync(METRICS_DIR)) return [];

  const files = fs.readdirSync(METRICS_DIR)
    .filter(f => f.endsWith('.jsonl'))
    .sort()
    .map(f => path.join(METRICS_DIR, f));

  const lines = [];
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line);
        if (skillFilter && record.skill !== skillFilter) continue;
        lines.push(record);
      } catch (_) {
        // Skip malformed lines
      }
    }
  }
  return lines;
}

function cmdShow(argv) {
  const opts = parseArgs(argv);
  const skillFilter = opts.skill || '';
  const limit = opts.limit ? parseInt(opts.limit, 10) : 20;

  ensureDir();
  const lines = loadAllLines(skillFilter);
  const slice = lines.slice(Math.max(0, lines.length - limit));
  slice.forEach(record => console.log(JSON.stringify(record)));
}

function computeStats(lines) {
  let success = 0, failure = 0, partial = 0, skipped = 0;
  let totalDuration = 0, durationCount = 0;

  for (const r of lines) {
    if (r.outcome === 'success') success++;
    else if (r.outcome === 'failure') failure++;
    else if (r.outcome === 'partial') partial++;
    else if (r.outcome === 'skipped') skipped++;

    if (typeof r.duration_s === 'number' && r.duration_s >= 0) {
      totalDuration += r.duration_s;
      durationCount++;
    }
  }

  const total = lines.length;
  const rate = total > 0 ? Math.round(success / total * 100) : 0;
  const avgDuration = durationCount > 0 ? Math.round(totalDuration / durationCount) : -1;

  return { total, success, failure, partial, skipped, rate, avgDuration };
}

function cmdSummary(argv) {
  const opts = parseArgs(argv);
  const skillFilter = opts.skill || '';

  ensureDir();
  const lines = loadAllLines(skillFilter);

  if (lines.length === 0) {
    console.log(`No metrics recorded${skillFilter ? ` for skill: ${skillFilter}` : ''}`);
    return;
  }

  const stats = computeStats(lines);

  console.log(`Total executions: ${stats.total}`);
  console.log(`  Success: ${stats.success} (${stats.rate}%)`);
  console.log(`  Failure: ${stats.failure} (${Math.round(stats.failure / stats.total * 100)}%)`);
  console.log(`  Partial: ${stats.partial} (${Math.round(stats.partial / stats.total * 100)}%)`);
  if (stats.skipped > 0) {
    console.log(`  Skipped: ${stats.skipped} (${Math.round(stats.skipped / stats.total * 100)}%)`);
  }
  if (stats.avgDuration >= 0) {
    console.log(`Avg duration: ${stats.avgDuration}s`);
  }

  if (!skillFilter) {
    // Skill breakdown
    const skillCounts = {};
    for (const r of lines) {
      skillCounts[r.skill] = (skillCounts[r.skill] || 0) + 1;
    }
    console.log('\nSkill breakdown:');
    for (const [skill, count] of Object.entries(skillCounts).sort()) {
      console.log(`  ${skill}: ${count}`);
    }
  }
}

function printUsage() {
  console.log(`Usage: collector.js <command> [options]

Commands:
  record   Record a skill execution outcome
  show     Show recent execution records
  summary  Show aggregated statistics

record options:
  --skill <name>         Skill name (required)
  --outcome <result>     success | failure | partial | skipped (required)
  --duration <seconds>   Execution time in seconds
  --notes <text>         Notes about this execution
  --session-id <id>      Session identifier

Examples:
  collector.js record --skill systematic-debugging --outcome success --duration 1800 \\
    --notes "payment-pool: 3 hypotheses, root cause found in git bisect"

  collector.js show --skill test-driven-development --limit 10

  collector.js summary
  collector.js summary --skill systematic-debugging`);
}

function main(argv) {
  const [cmd, ...rest] = argv;

  switch (cmd) {
    case 'record':
      cmdRecord(rest);
      break;
    case 'show':
      cmdShow(rest);
      break;
    case 'summary':
      cmdSummary(rest);
      break;
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

module.exports = { cmdRecord, cmdShow, cmdSummary, loadAllLines, computeStats, METRICS_DIR };
