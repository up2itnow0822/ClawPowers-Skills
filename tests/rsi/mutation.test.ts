import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MutationEngine } from '../../src/rsi/mutation.js';
import type { RSIHypothesis, RSITierLabel } from '../../src/types.js';

function makeHypothesis(overrides: Partial<RSIHypothesis> = {}): RSIHypothesis {
  return {
    hypothesisId: 'hyp-1',
    skillName: 'tdd',
    description: 'Adjusting retry count for tdd may improve success by 20%',
    expectedImprovement: 20,
    tier: 'T1' as RSITierLabel,
    confidence: 0.7,
    evidence: ['Current success rate: 40%'],
    ...overrides,
  };
}

describe('MutationEngine', () => {
  let tmpDir: string;
  let engine: MutationEngine;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mutation-'));
    engine = new MutationEngine(join(tmpDir, 'mutations.jsonl'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a mutation from hypothesis', () => {
    const hypothesis = makeHypothesis();
    const mutation = engine.createMutation(hypothesis);

    expect(mutation.mutationId).toBeDefined();
    expect(mutation.hypothesisId).toBe('hyp-1');
    expect(mutation.skillName).toBe('tdd');
    expect(mutation.tier).toBe('T1');
    expect(mutation.status).toBe('proposed');
  });

  it('creates T1 mutation with proposed status', () => {
    const mutation = engine.createMutation(makeHypothesis({ tier: 'T1' }));
    expect(mutation.tier).toBe('T1');
    expect(mutation.status).toBe('proposed');
  });

  it('creates T2 mutation', () => {
    const mutation = engine.createMutation(makeHypothesis({ tier: 'T2' }));
    expect(mutation.tier).toBe('T2');
  });

  it('creates T3 mutation', () => {
    const mutation = engine.createMutation(makeHypothesis({ tier: 'T3' }));
    expect(mutation.tier).toBe('T3');
  });

  it('creates T4 mutation as proposed', () => {
    const mutation = engine.createMutation(makeHypothesis({ tier: 'T4' }));
    expect(mutation.tier).toBe('T4');
    expect(mutation.status).toBe('proposed');
  });

  it('applies T1 mutation', async () => {
    const mutation = engine.createMutation(makeHypothesis({ tier: 'T1' }));
    await engine.applyMutation(mutation);

    const history = await engine.getMutationHistory();
    expect(history).toHaveLength(1);
    expect(history[0]!.status).toBe('applied');
    expect(history[0]!.appliedAt).not.toBeNull();
  });

  it('applies T2 mutation', async () => {
    const mutation = engine.createMutation(makeHypothesis({ tier: 'T2' }));
    await engine.applyMutation(mutation);

    const history = await engine.getMutationHistory();
    expect(history[0]!.status).toBe('applied');
  });

  it('applies T3 mutation', async () => {
    const mutation = engine.createMutation(makeHypothesis({ tier: 'T3' }));
    await engine.applyMutation(mutation);

    const history = await engine.getMutationHistory();
    expect(history[0]!.status).toBe('applied');
  });

  it('rejects T4 mutation auto-apply', async () => {
    const mutation = engine.createMutation(makeHypothesis({ tier: 'T4' }));

    await expect(engine.applyMutation(mutation)).rejects.toThrow(
      'T4 mutations (Architecture) cannot be auto-applied'
    );
  });

  it('reverts a mutation', async () => {
    const mutation = engine.createMutation(makeHypothesis());
    await engine.applyMutation(mutation);
    await engine.revertMutation(mutation);

    const history = await engine.getMutationHistory();
    expect(history).toHaveLength(2);
    expect(history[1]!.status).toBe('reverted');
    expect(history[1]!.revertedAt).not.toBeNull();
  });

  it('rejects mutation targeting spending limits', () => {
    expect(() =>
      engine.createMutation(makeHypothesis({ skillName: 'Spending limits' }))
    ).toThrow('safety invariant');
  });

  it('rejects mutation targeting identity', () => {
    expect(() =>
      engine.createMutation(makeHypothesis({ skillName: 'Core identity' }))
    ).toThrow('safety invariant');
  });

  it('rejects mutation targeting tier definitions', () => {
    expect(() =>
      engine.createMutation(makeHypothesis({ skillName: 'RSI safety tier definitions' }))
    ).toThrow('safety invariant');
  });

  it('rejects mutation targeting sandbox boundaries', () => {
    expect(() =>
      engine.createMutation(makeHypothesis({ skillName: 'Sandbox boundaries' }))
    ).toThrow('safety invariant');
  });

  it('rejects mutation targeting credentials', () => {
    expect(() =>
      engine.createMutation(makeHypothesis({ skillName: 'Authentication credentials' }))
    ).toThrow('safety invariant');
  });

  it('rejects apply on safety invariant skill', async () => {
    // Construct a mutation manually targeting safety invariant
    const mutation = {
      mutationId: 'mut-evil',
      hypothesisId: 'hyp-evil',
      skillName: 'SpendingPolicy',
      tier: 'T1' as RSITierLabel,
      description: 'Increase limits',
      originalValue: '100',
      mutatedValue: '10000',
      status: 'proposed' as const,
      appliedAt: null,
      revertedAt: null,
    };

    await expect(engine.applyMutation(mutation)).rejects.toThrow('safety invariant');
  });

  it('returns empty history when no mutations exist', async () => {
    const history = await engine.getMutationHistory();
    expect(history).toEqual([]);
  });
});
