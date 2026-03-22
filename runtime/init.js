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

const VERSION = '1.0.0';
const CLAWPOWERS_DIR = process.env.CLAWPOWERS_DIR || path.join(os.homedir(), '.clawpowers');

function createStructure() {
  const dirs = [
    CLAWPOWERS_DIR,
    path.join(CLAWPOWERS_DIR, 'state'),
    path.join(CLAWPOWERS_DIR, 'metrics'),
    path.join(CLAWPOWERS_DIR, 'checkpoints'),
    path.join(CLAWPOWERS_DIR, 'feedback'),
    path.join(CLAWPOWERS_DIR, 'memory'),
    path.join(CLAWPOWERS_DIR, 'logs'),
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

function writeVersion() {
  const versionFile = path.join(CLAWPOWERS_DIR, '.version');
  if (!fs.existsSync(versionFile)) {
    const ts = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const content = `version=${VERSION}\ninitialized=${ts}\n`;
    fs.writeFileSync(versionFile, content, { mode: 0o600 });
  }
}

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

function runMigrations() {
  const versionFile = path.join(CLAWPOWERS_DIR, '.version');
  if (!fs.existsSync(versionFile)) return;

  let content = fs.readFileSync(versionFile, 'utf8');
  content = content.replace(/^version=.*/m, `version=${VERSION}`);
  fs.writeFileSync(versionFile, content, { mode: 0o600 });
}

function getStoredVersion() {
  const versionFile = path.join(CLAWPOWERS_DIR, '.version');
  if (!fs.existsSync(versionFile)) return VERSION;
  const content = fs.readFileSync(versionFile, 'utf8');
  const match = content.match(/^version=(.+)$/m);
  return match ? match[1].trim() : VERSION;
}

function main() {
  const created = createStructure();
  writeVersion();
  writeReadme();

  if (fs.existsSync(path.join(CLAWPOWERS_DIR, '.version'))) {
    runMigrations();
  }

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

if (require.main === module) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
}

module.exports = { main, CLAWPOWERS_DIR, VERSION };
