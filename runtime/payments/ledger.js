#!/usr/bin/env node
// runtime/payments/ledger.js — Payment decision ledger
//
// Records every payment decision (approve, deny, dry-run) to a persistent
// JSONL log at ~/.clawpowers/logs/payments.jsonl. Provides CLI commands to
// review recent decisions and summarize spending by skill, chain, and outcome.
//
// Usage (CLI):
//   node ledger.js log [--limit <n>]
//   node ledger.js summary
//
// Usage (module):
//   const { logPaymentDecision, getPaymentSummary } = require('./ledger');
//   await logPaymentDecision({ skill: 'agent-payments', url: '...', ... });
//   const summary = getPaymentSummary();
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// Logs directory — contains payments.jsonl and other audit logs
const LOGS_DIR = path.join(
  process.env.CLAWPOWERS_DIR || path.join(os.homedir(), '.clawpowers'),
  'logs'
);

/** Absolute path to the payment ledger file. */
const LEDGER_FILE = path.join(LOGS_DIR, 'payments.jsonl');

/**
 * Creates the logs directory if it doesn't already exist.
 * Mode 0o700 restricts access to the current user only.
 */
function ensureLogsDir() {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true, mode: 0o700 });
  }
}

/**
 * Returns an ISO 8601 timestamp without milliseconds.
 *
 * @returns {string} e.g. "2026-03-22T21:42:00Z"
 */
function isoTimestamp() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Records a payment decision to the JSONL ledger.
 *
 * Each entry captures what happened at a payment gate: the skill that
 * encountered the payment requirement, the URL that required payment,
 * the amount and asset, the policy evaluation result, and whether payment
 * would have been (or was) made.
 *
 * The entry is appended as a single JSON line to `~/.clawpowers/logs/payments.jsonl`.
 * The file is created if it doesn't exist.
 *
 * @param {object} entry - Payment decision details.
 * @param {string} [entry.skill='unknown'] - Skill that triggered the payment gate.
 * @param {string} [entry.type='decision'] - Entry type: 'decision' | 'payment' | 'denial'.
 * @param {string} [entry.url=''] - Resource URL that required payment.
 * @param {string} [entry.required_amount='0'] - Amount required (in smallest asset unit).
 * @param {string} [entry.asset='USDC'] - Asset symbol (e.g. 'USDC', 'ETH').
 * @param {string} [entry.chain='base'] - Chain name (e.g. 'base', 'base-sepolia').
 * @param {string} [entry.policy_result='dry_run'] - Policy outcome: 'dry_run' | 'approved' | 'denied' | 'disabled'.
 * @param {string} [entry.reason=''] - Human-readable reason for the policy result.
 * @param {boolean} [entry.would_have_paid=false] - Whether payment would have succeeded if live.
 * @returns {object} The complete entry as written to the ledger (including timestamp).
 */
function logPaymentDecision(entry) {
  ensureLogsDir();

  /** @type {object} Full ledger record with timestamp and defaults applied. */
  const record = {
    timestamp: isoTimestamp(),
    skill: entry.skill || 'unknown',
    type: entry.type || 'decision',
    url: entry.url || '',
    required_amount: entry.required_amount || '0',
    asset: entry.asset || 'USDC',
    chain: entry.chain || 'base',
    policy_result: entry.policy_result || 'dry_run',
    reason: entry.reason || '',
    would_have_paid: Boolean(entry.would_have_paid),
  };

  // Append as a single JSON line — safe for concurrent appends
  const line = JSON.stringify(record) + '\n';
  fs.appendFileSync(LEDGER_FILE, line);
  try { fs.chmodSync(LEDGER_FILE, 0o600); } catch (_) { /* non-fatal on Windows */ }

  return record;
}

/**
 * Reads all payment decision records from the ledger.
 * Malformed JSON lines are silently skipped.
 *
 * @returns {object[]} Array of parsed ledger records in chronological order.
 */
function loadLedger() {
  if (!fs.existsSync(LEDGER_FILE)) return [];

  const content = fs.readFileSync(LEDGER_FILE, 'utf8');
  const records = [];
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch (_) {
      // Skip malformed lines — don't crash on a single bad record
    }
  }
  return records;
}

/**
 * Computes a payment summary aggregated by skill, chain, and policy outcome.
 *
 * Returns totals broken down by:
 * - Skill name: which skills hit payment gates most often
 * - Chain: which networks were targeted for payment
 * - Outcome: how many were dry_run vs approved vs denied vs disabled
 *
 * @returns {{
 *   total: number,
 *   by_skill: Object.<string, number>,
 *   by_chain: Object.<string, number>,
 *   by_outcome: Object.<string, number>,
 *   would_have_paid: number,
 *   records: object[]
 * }} Aggregated summary object.
 */
function getPaymentSummary() {
  const records = loadLedger();

  /** @type {Object.<string, number>} Count per skill name. */
  const by_skill = {};
  /** @type {Object.<string, number>} Count per chain name. */
  const by_chain = {};
  /** @type {Object.<string, number>} Count per policy_result value. */
  const by_outcome = {};
  let would_have_paid = 0;

  for (const r of records) {
    // Tally by skill
    by_skill[r.skill] = (by_skill[r.skill] || 0) + 1;
    // Tally by chain
    by_chain[r.chain] = (by_chain[r.chain] || 0) + 1;
    // Tally by outcome
    by_outcome[r.policy_result] = (by_outcome[r.policy_result] || 0) + 1;
    // Count would-have-paid scenarios (dry-run hits)
    if (r.would_have_paid) would_have_paid++;
  }

  return {
    total: records.length,
    by_skill,
    by_chain,
    by_outcome,
    would_have_paid,
    records,
  };
}

/**
 * `log` CLI command — prints recent payment decisions to stdout.
 * Defaults to the last 20 records. Use --limit to change.
 *
 * @param {string[]} argv - Arguments after 'log'.
 */
function cmdLog(argv) {
  // Parse optional --limit flag
  let limit = 20;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--limit' && argv[i + 1]) {
      limit = parseInt(argv[i + 1], 10);
      i++;
    }
  }

  const records = loadLedger();
  if (records.length === 0) {
    console.log('No payment decisions recorded yet.');
    console.log(`Ledger location: ${LEDGER_FILE}`);
    return;
  }

  const slice = records.slice(Math.max(0, records.length - limit));
  console.log(`Recent payment decisions (last ${slice.length} of ${records.length}):`);
  console.log('');
  for (const r of slice) {
    const paid = r.would_have_paid ? '[would pay]' : '[would skip]';
    console.log(`  ${r.timestamp} | ${r.skill} | ${r.policy_result} ${paid}`);
    if (r.url) console.log(`    URL: ${r.url}`);
    if (r.required_amount !== '0') {
      console.log(`    Amount: ${r.required_amount} ${r.asset} on ${r.chain}`);
    }
    if (r.reason) console.log(`    Reason: ${r.reason}`);
    console.log('');
  }
}

/**
 * `summary` CLI command — prints aggregated payment totals to stdout.
 * Shows totals by skill, chain, and outcome.
 */
function cmdSummary() {
  const summary = getPaymentSummary();

  if (summary.total === 0) {
    console.log('No payment decisions recorded yet.');
    console.log(`Ledger location: ${LEDGER_FILE}`);
    return;
  }

  console.log(`Payment Decision Summary`);
  console.log(`========================`);
  console.log(`Total decisions: ${summary.total}`);
  console.log(`Would have paid: ${summary.would_have_paid}`);
  console.log('');

  console.log('By skill:');
  for (const [skill, count] of Object.entries(summary.by_skill).sort()) {
    console.log(`  ${skill}: ${count}`);
  }
  console.log('');

  console.log('By chain:');
  for (const [chain, count] of Object.entries(summary.by_chain).sort()) {
    console.log(`  ${chain}: ${count}`);
  }
  console.log('');

  console.log('By outcome:');
  for (const [outcome, count] of Object.entries(summary.by_outcome).sort()) {
    const pct = Math.round(count / summary.total * 100);
    console.log(`  ${outcome}: ${count} (${pct}%)`);
  }
}

/**
 * Prints usage information for the ledger CLI to stdout.
 */
function printUsage() {
  console.log(`Usage: ledger.js <command> [options]

Commands:
  log [--limit <n>]   Show recent payment decisions (default: last 20)
  summary             Show totals by skill, chain, and outcome

Ledger file: ~/.clawpowers/logs/payments.jsonl

Examples:
  ledger.js log
  ledger.js log --limit 50
  ledger.js summary`);
}

/**
 * CLI dispatch — routes argv to the appropriate command.
 *
 * @param {string[]} argv - Argument array (typically process.argv.slice(2)).
 */
function main(argv) {
  const [cmd, ...rest] = argv;

  switch (cmd) {
    case 'log':
      cmdLog(rest);
      break;
    case 'summary':
      cmdSummary();
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

module.exports = { logPaymentDecision, getPaymentSummary, LEDGER_FILE, LOGS_DIR };
