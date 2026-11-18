#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const script = join(repoRoot, 'scripts', 'check-dependency-sources.mjs');
const fixtures = join(repoRoot, 'test', 'fixtures', 'dep-sources');

function check(root) {
  const result = spawnSync(process.execPath, [script, root], {
    encoding: 'utf8',
    cwd: repoRoot,
    env: { PATH: process.env.PATH },
  });
  return {
    status: result.status,
    out: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    error: result.error,
  };
}

function assertFail(label, root, substrings) {
  const result = check(root);
  assert.equal(result.error, undefined, `${label} spawn error`);
  assert.equal(result.status, 1, `${label} expected FAIL, got ${result.status}\n${result.out}`);
  for (const snippet of substrings) {
    assert.match(result.out, snippet, `${label} missing ${snippet}\n${result.out}`);
  }
  return result;
}

function assertPass(label, root, substrings = []) {
  const result = check(root);
  assert.equal(result.error, undefined, `${label} spawn error`);
  assert.equal(result.status, 0, `${label} expected PASS, got ${result.status}\n${result.out}`);
  for (const snippet of substrings) {
    assert.match(result.out, snippet, `${label} missing ${snippet}\n${result.out}`);
  }
  return result;
}

test('T0 repo current package.json/lockfile PASS', () => {
  const result = assertPass('T0', repoRoot, [/allowlist entries:/]);
  process.stdout.write(`T0 PASS\n${result.out}`);
});

test('T1 overrides npm: alias FAIL', () => {
  const result = assertFail('T1', join(fixtures, 't1'), [
    /FAIL F1 package\.json:overrides\.picomatch/,
  ]);
  process.stdout.write(`T1 FAIL ${result.out}`);
});

test('T2 nested override npm: alias FAIL', () => {
  const result = assertFail('T2', join(fixtures, 't2'), [
    /FAIL F1 package\.json:overrides\.vitest\.picomatch/,
  ]);
  process.stdout.write(`T2 FAIL ${result.out}`);
});

test('T3 devDependency npm: alias FAIL', () => {
  const result = assertFail('T3', join(fixtures, 't3'), [
    /FAIL F1 package\.json:devDependencies\.foo/,
  ]);
  process.stdout.write(`T3 FAIL ${result.out}`);
});

test('T4 git+https spec FAIL', () => {
  const result = assertFail('T4-git', join(fixtures, 't4-git'), [
    /FAIL F2 package\.json:dependencies\.foo/,
  ]);
  process.stdout.write(`T4-git FAIL ${result.out}`);
});

test('T4 github:user/repo spec FAIL', () => {
  const result = assertFail('T4-github', join(fixtures, 't4-github'), [
    /FAIL F2 package\.json:dependencies\.foo/,
  ]);
  process.stdout.write(`T4-github FAIL ${result.out}`);
});

test('T4 https tarball spec FAIL', () => {
  const result = assertFail('T4-tarball', join(fixtures, 't4-tarball'), [
    /FAIL F2 package\.json:dependencies\.foo/,
  ]);
  process.stdout.write(`T4-tarball FAIL ${result.out}`);
});

test('T4 file: spec FAIL', () => {
  const result = assertFail('T4-file', join(fixtures, 't4-file'), [
    /FAIL F2 package\.json:dependencies\.foo/,
  ]);
  process.stdout.write(`T4-file FAIL ${result.out}`);
});

test('T5 lock resolved from non-npmjs host FAIL', () => {
  const result = assertFail('T5', join(fixtures, 't5'), [
    /FAIL F3 package-lock\.json:node_modules\/foo/,
  ]);
  process.stdout.write(`T5 FAIL ${result.out}`);
});

test('T6 lock name mismatch at node_modules/picomatch FAIL', () => {
  const result = assertFail('T6', join(fixtures, 't6'), [
    /FAIL F4 package-lock\.json:node_modules\/picomatch/,
  ]);
  process.stdout.write(`T6 FAIL ${result.out}`);
});

test('T7 lock entry missing integrity FAIL', () => {
  const result = assertFail('T7', join(fixtures, 't7'), [
    /FAIL F5 package-lock\.json:node_modules\/foo/,
  ]);
  process.stdout.write(`T7 FAIL ${result.out}`);
});

test('T8 .npmrc registry host FAIL', () => {
  const result = assertFail('T8', join(fixtures, 't8'), [
    /FAIL F6 \.npmrc registry/,
  ]);
  process.stdout.write(`T8 FAIL ${result.out}`);
});

test('T9 malformed lockfile FAIL', () => {
  const result = assertFail('T9-malformed', join(fixtures, 't9-malformed'), [
    /FAIL F7 package-lock\.json \(parse error\)/,
  ]);
  process.stdout.write(`T9-malformed FAIL ${result.out}`);
});

test('T9 missing lockfile FAIL', () => {
  const result = assertFail('T9-missing', join(fixtures, 't9-missing'), [
    /FAIL F7 package-lock\.json \(missing lockfile\)/,
  ]);
  process.stdout.write(`T9-missing FAIL ${result.out}`);
});

test('T10 allowlisted entry PASS and printed', () => {
  const result = assertPass('T10', join(fixtures, 't10'), [
    /allowlist entries:/,
    /package\.json:devDependencies\.foo/,
    /allowlisted F1 package\.json:devDependencies\.foo/,
  ]);
  process.stdout.write(`T10 PASS ${result.out}`);
});

test('replay 79592d6 picomatch override + lock name mismatch FAIL', () => {
  const result = assertFail('replay-79592d6', join(fixtures, 'replay-79592d6'), [
    /FAIL F1 package\.json:overrides\.picomatch/,
    /FAIL F4 package-lock\.json:node_modules\/picomatch/,
  ]);
  process.stdout.write(`replay-79592d6 FAIL ${result.out}`);
});
