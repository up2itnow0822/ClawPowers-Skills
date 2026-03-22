#!/usr/bin/env node
// runtime/feedback/analyze.js — RSI feedback engine
//
// Reads metrics, computes per-skill success rates, identifies declining performance,
// and outputs actionable recommendations for skill improvement.
//
// Usage:
//   node analyze.js                        Full analysis of all skills
//   node analyze.js --skill <name>         Analysis for one skill
//   node analyze.js --plan <name>          Plan execution analysis
//   node analyze.js --worktrees            Worktree lifecycle report
//   node analyze.js --recommendations      Show improvement recommendations only
//   node analyze.js --format json          Output as JSON (default: human-readable)
//
// RSI Cycle: measure → analyze → adapt
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// All runtime paths derived from CLAWPOWERS_DIR for testability
const CLAWPOWERS_DIR = process.env.CLAWPOWERS_DIR || path.join(os.homedir(), '.clawpowers');
const METRICS_DIR = path.join(CLAWPOWERS_DIR, 'metrics');
const STATE_DIR = path.join(CLAWPOWERS_DIR, 'state');
const FEEDBACK_DIR = path.join(CLAWPOWERS_DIR, 'feedback');

/**
 * Ensures all required runtime directories exist.
 * Called at the start of each command function so analysis works even if
 * the user has never run `clawpowers init`.
 */
function ensureDirs() {
  for (const dir of [METRICS_DIR, STATE_DIR, FEEDBACK_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
  }
}

/**
 * Returns an ISO 8601 timestamp without milliseconds.
 *
 * @returns {string} e.g. "2025-01-15T12:00:00Z"
 */
function isoTimestamp() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Reads all JSONL metric records from every monthly log file.
 * Files are read in chronological order (sorted by YYYY-MM filename).
 * Malformed JSON lines are silently skipped.
 *
 * @param {string} [skillFilter=''] - If non-empty, only return records for this skill name.
 * @returns {Object[]} Parsed record objects in chronological order.
 */
function loadAllLines(skillFilter) {
  if (!fs.existsSync(METRICS_DIR)) return [];

  const files = fs.readdirSync(METRICS_DIR)
    .filter(f => f.endsWith('.jsonl'))
    .sort() // YYYY-MM.jsonl sorts chronologically
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
      } catch (_) { /* skip malformed lines without crashing */ }
    }
  }
  return lines;
}

/**
 * Returns a sorted, deduplicated list of all skill names that have been
 * recorded in the metrics store.
 *
 * @returns {string[]} Alphabetically sorted array of skill names.
 */
function getAllSkills() {
  const lines = loadAllLines(); // No filter — load all records
  const skills = new Set(lines.map(r => r.skill).filter(Boolean));
  return [...skills].sort();
}

/**
 * Computes aggregate statistics for a single skill.
 *
 * @param {string} skill - The skill name to analyze.
 * @returns {{total: number, success: number, failure: number, partial: number,
 *            skipped: number, rate: number, avgDuration: number} | null}
 *   Statistics object, or null if no records exist for this skill.
 *   `rate` is success percentage (0-100). `avgDuration` is -1 if no durations recorded.
 */
function computeSkillStats(skill) {
  const lines = loadAllLines(skill);
  if (lines.length === 0) return null;

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
  const rate = Math.round(success / total * 100);
  const avgDuration = durationCount > 0 ? Math.round(totalDuration / durationCount) : -1;

  return { total, success, failure, partial, skipped, rate, avgDuration };
}

/**
 * Detects whether a skill's recent performance is declining compared to its
 * all-time success rate. "Recent" is defined as the last `window` executions.
 *
 * A decline is flagged when the all-time rate minus the recent rate is >= 20
 * percentage points. This threshold avoids noise from small sample sizes.
 *
 * Requires at least 2×window total records to produce a meaningful comparison;
 * returns null for skills with insufficient data.
 *
 * @param {string} skill - Skill name to check.
 * @param {number} [window=5] - Number of recent executions to compare against all-time.
 * @returns {string | null} A descriptive message if declining, null otherwise.
 */
function detectDecline(skill, window = 5) {
  const lines = loadAllLines(skill);
  if (lines.length === 0) return null;

  const total = lines.length;
  // Need at least 2×window records for a meaningful all-time vs. recent comparison
  if (total < window * 2) return null;

  const allSuccess = lines.filter(r => r.outcome === 'success').length;
  const allRate = allSuccess / total * 100;

  // Compare against only the most recent `window` records
  const recent = lines.slice(total - window);
  const recentSuccess = recent.filter(r => r.outcome === 'success').length;
  const recentRate = recentSuccess / recent.length * 100;

  if (allRate - recentRate >= 20) {
    return `DECLINING: ${skill} (all-time ${Math.round(allRate)}% → recent ${Math.round(recentRate)}%)`;
  }
  return null;
}

/**
 * Generates human-readable improvement recommendations for a skill based on
 * its success rate and execution count.
 *
 * Three tiers:
 *   - <60%: Low — methodology review recommended
 *   - 60-79%: Moderate — check failure notes for patterns
 *   - ≥80%: Good — performing well
 *
 * Requires at least 3 executions before making recommendations; returns an
 * "insufficient data" message for skills with fewer records.
 *
 * @param {string} skill - Skill name (used in recommendation text).
 * @param {number} rate - Success rate percentage (0-100).
 * @param {number} total - Total number of executions recorded.
 * @returns {string[]} Array of recommendation lines ready to print.
 */
function generateRecommendations(skill, rate, total) {
  const lines = [];
  if (total < 3) {
    lines.push(`  Not enough data (${total} executions). Need 3+ to analyze.`);
    return lines;
  }
  if (rate < 60) {
    lines.push(`  ⚠ LOW SUCCESS RATE (${rate}%): Review skill methodology.`);
    lines.push(`    Consider: Is the 'When to Use' triggering at wrong times?`);
    lines.push(`    Consider: Are anti-patterns in the skill being followed anyway?`);
  } else if (rate < 80) {
    lines.push(`  ℹ MODERATE RATE (${rate}%): Some improvement opportunity.`);
    lines.push(`    Review recent failure notes for common causes.`);
  } else {
    lines.push(`  ✓ GOOD RATE (${rate}%): Skill performing well.`);
  }
  return lines;
}

// ============================================================
// Store bridge — thin wrappers around store.js so analyze.js doesn't
// need store.js to be present (graceful degradation when store is missing)
// ============================================================

/**
 * Fetches a single value from the key-value store.
 * Returns `defaultVal` if the store module is unavailable or the key doesn't exist.
 *
 * @param {string} key - Store key in namespace:entity:attribute format.
 * @param {string} defaultVal - Value to return on error or missing key.
 * @returns {string} The stored value or the default.
 */
function storeGet(key, defaultVal) {
  const storeJs = path.join(__dirname, '..', 'persistence', 'store.js');
  if (!fs.existsSync(storeJs)) return defaultVal;
  try {
    const store = require(storeJs);
    return store.cmdGet(key, defaultVal);
  } catch (_) {
    return defaultVal;
  }
}

/**
 * Lists all store keys matching a prefix.
 * Returns an empty array if the store module is unavailable.
 *
 * @param {string} prefix - Key prefix to filter by.
 * @returns {string[]} Matching keys, or [] on error.
 */
function storeList(prefix) {
  const storeJs = path.join(__dirname, '..', 'persistence', 'store.js');
  if (!fs.existsSync(storeJs)) return [];
  try {
    const store = require(storeJs);
    return store.cmdList(prefix);
  } catch (_) {
    return [];
  }
}

/**
 * Lists all store key=value pairs matching a prefix.
 * Returns an empty array if the store module is unavailable.
 *
 * @param {string} prefix - Key prefix to filter by.
 * @returns {string[]} Matching "key=value" strings, or [] on error.
 */
function storeListValues(prefix) {
  const storeJs = path.join(__dirname, '..', 'persistence', 'store.js');
  if (!fs.existsSync(storeJs)) return [];
  try {
    const store = require(storeJs);
    return store.cmdListValues(prefix);
  } catch (_) {
    return [];
  }
}

// ============================================================
// Command functions — each corresponds to one CLI invocation mode
// ============================================================

/**
 * Full RSI analysis across all tracked skills.
 * Prints per-skill statistics, recommendations, decline warnings, and
 * an overall summary. Also saves a plain-text report to the feedback directory.
 *
 * This is the default view shown by `clawpowers status`.
 */
function cmdFullAnalysis() {
  ensureDirs();

  console.log('ClawPowers RSI Feedback Analysis');
  console.log('=================================');
  console.log(`Generated: ${isoTimestamp()}`);
  console.log('');

  const skills = getAllSkills();

  if (skills.length === 0) {
    console.log('No metrics found. Run some skills and record outcomes with:');
    console.log('  node runtime/metrics/collector.js record --skill <name> --outcome success');
    return;
  }

  console.log('## Per-Skill Analysis');
  console.log('');

  let overallTotal = 0;
  let overallSuccess = 0;
  const decliningSkills = [];

  for (const skill of skills) {
    const stats = computeSkillStats(skill);
    if (!stats) continue;

    overallTotal += stats.total;
    overallSuccess += stats.success;

    console.log(`### ${skill}`);

    // Build stat line, appending avg duration only when we have duration data
    let statLine = `  Executions: ${stats.total} | Success rate: ${stats.rate}%`;
    if (stats.avgDuration >= 0) statLine += ` | Avg duration: ${stats.avgDuration}s`;
    console.log(statLine);

    // Print improvement recommendations based on the success rate tier
    generateRecommendations(skill, stats.rate, stats.total).forEach(r => console.log(r));

    // Flag skills with a significant performance drop in recent executions
    const decline = detectDecline(skill);
    if (decline) {
      console.log(`  ⚠ ${decline}`);
      decliningSkills.push(skill);
    }

    console.log('');
  }

  // Aggregate stats across all skills
  console.log('## Overall Summary');
  if (overallTotal > 0) {
    const overallRate = Math.round(overallSuccess / overallTotal * 100);
    console.log(`  Total executions: ${overallTotal}`);
    console.log(`  Overall success rate: ${overallRate}%`);

    if (decliningSkills.length > 0) {
      console.log('');
      console.log(`  ⚠ Declining skills: ${decliningSkills.join(' ')}`);
      console.log('    These skills show degraded performance in recent executions.');
      console.log('    Recommended: Review skill methodology and recent failure notes.');
    }
  }

  // Count state keys and metrics files for the runtime health section
  let stateKeyCount = 0;
  if (fs.existsSync(STATE_DIR)) {
    stateKeyCount = fs.readdirSync(STATE_DIR).filter(f =>
      fs.statSync(path.join(STATE_DIR, f)).isFile()
    ).length;
  }
  let metricsFileCount = 0;
  if (fs.existsSync(METRICS_DIR)) {
    metricsFileCount = fs.readdirSync(METRICS_DIR).filter(f => f.endsWith('.jsonl')).length;
  }

  console.log('');
  console.log('## Runtime State');
  console.log(`  State keys stored: ${stateKeyCount}`);
  console.log(`  Metrics files: ${metricsFileCount}`);

  // Persist a compact summary to the feedback directory for later reference
  const reportFile = path.join(FEEDBACK_DIR, `analysis-${new Date().toISOString().slice(0, 10)}.txt`);
  const safeRate = overallTotal > 0 ? Math.round(overallSuccess / overallTotal * 100) : 0;
  const reportLines = [
    `Analysis generated: ${isoTimestamp()}`,
    `Overall success rate: ${safeRate}%`,
    `Total executions: ${overallTotal}`,
  ];
  if (decliningSkills.length > 0) reportLines.push(`Declining: ${decliningSkills.join(' ')}`);
  try {
    fs.writeFileSync(reportFile, reportLines.join('\n') + '\n', { mode: 0o600 });
  } catch (_) { /* non-fatal: report save failure doesn't affect console output */ }
}

/**
 * Detailed analysis for a single named skill.
 * Shows statistics, recommendations, the 5 most recent executions, and
 * any related keys in the state store.
 *
 * @param {string} skill - Name of the skill to analyze.
 */
function cmdSkillAnalysis(skill) {
  if (!skill) {
    process.stderr.write('Error: --skill requires a skill name\n');
    process.exit(1);
  }

  ensureDirs();

  console.log(`Skill Analysis: ${skill}`);
  console.log('='.repeat(40));
  console.log(`Generated: ${isoTimestamp()}`);
  console.log('');

  const stats = computeSkillStats(skill);
  if (!stats) {
    console.log(`No metrics found for skill: ${skill}`);
    console.log('Record some executions with:');
    console.log(`  node runtime/metrics/collector.js record --skill ${skill} --outcome success`);
    return;
  }

  const failRate = Math.round(stats.failure / stats.total * 100);

  console.log('## Statistics');
  console.log(`  Total executions: ${stats.total}`);
  console.log(`  Success: ${stats.success} (${stats.rate}%)`);
  console.log(`  Failure: ${stats.failure} (${failRate}%)`);
  if (stats.avgDuration >= 0) {
    // Show duration in both seconds and minutes+seconds for readability
    const mins = Math.floor(stats.avgDuration / 60);
    const secs = stats.avgDuration % 60;
    console.log(`  Average duration: ${stats.avgDuration}s (${mins}m ${secs}s)`);
  }

  console.log('');
  console.log('## Recommendations');
  generateRecommendations(skill, stats.rate, stats.total).forEach(r => console.log(r));

  // Show last 5 executions as a quick sanity check on recent behavior
  console.log('');
  console.log('## Recent Executions');
  const lines = loadAllLines(skill).slice(-5);
  for (const r of lines) {
    const ts = r.ts || '';
    // Pad outcome to 10 chars for aligned column output
    const outcome = (r.outcome || '').padEnd(10);
    const notes = r.notes || '(no notes)';
    console.log(`  ${ts} | ${outcome} | ${notes}`);
  }

  // Show any store keys that belong to this skill's namespace
  console.log('');
  console.log('## Related State Keys');
  const relatedKeys = storeList(`${skill}:`);
  if (relatedKeys.length === 0) {
    console.log('  (none)');
  } else {
    relatedKeys.forEach(k => console.log(`  ${k}`));
  }
}

/**
 * Analyzes the execution of a named plan.
 * Reads estimated vs. actual duration from the store and computes estimation
 * accuracy. Also lists all task statuses tracked under this plan's namespace.
 *
 * @param {string} planName - Plan identifier (as used in store keys).
 */
function cmdPlanAnalysis(planName) {
  if (!planName) {
    process.stderr.write('Error: --plan requires a plan name\n');
    process.exit(1);
  }

  ensureDirs();

  console.log(`Plan Execution Analysis: ${planName}`);
  console.log('='.repeat(50));
  console.log('');

  // Read plan timing metadata from the store (set by the executing-plans skill)
  const estimated = storeGet(`plan:${planName}:estimated_duration`, 'unknown');
  const actual = storeGet(`plan:${planName}:actual_duration`, 'unknown');

  console.log(`Estimated duration: ${estimated}min`);
  console.log(`Actual duration: ${actual}min`);

  if (estimated !== 'unknown' && actual !== 'unknown') {
    // Accuracy ratio: 1.0 = perfect, >1.0 = took longer than estimated
    const error = parseFloat(actual) / parseFloat(estimated);
    console.log(`Estimation accuracy: ${error.toFixed(1)}x (1.0 = perfect)`);
    // Flag significant underestimates (>30% over estimate) with a recommendation
    if (error > 1.3) {
      console.log(`Recommendation: Increase task time estimates by ${error.toFixed(1)}x for similar work`);
    }
  }

  console.log('');
  console.log('Task Status:');
  // Task keys follow the pattern: execution:<planName>:task_<n>:status
  const taskPairs = storeListValues(`execution:${planName}:task_`);
  if (taskPairs.length === 0) {
    console.log('  (none)');
  } else {
    for (const pair of taskPairs) {
      const eqIdx = pair.indexOf('=');
      // Pad the key to 40 chars for aligned two-column output
      const key = pair.slice(0, eqIdx).padEnd(40);
      const val = pair.slice(eqIdx + 1);
      console.log(`  ${key} ${val}`);
    }
  }
}

/**
 * Reports on all active git worktrees tracked in the state store.
 * Worktrees are registered by the using-git-worktrees skill and should be
 * cleaned up after branch merges.
 */
function cmdWorktreeReport() {
  ensureDirs();

  console.log('Worktree Lifecycle Report');
  console.log('=========================');
  console.log('');

  console.log('Active Worktrees:');
  // Worktree keys are registered under the "worktree:" namespace
  const worktreePairs = storeListValues('worktree:');
  if (worktreePairs.length === 0) {
    console.log('  (none registered)');
  } else {
    for (const pair of worktreePairs) {
      const eqIdx = pair.indexOf('=');
      const key = pair.slice(0, eqIdx);
      const val = pair.slice(eqIdx + 1);
      console.log(`  ${key}: ${val}`);
    }
  }

  console.log('');
  console.log('Tip: After merging a branch, clean up its worktree:');
  console.log('  git worktree remove <path> && git branch -d <branch>');
}

/**
 * Shows only the skills that have improvement recommendations (success rate < 80%).
 * Useful for quick triage without the full analysis output.
 * Skills with fewer than 3 executions are excluded (insufficient data).
 */
function cmdRecommendations() {
  ensureDirs();

  console.log('ClawPowers Recommendations');
  console.log('==========================');
  console.log('');

  const skills = getAllSkills();

  if (skills.length === 0) {
    console.log('No metrics yet. Record skill outcomes to get recommendations.');
    return;
  }

  let hasRecommendations = false;

  for (const skill of skills) {
    const stats = computeSkillStats(skill);
    if (!stats) continue;
    // Only surface skills that have enough data and are underperforming
    if (stats.total >= 3 && stats.rate < 80) {
      console.log(`[${skill}] Success rate: ${stats.rate}% (${stats.total} executions)`);
      generateRecommendations(skill, stats.rate, stats.total).forEach(r => console.log(r));
      console.log('');
      hasRecommendations = true;
    }
  }

  if (!hasRecommendations) {
    console.log('All tracked skills performing well (≥80% success rate).');
    console.log('Keep recording outcomes to refine this analysis.');
  }
}

/**
 * Prints usage information for the analyze CLI to stdout.
 */
function printUsage() {
  console.log(`Usage: analyze.js [options]

Options:
  (no args)                Full analysis of all skills
  --skill <name>           Analysis for one specific skill
  --plan <name>            Plan execution analysis (duration, task status)
  --worktrees              Worktree lifecycle report
  --recommendations        Show improvement recommendations only
  --format json            JSON output (future: human is default)

Examples:
  node analyze.js
  node analyze.js --skill systematic-debugging
  node analyze.js --plan auth-service
  node analyze.js --worktrees
  node analyze.js --recommendations`);
}

/**
 * CLI dispatch — routes the first flag argument to the appropriate command.
 *
 * @param {string[]} argv - Argument array (typically process.argv.slice(2)).
 */
function main(argv) {
  const [flag, value] = argv;

  switch (flag) {
    case '--skill':           cmdSkillAnalysis(value); break;
    case '--plan':            cmdPlanAnalysis(value); break;
    case '--worktrees':       cmdWorktreeReport(); break;
    case '--recommendations': cmdRecommendations(); break;
    // --format accepts a format name; human-readable is the only current format
    case '--format':          cmdFullAnalysis(); break;
    case 'help':
    case '-h':
    case '--help':            printUsage(); break;
    case undefined:
    case '':                  cmdFullAnalysis(); break;
    default:
      process.stderr.write(`Unknown option: ${flag}\n`);
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

module.exports = {
  cmdFullAnalysis, cmdSkillAnalysis, cmdPlanAnalysis,
  cmdWorktreeReport, cmdRecommendations,
  loadAllLines, computeSkillStats, detectDecline, generateRecommendations,
};
