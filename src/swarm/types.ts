/**
 * Parallel Swarm Types
 *
 * Type definitions for the parallel swarm execution module.
 * Mirrors the Python a0-parallel-swarm-plugin API surface.
 */

// ─── Model Complexity ─────────────────────────────────────────────────────────

export type ModelComplexity = 'simple' | 'moderate' | 'complex';

// ─── Task Status ──────────────────────────────────────────────────────────────

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

// ─── Swarm Task ───────────────────────────────────────────────────────────────

export interface SwarmTask {
  /** Unique task identifier. Auto-generated if omitted. */
  id: string;
  /** Human-readable description of the task. */
  description: string;
  /** The message/prompt to send to the agent. */
  message: string;
  /** Task complexity for model routing. Defaults to 'moderate'. */
  complexity?: ModelComplexity;
  /** Optional profile/persona for the agent. */
  profile?: string;
  /** Priority within an execution level (lower = higher priority). */
  priority?: number;
  /** Task IDs this task depends on. Forms a DAG. */
  depends_on?: string[];
  /** Token budget override for this specific task. */
  token_budget?: number;
  /** Arbitrary metadata attached to the task. */
  metadata?: Record<string, unknown>;
}

// ─── Swarm Result ─────────────────────────────────────────────────────────────

export interface SwarmResult {
  /** The task ID this result belongs to. */
  task_id: string;
  /** Task description (copied from input). */
  description: string;
  /** Final status. */
  status: TaskStatus;
  /** The result string on success. */
  result: string | null;
  /** Error message on failure. */
  error: string | null;
  /** Resolved complexity used for model routing. */
  complexity: ModelComplexity;
  /** Tokens consumed by this task. */
  tokens_used: number;
  /** Token budget allocated to this task. */
  token_budget: number;
  /** ISO timestamp when the task started. */
  started_at: string | null;
  /** ISO timestamp when the task completed. */
  completed_at: string | null;
  /** Duration in milliseconds. */
  duration_ms: number;
}

// ─── Swarm Config ─────────────────────────────────────────────────────────────

export interface SwarmConfig {
  /** Maximum parallel tasks. 1–20, default 5. */
  max_concurrency?: number;
  /** Total token budget across all tasks. Default 100_000. */
  token_budget?: number;
  /** Per-task token budget default. Default 20_000. */
  per_task_budget?: number;
  /** Whether to auto-classify task complexity. Default true. */
  auto_classify?: boolean;
  /** Model overrides by complexity tier. */
  models?: {
    simple?: string;
    moderate?: string;
    complex?: string;
  };
  /** Backpressure threshold (0–1). Default 0.8. */
  backpressure_threshold?: number;
}

// ─── Swarm Memory Entry ───────────────────────────────────────────────────────

export interface SwarmMemoryEntry {
  /** ID of the agent that shared this finding. */
  agent_id: string;
  /** Unique key for the finding. */
  key: string;
  /** The finding value. */
  value: string;
  /** Tags for querying. */
  tags: string[];
  /** ISO timestamp when stored. */
  timestamp: string;
}

// ─── Task Executor ────────────────────────────────────────────────────────────

/**
 * User-supplied function that executes a single task.
 * The orchestrator calls this for each task, passing the task and the
 * selected model ID. The function should return the result string.
 *
 * This is the integration point — bring your own agent/LLM call.
 */
export type TaskExecutor = (
  task: SwarmTask,
  context: TaskExecutorContext,
) => Promise<string>;

export interface TaskExecutorContext {
  /** Model ID selected by the router for this task's complexity. */
  model: string;
  /** Allocated token budget for this task. */
  token_budget: number;
  /** Shared swarm memory — read/write findings during execution. */
  memory: SwarmMemoryHandle;
  /** Signal that is aborted if the swarm is cancelled. */
  signal: AbortSignal;
}

/** Subset of SwarmMemory exposed to task executors. */
export interface SwarmMemoryHandle {
  share(agentId: string, key: string, value: string, tags?: string[]): void;
  get(key: string): SwarmMemoryEntry | undefined;
  query(options?: { tags?: string[]; keyword?: string }): SwarmMemoryEntry[];
  getAll(): SwarmMemoryEntry[];
}

// ─── Token Pool Types ─────────────────────────────────────────────────────────

export interface TokenAllocation {
  task_id: string;
  budget: number;
  consumed: number;
  allocated_at: number;
}

export interface TokenUsageReport {
  total_budget: number;
  total_allocated: number;
  total_consumed: number;
  total_remaining: number;
  tasks: Record<string, {
    budget: number;
    consumed: number;
    remaining: number;
    over_budget: boolean;
  }>;
}

// ─── Swarm Run ───────────────────────────────────────────────────────────────

/**
 * Represents a complete swarm execution run — the top-level result
 * returned after all tasks in a swarm have completed or failed.
 */
export interface SwarmRun {
  /** ISO timestamp when the run started. */
  started_at: string;
  /** ISO timestamp when the run completed. */
  completed_at: string;
  /** Total duration in milliseconds. */
  duration_ms: number;
  /** Results keyed by task ID. */
  results: Record<string, SwarmResult>;
  /** Token usage summary for the entire run. */
  token_usage: TokenUsageReport;
  /** Whether the run was cancelled. */
  cancelled: boolean;
  /** Count of successful tasks. */
  success_count: number;
  /** Count of failed tasks. */
  failure_count: number;
  /** Total tasks submitted. */
  total_count: number;
}

// ─── Orchestrator Status ──────────────────────────────────────────────────────

export interface SwarmStatus {
  tasks: Record<string, {
    description: string;
    status: TaskStatus;
    complexity: ModelComplexity;
    tokens_used: number;
    error: string | null;
  }>;
  token_usage: TokenUsageReport;
  active_count: number;
  is_cancelled: boolean;
}
