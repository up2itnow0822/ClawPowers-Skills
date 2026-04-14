#!/usr/bin/env node
/**
 * Verifies required WASM fallback artifacts are present in the npm tarball.
 *
 * npm pack --dry-run --json interleaves prepack build output (from tsup) on stdout
 * before the JSON array. We find the LAST '[' that starts a valid JSON array.
 */
import { spawnSync } from 'child_process';

const result = spawnSync('npm', ['pack', '--dry-run', '--json'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'], // let prepack stderr go to terminal, capture stdout
});

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
