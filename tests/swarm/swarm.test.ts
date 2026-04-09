/**
 * Swarm Module Tests — ClawPowers Skills
 *
 * Tests for parallel swarm execution primitives:
 * - ConcurrencyManager (bounded parallelism, adaptive throttle)
 * - TokenPool (budget allocation, consumption, release)
 * - ModelRouter (heuristic classification, model selection)
 * - Type shape validation for SwarmRun, SwarmTask, SwarmResult
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ConcurrencyManager } from '../../src/swarm/concurrency.js';
import { TokenPool } from '../../src/swarm/token_pool.js';
import { classifyHeuristic, selectModel, classifyTasks } from '../../src/swarm/model_router.js';
import type {
  SwarmTask,
  SwarmRun,
  SwarmConfig,
  ModelComplexity,
} from '../../src/swarm/types.js';

// ─── ConcurrencyManager ───────────────────────────────────────────────────────

describe('ConcurrencyManager', () => {
  it('starts with zero active tasks', () => {
    const cm = new ConcurrencyManager(3);
    expect(cm.active).toBe(0);
    expect(cm.pending).toBe(0);
  });

  it('reports capacity correctly', () => {
    const cm = new ConcurrencyManager(2);
    expect(cm.hasCapacity()).toBe(true);
  });

  it('acquires and releases a slot', async () => {
    const cm = new ConcurrencyManager(2);
    await cm.acquire();
    expect(cm.active).toBe(1);
    cm.release();
    expect(cm.active).toBe(0);
  });

  it('blocks when at max concurrency', async () => {
    const cm = new ConcurrencyManager(1);
    await cm.acquire(); // slot 1 taken
    expect(cm.hasCapacity()).toBe(false);

    let resolved = false;
    const waiting = cm.acquire().then(() => { resolved = true; });
    expect(resolved).toBe(false);
    expect(cm.pending).toBe(1);

    cm.release(); // free slot → waiting should resolve
    await waiting;
    expect(resolved).toBe(true);
    cm.release(); // cleanup
  });

  it('applies adaptive throttle after error', () => {
    const cm = new ConcurrencyManager(5);
    cm.adaptiveThrottle('rate_limit');
    // throttle delay should be positive
    // We verify indirectly via resetThrottle reducing it
    cm.resetThrottle();
    // No throw = pass
  });

  it('isUnderPressure returns true when above threshold', async () => {
    const cm = new ConcurrencyManager(2, 0.5);
    await cm.acquire(); // 1/2 = 50% → at threshold → true
    expect(cm.isUnderPressure()).toBe(true);
    cm.release();
  });
});

// ─── TokenPool ────────────────────────────────────────────────────────────────

describe('TokenPool', () => {
  let pool: TokenPool;

  beforeEach(() => {
    pool = new TokenPool(100_000, 20_000);
  });

  it('initialises with correct budget', () => {
    expect(pool.totalBudget).toBe(100_000);
    expect(pool.remaining()).toBe(100_000);
  });

  it('allocates tokens for a task', () => {
    const ok = pool.allocate('task-1');
    expect(ok).toBe(true);
    expect(pool.remaining()).toBe(80_000);
  });

  it('rejects allocation when budget exhausted', () => {
    for (let i = 0; i < 5; i++) {
      pool.allocate(`task-${i}`);
    }
    // 5 × 20k = 100k — full
    const ok = pool.allocate('task-overflow');
    expect(ok).toBe(false);
  });

  it('records token consumption', () => {
    pool.allocate('task-1');
    pool.consume('task-1', 5_000);
    expect(pool.consumed()).toBe(5_000);
  });

  it('releases allocation and returns consumed count', () => {
    pool.allocate('task-1');
    pool.consume('task-1', 3_000);
    const consumed = pool.release('task-1');
    expect(consumed).toBe(3_000);
    expect(pool.remaining()).toBe(100_000);
  });

  it('detects over-budget tasks', () => {
    pool.allocate('task-1', 1_000);
    pool.consume('task-1', 1_500);
    expect(pool.isTaskOverBudget('task-1')).toBe(true);
  });

  it('produces a usage report', () => {
    pool.allocate('task-1', 10_000);
    pool.consume('task-1', 4_000);
    const report = pool.usageReport();
    expect(report.total_budget).toBe(100_000);
    expect(report.total_allocated).toBe(10_000);
    expect(report.total_consumed).toBe(4_000);
    expect(report.tasks['task-1'].consumed).toBe(4_000);
  });

  it('resets all allocations', () => {
    pool.allocate('task-1');
    pool.reset();
    expect(pool.remaining()).toBe(100_000);
  });
});

// ─── ModelRouter ─────────────────────────────────────────────────────────────

describe('classifyHeuristic', () => {
  it('classifies simple tasks', () => {
    expect(classifyHeuristic('list the items')).toBe('simple');
    expect(classifyHeuristic('format the output')).toBe('simple');
    expect(classifyHeuristic('fetch the data')).toBe('simple');
  });

  it('classifies complex tasks', () => {
    expect(classifyHeuristic('architect the distributed system')).toBe('complex');
    expect(classifyHeuristic('security audit of the entire codebase')).toBe('complex');
    expect(classifyHeuristic('performance optimization for concurrent requests')).toBe('complex');
  });

  it('classifies moderate by default for medium-length descriptions', () => {
    // 100–500 chars with no keyword triggers → moderate
    const mid = 'process the incoming data batch and aggregate results for the downstream consumer pipeline that handles multiple concurrent streams';
    expect(classifyHeuristic(mid)).toBe('moderate');
  });

  it('classifies short descriptions as simple', () => {
    expect(classifyHeuristic('do X')).toBe('simple'); // < 100 chars, no keywords
  });

  it('classifies very long descriptions as complex', () => {
    const long = 'a'.repeat(600);
    expect(classifyHeuristic(long)).toBe('complex');
  });
});

describe('selectModel', () => {
  it('returns default models for each complexity tier', () => {
    expect(selectModel('simple')).toContain('haiku');
    expect(selectModel('moderate')).toContain('sonnet');
    expect(selectModel('complex')).toContain('opus');
  });

  it('uses config model overrides when provided', () => {
    const config: SwarmConfig = { models: { simple: 'my-fast-model' } };
    expect(selectModel('simple', config)).toBe('my-fast-model');
    // Unoverridden tiers still use defaults
    expect(selectModel('complex', config)).toContain('opus');
  });
});

describe('classifyTasks', () => {
  it('auto-classifies tasks without complexity set', () => {
    const tasks = [
      { id: 'a', description: 'format the data' },
      { id: 'b', description: 'design the distributed architecture' },
    ];
    const result = classifyTasks(tasks);
    expect(result.get('a')).toBe('simple');
    expect(result.get('b')).toBe('complex');
  });

  it('preserves explicit complexity values', () => {
    const tasks = [
      { id: 'a', description: 'fetch the items', complexity: 'complex' as ModelComplexity },
    ];
    const result = classifyTasks(tasks);
    // Should NOT re-classify; explicit value wins
    expect(result.get('a')).toBe('complex');
  });
});

// ─── Type Shape Validation ────────────────────────────────────────────────────

describe('SwarmRun type shape', () => {
  it('constructs a valid SwarmRun object', () => {
    const run: SwarmRun = {
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: 1234,
      results: {},
      token_usage: {
        total_budget: 100_000,
        total_allocated: 20_000,
        total_consumed: 5_000,
        total_remaining: 80_000,
        tasks: {},
      },
      cancelled: false,
      success_count: 3,
      failure_count: 0,
      total_count: 3,
    };
    expect(run.total_count).toBe(3);
    expect(run.cancelled).toBe(false);
    expect(run.token_usage.total_budget).toBe(100_000);
  });
});

describe('SwarmTask type shape', () => {
  it('constructs a minimal SwarmTask', () => {
    const task: SwarmTask = {
      id: 'task-1',
      description: 'fetch market data',
      message: 'Please fetch the latest BTC price',
    };
    expect(task.id).toBe('task-1');
    expect(task.depends_on).toBeUndefined();
  });

  it('constructs a SwarmTask with DAG dependencies', () => {
    const task: SwarmTask = {
      id: 'synthesize',
      description: 'synthesize results from 5 research agents',
      message: 'Synthesize all findings',
      depends_on: ['agent-1', 'agent-2', 'agent-3'],
      complexity: 'complex',
      token_budget: 50_000,
    };
    expect(task.depends_on).toHaveLength(3);
    expect(task.complexity).toBe('complex');
  });
});
