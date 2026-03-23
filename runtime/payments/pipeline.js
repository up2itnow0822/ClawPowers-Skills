#!/usr/bin/env node
// runtime/payments/pipeline.js — Unified Payment Decision Pipeline
//
// Central gate for ALL skill payment decisions. Any skill that encounters a
// payment boundary (HTTP 402, premium scanner, paid API, x402 endpoint) calls
// evaluatePayment() here instead of making its own policy judgements.
//
// Flow:
//   estimate_cost → check_config → check_policy →
//   (disabled | dry_run | queued | approved | rejected) → log
//
// Usage (module):
//   const { evaluatePayment } = require('./pipeline');
//   const result = await evaluatePayment({ skill, reason, amount_usd, asset, chain, recipient, url });
//
// Usage (CLI):
//   node pipeline.js evaluate --amount 0.05 --skill security-audit --reason "premium scanner"
//   npx clawpowers payments evaluate --amount 0.05 --skill security-audit --reason "premium scanner"
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { logPaymentDecision, LOGS_DIR } = require('./ledger');

// ─── Config paths ──────────────────────────────────────────────────────────

/** Root of the ~/.clawpowers/ runtime directory. */
const CLAWPOWERS_DIR = process.env.CLAWPOWERS_DIR || path.join(os.homedir(), '.clawpowers');

/** Main config file path. */
const CONFIG_FILE = path.join(CLAWPOWERS_DIR, 'config.json');

/** Payment ledger path (JSONL — one record per decision). */
const PAYMENTS_LEDGER = path.join(CLAWPOWERS_DIR, 'logs', 'payments.jsonl');

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Load and parse ~/.clawpowers/config.json.
 * Returns an empty object if the file doesn't exist.
 *
 * @returns {object} Parsed config or {}.
 */
function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return {};
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    process.stderr.write(`[pipeline] Warning: could not read config: ${err.message}\n`);
    return {};
  }
}

/**
 * Compute today's total spend (USD) from the payments ledger.
 * Only counts entries with action "approved" or "executed" and today's date.
 *
 * @returns {number} Total USD spent today across all skills and chains.
 */
function getTodaySpend() {
  try {
    if (!fs.existsSync(PAYMENTS_LEDGER)) return 0;
    const today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
    const lines = fs.readFileSync(PAYMENTS_LEDGER, 'utf8').split('\n');
    let total = 0;
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line);
        if (
          r.timestamp &&
          r.timestamp.startsWith(today) &&
          (r.policy_result === 'approved' || r.policy_result === 'executed')
        ) {
          total += parseFloat(r.required_amount) || 0;
        }
      } catch (_) { /* skip malformed */ }
    }
    return total;
  } catch {
    return 0;
  }
}

/**
 * Check if a recipient address appears in the configured allowlist.
 * An empty allowlist means NO recipients are automatically allowed.
 *
 * @param {string} recipient - Recipient address (0x-prefixed).
 * @param {string[]} allowlist - Array of allowed addresses (case-insensitive).
 * @returns {boolean} True if allowed or allowlist is not configured.
 */
function isAllowlisted(recipient, allowlist) {
  // If allowlist is undefined/null → not configured → no automatic allowance
  if (!Array.isArray(allowlist)) return false;
  // Empty allowlist → nothing allowed
  if (allowlist.length === 0) return false;
  const lower = (recipient || '').toLowerCase();
  return allowlist.some((a) => (a || '').toLowerCase() === lower);
}

/**
 * Returns an ISO 8601 timestamp without milliseconds.
 * @returns {string}
 */
function isoNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// ─── Core pipeline ─────────────────────────────────────────────────────────

/**
 * Payment Decision Pipeline — evaluate whether a payment should be made.
 *
 * Called by any skill when it hits a payment boundary. Reads config, checks
 * policy limits, and returns a decision with a reason. Always logs the decision
 * to the payments ledger regardless of outcome.
 *
 * ### Decision flow
 *
 * ```
 * payments.enabled === false    →  "disabled"
 * payments.mode === "dry_run"   →  "dry_run"
 * amount > per_tx_limit         →  "rejected"  (hard limit)
 * today_spend + amount > daily  →  "rejected"  (daily limit)
 * recipient not in allowlist    →  "queued"    (needs approval)
 * amount > require_approval_above → "queued"   (needs approval)
 * all checks pass               →  "approved"
 * ```
 *
 * @param {object} decision - Payment details.
 * @param {string} decision.skill        - ClawPowers skill triggering the payment.
 * @param {string} decision.reason       - Human-readable reason ("HTTP 402", "premium scanner", …).
 * @param {number} decision.amount_usd   - Estimated cost in USD (decimal).
 * @param {string} [decision.asset]      - Token/asset symbol (default "USDC").
 * @param {string} [decision.chain]      - Chain name (default "base").
 * @param {string} [decision.recipient]  - Payment recipient address.
 * @param {string} [decision.url]        - URL or service that triggered the boundary.
 *
 * @returns {{
 *   action: "disabled"|"dry_run"|"queued"|"approved"|"rejected",
 *   reason: string,
 *   logged: boolean,
 *   amount_usd: number,
 *   config_used: object
 * }} Decision result.
 *
 * @example
 * ```javascript
 * const { evaluatePayment } = require('./pipeline');
 * const result = await evaluatePayment({
 *   skill: 'security-audit',
 *   reason: 'premium scanner API',
 *   amount_usd: 0.05,
 *   asset: 'USDC',
 *   chain: 'base',
 *   recipient: '0xSCANNER_RECIPIENT',
 * });
 * if (result.action === 'approved') {
 *   // proceed with payment
 * }
 * ```
 */
function evaluatePayment(decision) {
  const {
    skill = 'unknown',
    reason = '',
    amount_usd = 0,
    asset = 'USDC',
    chain = 'base',
    recipient = '',
    url = '',
  } = decision;

  // ── 1. Load config ────────────────────────────────────────────────────────
  const config = loadConfig();
  const payments = config.payments || {};

  // ── 2. payments.enabled === false → disabled ──────────────────────────────
  if (payments.enabled === false) {
    const result = {
      action: 'disabled',
      reason: 'Payments disabled in ~/.clawpowers/config.json (payments.enabled = false)',
      logged: false,
      amount_usd,
      config_used: payments,
    };
    result.logged = _logDecision(skill, url, String(amount_usd), asset, chain, 'disabled', result.reason, false);
    return result;
  }

  // ── 3. payments.mode === "dry_run" → log what would happen, no payment ────
  if (payments.mode === 'dry_run') {
    const summary =
      `DRY-RUN: skill=${skill} reason="${reason}" would pay ` +
      `$${amount_usd.toFixed ? amount_usd.toFixed(4) : amount_usd} ${asset} on ${chain}` +
      (url ? ` for ${url}` : '');
    console.log(`[pipeline] ${summary}`);

    const result = {
      action: 'dry_run',
      reason: summary,
      logged: false,
      amount_usd,
      config_used: payments,
    };
    result.logged = _logDecision(skill, url, String(amount_usd), asset, chain, 'dry_run', reason, true);
    return result;
  }

  // ── 4. Check per-transaction limit ────────────────────────────────────────
  const perTxLimit = typeof payments.per_tx_limit === 'number' ? payments.per_tx_limit : Infinity;
  if (amount_usd > perTxLimit) {
    const msg = `Amount $${amount_usd} exceeds per_tx_limit $${perTxLimit}`;
    const result = {
      action: 'rejected',
      reason: msg,
      logged: false,
      amount_usd,
      config_used: payments,
    };
    result.logged = _logDecision(skill, url, String(amount_usd), asset, chain, 'rejected', msg, false);
    return result;
  }

  // ── 5. Check daily limit ─────────────────────────────────────────────────
  const dailyLimit = typeof payments.daily_limit === 'number' ? payments.daily_limit : Infinity;
  const todaySpend = getTodaySpend();
  if (todaySpend + amount_usd > dailyLimit) {
    const msg =
      `Daily limit would be exceeded: today=$${todaySpend.toFixed(4)}, ` +
      `new=$${amount_usd}, limit=$${dailyLimit}`;
    const result = {
      action: 'rejected',
      reason: msg,
      logged: false,
      amount_usd,
      config_used: payments,
    };
    result.logged = _logDecision(skill, url, String(amount_usd), asset, chain, 'rejected', msg, false);
    return result;
  }

  // ── 6. Check recipient allowlist ─────────────────────────────────────────
  const allowlist = payments.allowlist; // undefined = not configured
  if (recipient && !isAllowlisted(recipient, allowlist)) {
    // Not in allowlist — queue for approval unless allowlist is intentionally absent
    // (If allowlist key doesn't exist at all, we fall through to approval-above check)
    if (Array.isArray(allowlist)) {
      const msg = `Recipient ${recipient} is not in payments.allowlist`;
      const result = {
        action: 'queued',
        reason: msg,
        logged: false,
        amount_usd,
        config_used: payments,
      };
      result.logged = _logDecision(skill, url, String(amount_usd), asset, chain, 'queued', msg, false);
      return result;
    }
  }

  // ── 7. Check require_approval_above threshold ─────────────────────────────
  const approvalThreshold = typeof payments.require_approval_above === 'number'
    ? payments.require_approval_above
    : Infinity;
  if (amount_usd > approvalThreshold) {
    const msg =
      `Amount $${amount_usd} exceeds require_approval_above threshold $${approvalThreshold}`;
    const result = {
      action: 'queued',
      reason: msg,
      logged: false,
      amount_usd,
      config_used: payments,
    };
    result.logged = _logDecision(skill, url, String(amount_usd), asset, chain, 'queued', msg, false);
    return result;
  }

  // ── 8. All checks passed → approved ───────────────────────────────────────
  const approveMsg = `Payment approved: $${amount_usd} ${asset} on ${chain} for ${skill} (${reason})`;
  const result = {
    action: 'approved',
    reason: approveMsg,
    logged: false,
    amount_usd,
    config_used: payments,
  };
  result.logged = _logDecision(skill, url, String(amount_usd), asset, chain, 'approved', reason, true);
  return result;
}

/**
 * Internal: write decision to the payments ledger via the ledger module.
 *
 * @param {string} skill
 * @param {string} url
 * @param {string} required_amount
 * @param {string} asset
 * @param {string} chain
 * @param {string} policy_result
 * @param {string} reason
 * @param {boolean} would_have_paid
 * @returns {boolean} Always true (indicates logging was attempted).
 */
function _logDecision(skill, url, required_amount, asset, chain, policy_result, reason, would_have_paid) {
  try {
    logPaymentDecision({
      skill,
      type: 'decision',
      url,
      required_amount,
      asset,
      chain,
      policy_result,
      reason,
      would_have_paid,
    });
    return true;
  } catch (err) {
    process.stderr.write(`[pipeline] Warning: could not write to ledger: ${err.message}\n`);
    return false;
  }
}

// ─── CLI ───────────────────────────────────────────────────────────────────

/**
 * Print CLI usage to stdout.
 */
function printUsage() {
  console.log(`Usage: clawpowers payments evaluate [options]

Options:
  --amount <n>       Payment amount in USD (required, decimal, e.g. 0.05)
  --skill <name>     Skill that triggered the payment (default: "cli")
  --reason <text>    Reason for the payment (default: "cli test")
  --asset <symbol>   Token symbol (default: USDC)
  --chain <name>     Chain name (default: base)
  --recipient <addr> Recipient wallet address (optional)
  --url <url>        URL or service requiring payment (optional)
  --json             Output raw JSON result

Examples:
  node pipeline.js evaluate --amount 0.05 --skill security-audit --reason "premium scanner"
  node pipeline.js evaluate --amount 0.01 --skill prospecting --reason "contact enrichment" --json
  npx clawpowers payments evaluate --amount 0.05 --skill agent-payments --reason "x402 API"

Config file: ~/.clawpowers/config.json
Ledger file: ~/.clawpowers/logs/payments.jsonl`);
}

/**
 * CLI handler for the `evaluate` sub-command.
 * Parses --flags and calls evaluatePayment(), printing the result.
 *
 * @param {string[]} argv - Arguments after "evaluate".
 */
function cmdEvaluate(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const next = argv[i + 1];
    switch (flag) {
      case '--amount':     args.amount_usd  = parseFloat(next); i++; break;
      case '--skill':      args.skill       = next; i++; break;
      case '--reason':     args.reason      = next; i++; break;
      case '--asset':      args.asset       = next; i++; break;
      case '--chain':      args.chain       = next; i++; break;
      case '--recipient':  args.recipient   = next; i++; break;
      case '--url':        args.url         = next; i++; break;
      case '--json':       args._json       = true; break;
    }
  }

  if (args.amount_usd === undefined || isNaN(args.amount_usd)) {
    process.stderr.write('Error: --amount is required and must be a number\n\n');
    printUsage();
    process.exit(1);
  }

  const decision = {
    skill: args.skill || 'cli',
    reason: args.reason || 'cli test',
    amount_usd: args.amount_usd,
    asset: args.asset || 'USDC',
    chain: args.chain || 'base',
    recipient: args.recipient || '',
    url: args.url || '',
  };

  const result = evaluatePayment(decision);

  if (args._json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('');
    console.log(`Payment Decision Pipeline`);
    console.log(`─────────────────────────`);
    console.log(`  Skill:   ${decision.skill}`);
    console.log(`  Reason:  ${decision.reason}`);
    console.log(`  Amount:  $${decision.amount_usd} ${decision.asset} on ${decision.chain}`);
    if (decision.url)       console.log(`  URL:     ${decision.url}`);
    if (decision.recipient) console.log(`  To:      ${decision.recipient}`);
    console.log('');
    console.log(`  ► Action:  ${result.action.toUpperCase()}`);
    console.log(`  ► Reason:  ${result.reason}`);
    console.log(`  ► Logged:  ${result.logged ? 'yes' : 'no'}`);
    console.log('');
  }

  // Non-zero exit for rejected/disabled so scripts can branch on exit code
  if (result.action === 'rejected') process.exit(2);
  if (result.action === 'disabled') process.exit(3);
}

/**
 * Main CLI dispatch.
 * @param {string[]} argv
 */
function main(argv) {
  const [cmd, ...rest] = argv;

  switch (cmd) {
    case 'evaluate':
    case 'eval':
      cmdEvaluate(rest);
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

// Guard: only run CLI dispatch when invoked directly
if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
}

module.exports = { evaluatePayment };
