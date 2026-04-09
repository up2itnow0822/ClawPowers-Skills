#!/usr/bin/env node
// Verifies that required WASM fallback artifacts are present in the npm tarball.
// Run after: npm pack --dry-run --json > pack.json
import { execSync } from 'child_process';

const raw = execSync('npm pack --dry-run --json 2>/dev/null', { encoding: 'utf8' });
const idx = raw.indexOf('[');
if (idx < 0) {
  console.error('ERROR: Could not find JSON array in npm pack output');
  process.exit(1);
}
const pack = JSON.parse(raw.slice(idx));
const files = (pack[0]?.files ?? []).map(f => f.path);

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
