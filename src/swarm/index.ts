/**
 * ClawPowers Skills — Parallel Swarm Module
 *
 * Provides TypeScript bindings for parallel swarm execution,
 * mirroring the Python a0-parallel-swarm-plugin API surface.
 *
 * Features:
 * - Bounded concurrency with adaptive throttling (ConcurrencyManager)
 * - Centralized token budget management (TokenPool)
 * - Shared memory across parallel agents (SwarmMemory)
 * - Heuristic model routing by task complexity (ModelRouter)
 */

export { ConcurrencyManager } from './concurrency.js';
export { TokenPool } from './token_pool.js';
export { classifyHeuristic, selectModel, classifyTasks } from './model_router.js';
export type {
  ModelComplexity,
  TaskStatus,
  SwarmTask,
  SwarmResult,
  SwarmRun,
  SwarmConfig,
  SwarmMemoryEntry,
  SwarmMemoryHandle,
  TokenAllocation,
  TokenUsageReport,
} from './types.js';

// ITP ↔ Swarm bridge (optional — graceful if ITP not available)
export { encodeTaskDescription, decodeSwarmResult } from '../itp/swarm-bridge.js';
