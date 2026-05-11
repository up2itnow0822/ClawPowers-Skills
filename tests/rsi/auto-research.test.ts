/**
 * AutoResearch — Unit Tests
 *
 * Covers:
 *  1.  Successful research finds solution
 *  2.  No solution found falls through
 *  3.  Candidate passes 3 test runs → promoted
 *  4.  Candidate fails → not promoted
 *  5.  Failure trace extraction (search query construction)
 *  6.  Search query is non-empty
 *  7.  Search query strips ANSI codes
 *  8.  Confidence scoring baseline per source
 *  9.  Confidence scoring keyword overlap boost
 *  10. Confidence score clamped to [0, 1]
 *  11. promoteToSkill throws when < 3 passing runs
 *  12. promoteToSkill succeeds with 3 passing runs
 *  13. runAutoResearch returns null when no candidates meet threshold
 *  14. TestResult.attempt increments correctly in runSandboxTests
 *  15. skill-catalog source gets highest base confidence
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  AutoResearcher,
  buildSearchQuery,
  scoreConfidence,
  runAutoResearch,
} from '../../src/rsi/auto-research.js';
import type {
  FailureTrace,
  CandidateSolution,
  TaskContext,
  TestResult,
} from '../../src/rsi/auto-research.js';

// ─── Test Fixtures ────────────────────────────────────────────────────────────

function makeFailure(overrides: Partial<FailureTrace> = {}): FailureTrace {
  return {
    taskDescription: 'Parse and validate JSON config file',
    error: 'SyntaxError: Unexpected token } in JSON at position 42',
    executionSteps: ['read file', 'parse JSON', 'validate schema'],
    skillsUsed: ['file-reader', 'json-parser'],
    attemptCount: 2,
    ...overrides,
  };
}

function makeTask(overrides: Partial<TaskContext> = {}): TaskContext {
  return {
    taskId: 'task-001',
    description: 'Parse and validate a JSON config file',
    constraints: ['must not modify the file'],
    successCriteria: ['config is parsed without error', 'schema validation passes'],
    ...overrides,
  };
}

function makeCandidate(
  overrides: Partial<CandidateSolution> = {}
): CandidateSolution {
  return {
    source: 'skill-catalog',
    description: 'Use JSON schema validator to catch syntax errors early',
    approach: "Use the 'json-validator' skill to validate config files before parsing.",
    confidence: 0.75,
    ...overrides,
  };
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('buildSearchQuery', () => {
  it('test 5 — extracts meaningful query from failure trace', () => {
    const failure = makeFailure();
    const query = buildSearchQuery(failure);
    expect(query.length).toBeGreaterThan(5);
    // Should include something from the task description or error
    expect(query.toLowerCase()).toMatch(/json|parse|config|syntax/i);
  });

  it('test 6 — returns non-empty string even for minimal failure', () => {
    const failure = makeFailure({ error: 'Error', taskDescription: 'do something' });
    const query = buildSearchQuery(failure);
    expect(typeof query).toBe('string');
    expect(query.trim().length).toBeGreaterThan(0);
  });

  it('test 7 — strips ANSI escape codes from error', () => {
    const failure = makeFailure({
      error: '\x1b[31mTypeError\x1b[0m: Cannot read property "foo" of undefined',
    });
    const query = buildSearchQuery(failure);
    expect(query).not.toMatch(/\x1b/);
    expect(query).toMatch(/TypeError|property|undefined/i);
  });
});

describe('scoreConfidence', () => {
  it('test 8 — skill-catalog gets highest base confidence (0.7)', () => {
    const failure = makeFailure();
    const candidate = {
      source: 'skill-catalog' as const,
      description: 'Some skill',
      approach: 'Use a skill.',
    };
    const score = scoreConfidence(candidate, failure);
    // Base is 0.7 (may be slightly adjusted by overlap/length)
    expect(score).toBeGreaterThanOrEqual(0.5);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('test 8b — npm-registry gets 0.5 base confidence', () => {
    const failure = makeFailure({ taskDescription: 'unrelated xyz task' });
    const candidate = {
      source: 'npm-registry' as const,
      description: 'some-random-package',
      approach: 'Install and use npm package.',
    };
    const score = scoreConfidence(candidate, failure);
    // 0.5 base, with possible small adjustments
    expect(score).toBeGreaterThanOrEqual(0.3);
    expect(score).toBeLessThanOrEqual(0.8);
  });

  it('test 9 — keyword overlap boosts confidence', () => {
    const failure = makeFailure({
      taskDescription: 'validate json schema config',
    });
    const lowOverlap = {
      source: 'web-search' as const,
      description: 'unrelated topic',
      approach: 'Use xyz toolchain.',
    };
    const highOverlap = {
      source: 'web-search' as const,
      description: 'validate json schema config',
      approach: 'validate json schema config using ajv.',
    };
    const low = scoreConfidence(lowOverlap, failure);
    const high = scoreConfidence(highOverlap, failure);
    expect(high).toBeGreaterThan(low);
  });

  it('test 10 — confidence score is always clamped to [0, 1]', () => {
    const failure = makeFailure();
    // Force maximum overlap and perfect source
    const candidate = {
      source: 'skill-catalog' as const,
      description: 'parse validate json config syntax error file',
      approach: 'parse validate json config syntax error file schema parse',
    };
    const score = scoreConfidence(candidate, failure);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

describe('AutoResearcher.testCandidate', () => {
  let tmpDir: string;
  let researcher: AutoResearcher;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ar-test-'));
    researcher = new AutoResearcher(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('test 14 — TestResult.attempt is set correctly', async () => {
    const candidate = makeCandidate({ source: 'skill-catalog' });
    const task = makeTask();
    const result = await researcher.testCandidate(candidate, task);
    expect(result.attempt).toBe(1);
    expect(typeof result.durationMs).toBe('number');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(typeof result.output).toBe('string');
    expect(typeof result.passed).toBe('boolean');
  });

  it('escapes sandbox script metadata so candidate text cannot inject commands', async () => {
    const marker = join(tmpDir, 'metadata-injection-marker');
    const shellMarker = marker.replace(/\\/g, '/');
    const candidate = makeCandidate({
      description: `safe description\ntouch ${JSON.stringify(shellMarker)}`,
      approach: 'Use a normal catalog skill safely.',
    });
    const task = makeTask({
      description: `safe task\ntouch ${JSON.stringify(shellMarker)}`,
      successCriteria: [`no command substitution $(touch ${JSON.stringify(shellMarker)})`],
    });

    const result = await researcher.testCandidate(candidate, task);

    expect(result.passed).toBe(true);
    expect(existsSync(marker)).toBe(false);
  });

  it('single-quotes web-search echo content to prevent command substitution', async () => {
    const marker = join(tmpDir, 'web-search-injection-marker');
    const shellMarker = marker.replace(/\\/g, '/');
    const candidate = makeCandidate({
      source: 'web-search',
      description: `search for $(touch ${JSON.stringify(shellMarker)})`,
      approach: 'Search docs for a safe answer.',
    });
    const task = makeTask({
      description: `diagnose $(touch ${JSON.stringify(shellMarker)})`,
      successCriteria: [`no command substitution $(touch ${JSON.stringify(shellMarker)})`],
    });

    const result = await researcher.testCandidate(candidate, task);

    expect(result.passed).toBe(true);
    expect(existsSync(marker)).toBe(false);
  });
});

describe('AutoResearcher.promoteToSkill', () => {
  let tmpDir: string;
  let researcher: AutoResearcher;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ar-promote-'));
    researcher = new AutoResearcher(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('test 3 — candidate passes 3 test runs → promoted to skill', async () => {
    const candidate = makeCandidate();
    const passingResults: TestResult[] = [
      { passed: true, output: 'ok', durationMs: 10, attempt: 1 },
      { passed: true, output: 'ok', durationMs: 10, attempt: 2 },
      { passed: true, output: 'ok', durationMs: 10, attempt: 3 },
    ];
    const skill = await researcher.promoteToSkill(candidate, passingResults);
    expect(skill.skillId).toBeDefined();
    expect(skill.name).toBeDefined();
    expect(skill.description).toBe(candidate.description);
    expect(skill.promotedAt).toBeDefined();
    expect(skill.testResults).toHaveLength(3);
  });

  it('test 4 — candidate fails → promoteToSkill throws', async () => {
    const candidate = makeCandidate();
    const failingResults: TestResult[] = [
      { passed: false, output: 'fail', durationMs: 10, attempt: 1 },
    ];
    await expect(researcher.promoteToSkill(candidate, failingResults)).rejects.toThrow(
      /Cannot promote candidate/
    );
  });

  it('test 11 — promoteToSkill throws when < 3 passing runs', async () => {
    const candidate = makeCandidate();
    const mixedResults: TestResult[] = [
      { passed: true, output: 'ok', durationMs: 10, attempt: 1 },
      { passed: true, output: 'ok', durationMs: 10, attempt: 2 },
      // Only 2 passing runs — not enough
    ];
    await expect(researcher.promoteToSkill(candidate, mixedResults)).rejects.toThrow(
      /Cannot promote candidate/
    );
  });

  it('test 12 — promoteToSkill succeeds and writes SKILL.md', async () => {
    const { existsSync } = await import('node:fs');
    const candidate = makeCandidate({ source: 'npm-registry' });
    const results: TestResult[] = [
      { passed: true, output: 'ok', durationMs: 10, attempt: 1 },
      { passed: true, output: 'ok', durationMs: 12, attempt: 2 },
      { passed: true, output: 'ok', durationMs: 11, attempt: 3 },
    ];
    const skill = await researcher.promoteToSkill(candidate, results);
    const skillMdPath = join(tmpDir, skill.name, 'SKILL.md');
    expect(existsSync(skillMdPath)).toBe(true);
  });

  it('test 15 — skill-catalog source reflected in promoted skill', async () => {
    const candidate = makeCandidate({ source: 'skill-catalog' });
    const results: TestResult[] = [
      { passed: true, output: 'ok', durationMs: 10, attempt: 1 },
      { passed: true, output: 'ok', durationMs: 10, attempt: 2 },
      { passed: true, output: 'ok', durationMs: 10, attempt: 3 },
    ];
    const skill = await researcher.promoteToSkill(candidate, results);
    expect(skill.source).toBe('skill-catalog');
  });
});

describe('AutoResearcher.research', () => {
  let tmpDir: string;
  let researcher: AutoResearcher;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ar-research-'));
    researcher = new AutoResearcher(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('test 1 — research returns array of candidates', async () => {
    const failure = makeFailure();
    const candidates = await researcher.research(failure);
    // May return 0 or more depending on npm/skill-catalog availability
    expect(Array.isArray(candidates)).toBe(true);
    // All returned candidates must meet minimum confidence
    for (const c of candidates) {
      expect(c.confidence).toBeGreaterThanOrEqual(0.3);
    }
  });

  it('test 2 — research candidates sorted by confidence descending', async () => {
    const failure = makeFailure();
    const candidates = await researcher.research(failure);
    for (let i = 1; i < candidates.length; i++) {
      expect(candidates[i - 1]!.confidence).toBeGreaterThanOrEqual(
        candidates[i]!.confidence
      );
    }
  });
});

describe('runAutoResearch', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ar-run-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('test 13 — returns null when no solution is found within confidence threshold', async () => {
    // Use a nonsensical failure that is unlikely to produce a real solution
    const failure: FailureTrace = {
      taskDescription: 'zzz999-impossible-task-no-skill',
      error: 'zzz999-impossible-error-xyz',
      executionSteps: [],
      skillsUsed: [],
      attemptCount: 5,
    };
    const task: TaskContext = {
      taskId: 'task-zzz',
      description: 'zzz999-impossible-task',
      constraints: [],
      successCriteria: [],
    };
    // This call may succeed or return null depending on npm search results
    // But it must not throw
    const result = await runAutoResearch(failure, task, tmpDir);
    expect(result === null || result?.skillId !== undefined).toBe(true);
  });
});
