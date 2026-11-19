#!/usr/bin/env node
/**
 * Blocking dependency-source check (SEC-20261117-02).
 *
 * Reads package.json, package-lock.json, npm-shrinkwrap.json, and .npmrc
 * from disk. No network. Node built-ins only. No --skip flag, no env bypass.
 *
 * Usage: node scripts/check-dependency-sources.mjs [rootDir]
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const DEP_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
  'overrides',
];

const ROOT_SPEC_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];

const ALLOWED_REGISTRY_HOST = 'registry.npmjs.org';
const ALLOWED_RESOLVED_PREFIX = 'https://registry.npmjs.org/';
const ALLOWLIST_REL = join('scripts', 'dependency-sources-allowlist.json');

function failClosed(findings, key, reason) {
  findings.push({ code: 'F7', key, reason });
}

function readText(path) {
  return readFileSync(path, 'utf8');
}

function parseJsonOrNull(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return { ok: false, error: err };
  }
}

function loadAllowlist(root, findings) {
  const path = join(root, ALLOWLIST_REL);
  if (!existsSync(path)) {
    return [];
  }
  const parsed = parseJsonOrNull(readText(path));
  if (!parsed.ok) {
    failClosed(findings, ALLOWLIST_REL, 'parse error');
    return [];
  }
  const value = parsed.value;
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && Array.isArray(value.entries)) {
    return value.entries;
  }
  failClosed(findings, ALLOWLIST_REL, 'parse error');
  return [];
}

function allowlistKey(entry) {
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object' && typeof entry.key === 'string') {
    return entry.key;
  }
  return null;
}

function printAllowlist(entries) {
  process.stdout.write('allowlist entries:\n');
  if (entries.length === 0) {
    process.stdout.write('  (empty)\n');
    return;
  }
  for (const entry of entries) {
    process.stdout.write(`  ${JSON.stringify(entry)}\n`);
  }
}

function isNpmAlias(spec) {
  return spec.startsWith('npm:');
}

function hasProtocol(spec) {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(spec);
}

function isGithubShorthand(spec) {
  if (spec.startsWith('@')) return false;
  if (spec.includes(':')) return false;
  return /^[^/\s]+\/[^/\s]+(?:#.*)?$/.test(spec);
}

function classifyManifestSpec(spec) {
  const trimmed = spec.trim();
  if (isNpmAlias(trimmed)) return 'F1';
  if (hasProtocol(trimmed) || trimmed.startsWith('git+') || isGithubShorthand(trimmed)) {
    return 'F2';
  }
  return null;
}

function walkSpecs(value, keyPath, findings) {
  if (value == null) return;
  if (typeof value === 'string') {
    const code = classifyManifestSpec(value);
    if (code === 'F1') {
      findings.push({
        code: 'F1',
        key: keyPath,
        reason: 'npm: alias',
      });
    } else if (code === 'F2') {
      findings.push({
        code: 'F2',
        key: keyPath,
        reason: 'non-registry spec',
      });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      walkSpecs(item, `${keyPath}[${index}]`, findings);
    });
    return;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      walkSpecs(v, `${keyPath}.${k}`, findings);
    }
  }
}

function checkManifest(pkg, findings) {
  for (const field of DEP_FIELDS) {
    if (!Object.hasOwn(pkg, field)) continue;
    walkSpecs(pkg[field], `package.json:${field}`, findings);
  }
  checkPublishConfig(pkg, findings);
}

function impliedNameFromLockKey(key) {
  if (key === '' || key === '.') return null;
  const marker = 'node_modules/';
  const idx = key.lastIndexOf(marker);
  if (idx === -1) return null;
  const rest = key.slice(idx + marker.length);
  if (!rest) return null;
  if (rest.startsWith('@')) {
    const parts = rest.split('/');
    if (parts.length < 2 || !parts[1]) return null;
    return `${parts[0]}/${parts[1]}`;
  }
  return rest.split('/')[0] || null;
}

function resolvedPathnamePrefix(implied) {
  return `/${implied}/-/`;
}

function resolvedPathnameMatchesImplied(resolved, implied) {
  if (typeof resolved !== 'string' || resolved.length === 0) return true;
  let url;
  try {
    url = new URL(resolved);
  } catch {
    return true;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return true;
  let pathname = url.pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    pathname = url.pathname;
  }
  return pathname.startsWith(resolvedPathnamePrefix(implied));
}

function isNpmjsResolved(resolved) {
  if (typeof resolved !== 'string' || resolved.length === 0) return false;
  try {
    const url = new URL(resolved);
    if (url.username || url.password) return false;
    if (url.protocol !== 'https:') return false;
    if (url.hostname !== ALLOWED_REGISTRY_HOST) return false;
    return resolved.startsWith(ALLOWED_RESOLVED_PREFIX);
  } catch {
    return false;
  }
}

function isAbsoluteLike(p) {
  const n = String(p).replaceAll('\\', '/');
  return n.startsWith('/') || /^[A-Za-z]:/.test(n);
}

function hasDotDotSegment(p) {
  return String(p).split(/[\\/]/).includes('..');
}

function pathStaysInsideRepo(root, relPath) {
  if (typeof relPath !== 'string' || relPath.length === 0) return false;
  if (hasProtocol(relPath)) return false;
  const posix = relPath.replaceAll('\\', '/');
  if (isAbsoluteLike(posix)) return false;
  if (hasDotDotSegment(posix)) return false;
  let rootReal;
  try {
    rootReal = realpathSync(root);
  } catch {
    rootReal = resolve(root);
  }
  const candidate = resolve(rootReal, posix);
  const relToRoot = relative(rootReal, candidate);
  if (relToRoot.startsWith('..') || isAbsolute(relToRoot)) return false;
  try {
    const real = realpathSync(candidate);
    const relReal = relative(rootReal, real);
    if (relReal.startsWith('..') || isAbsolute(relReal)) return false;
  } catch {
    // Path does not exist; the normalized path is already inside the root.
  }
  return true;
}

function isLocalWorkspaceRecord(root, key, entry) {
  if (typeof entry.resolved === 'string' && hasProtocol(entry.resolved)) {
    return false;
  }
  if (entry.link === true) {
    return pathStaysInsideRepo(root, entry.resolved);
  }
  if (!key.includes('node_modules/')) {
    return pathStaysInsideRepo(root, key);
  }
  return false;
}

function parentLockKey(key) {
  const marker = '/node_modules/';
  const idx = key.lastIndexOf(marker);
  if (idx <= 0) return null;
  return key.slice(0, idx);
}

function lockEntryKey(lockLabel, key) {
  return key === '' ? `${lockLabel}:(root)` : `${lockLabel}:${key}`;
}

function baseRecordFindings(root, lockLabel, key, entry) {
  const findings = [];
  const lockKey = lockEntryKey(lockLabel, key);
  if (isLocalWorkspaceRecord(root, key, entry)) {
    return { workspace: true, findings };
  }
  if (!isNpmjsResolved(entry.resolved)) {
    findings.push({
      code: 'F3',
      key: lockKey,
      reason: 'resolved is not https://registry.npmjs.org/',
    });
  }
  if (typeof entry.integrity !== 'string' || entry.integrity.length === 0) {
    findings.push({
      code: 'F5',
      key: lockKey,
      reason: 'missing integrity',
    });
  }
  const implied = impliedNameFromLockKey(key);
  if (implied) {
    if (
      typeof entry.name === 'string' &&
      entry.name.length > 0 &&
      entry.name !== implied
    ) {
      findings.push({
        code: 'F4',
        key: lockKey,
        reason: `name differs from path-implied ${implied}`,
      });
    }
    if (!resolvedPathnameMatchesImplied(entry.resolved, implied)) {
      findings.push({
        code: 'F4',
        key: lockKey,
        reason: `resolved pathname does not start with ${resolvedPathnamePrefix(implied)}`,
      });
    }
  }
  return { workspace: false, findings };
}

function checkLockObject(lock, lockLabel, root, findings) {
  if (!lock || typeof lock !== 'object' || Array.isArray(lock)) {
    failClosed(findings, lockLabel, 'parse error');
    return;
  }
  if (typeof lock.lockfileVersion !== 'number' || lock.lockfileVersion < 2) {
    failClosed(findings, lockLabel, 'lockfileVersion < 2');
    return;
  }
  const packages = lock.packages;
  if (!packages || typeof packages !== 'object' || Array.isArray(packages)) {
    failClosed(findings, lockLabel, 'parse error');
    return;
  }

  const bases = new Map();
  for (const [key, entry] of Object.entries(packages)) {
    const lockKey = lockEntryKey(lockLabel, key);
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      failClosed(findings, lockKey, 'parse error');
      continue;
    }
    if (key === '') {
      for (const field of ROOT_SPEC_FIELDS) {
        if (!Object.hasOwn(entry, field)) continue;
        walkSpecs(entry[field], `${lockKey}.${field}`, findings);
      }
      continue;
    }
    bases.set(key, {
      entry,
      ...baseRecordFindings(root, lockLabel, key, entry),
    });
  }

  for (const [key, base] of bases) {
    if (base.workspace) continue;
    const bundled = base.entry.inBundle === true;
    const parent = parentLockKey(key);
    const parentBase = parent ? bases.get(parent) : undefined;
    const parentClean = Boolean(parentBase && parentBase.findings.length === 0);
    if (bundled && parentClean) {
      for (const finding of base.findings) {
        if (finding.code === 'F4') findings.push(finding);
      }
      continue;
    }
    findings.push(...base.findings);
  }
}

function loadLockObject(path, label, findings) {
  if (!existsSync(path)) return null;
  const parsed = parseJsonOrNull(readText(path));
  if (!parsed.ok) {
    failClosed(findings, label, 'parse error');
    return null;
  }
  return parsed.value;
}

function checkLockfiles(root, findings) {
  const lockPath = join(root, 'package-lock.json');
  const shrinkPath = join(root, 'npm-shrinkwrap.json');
  const hasLock = existsSync(lockPath);
  const hasShrink = existsSync(shrinkPath);
  if (!hasLock && !hasShrink) {
    failClosed(findings, 'package-lock.json', 'missing lockfile');
    return;
  }
  if (hasLock && hasShrink) {
    const lock = loadLockObject(lockPath, 'package-lock.json', findings);
    const shrink = loadLockObject(shrinkPath, 'npm-shrinkwrap.json', findings);
    if (!lock || !shrink) return;
    if (!isDeepStrictEqual(lock, shrink)) {
      failClosed(findings, 'npm-shrinkwrap.json', 'differs from package-lock.json');
      return;
    }
    checkLockObject(lock, 'package-lock.json', root, findings);
    return;
  }
  if (hasLock) {
    const lock = loadLockObject(lockPath, 'package-lock.json', findings);
    if (!lock) return;
    checkLockObject(lock, 'package-lock.json', root, findings);
    return;
  }
  const shrink = loadLockObject(shrinkPath, 'npm-shrinkwrap.json', findings);
  if (!shrink) return;
  checkLockObject(shrink, 'npm-shrinkwrap.json', root, findings);
}

function checkUncheckedAlternateLockfiles(root, findings) {
  if (existsSync(join(root, 'pnpm-lock.yaml'))) {
    failClosed(findings, 'pnpm-lock.yaml', 'present and not validated');
  }
  if (existsSync(join(root, 'yarn.lock'))) {
    failClosed(findings, 'yarn.lock', 'present and not validated');
  }
}

function isRegistryNpmrcKey(key) {
  return key === 'registry' || /^@[A-Za-z0-9_.~-]+:registry$/.test(key);
}

function stripQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function registryUrlAllowed(value) {
  const raw = stripQuotes(String(value)).trim();
  if (!raw) return false;
  try {
    const url = new URL(raw);
    if (url.username || url.password) return false;
    if (url.protocol !== 'https:') return false;
    return url.hostname === ALLOWED_REGISTRY_HOST;
  } catch {
    return false;
  }
}

function registryRejectReason(value) {
  try {
    const url = new URL(stripQuotes(String(value)).trim());
    if (url.hostname === ALLOWED_REGISTRY_HOST && url.protocol !== 'https:') {
      return 'registry is not https://registry.npmjs.org';
    }
  } catch {
    // ignore parse errors; never print the value
  }
  return 'registry host is not registry.npmjs.org';
}

function checkPublishConfig(pkg, findings) {
  const pc = pkg.publishConfig;
  if (!pc || typeof pc !== 'object' || Array.isArray(pc)) return;
  for (const [key, value] of Object.entries(pc)) {
    if (!isRegistryNpmrcKey(key)) continue;
    if (typeof value !== 'string' || !registryUrlAllowed(value)) {
      findings.push({
        code: 'F6',
        key: `package.json:publishConfig.${key}`,
        reason: registryRejectReason(value),
      });
    }
  }
}

function checkNpmrc(root, findings) {
  const npmrcPath = join(root, '.npmrc');
  if (!existsSync(npmrcPath)) return;
  const text = readText(npmrcPath);
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i].trim();
    if (!raw || raw.startsWith('#') || raw.startsWith(';')) continue;
    const eq = raw.indexOf('=');
    if (eq === -1) continue;
    const key = raw.slice(0, eq).trim();
    const value = raw.slice(eq + 1).trim();
    if (!isRegistryNpmrcKey(key)) continue;
    if (!registryUrlAllowed(value)) {
      findings.push({
        code: 'F6',
        key: `.npmrc ${key}`,
        reason: registryRejectReason(value),
      });
    }
  }
}

function printFinding(prefix, finding) {
  process.stderr.write(
    `${prefix} ${finding.code} ${finding.key} (${finding.reason})\n`,
  );
}

function run(root) {
  const findings = [];
  const pkgPath = join(root, 'package.json');
  if (!existsSync(pkgPath)) {
    failClosed(findings, 'package.json', 'missing package.json');
    printAllowlist([]);
    for (const finding of findings) printFinding('FAIL', finding);
    return 1;
  }

  const parsedPkg = parseJsonOrNull(readText(pkgPath));
  if (!parsedPkg.ok || !parsedPkg.value || typeof parsedPkg.value !== 'object') {
    failClosed(findings, 'package.json', 'parse error');
    printAllowlist([]);
    for (const finding of findings) printFinding('FAIL', finding);
    return 1;
  }
  const pkg = parsedPkg.value;
  const allowlist = loadAllowlist(root, findings);
  printAllowlist(allowlist);

  const allowlistedKeys = new Set(
    allowlist.map(allowlistKey).filter((key) => typeof key === 'string'),
  );

  checkUncheckedAlternateLockfiles(root, findings);
  checkManifest(pkg, findings);
  checkLockfiles(root, findings);
  checkNpmrc(root, findings);

  let failed = 0;
  for (const finding of findings) {
    if (finding.code !== 'F7' && allowlistedKeys.has(finding.key)) {
      printFinding('allowlisted', finding);
      continue;
    }
    printFinding('FAIL', finding);
    failed += 1;
  }
  return failed === 0 ? 0 : 1;
}

function main(argv) {
  for (const arg of argv) {
    if (arg.startsWith('-')) {
      process.stderr.write('FAIL F7 argv (unknown flag; no skip or bypass is supported)\n');
      return 1;
    }
  }
  if (argv.length > 1) {
    process.stderr.write('FAIL F7 argv (extra arguments)\n');
    return 1;
  }
  const root = resolve(argv[0] ?? process.cwd());
  return run(root);
}

const invokedDirectly =
  process.argv[1] != null &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  process.exit(main(process.argv.slice(2)));
}
