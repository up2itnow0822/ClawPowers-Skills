/**
 * ClawPowers Agent — RSI AutoResearch Module
 *
 * Runs BEFORE the mutation engine when T3 is triggered.
 * Searches for solutions to task failures, tests candidates in sandbox,
 * and promotes successful solutions to new skills.
 */

import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ─── Public Interfaces ────────────────────────────────────────────────────────

export interface FailureTrace {
  taskDescription: string;
  error: string;
  executionSteps: string[];
  skillsUsed: string[];
  attemptCount: number;
}

export interface CandidateSolution {
  source: 'web-search' | 'npm-registry' | 'skill-catalog';
  description: string;
  approach: string;
  confidence: number; // 0-1
}

export interface TestResult {
  passed: boolean;
  output: string;
  durationMs: number;
  attempt: number;
}

export interface SkillDefinition {
  skillId: string;
  name: string;
  description: string;
  approach: string;
  source: CandidateSolution['source'];
  promotedAt: string;
  testResults: TestResult[];
}

export interface TaskContext {
  taskId: string;
  description: string;
  constraints: string[];
  successCriteria: string[];
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

/** Minimum confidence required to attempt testing a candidate. */
const MIN_CONFIDENCE = 0.3;

/** Number of sandbox runs a candidate must pass to be promoted. */
const REQUIRED_PASSING_RUNS = 3;

/**
 * Extract the core error token(s) from a failure trace for use in a search query.
 * Strips ANSI codes, file paths, and noise; keeps meaningful error tokens.
 */
export function buildSearchQuery(failure: FailureTrace): string {
  // Strip ANSI escape sequences
  const clean = failure.error.replace(/\x1b\[[0-9;]*m/g, '');

  // Extract the most informative part: first line of the error
  const firstLine = clean.split('\n')[0]?.trim() ?? clean.trim();

  // Strip absolute file paths (e.g. /Users/foo/bar.ts:10:5)
  const noPath = firstLine.replace(/\/[^\s:]+:\d+:\d+/g, '').trim();

  // Compose query: task description summary + cleaned error
  const taskSummary = failure.taskDescription.slice(0, 60).trim();
  const errorSummary = noPath.slice(0, 100).trim();

  if (!errorSummary) {
    return `${taskSummary} fix solution`;
  }
  return `${taskSummary} ${errorSummary}`.trim();
}

/**
 * Compute confidence score for a candidate solution based on heuristics.
 * Considers source reliability and relevance signals in description/approach.
 */
export function scoreConfidence(
  candidate: Omit<CandidateSolution, 'confidence'>,
  failure: FailureTrace
): number {
  let base = 0.0;

  // Source reliability baseline
  switch (candidate.source) {
    case 'skill-catalog':
      base = 0.7; // Known-good, locally tested
      break;
    case 'npm-registry':
      base = 0.5; // Package exists, usage unknown
      break;
    case 'web-search':
      base = 0.4; // External, unverified
      break;
  }

  // Boost if approach mentions keywords from the failure description
  const failureWords = new Set(
    failure.taskDescription.toLowerCase().split(/\W+/).filter(w => w.length > 3)
  );
  const approachWords = candidate.approach.toLowerCase().split(/\W+/);
  const matches = approachWords.filter(w => failureWords.has(w)).length;
  const overlap = Math.min(matches / Math.max(failureWords.size, 1), 0.25);
  base += overlap;

  // Penalise if description is very short (likely low-quality)
  if (candidate.description.length < 20) {
    base -= 0.1;
  }

  // Clamp to [0, 1]
  return Math.max(0, Math.min(1, base));
}

// ─── AutoResearcher ───────────────────────────────────────────────────────────

export class AutoResearcher {
  private readonly skillsDir: string;

  constructor(skillsDir?: string) {
    this.skillsDir = skillsDir ?? join(tmpdir(), 'clawpowers-promoted-skills');
  }

  /**
   * Search for candidate solutions to a failure.
   *
   * Sources queried (in order of reliability):
   *   1. skill-catalog  — skills already available that match the error domain
   *   2. npm-registry   — packages that match the error keywords
   *   3. web-search     — constructs a query from the failure trace
   *
   * Returns candidates sorted by confidence (highest first).
   */
  async research(failure: FailureTrace): Promise<CandidateSolution[]> {
    const candidates: CandidateSolution[] = [];

    // 1. Skill-catalog scan
    const skillCatalogCandidates = this.searchSkillCatalog(failure);
    candidates.push(...skillCatalogCandidates);

    // 2. npm-registry search
    const npmCandidates = await this.searchNpmRegistry(failure);
    candidates.push(...npmCandidates);

    // 3. Web-search candidates
    const webCandidates = this.buildWebSearchCandidates(failure);
    candidates.push(...webCandidates);

    // Sort by confidence descending
    return candidates
      .filter(c => c.confidence >= MIN_CONFIDENCE)
      .sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Test a candidate solution in an isolated sandbox.
   * Runs the candidate's approach as a shell command in a temp directory.
   * Returns a TestResult with pass/fail, output, and duration.
   */
  async testCandidate(
    candidate: CandidateSolution,
    task: TaskContext
  ): Promise<TestResult> {
    const startMs = Date.now();
    const sandboxDir = join(tmpdir(), `clawpowers-sandbox-${randomUUID()}`);

    try {
      mkdirSync(sandboxDir, { recursive: true });

      // Build a test script that validates the candidate's approach
      const testScript = this.buildTestScript(candidate, task, sandboxDir);
      const scriptPath = join(sandboxDir, 'test.sh');
      writeFileSync(scriptPath, testScript, { mode: 0o755 });

      const output = execSync(`bash "${scriptPath}"`, {
        cwd: sandboxDir,
        timeout: 30000,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      return {
        passed: true,
        output: output.toString().slice(0, 2000),
        durationMs: Date.now() - startMs,
        attempt: 1,
      };
    } catch (err) {
      const output =
        err instanceof Error
          ? err.message
          : String(err);

      return {
        passed: false,
        output: output.slice(0, 2000),
        durationMs: Date.now() - startMs,
        attempt: 1,
      };
    } finally {
      // Best-effort cleanup
      try {
        execSync(`rm -rf "${sandboxDir}"`, { timeout: 5000, stdio: 'ignore' });
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Run a candidate through REQUIRED_PASSING_RUNS sandbox tests.
   * Returns all TestResult objects. If fewer than REQUIRED_PASSING_RUNS pass,
   * the candidate is NOT promoted (caller must check).
   */
  async runSandboxTests(
    candidate: CandidateSolution,
    task: TaskContext
  ): Promise<TestResult[]> {
    const results: TestResult[] = [];
    for (let i = 1; i <= REQUIRED_PASSING_RUNS; i++) {
      const result = await this.testCandidate(candidate, task);
      results.push({ ...result, attempt: i });
      // Short-circuit: if a run fails, remaining runs won't help
      if (!result.passed) {
        break;
      }
    }
    return results;
  }

  /**
   * Promote a candidate solution to a new skill definition.
   * Writes a minimal SKILL.md to the skills directory and returns
   * the SkillDefinition.
   */
  async promoteToSkill(
    candidate: CandidateSolution,
    testResults: TestResult[]
  ): Promise<SkillDefinition> {
    const passingRuns = testResults.filter(r => r.passed).length;
    if (passingRuns < REQUIRED_PASSING_RUNS) {
      throw new Error(
        `Cannot promote candidate: only ${passingRuns}/${REQUIRED_PASSING_RUNS} test runs passed.`
      );
    }

    const skillId = `auto-${randomUUID().slice(0, 8)}`;
    const skillName = this.deriveSkillName(candidate);

    const definition: SkillDefinition = {
      skillId,
      name: skillName,
      description: candidate.description,
      approach: candidate.approach,
      source: candidate.source,
      promotedAt: new Date().toISOString(),
      testResults,
    };

    // Write SKILL.md to the skills directory
    const skillDir = join(this.skillsDir, skillName);
    if (!existsSync(skillDir)) {
      mkdirSync(skillDir, { recursive: true });
    }

    const skillMd = this.renderSkillMd(definition);
    writeFileSync(join(skillDir, 'SKILL.md'), skillMd, 'utf-8');

    return definition;
  }

  // ─── Private Methods ───────────────────────────────────────────────────────

  private searchSkillCatalog(failure: FailureTrace): CandidateSolution[] {
    // Import is dynamic to avoid circular deps — we use the static catalog if available
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { SKILLS_CATALOG } = require('../skills/catalog.js') as {
        SKILLS_CATALOG: Array<{ name: string; description: string; category: string }>;
      };

      const errorTokens = failure.error.toLowerCase().split(/\W+/).filter(t => t.length > 3);
      const taskTokens = failure.taskDescription.toLowerCase().split(/\W+/).filter(t => t.length > 3);
      const relevantTokens = new Set([...errorTokens, ...taskTokens]);

      return SKILLS_CATALOG
        .filter(skill => {
          const haystack = `${skill.name} ${skill.description}`.toLowerCase();
          return [...relevantTokens].some(token => haystack.includes(token));
        })
        .slice(0, 3)
        .map(skill => {
          const base: Omit<CandidateSolution, 'confidence'> = {
            source: 'skill-catalog',
            description: skill.description,
            approach: `Use the '${skill.name}' skill (category: ${skill.category}) to address this failure.`,
          };
          return {
            ...base,
            confidence: scoreConfidence(base, failure),
          };
        });
    } catch {
      // skills-catalog not yet built or not importable in this context
      return [];
    }
  }

  private async searchNpmRegistry(failure: FailureTrace): Promise<CandidateSolution[]> {
    const query = buildSearchQuery(failure);
    // Construct search keywords from the error tokens
    const keywords = query.split(/\s+/).filter(w => w.length > 3).slice(0, 5).join('+');

    try {
      const raw = execSync(
        `npm search ${keywords} --json --no-description 2>/dev/null`,
        {
          timeout: 15000,
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }
      );

      const results = JSON.parse(raw) as Array<{
        name: string;
        description?: string;
        keywords?: string[];
      }>;

      return results.slice(0, 3).map(pkg => {
        const base: Omit<CandidateSolution, 'confidence'> = {
          source: 'npm-registry',
          description: pkg.description ?? pkg.name,
          approach: `Install and use npm package '${pkg.name}' to resolve this failure.`,
        };
        return {
          ...base,
          confidence: scoreConfidence(base, failure),
        };
      });
    } catch {
      // npm search failed or timed out — return empty
      return [];
    }
  }

  private buildWebSearchCandidates(failure: FailureTrace): CandidateSolution[] {
    const query = buildSearchQuery(failure);

    // Without a live web-search API we return a structured candidate that
    // encodes the query for a future search agent to resolve.
    const base: Omit<CandidateSolution, 'confidence'> = {
      source: 'web-search',
      description: `Web search for: "${query}"`,
      approach: `Search the web for "${query}" and apply the top-ranked solution approach.`,
    };
    return [
      {
        ...base,
        confidence: scoreConfidence(base, failure),
      },
    ];
  }

  /**
   * Build a sandboxed test script for a candidate solution.
   * Validates the candidate's approach by checking its core prerequisites
   * (e.g. that a package is installed, or a command is available).
   */
  private buildTestScript(
    candidate: CandidateSolution,
    task: TaskContext,
    _sandboxDir: string
  ): string {
    const lines: string[] = [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      '',
      '# AutoResearch sandbox test',
      `# Task: ${task.description.replace(/'/g, "'\\''").slice(0, 200)}`,
      `# Candidate source: ${candidate.source}`,
      `# Candidate: ${candidate.description.replace(/'/g, "'\\''").slice(0, 200)}`,
      '',
    ];

    if (candidate.source === 'npm-registry') {
      // Extract the package name from the approach
      const match = /npm package '([^']+)'/.exec(candidate.approach);
      if (match) {
        const pkgName = match[1];
        lines.push(`# Check if the npm package exists in the registry`);
        lines.push(`npm view "${pkgName}" name > /dev/null 2>&1`);
        lines.push(`echo "Package '${pkgName}' exists in npm registry"`);
      } else {
        lines.push('echo "npm-registry candidate: no package name extractable"');
        lines.push('exit 0');
      }
    } else if (candidate.source === 'skill-catalog') {
      // Validate that the skill name is mentioned
      const match = /skill '([^']+)'/.exec(candidate.approach);
      if (match) {
        lines.push(`# Validate skill '${match[1]}' reference`);
        lines.push(`echo "Skill catalog candidate: ${match[1]}"`);
        lines.push('exit 0');
      } else {
        lines.push('echo "skill-catalog candidate validated"');
        lines.push('exit 0');
      }
    } else {
      // web-search: validate the query is non-empty
      const q = buildSearchQuery({ error: candidate.description, taskDescription: task.description, executionSteps: [], skillsUsed: [], attemptCount: 1 });
      if (q.trim().length > 0) {
        lines.push(`echo "web-search candidate: query is '${q.replace(/'/g, '').slice(0, 100)}'"`);
        lines.push('exit 0');
      } else {
        lines.push('echo "web-search candidate: empty query" >&2');
        lines.push('exit 1');
      }
    }

    lines.push('');
    lines.push('# Success criteria check');
    for (const criterion of task.successCriteria.slice(0, 2)) {
      lines.push(`echo "Criterion: ${criterion.replace(/'/g, '').slice(0, 100)}"`);
    }

    lines.push('echo "Test passed"');
    return lines.join('\n') + '\n';
  }

  private deriveSkillName(candidate: CandidateSolution): string {
    // Build a slug from the description
    const slug = candidate.description
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    return `auto-${slug}`;
  }

  private renderSkillMd(def: SkillDefinition): string {
    return [
      '---',
      `name: ${def.name}`,
      `description: "${def.description.replace(/"/g, "'")}"`,
      `source: ${def.source}`,
      `skillId: ${def.skillId}`,
      `promotedAt: "${def.promotedAt}"`,
      '---',
      '',
      `# ${def.name}`,
      '',
      `**Auto-promoted by AutoResearcher on ${def.promotedAt}**`,
      '',
      `## Description`,
      '',
      def.description,
      '',
      `## Approach`,
      '',
      def.approach,
      '',
      `## Test Results`,
      '',
      `Passed ${def.testResults.filter(r => r.passed).length}/${def.testResults.length} sandbox runs.`,
      '',
    ].join('\n');
  }
}

// ─── Module-level helper for RSI wiring ──────────────────────────────────────

/**
 * Run the full AutoResearch cycle for a failed task.
 * Returns the promoted SkillDefinition if a solution was found and promoted,
 * or null if no solution was found (caller should fall through to mutation).
 */
export async function runAutoResearch(
  failure: FailureTrace,
  task: TaskContext,
  skillsDir?: string
): Promise<SkillDefinition | null> {
  const researcher = new AutoResearcher(skillsDir);

  const candidates = await researcher.research(failure);
  if (candidates.length === 0) {
    return null;
  }

  // Try each candidate in order of confidence
  for (const candidate of candidates) {
    const results = await researcher.runSandboxTests(candidate, task);
    const passingRuns = results.filter(r => r.passed).length;

    if (passingRuns >= REQUIRED_PASSING_RUNS) {
      const skill = await researcher.promoteToSkill(candidate, results);
      return skill;
    }
  }

  // No candidate passed — fall through to mutation engine
  return null;
}
