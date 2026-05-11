#!/usr/bin/env node
/**
 * Build the Node-targeted WASM fallback when wasm-pack is available.
 *
 * Release/source checkouts may already contain committed pkg-node artifacts. In
 * that case, do not fail prepack on machines that lack Rust/wasm-pack; verify
 * the required artifacts are present and let the TypeScript fallback package.
 */
import { existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wasmDir = resolve(root, 'native/wasm');
const outDir = resolve(wasmDir, 'pkg-node');
const requiredArtifacts = [
  resolve(outDir, 'clawpowers_wasm.js'),
  resolve(outDir, 'clawpowers_wasm_bg.wasm'),
];

function haveRequiredArtifacts() {
  return requiredArtifacts.every(path => existsSync(path));
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });
}

const version = run('wasm-pack', ['--version'], { stdio: 'ignore' });

if (version.status !== 0) {
  if (haveRequiredArtifacts()) {
    console.warn('[clawpowers] wasm-pack not found; using existing native/wasm/pkg-node artifacts.');
    process.exit(0);
  }

  console.error('[clawpowers] wasm-pack is required because native/wasm/pkg-node artifacts are missing.');
  process.exit(version.status ?? 1);
}

const build = run('wasm-pack', ['build', '--target', 'nodejs', '--out-dir', 'pkg-node'], {
  cwd: wasmDir,
});

if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

rmSync(resolve(outDir, '.gitignore'), { force: true });

if (!haveRequiredArtifacts()) {
  console.error('[clawpowers] wasm-pack completed but required pkg-node artifacts are missing.');
  process.exit(1);
}
