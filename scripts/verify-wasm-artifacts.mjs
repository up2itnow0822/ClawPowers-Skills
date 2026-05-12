#!/usr/bin/env node
/**
 * Verifies required WASM fallback artifacts are present in the npm tarball.
 *
 * npm pack --dry-run --json interleaves prepack build output (from tsup) on stdout
 * before the JSON array. We find the LAST '[' that starts a valid JSON array.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

function npmCliPath() {
  if (process.env.npm_execpath) return process.env.npm_execpath;
  const appData = process.env.APPDATA;
  if (appData) {
    const candidate = join(appData, 'npm', 'node_modules', 'npm', 'bin', 'npm-cli.js');
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const cliPath = npmCliPath();
const npmCommand = cliPath ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm');
const npmArgs = cliPath
  ? [cliPath, 'pack', '--dry-run', '--json']
  : ['pack', '--dry-run', '--json'];
const result = spawnSync(npmCommand, npmArgs, {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'], // let prepack stderr go to terminal, capture stdout
  maxBuffer: 64 * 1024 * 1024,
  shell: !cliPath && process.platform === 'win32',
});

if (result.error) {
  console.error(result.error.stack ?? result.error);
}

const stdout = result.stdout ?? '';

// Find the last '[' in stdout -- npm pack JSON array always comes after prepack output
let pack;
let pos = stdout.lastIndexOf('[');
while (pos >= 0) {
  try {
    pack = JSON.parse(stdout.slice(pos));
    break;
  } catch {
    pos = stdout.lastIndexOf('[', pos - 1);
  }
}

if (!pack) {
  console.error('ERROR: Could not parse JSON array from npm pack --dry-run --json output');
  console.error('stdout (first 400 chars):', stdout.slice(0, 400));
  process.exit(1);
}

const files = (pack[0]?.files ?? []).map(f => String(f.path).replace(/^package\//, ''));

const required = [
  'native/wasm/pkg-node/clawpowers_wasm.js',
  'native/wasm/pkg-node/clawpowers_wasm_bg.wasm',
];

let ok = true;
for (const req of required) {
  if (!files.includes(req)) {
    console.error('ERROR: Missing packaged WASM artifact:', req);
    ok = false;
  }
}

if (ok) {
  console.log(`WASM artifacts present in tarball. Total files: ${files.length}`);
} else {
  process.exit(1);
}
