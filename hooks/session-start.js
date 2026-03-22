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

// hooks/ is inside the repo; climb one level to get the repo root
const SCRIPT_DIR = __dirname;
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');

// Primary skill file that gets injected into every session
const SKILL_FILE = path.join(REPO_ROOT, 'skills', 'using-clawpowers', 'SKILL.md');

// Path to the JS init module used for silent first-run initialization
const INIT_JS = path.join(REPO_ROOT, 'runtime', 'init.js');

const VERSION = '1.0.0';

/**
 * Returns an ISO 8601 timestamp without milliseconds (e.g. "2025-01-15T12:00:00Z").
 * Milliseconds are stripped for readability in the JSON output.
 *
 * @returns {string} ISO 8601 UTC timestamp.
 */
function isoTimestamp() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Checks whether a command-line binary exists in the system PATH.
 * Uses platform-appropriate existence check: `where` on Windows, `command -v` on Unix.
 *
 * @param {string} cmd - Binary name to search for (e.g. 'codex', 'gemini').
 * @returns {boolean} True if the binary is found and executable.
 */
function commandExists(cmd) {
  try {
    const check = os.platform() === 'win32'
      ? `where ${cmd}`        // Windows: where.exe searches PATH
      : `command -v ${cmd}`;  // Unix: shell built-in, no subprocess needed
    execSync(check, { stdio: 'ignore' });
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Detects which AI coding platform is currently active by inspecting
 * environment variables first, then falling back to PATH binary checks.
 * Priority order matches likelihood of each platform being in use.
 *
 * @returns {string} Platform identifier: 'claude-code' | 'cursor' | 'codex' |
 *                   'opencode' | 'gemini' | 'generic'.
 */
function detectPlatform() {
  if (process.env.CLAUDE_PLUGIN_ROOT) return 'claude-code';
  if (process.env.CURSOR_PLUGIN_ROOT) return 'cursor';
  // Codex sets CODEX env var when active; also detectable via binary
  if (process.env.CODEX || commandExists('codex')) return 'codex';
  if (process.env.OPENCODE) return 'opencode';
  // Gemini CLI sets GEMINI_CLI env var; also detectable via binary
  if (process.env.GEMINI_CLI || commandExists('gemini')) return 'gemini';
  // No recognized platform detected — emit generic JSON that any agent can parse
  return 'generic';
}

/**
 * Platform-specific instructions embedded in the injection JSON.
 * Each instruction tells the agent how to activate skills in that environment.
 * The 'generic' fallback works for any agent that receives the JSON.
 */
const INSTRUCTIONS = {
  'claude-code': 'You have ClawPowers skills loaded. Read the content above to understand available skills and how to trigger them. Skills activate automatically when you recognize a matching task pattern.',
  'cursor':      'ClawPowers skills are available in this Cursor session. Trigger skills by recognizing task patterns described in the using-clawpowers skill above.',
  'codex':       'ClawPowers loaded for Codex session. Apply skills based on task pattern recognition.',
  'opencode':    'ClawPowers loaded for OpenCode session. Skills activate on pattern recognition.',
  'gemini':      'ClawPowers loaded for Gemini CLI session. Recognize task patterns to activate skills.',
  'generic':     'ClawPowers skills loaded. Use the using-clawpowers skill content to understand available capabilities.',
};

/**
 * Main entry point.
 *
 * 1. Silently initializes the runtime directory if it doesn't exist yet
 *    (first-run scenario when called directly from a platform hook).
 * 2. Reads the using-clawpowers SKILL.md file.
 * 3. Detects the active platform.
 * 4. Emits a structured JSON object to stdout for the platform to consume.
 */
function main() {
  // Auto-initialize runtime on first run so the hook works without a manual `init` step.
  // CLAWPOWERS_QUIET=1 suppresses all init output to avoid polluting the JSON stream.
  const clawpowersDir = process.env.CLAWPOWERS_DIR || path.join(os.homedir(), '.clawpowers');
  if (!fs.existsSync(clawpowersDir) && fs.existsSync(INIT_JS)) {
    try {
      const init = require(INIT_JS);
      // Save and restore CLAWPOWERS_QUIET so we don't clobber an existing value
      const orig = process.env.CLAWPOWERS_QUIET;
      process.env.CLAWPOWERS_QUIET = '1';
      init.main();
      if (orig === undefined) delete process.env.CLAWPOWERS_QUIET;
      else process.env.CLAWPOWERS_QUIET = orig;
    } catch (_) { /* non-fatal: proceed even if init fails */ }
  }

  // Skill file is required — output a machine-readable error JSON if missing
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

  // Structured injection payload — platforms parse this to load skills into context
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
