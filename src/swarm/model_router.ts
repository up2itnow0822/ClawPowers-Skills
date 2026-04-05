/**
 * ModelRouter — Complexity classification and model routing for swarm tasks.
 *
 * Provides heuristic-based task complexity classification (no LLM required)
 * and maps complexity tiers to model IDs.
 *
 * Mirrors the Python a0-parallel-swarm-plugin model_router helpers.
 */

import type { ModelComplexity, SwarmConfig } from './types.js';

// ─── Default Model Map ────────────────────────────────────────────────────────

const DEFAULT_MODELS: Record<ModelComplexity, string> = {
  simple: 'claude-3-haiku-20240307',
  moderate: 'claude-3-5-sonnet-20241022',
  complex: 'claude-opus-4-5',
};

// ─── Heuristic Classification ─────────────────────────────────────────────────

const COMPLEX_KEYWORDS = [
  'architect', 'design', 'refactor', 'debug complex', 'optimize',
  'cross-domain', 'integrate multiple', 'security audit', 'performance',
  'distributed', 'concurrent requests', 'migration', 'system design',
  'multi-step', 'synthesize', 'reasoning', 'trade-off',
];

const SIMPLE_KEYWORDS = [
  'format', 'list', 'count', 'lookup', 'translate', 'summarize briefly',
  'extract', 'convert', 'rename', 'simple', 'trivial', 'basic',
  'fetch', 'get', 'retrieve', 'find the',
];

/**
 * Classify task complexity using keyword heuristics and description length.
 * Fast — no LLM call required.
 *
 * @param description - Task description to classify
 * @returns ModelComplexity: 'simple' | 'moderate' | 'complex'
 */
export function classifyHeuristic(description: string): ModelComplexity {
  const lower = description.toLowerCase();

  // Complex keywords take priority
  for (const kw of COMPLEX_KEYWORDS) {
    if (lower.includes(kw)) return 'complex';
  }

  // Simple keywords
  for (const kw of SIMPLE_KEYWORDS) {
    if (lower.includes(kw)) return 'simple';
  }

  // Length heuristic (chars, not tokens)
  const len = description.length;
  if (len < 100) return 'simple';
  if (len > 500) return 'complex';

  return 'moderate';
}

/**
 * Select the model ID for a given complexity tier.
 * Falls back to default model map if no override is configured.
 *
 * @param complexity - Task complexity tier
 * @param config - Optional SwarmConfig with model overrides
 * @returns Model ID string
 */
export function selectModel(complexity: ModelComplexity, config?: SwarmConfig): string {
  const overrides = config?.models ?? {};
  return overrides[complexity] ?? DEFAULT_MODELS[complexity];
}

/**
 * Auto-classify a list of tasks, assigning complexity if not explicitly set.
 * Tasks with an existing complexity value are left unchanged.
 *
 * @param tasks - Array of tasks with optional complexity fields
 * @returns Map from task ID to resolved complexity
 */
export function classifyTasks(
  tasks: Array<{ id: string; description: string; complexity?: ModelComplexity }>,
): Map<string, ModelComplexity> {
  const result = new Map<string, ModelComplexity>();
  for (const task of tasks) {
    result.set(task.id, task.complexity ?? classifyHeuristic(task.description));
  }
  return result;
}
