#!/usr/bin/env node
/**
 * Clean consumer install smoke for the packed npm tarball.
 *
 * This catches release-only failures that local tests miss: missing dist files,
 * missing packaged skills/WASM artifacts, bad exports, and install-time metadata
 * drift between package.json and the tarball npm consumers receive.
 */
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));

function commandSpec(command, args) {
  if (command === 'npm' && process.env.npm_execpath) {
    return { command: process.execPath, args: [process.env.npm_execpath, ...args] };
  }
  return { command, args };
}

function run(command, args, options = {}) {
  const spec = commandSpec(command, args);
  const result = spawnSync(spec.command, spec.args, {
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, ...(options.env ?? {}) },
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    shell: false,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    if (options.capture) {
      process.stderr.write(result.stdout ?? '');
      process.stderr.write(result.stderr ?? '');
    }
    if (result.error) process.stderr.write(`${result.error.stack ?? result.error}\n`);
    throw new Error(`${command} ${args.join(' ')} failed with exit ${result.status}`);
  }
  return result;
}

function parsePackJson(stdout) {
  let pos = stdout.lastIndexOf('[');
  while (pos >= 0) {
    try {
      return JSON.parse(stdout.slice(pos));
    } catch {
      pos = stdout.lastIndexOf('[', pos - 1);
    }
  }
  throw new Error(`Could not parse npm pack JSON output:\n${stdout.slice(0, 800)}`);
}

const pack = run('npm', ['pack', '--json'], { capture: true });
const packed = parsePackJson(pack.stdout ?? '');
const filename = packed[0]?.filename;
if (!filename) throw new Error('npm pack did not report a tarball filename');
const tarball = resolve(repoRoot, filename);

const temp = mkdtempSync(join(tmpdir(), 'clawpowers-consumer-'));
try {
  run('npm', ['init', '-y'], { cwd: temp, capture: true });
  run('npm', ['install', tarball, '--save-exact', '--ignore-scripts'], { cwd: temp });

  const smoke = `
    import { existsSync, readdirSync } from 'node:fs';
    import { join } from 'node:path';
    import {
      VERSION,
      PACKAGE_NAME,
      initConfig,
      discoverSkills,
      deriveEthereumAddress,
      getCapabilitySummary,
    } from 'clawpowers';

    if (PACKAGE_NAME !== 'clawpowers') throw new Error('Unexpected package name: ' + PACKAGE_NAME);
    if (VERSION !== '${pkg.version}') throw new Error('Unexpected VERSION export: ' + VERSION);

    const config = initConfig();
    if (config.version !== '${pkg.version}') throw new Error('Config version drift: ' + config.version);

    const packageRoot = join(process.cwd(), 'node_modules', 'clawpowers');
    const skillsDir = join(packageRoot, 'skills');
    if (!existsSync(skillsDir)) throw new Error('Packaged skills directory missing');
    const skillCount = discoverSkills(skillsDir).length;
    if (skillCount < 20) throw new Error('Expected at least 20 packaged skills, saw ' + skillCount);

    const wasmPath = join(packageRoot, 'native', 'wasm', 'pkg-node', 'clawpowers_wasm_bg.wasm');
    if (!existsSync(wasmPath)) throw new Error('Packaged WASM fallback missing');

    const hardhat0 = Buffer.from('ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', 'hex');
    const address = deriveEthereumAddress(hardhat0);
    if (address !== '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266') {
      throw new Error('Ethereum derivation smoke failed: ' + address);
    }

    const summary = getCapabilitySummary();
    if (!summary || typeof summary !== 'object') throw new Error('Capability summary unavailable');
    console.log('consumer smoke OK: clawpowers ${pkg.version}, skills=' + skillCount);
  `;
  run('node', ['--input-type=module', '--eval', smoke], { cwd: temp });
} finally {
  rmSync(temp, { recursive: true, force: true });
  if (existsSync(tarball)) rmSync(tarball, { force: true });
}
