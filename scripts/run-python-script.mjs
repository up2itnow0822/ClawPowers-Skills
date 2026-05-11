#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const [, , scriptPath, ...scriptArgs] = process.argv;

if (!scriptPath) {
  console.error('Usage: node scripts/run-python-script.mjs <script.py> [...args]');
  process.exit(2);
}

const candidates = process.platform === 'win32'
  ? [
      ['python', []],
      ['py', ['-3']],
      ['python3', []],
    ]
  : [
      ['python3', []],
      ['python', []],
    ];

const failures = [];
for (const [command, prefixArgs] of candidates) {
  const probe = spawnSync(command, [...prefixArgs, '--version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const versionOutput = `${probe.stdout ?? ''}${probe.stderr ?? ''}`;
  if (probe.status !== 0 || /Microsoft Store/i.test(versionOutput)) {
    failures.push(`${command} ${prefixArgs.join(' ')} -> ${versionOutput.trim() || probe.error?.message || `exit ${probe.status}`}`);
    continue;
  }

  const run = spawnSync(command, [...prefixArgs, scriptPath, ...scriptArgs], {
    stdio: 'inherit',
  });
  if (run.error) {
    failures.push(`${command} ${prefixArgs.join(' ')} -> ${run.error.message}`);
    continue;
  }
  process.exit(run.status ?? 1);
}

console.error('Unable to find a working Python interpreter for', scriptPath);
for (const failure of failures) {
  console.error('-', failure);
}
process.exit(1);
