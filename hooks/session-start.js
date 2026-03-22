#!/usr/bin/env node
// hooks/session-start.js — ClawPowers session injection hook
//
// Detects the active AI coding platform and outputs platform-appropriate JSON
// to inject the using-clawpowers skill into the agent's context window.
//
// Supported platforms:
//   - Claude Code  (CLAUDE_PLUGIN_ROOT env var)
//   - Cursor       (CURSOR_PLUGIN_ROOT env var)
//   - Codex        (CODEX env var or codex in PATH)
//   - OpenCode     (OPENCODE env var)
//   - Gemini CLI   (GEMINI_CLI env var or gemini in PATH)
//
// Output: JSON object suitable for platform context injection
// Exit 0: success with JSON on stdout
// Exit 1: skill file not found
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const SCRIPT_DIR = __dirname;
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const SKILL_FILE = path.join(REPO_ROOT, 'skills', 'using-clawpowers', 'SKILL.md');
const INIT_JS = path.join(REPO_ROOT, 'runtime', 'init.js');

const VERSION = '1.0.0';

function isoTimestamp() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// Check if a binary exists in PATH (cross-platform)
function commandExists(cmd) {
  try {
    const check = os.platform() === 'win32'
      ? `where ${cmd}`
      : `command -v ${cmd}`;
    execSync(check, { stdio: 'ignore' });
    return true;
  } catch (_) {
    return false;
  }
}

function detectPlatform() {
  if (process.env.CLAUDE_PLUGIN_ROOT) return 'claude-code';
  if (process.env.CURSOR_PLUGIN_ROOT) return 'cursor';
  if (process.env.CODEX || commandExists('codex')) return 'codex';
  if (process.env.OPENCODE) return 'opencode';
  if (process.env.GEMINI_CLI || commandExists('gemini')) return 'gemini';
  return 'generic';
}

const INSTRUCTIONS = {
  'claude-code': 'You have ClawPowers skills loaded. Read the content above to understand available skills and how to trigger them. Skills activate automatically when you recognize a matching task pattern.',
  'cursor':      'ClawPowers skills are available in this Cursor session. Trigger skills by recognizing task patterns described in the using-clawpowers skill above.',
  'codex':       'ClawPowers loaded for Codex session. Apply skills based on task pattern recognition.',
  'opencode':    'ClawPowers loaded for OpenCode session. Skills activate on pattern recognition.',
  'gemini':      'ClawPowers loaded for Gemini CLI session. Recognize task patterns to activate skills.',
  'generic':     'ClawPowers skills loaded. Use the using-clawpowers skill content to understand available capabilities.',
};

function main() {
  // Initialize runtime silently on first run
  const clawpowersDir = process.env.CLAWPOWERS_DIR || path.join(os.homedir(), '.clawpowers');
  if (!fs.existsSync(clawpowersDir) && fs.existsSync(INIT_JS)) {
    try {
      const init = require(INIT_JS);
      const orig = process.env.CLAWPOWERS_QUIET;
      process.env.CLAWPOWERS_QUIET = '1';
      init.main();
      if (orig === undefined) delete process.env.CLAWPOWERS_QUIET;
      else process.env.CLAWPOWERS_QUIET = orig;
    } catch (_) { /* non-fatal */ }
  }

  if (!fs.existsSync(SKILL_FILE)) {
    process.stderr.write(
      JSON.stringify({
        error: 'ClawPowers: using-clawpowers/SKILL.md not found',
        action: 'run npx clawpowers init',
      }) + '\n'
    );
    process.exit(1);
  }

  const skillContent = fs.readFileSync(SKILL_FILE, 'utf8');
  const platform = detectPlatform();
  const instruction = INSTRUCTIONS[platform] || INSTRUCTIONS.generic;

  const output = {
    type: 'skill_injection',
    platform,
    version: VERSION,
    timestamp: isoTimestamp(),
    skill: {
      name: 'using-clawpowers',
      source: SKILL_FILE,
      content: skillContent,
    },
    instruction,
  };

  // JSON.stringify handles all escaping correctly — no manual escaping needed
  console.log(JSON.stringify(output, null, 2));
}

try {
  main();
  process.exit(0);
} catch (err) {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
}
