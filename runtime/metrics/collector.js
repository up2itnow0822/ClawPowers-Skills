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

// Metrics directory — monthly JSONL files are written here
const METRICS_DIR = path.join(
  process.env.CLAWPOWERS_DIR || path.join(os.homedir(), '.clawpowers'),
  'metrics'
);

// Accepted outcome values — any other value triggers a validation error
const VALID_OUTCOMES = new Set(['success', 'failure', 'partial', 'skipped']);

/**
 * Creates the metrics directory if it doesn't already exist.
 * Mode 0o700 restricts access to the current user only.
 */
function ensureDir() {
  if (!fs.existsSync(METRICS_DIR)) {
    fs.mkdirSync(METRICS_DIR, { recursive: true, mode: 0o700 });
  }
}

/**
 * Returns the path to the current month's JSONL log file.
 * Files are rotated monthly so individual files stay manageable and
 * historical data can be archived or deleted by month.
 *
 * Example output: ~/.clawpowers/metrics/2025-01.jsonl
 *
 * @returns {string} Absolute path to this month's log file.
 */
function currentLogfile() {
  const now = new Date();
  const year = now.getUTCFullYear();
  // Pad month to two digits: January = "01", not "1"
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return path.join(METRICS_DIR, `${year}-${month}.jsonl`);
}

/**
 * Returns an ISO 8601 timestamp without milliseconds.
 * Milliseconds are stripped for compactness in the JSONL records.
 *
 * @returns {string} e.g. "2025-01-15T12:00:00Z"
 */
function isoTimestamp() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Parses a flat --key value style argument array into an options object.
 * Every argument must be a --flag followed by its value; bare positional
 * arguments are rejected with an error.
 *
 * Example: ['--skill', 'my-skill', '--outcome', 'success'] → { skill: 'my-skill', outcome: 'success' }
 *
 * @param {string[]} argv - Array of argument strings.
 * @returns {Object.<string, string>} Parsed key-value pairs.
 * @throws {Error} If a flag is missing its value or an unknown positional argument is encountered.
 */
function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2); // Strip leading '--'
      const value = argv[i + 1];
      // A flag with no following value, or whose "value" is another flag, is invalid
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`Option ${arg} requires a value`);
      }
      opts[key] = value;
      i++; // Skip the consumed value
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return opts;
}

/**
 * `record` command — appends one JSONL record to the current month's log file.
 *
 * Required options: --skill, --outcome
 * Optional options: --duration, --notes, --session-id
 *
 * @param {string[]} argv - Argument array after 'record' (e.g. ['--skill', 'foo', '--outcome', 'success']).
 * @throws {Error} If required fields are missing or values are invalid.
 */
function cmdRecord(argv) {
  const opts = parseArgs(argv);

  // Validate required fields before touching the filesystem
  if (!opts.skill) throw new Error('--skill is required');
  if (!opts.outcome) throw new Error('--outcome is required (success|failure|partial|skipped)');
  if (!VALID_OUTCOMES.has(opts.outcome)) {
    throw new Error(`--outcome must be success, failure, partial, or skipped`);
  }

  // Duration is optional, but if provided it must be a non-negative number
  const duration = opts.duration !== undefined ? opts.duration : null;
  if (duration !== null && !/^\d+(\.\d+)?$/.test(duration)) {
    throw new Error('--duration must be a number (seconds)');
  }

  ensureDir();

  // Build the record object — only include optional fields when provided
  const record = {
    ts: isoTimestamp(),
    skill: opts.skill,
    outcome: opts.outcome,
  };

  if (duration !== null) record.duration_s = parseFloat(duration);
  if (opts.notes) record.notes = opts.notes;
  // 'session-id' CLI arg maps to 'session' in the stored record for brevity
  if (opts['session-id']) record.session = opts['session-id'];

  const jsonLine = JSON.stringify(record);
  const logfile = currentLogfile();

  // appendFileSync is safe here — each append is a complete JSON line
  fs.appendFileSync(logfile, jsonLine + '\n');
  // Restrict log file to owner-only access (may already be set; non-fatal on Windows)
  try { fs.chmodSync(logfile, 0o600); } catch (_) { /* non-fatal on Windows */ }

  console.log(`Recorded: ${opts.skill} → ${opts.outcome} (${path.basename(logfile)})`);
}

/**
 * Reads all JSONL metric records from every monthly log file, optionally
 * filtering to a single skill. Records are returned in chronological order
 * (files are sorted by filename which is YYYY-MM.jsonl).
 *
 * Malformed JSON lines are silently skipped rather than crashing — log files
 * may be partially corrupted without invalidating the rest of the data.
 *
 * @param {string} [skillFilter=''] - If non-empty, only return records for this skill.
 * @returns {Object[]} Array of parsed record objects in chronological order.
 */
function loadAllLines(skillFilter) {
  if (!fs.existsSync(METRICS_DIR)) return [];

  // Sort filenames so we read records in chronological order (YYYY-MM.jsonl sorts lexicographically)
  const files = fs.readdirSync(METRICS_DIR)
    .filter(f => f.endsWith('.jsonl'))
    .sort()
    .map(f => path.join(METRICS_DIR, f));

  const lines = [];
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    for (const line of content.split('\n')) {
      if (!line.trim()) continue; // Skip blank lines between records
      try {
        const record = JSON.parse(line);
        if (skillFilter && record.skill !== skillFilter) continue;
        lines.push(record);
      } catch (_) {
        // Skip malformed lines — don't crash on a single bad record
      }
    }
  }
  return lines;
}

/**
 * `show` command — prints recent execution records as JSON lines to stdout.
 * Supports optional skill filter and record limit.
 *
 * @param {string[]} argv - Argument array (e.g. ['--skill', 'foo', '--limit', '10']).
 */
function cmdShow(argv) {
  const opts = parseArgs(argv);
  const skillFilter = opts.skill || '';
  const limit = opts.limit ? parseInt(opts.limit, 10) : 20;

  ensureDir();
  const lines = loadAllLines(skillFilter);
  // Show the last `limit` records — tail semantics (most recent first makes no sense for a log)
  const slice = lines.slice(Math.max(0, lines.length - limit));
  slice.forEach(record => console.log(JSON.stringify(record)));
}

/**
 * Computes aggregate statistics from an array of metric records.
 * Duration statistics are computed only over records that include a duration_s field.
 *
 * @param {Object[]} lines - Array of parsed JSONL records.
 * @returns {{total: number, success: number, failure: number, partial: number,
 *            skipped: number, rate: number, avgDuration: number}} Statistics object.
 *   `rate` is the success percentage (0-100). `avgDuration` is -1 if no durations were recorded.
 */
function computeStats(lines) {
  let success = 0, failure = 0, partial = 0, skipped = 0;
  let totalDuration = 0, durationCount = 0;

  for (const r of lines) {
    if (r.outcome === 'success') success++;
    else if (r.outcome === 'failure') failure++;
    else if (r.outcome === 'partial') partial++;
    else if (r.outcome === 'skipped') skipped++;

    // Only include records with a valid non-negative duration in the average
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

/**
 * `summary` command — prints aggregated statistics to stdout.
 * When no skill filter is provided, also prints a per-skill breakdown.
 *
 * @param {string[]} argv - Argument array (e.g. ['--skill', 'foo']).
 */
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

  // Format percentages as integers — floating point noise isn't meaningful here
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
    // Per-skill breakdown — shows which skills have been used most
    const skillCounts = {};
    for (const r of lines) {
      skillCounts[r.skill] = (skillCounts[r.skill] || 0) + 1;
    }
    console.log('\nSkill breakdown:');
    // Sort alphabetically for consistent output
    for (const [skill, count] of Object.entries(skillCounts).sort()) {
      console.log(`  ${skill}: ${count}`);
    }
  }
}

/**
 * Prints usage information for the collector CLI to stdout.
 */
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

/**
 * CLI dispatch — routes argv to the appropriate command function.
 *
 * @param {string[]} argv - Argument array (typically process.argv.slice(2)).
 */
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

// Guard: only run CLI dispatch when invoked directly, not when require()'d
if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
}

module.exports = { cmdRecord, cmdShow, cmdSummary, loadAllLines, computeStats, METRICS_DIR };
