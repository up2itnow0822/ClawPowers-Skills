#!/usr/bin/env node
/**
 * Blocking dependency-source check (SEC-20261117-02).
 *
 * Reads package.json, package-lock.json, and .npmrc from disk. No network.
 * Node built-ins only. No --skip flag, no env bypass.
 *
 * Usage: node scripts/check-dependency-sources.mjs [rootDir]
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEP_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
  'overrides',
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
  // user/repo or user/repo#ref — not @scope/name and not a semver range
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
}

function workspacePatterns(pkg) {
  const ws = pkg.workspaces;
  if (!ws) return [];
  if (Array.isArray(ws)) return ws.map(String);
  if (ws && typeof ws === 'object' && Array.isArray(ws.packages)) {
    return ws.packages.map(String);
  }
  return [];
}

function normalizeRel(p) {
  return String(p).replaceAll('\\', '/').replace(/^\.\//, '');
}

function matchesWorkspacePattern(relPath, pattern) {
  const path = normalizeRel(relPath);
  const pat = normalizeRel(pattern);
  if (path === pat) return true;
  if (pat.endsWith('/**')) {
    const prefix = pat.slice(0, -2);
    return prefix === '' || path === prefix.slice(0, -1) || path.startsWith(prefix);
  }
  if (pat.endsWith('/*')) {
    const prefix = pat.slice(0, -1);
    if (!path.startsWith(prefix)) return false;
    const rest = path.slice(prefix.length);
    return rest.length > 0 && !rest.includes('/');
  }
  return false;
}

function isDeclaredWorkspacePath(resolved, patterns) {
  if (typeof resolved !== 'string') return false;
  if (hasProtocol(resolved)) return false;
  return patterns.some((pattern) => matchesWorkspacePattern(resolved, pattern));
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
    if (parts.length < 2) return null;
    return `${parts[0]}/${parts[1]}`;
  }
  return rest.split('/')[0];
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

function checkLockfile(root, pkg, findings) {
  const lockPath = join(root, 'package-lock.json');
  if (!existsSync(lockPath)) {
    failClosed(findings, 'package-lock.json', 'missing lockfile');
    return;
  }
  const parsed = parseJsonOrNull(readText(lockPath));
  if (!parsed.ok) {
    failClosed(findings, 'package-lock.json', 'parse error');
    return;
  }
  const lock = parsed.value;
  if (!lock || typeof lock !== 'object' || Array.isArray(lock)) {
    failClosed(findings, 'package-lock.json', 'parse error');
    return;
  }
  if (typeof lock.lockfileVersion !== 'number' || lock.lockfileVersion < 2) {
    failClosed(findings, 'package-lock.json', 'lockfileVersion < 2');
    return;
  }
  const packages = lock.packages;
  if (!packages || typeof packages !== 'object' || Array.isArray(packages)) {
    failClosed(findings, 'package-lock.json', 'parse error');
    return;
  }

  const declared = workspacePatterns(pkg);
  for (const [key, entry] of Object.entries(packages)) {
    if (key === '') continue;
    const lockKey = `package-lock.json:${key}`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      failClosed(findings, lockKey, 'parse error');
      continue;
    }

    const workspaceLink =
      entry.link === true && isDeclaredWorkspacePath(entry.resolved, declared);

    if (!workspaceLink) {
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
    }

    const implied = impliedNameFromLockKey(key);
    if (
      implied &&
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

function registryHostAllowed(value) {
  const raw = stripQuotes(value).trim();
  if (!raw) return false;
  const candidates = [];
  candidates.push(raw);
  if (raw.startsWith('//')) candidates.push(`https:${raw}`);
  try {
    for (const candidate of candidates) {
      const url = new URL(candidate);
      if (url.username || url.password) return false;
      if (url.hostname === ALLOWED_REGISTRY_HOST) return true;
    }
  } catch {
    return false;
  }
  return false;
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
    if (!registryHostAllowed(value)) {
      findings.push({
        code: 'F6',
        key: `.npmrc ${key}`,
        reason: 'registry host is not registry.npmjs.org',
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
    const allowlist = [];
    printAllowlist(allowlist);
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

  checkManifest(pkg, findings);
  checkLockfile(root, pkg, findings);
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
