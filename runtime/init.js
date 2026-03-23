#!/usr/bin/env node
// runtime/init.js — Initialize the ClawPowers runtime directory structure
//
// Creates ~/.clawpowers/ with all required subdirectories on first run.
// Safe to run multiple times (idempotent).
//
// Usage:
//   node runtime/init.js
//   npx clawpowers init
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const VERSION = '1.1.1';

// Runtime root — override with CLAWPOWERS_DIR env var for testing or custom locations
const CLAWPOWERS_DIR = process.env.CLAWPOWERS_DIR || path.join(os.homedir(), '.clawpowers');

/**
 * Creates the full runtime directory tree under CLAWPOWERS_DIR.
 * Each directory is created with mode 0o700 (owner-only access) so
 * skill state and metrics aren't readable by other users on the system.
 * Directories that already exist are silently skipped.
 *
 * @returns {number} Count of directories actually created (0 if already initialized).
 */
function createStructure() {
  const dirs = [
    CLAWPOWERS_DIR,
    path.join(CLAWPOWERS_DIR, 'state'),        // Key-value persistence files
    path.join(CLAWPOWERS_DIR, 'metrics'),       // JSONL outcome logs per month
    path.join(CLAWPOWERS_DIR, 'checkpoints'),   // Resumable plan state (executing-plans skill)
    path.join(CLAWPOWERS_DIR, 'feedback'),      // RSI analysis reports
    path.join(CLAWPOWERS_DIR, 'memory'),        // Cross-session knowledge base
    path.join(CLAWPOWERS_DIR, 'logs'),          // Debug and audit logs
  ];

  let created = 0;
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      created++;
    }
  }
  return created;
}

/**
 * Writes a .version file to CLAWPOWERS_DIR on first initialization.
 * The file contains the ClawPowers version and an ISO timestamp so we can
 * track when the runtime was first set up and run migrations in the future.
 * No-op if the file already exists.
 */
function writeVersion() {
  const versionFile = path.join(CLAWPOWERS_DIR, '.version');
  if (!fs.existsSync(versionFile)) {
    const ts = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const content = `version=${VERSION}\ninitialized=${ts}\n`;
    // 0o600 = owner read/write only — this file may contain version metadata
    fs.writeFileSync(versionFile, content, { mode: 0o600 });
  }
}

/**
 * Writes a human-readable README into CLAWPOWERS_DIR explaining its purpose.
 * Helps users who discover the directory understand what it is and that it is
 * safe to delete (ClawPowers will recreate it on next run).
 * No-op if the README already exists.
 */
function writeReadme() {
  const readme = path.join(CLAWPOWERS_DIR, 'README');
  if (!fs.existsSync(readme)) {
    const content = [
      'ClawPowers Runtime Directory',
      '============================',
      '',
      'This directory is managed by ClawPowers (https://github.com/up2itnow0822/clawpowers).',
      '',
      'Directory Structure:',
      '  state/        Key-value state store for skill data (managed by persistence/store.js)',
      '  metrics/      Skill execution outcome logs in JSONL format',
      '  checkpoints/  Resumable workflow state (created by executing-plans skill)',
      '  feedback/     RSI analysis output and recommendations',
      '  memory/       Cross-session knowledge base',
      '  logs/         Debug and audit logs',
      '',
      'Safe to delete: Yes — ClawPowers recreates this directory on next init.',
      'Never share: Contains agent state and potentially sensitive workflow data.',
      '',
      'Manage with: npx clawpowers status',
      '',
    ].join('\n');
    fs.writeFileSync(readme, content, { mode: 0o600 });
  }
}

/**
 * Default configuration written to ~/.clawpowers/config.json on first init.
 * Users can edit this file to enable payments, telemetry, or change skill behavior.
 * Never overwritten once created — user settings are always preserved.
 */
const DEFAULT_CONFIG = {
  version: VERSION,
  payments: {
    enabled: false,
    mode: 'dry_run',
    per_tx_limit_usd: 0,
    daily_limit_usd: 0,
    weekly_limit_usd: 0,
    allowlist: [],
    require_approval_above_usd: 0,
  },
  telemetry: {
    enabled: false,
  },
  skills: {
    auto_load: true,
  },
};

/**
 * Writes the default config.json to CLAWPOWERS_DIR on first initialization.
 * No-op if config.json already exists — user settings are always preserved.
 * The config file is written with mode 0o600 (owner read/write only).
 */
function writeConfig() {
  const configFile = path.join(CLAWPOWERS_DIR, 'config.json');
  if (!fs.existsSync(configFile)) {
    const content = JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n';
    fs.writeFileSync(configFile, content, { mode: 0o600 });
  }
}

/**
 * Updates the version stamp in .version after initialization.
 * Currently a no-op placeholder for actual schema migrations; the version
 * string is updated in place so future versions can detect and migrate old
 * runtime layouts.
 */
function runMigrations() {
  const versionFile = path.join(CLAWPOWERS_DIR, '.version');
  if (!fs.existsSync(versionFile)) return;

  // Replace the version= line with the current version to keep .version current
  let content = fs.readFileSync(versionFile, 'utf8');
  content = content.replace(/^version=.*/m, `version=${VERSION}`);
  fs.writeFileSync(versionFile, content, { mode: 0o600 });
}

/**
 * Reads the stored version string from .version.
 * Used in the "already initialized" status message to show what version is
 * currently installed in the runtime directory.
 *
 * @returns {string} Stored version string, or the current VERSION if unreadable.
 */
function getStoredVersion() {
  const versionFile = path.join(CLAWPOWERS_DIR, '.version');
  if (!fs.existsSync(versionFile)) return VERSION;
  const content = fs.readFileSync(versionFile, 'utf8');
  const match = content.match(/^version=(.+)$/m);
  return match ? match[1].trim() : VERSION;
}

/**
 * Main initialization sequence:
 * 1. Create directory structure (idempotent).
 * 2. Write .version file (first run only).
 * 3. Write README (first run only).
 * 4. Run migrations to update version stamp.
 * 5. Print status to stdout (suppressed when CLAWPOWERS_QUIET=1).
 */
function main() {
  const created = createStructure();
  writeVersion();
  writeReadme();
  writeConfig();

  // Only run migrations when .version exists (i.e., after writeVersion)
  if (fs.existsSync(path.join(CLAWPOWERS_DIR, '.version'))) {
    runMigrations();
  }

  // CLAWPOWERS_QUIET=1 suppresses output when called from session-start hook
  // so the hook's JSON output isn't polluted with init messages
  if (process.env.CLAWPOWERS_QUIET !== '1') {
    if (created > 0) {
      console.log(`ClawPowers runtime initialized at ${CLAWPOWERS_DIR}`);
      console.log(`  Directories created: ${created}`);
      console.log(`  Version: ${VERSION}`);
    } else {
      console.log(`ClawPowers runtime already initialized at ${CLAWPOWERS_DIR}`);
      console.log(`  Version: ${getStoredVersion()}`);
    }
  }
}

// Only run main() when executed directly; allow require() without side effects
if (require.main === module) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
}

module.exports = { main, CLAWPOWERS_DIR, VERSION, writeConfig, DEFAULT_CONFIG };
