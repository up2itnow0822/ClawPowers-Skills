#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('p1 lockfile-only alias via resolved pathname FAIL F4', () => {
  const result = assertFail('p1', join(fixtures, 'p1'), [
    /FAIL F4 package-lock\.json:node_modules\/picomatch/,
  ]);
  process.stdout.write(`p1 FAIL ${result.out}`);
});

test('p5 root lock entry npm: alias FAIL', () => {
  const result = assertFail('p5', join(fixtures, 'p5'), [
    /FAIL F1 package-lock\.json:\(root\)\.dependencies\.picomatch/,
  ]);
  process.stdout.write(`p5 FAIL ${result.out}`);
});

test('c1-http-npmrc http registry FAIL', () => {
  const result = assertFail('c1-http-npmrc', join(fixtures, 'c1-http-npmrc'), [
    /FAIL F6 \.npmrc registry/,
  ]);
  process.stdout.write(`c1-http-npmrc FAIL ${result.out}`);
});

test('c1-http-scoped-npmrc http scoped registry FAIL', () => {
  const result = assertFail('c1-http-scoped-npmrc', join(fixtures, 'c1-http-scoped-npmrc'), [
    /FAIL F6 \.npmrc @foo:registry/,
  ]);
  process.stdout.write(`c1-http-scoped-npmrc FAIL ${result.out}`);
});

test('c1-http-publishconfig http publishConfig FAIL', () => {
  const result = assertFail('c1-http-publishconfig', join(fixtures, 'c1-http-publishconfig'), [
    /FAIL F6 package\.json:publishConfig\.registry/,
  ]);
  process.stdout.write(`c1-http-publishconfig FAIL ${result.out}`);
});

test('c1-http-resolved http lock resolved FAIL', () => {
  const result = assertFail('c1-http-resolved', join(fixtures, 'c1-http-resolved'), [
    /FAIL F3 package-lock\.json:node_modules\/foo/,
  ]);
  process.stdout.write(`c1-http-resolved FAIL ${result.out}`);
});

test('c2-shrinkwrap-only-clean PASS', () => {
  const result = assertPass('c2-shrinkwrap-only-clean', join(fixtures, 'c2-shrinkwrap-only-clean'));
  process.stdout.write(`c2-shrinkwrap-only-clean PASS ${result.out}`);
});

test('c2-shrinkwrap-evil FAIL', () => {
  const result = assertFail('c2-shrinkwrap-evil', join(fixtures, 'c2-shrinkwrap-evil'), [
    /FAIL F3 npm-shrinkwrap\.json:node_modules\/foo/,
  ]);
  process.stdout.write(`c2-shrinkwrap-evil FAIL ${result.out}`);
});

test('c2-lock-and-shrinkwrap-differ FAIL', () => {
  const result = assertFail('c2-lock-and-shrinkwrap-differ', join(fixtures, 'c2-lock-and-shrinkwrap-differ'), [
    /FAIL F7 npm-shrinkwrap\.json/,
  ]);
  process.stdout.write(`c2-lock-and-shrinkwrap-differ FAIL ${result.out}`);
});

test('c3-pnpm unvalidated pnpm-lock FAIL', () => {
  const result = assertFail('c3-pnpm', join(fixtures, 'c3-pnpm'), [
    /FAIL F7 pnpm-lock\.yaml/,
  ]);
  process.stdout.write(`c3-pnpm FAIL ${result.out}`);
});

test('c3-yarn unvalidated yarn.lock FAIL', () => {
  const result = assertFail('c3-yarn', join(fixtures, 'c3-yarn'), [
    /FAIL F7 yarn\.lock/,
  ]);
  process.stdout.write(`c3-yarn FAIL ${result.out}`);
});

test('c3 build.yml never installs from an unchecked lockfile', () => {
  const yml = readFileSync(join(repoRoot, '.github/workflows/build.yml'), 'utf8');
  assert.doesNotMatch(yml, /pnpm install/);
  assert.doesNotMatch(yml, /yarn install/);
  assert.doesNotMatch(yml, /npm ci \|\| npm install/);
  assert.match(yml, /pnpm-lock\.yaml/);
  assert.match(yml, /yarn\.lock/);
  process.stdout.write('c3-build-yml PASS\n');
});

test('c4-workspace-valid PASS', () => {
  const result = assertPass('c4-workspace-valid', join(fixtures, 'c4-workspace-valid'));
  process.stdout.write(`c4-workspace-valid PASS ${result.out}`);
});

test('c4-workspace-escape ../outside FAIL', () => {
  const result = assertFail('c4-workspace-escape', join(fixtures, 'c4-workspace-escape'), [
    /FAIL F3 package-lock\.json:node_modules\/a/,
  ]);
  process.stdout.write(`c4-workspace-escape FAIL ${result.out}`);
});

test('c4-workspace-bad-registry FAIL', () => {
  const result = assertFail('c4-workspace-bad-registry', join(fixtures, 'c4-workspace-bad-registry'), [
    /FAIL F3 package-lock\.json:packages\/a/,
  ]);
  process.stdout.write(`c4-workspace-bad-registry FAIL ${result.out}`);
});

test('c5-inbundle-ok under passing parent PASS', () => {
  const result = assertPass('c5-inbundle-ok', join(fixtures, 'c5-inbundle-ok'));
  process.stdout.write(`c5-inbundle-ok PASS ${result.out}`);
});

test('c5-inbundle-bad-parent FAIL', () => {
  const result = assertFail('c5-inbundle-bad-parent', join(fixtures, 'c5-inbundle-bad-parent'), [
    /FAIL F3 package-lock\.json:node_modules\/b/,
    /FAIL F3 package-lock\.json:node_modules\/b\/node_modules\/c/,
  ]);
  process.stdout.write(`c5-inbundle-bad-parent FAIL ${result.out}`);
});

test('n8 quoted .npmrc registry key FAIL F6', () => {
  const result = assertFail('n8', join(fixtures, 'n8-quoted-registry'), [
    /FAIL F6 \.npmrc registry/,
  ]);
  process.stdout.write(`n8 FAIL ${result.out}`);
});

test('n13 quoted .npmrc scoped registry key FAIL F6', () => {
  const result = assertFail('n13', join(fixtures, 'n13-quoted-scoped-registry'), [
    /FAIL F6 \.npmrc @foo:registry/,
  ]);
  process.stdout.write(`n13 FAIL ${result.out}`);
});

test('d1 lock key ../outside FAIL F8', () => {
  const result = assertFail('d1', join(fixtures, 'd1-dotdot-outside'), [
    /FAIL F8 package-lock\.json:\.\.\/outside/,
    /path escapes repo root/,
  ]);
  process.stdout.write(`d1 FAIL ${result.out}`);
});

test('d2 lock key /tmp/outside FAIL F8', () => {
  const result = assertFail('d2', join(fixtures, 'd2-abs-outside'), [
    /FAIL F8 package-lock\.json:\/tmp\/outside/,
    /path escapes repo root/,
  ]);
  process.stdout.write(`d2 FAIL ${result.out}`);
});

test('d6 packages/a symlink out FAIL F8', () => {
  const result = assertFail('d6', join(fixtures, 'd6-symlink-out'), [
    /FAIL F8 package-lock\.json:packages\/a/,
    /path escapes repo root/,
  ]);
  process.stdout.write(`d6 FAIL ${result.out}`);
});

test('d10 folder resolved ../../evil FAIL F8', () => {
  const result = assertFail('d10', join(fixtures, 'd10-folder-resolved-escape'), [
    /FAIL F8 package-lock\.json:packages\/a/,
    /path escapes repo root/,
  ]);
  process.stdout.write(`d10 FAIL ${result.out}`);
});

test('e1 inBundle git under workspace parent FAIL', () => {
  const result = assertFail('e1', join(fixtures, 'e1-inbundle-under-workspace'), [
    /FAIL F3 package-lock\.json:packages\/a\/node_modules\/evil/,
  ]);
  process.stdout.write(`e1 FAIL ${result.out}`);
});

test('e2 inBundle git under link parent FAIL', () => {
  const result = assertFail('e2', join(fixtures, 'e2-inbundle-under-link'), [
    /FAIL F3 package-lock\.json:node_modules\/a\/node_modules\/evil/,
  ]);
  process.stdout.write(`e2 FAIL ${result.out}`);
});

test('b1-cr-only-lines CR line break FAIL', () => {
  const result = assertFail('b1-cr-only-lines', join(fixtures, 'b1-cr-only-lines'), [
    /FAIL F6 \.npmrc registry/,
  ]);
  process.stdout.write(`b1-cr-only-lines FAIL ${result.out}`);
});

test('b1-env-optional-key FAIL F7', () => {
  const result = assertFail('b1-env-optional-key', join(fixtures, 'b1-env-optional-key'), [
    /FAIL F7 \.npmrc/,
  ]);
  process.stdout.write(`b1-env-optional-key FAIL ${result.out}`);
});

test('b1-env-optional-scoped FAIL F7', () => {
  const result = assertFail('b1-env-optional-scoped', join(fixtures, 'b1-env-optional-scoped'), [
    /FAIL F7 \.npmrc/,
  ]);
  process.stdout.write(`b1-env-optional-scoped FAIL ${result.out}`);
});

test('b1-json-unicode-escape FAIL F6', () => {
  const result = assertFail('b1-json-unicode-escape', join(fixtures, 'b1-json-unicode-escape'), [
    /FAIL F6 \.npmrc registry/,
  ]);
  process.stdout.write(`b1-json-unicode-escape FAIL ${result.out}`);
});

test('b1-json-unicode-scoped FAIL F6', () => {
  const result = assertFail('b1-json-unicode-scoped', join(fixtures, 'b1-json-unicode-scoped'), [
    /FAIL F6 \.npmrc @foo:registry/,
  ]);
  process.stdout.write(`b1-json-unicode-scoped FAIL ${result.out}`);
});

test('b1-key-hash-comment FAIL F6', () => {
  const result = assertFail('b1-key-hash-comment', join(fixtures, 'b1-key-hash-comment'), [
    /FAIL F6 \.npmrc registry/,
  ]);
  process.stdout.write(`b1-key-hash-comment FAIL ${result.out}`);
});

test('b1-key-semicolon-comment FAIL F6', () => {
  const result = assertFail('b1-key-semicolon-comment', join(fixtures, 'b1-key-semicolon-comment'), [
    /FAIL F6 \.npmrc registry/,
  ]);
  process.stdout.write(`b1-key-semicolon-comment FAIL ${result.out}`);
});

test('b1-scoped-key-hash-comment FAIL F6', () => {
  const result = assertFail('b1-scoped-key-hash-comment', join(fixtures, 'b1-scoped-key-hash-comment'), [
    /FAIL F6 \.npmrc @foo:registry/,
  ]);
  process.stdout.write(`b1-scoped-key-hash-comment FAIL ${result.out}`);
});

test('v1-value-escaped-semicolon-userinfo FAIL F6', () => {
  const result = assertFail('v1-value-escaped-semicolon-userinfo', join(fixtures, 'v1-value-escaped-semicolon-userinfo'), [
    /FAIL F6 \.npmrc registry/,
  ]);
  process.stdout.write(`v1-value-escaped-semicolon-userinfo FAIL ${result.out}`);
});

test('v5-scoped-escaped-semicolon FAIL F6', () => {
  const result = assertFail('v5-scoped-escaped-semicolon', join(fixtures, 'v5-scoped-escaped-semicolon'), [
    /FAIL F6 \.npmrc @foo:registry/,
  ]);
  process.stdout.write(`v5-scoped-escaped-semicolon FAIL ${result.out}`);
});

test('v6-value-dq-json-escape FAIL F6', () => {
  const result = assertFail('v6-value-dq-json-escape', join(fixtures, 'v6-value-dq-json-escape'), [
    /FAIL F6 \.npmrc registry/,
  ]);
  process.stdout.write(`v6-value-dq-json-escape FAIL ${result.out}`);
});

test('b1-clean-npmrc allowed registry, auth token, trailing comment PASS', () => {
  const result = assertPass('b1-clean-npmrc', join(fixtures, 'b1-clean-npmrc'));
  process.stdout.write(`b1-clean-npmrc PASS ${result.out}`);
});

test('c1-userconfig-indirect FAIL F7', () => {
  const result = assertFail('c1-userconfig-indirect', join(fixtures, 'c1-userconfig-indirect'), [
    /FAIL F7 \.npmrc userconfig/,
  ]);
  process.stdout.write(`c1-userconfig-indirect FAIL ${result.out}`);
});

test('c2-globalconfig-indirect FAIL F7', () => {
  const result = assertFail('c2-globalconfig-indirect', join(fixtures, 'c2-globalconfig-indirect'), [
    /FAIL F7 \.npmrc globalconfig/,
  ]);
  process.stdout.write(`c2-globalconfig-indirect FAIL ${result.out}`);
});

test('c25-replace-registry-host FAIL F7', () => {
  const result = assertFail('c25-replace-registry-host', join(fixtures, 'c25-replace-registry-host'), [
    /FAIL F7 \.npmrc replace-registry-host/,
  ]);
  process.stdout.write(`c25-replace-registry-host FAIL ${result.out}`);
});
