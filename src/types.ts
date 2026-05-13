/**
 * ClawPowers Skills — Core Type System
 * Zero `any` types. Discriminated unions for all status fields.
 * Agent control-loop types (AgentStatus, AgentState, Goal, Plan, Step) removed —
 * this is a skills library, not an agent runtime.
 */

// ─── Goal (lightweight, for memory/checkpoint compatibility) ──────────────────

export type GoalSource = 'cli' | 'interactive' | 'resume';

export interface Goal {
  readonly taskId: string;
  readonly description: string;
  readonly constraints: readonly string[];
  readonly successCriteria: readonly string[];
  readonly createdAt: string;
  readonly source: GoalSource;
}

// ─── Plan (lightweight, for memory/checkpoint compatibility) ──────────────────

export type StepStatus = 'pending' | 'in-progress' | 'complete' | 'failed' | 'skipped';

export interface Step {
  readonly stepId: string;
  readonly description: string;
  readonly assignedSkills: readonly string[];
  readonly status: StepStatus;
  readonly dependsOn: readonly string[];
  readonly output: string | null;
  readonly retryCount: number;
  readonly maxRetries: number;
}

export type PlanStatus = 'draft' | 'approved' | 'executing' | 'complete' | 'failed';

export interface Plan {
  readonly taskId: string;
  readonly steps: readonly Step[];
  readonly status: PlanStatus;
  readonly createdAt: string;
  readonly approvedAt: string | null;
  readonly parallelizable: boolean;
}

// ─── Agent Status (kept as string literal for checkpoint compatibility) ───────

export type AgentStatus =
  | 'idle'
  | 'intake'
  | 'planning'
  | 'executing'
  | 'reviewing'
  | 'complete'
  | 'failed'
  | 'paused';

// ─── Memory ───────────────────────────────────────────────────────────────────

export interface MemoryStats {
  readonly workingCount: number;
  readonly episodicCount: number;
  readonly proceduralCount: number;
  readonly lastCheckpoint: string | null;
  readonly memoryBytes: number;
}

export type MemoryOutcome = 'success' | 'failure' | 'partial';

export interface MemoryEntry {
  readonly taskId: string;
  readonly timestamp: string;
  readonly description: string;
  readonly outcome: MemoryOutcome;
  readonly lessonsLearned: readonly string[];
  readonly skillsUsed: readonly string[];
  readonly durationMs: number;
  readonly tags: readonly string[];
}

// ─── Profile ──────────────────────────────────────────────────────────────────

export type ProfileName = 'dev' | 'lead' | 'secure' | 'growth' | 'full';

export interface Profile {
  readonly name: ProfileName;
  readonly description: string;
  readonly skills: readonly string[];
  readonly defaultModel: string;
  readonly maxConcurrentAgents: number;
  readonly paymentEnabled: boolean;
  readonly rsiEnabled: boolean;
}

// ─── Skill Manifest ───────────────────────────────────────────────────────────

export interface SkillRequirements {
  readonly bins: readonly string[];
  readonly env: readonly string[];
  readonly config: readonly string[];
}

export interface SkillManifest {
  readonly name: string;
  readonly description: string;
  readonly path: string;
  readonly requirements: SkillRequirements | null;
}

// ─── RSI Tiers ────────────────────────────────────────────────────────────────

export type RSITierMode = 'auto' | 'ask' | 'off';
export type RSITierT4Mode = 'ask' | 'off';

export interface RSITier {
  readonly t1: RSITierMode;
  readonly t2: RSITierMode;
  readonly t3: RSITierMode;
  readonly t4: RSITierT4Mode;
}

export type RSIMutationStatus = 'active' | 'rolled-back';

export interface RSIMutation {
  readonly mutationId: string;
  readonly appliedAt: string;
  readonly delta: number;
  readonly status: RSIMutationStatus;
}

// ─── Payment Config ───────────────────────────────────────────────────────────

export type PaymentMode = 'human-first' | 'auto' | 'disabled';

export interface PaymentConfig {
  readonly mode: PaymentMode;
  readonly dailyLimitUsd: number;
  readonly weeklyLimitUsd: number;
  readonly allowedDomains: readonly string[];
}

// ─── Config File ──────────────────────────────────────────────────────────────

export interface RSIConfig {
  readonly enabled: boolean;
  readonly tiers: RSITier;
}

export interface LoggingConfig {
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  readonly retentionDays: number;
}

export interface ConfigFile {
  readonly version: string;
  readonly profile: ProfileName;
  readonly rsi: RSIConfig;
  readonly payments: PaymentConfig;
  readonly logging: LoggingConfig;
  readonly skillsDir: string;
  readonly dataDir: string;
}

// ─── Control Loop Types ───────────────────────────────────────────────────────

export interface StepResult {
  readonly stepId: string;
  readonly status: 'success' | 'failure';
  readonly output: string;
  readonly durationMs: number;
  readonly retriesUsed: number;
  readonly error: string | null;
}

export interface PlanResult {
  readonly taskId: string;
  readonly status: 'success' | 'failure' | 'partial';
  readonly stepResults: readonly StepResult[];
  readonly durationMs: number;
  readonly completedSteps: number;
  readonly failedSteps: number;
  readonly skippedSteps: number;
}

export interface CriterionResult {
  readonly criterion: string;
  readonly met: boolean;
  readonly evidence: string;
}

export interface ReviewResult {
  readonly passed: boolean;
  readonly criteria: readonly CriterionResult[];
  readonly suggestions: readonly string[];
}

export type TaskOutcome = 'success' | 'failure' | 'partial';

export interface TaskCompletion {
  readonly taskId: string;
  readonly outcome: TaskOutcome;
  readonly summary: string;
  readonly durationMs: number;
  readonly skillsUsed: readonly string[];
  readonly lessonsLearned: readonly string[];
}

// ─── Working Memory ───────────────────────────────────────────────────────────

export interface WorkingMemory {
  readonly taskId: string;
  readonly goal: Goal;
  readonly plan: Plan;
  readonly currentStepId: string | null;
  readonly intermediateOutputs: Readonly<Record<string, string>>;
  readonly contextWindow: readonly string[];
}

// ─── Payment Types ────────────────────────────────────────────────────────────

export interface PaymentRequired {
  readonly amount: number;
  readonly currency: string;
  readonly recipient: string;
  readonly network: string;
  readonly x402Headers: Readonly<Record<string, string>>;
}

export interface PaymentRequest {
  readonly amount: number;
  readonly currency: string;
  readonly recipient: string;
  readonly x402Headers: Readonly<Record<string, string>>;
  readonly domain: string;
}

export interface PaymentResult {
  readonly success: boolean;
  readonly txHash?: string;
  readonly error?: string;
}

export interface SpendingDecision {
  readonly allowed: boolean;
  readonly reason: string;
  readonly remainingDaily: number;
}

export interface PaymentAuditEntry {
  readonly timestamp: string;
  readonly request: PaymentRequest;
  readonly result: PaymentResult;
  readonly spendingSnapshot: {
    readonly dailySpent: number;
    readonly dailyLimit: number;
  };
}

// ─── Episodic Memory ──────────────────────────────────────────────────────────

export interface EpisodicEntry {
  readonly taskId: string;
  readonly timestamp: string;
  readonly description: string;
  readonly outcome: MemoryOutcome;
  readonly lessonsLearned: readonly string[];
  readonly skillsUsed: readonly string[];
  readonly durationMs: number;
  readonly tags: readonly string[];
}

// ─── Procedural Memory ────────────────────────────────────────────────────────

export interface MutationRecord {
  readonly mutationId: string;
  readonly description: string;
  readonly appliedAt: string;
  readonly revertedAt: string | null;
  readonly status: 'active' | 'reverted';
}

export interface ProceduralEntry {
  readonly skillName: string;
  readonly invocationCount: number;
  readonly successRate: number;
  readonly avgContribution: number;
  readonly preferredContexts: readonly string[];
  readonly lastUsed: string;
  readonly mutations: readonly MutationRecord[];
}

// ─── Checkpoint ───────────────────────────────────────────────────────────────

export interface CheckpointState {
  readonly taskId: string;
  readonly goal: Goal;
  readonly plan: Plan;
  readonly currentStepId: string | null;
  readonly intermediateOutputs: Readonly<Record<string, string>>;
  readonly workingMemory: WorkingMemory;
  readonly savedAt: string;
  readonly agentStatus: AgentStatus;
}

export interface CheckpointInfo {
  readonly taskId: string;
  readonly description: string;
  readonly savedAt: string;
  readonly isStale: boolean;
}

// ─── RSI Metrics ──────────────────────────────────────────────────────────────

export interface TaskMetrics {
  readonly taskId: string;
  readonly timestamp: string;
  readonly durationMs: number;
  readonly stepCount: number;
  readonly stepsCompleted: number;
  readonly stepsFailed: number;
  readonly retryCount: number;
  readonly skillsUsed: readonly string[];
  readonly outcome: TaskOutcome;
  readonly memoryEntriesCreated: number;
}

export interface SkillMetrics {
  readonly skillName: string;
  readonly timestamp: string;
  readonly invoked: boolean;
  readonly succeeded: boolean;
  readonly durationMs: number;
  readonly taskId: string;
  readonly mutationActive: boolean;
}

export type TrendDirection = 'improving' | 'declining' | 'stable';

export interface SkillAggregateStats {
  readonly skillName: string;
  readonly totalInvocations: number;
  readonly successRate: number;
  readonly avgDurationMs: number;
  readonly trendDirection: TrendDirection;
}

// ─── RSI Hypothesis ───────────────────────────────────────────────────────────

export type RSITierLabel = 'T1' | 'T2' | 'T3' | 'T4';

export interface RSIHypothesis {
  readonly hypothesisId: string;
  readonly skillName: string;
  readonly description: string;
  readonly expectedImprovement: number;
  readonly tier: RSITierLabel;
  readonly confidence: number;
  readonly evidence: readonly string[];
}

// ─── RSI Mutation (Extended) ──────────────────────────────────────────────────

export type RSIMutationExtendedStatus = 'proposed' | 'applied' | 'reverted' | 'promoted';

export interface RSIMutationExtended {
  readonly mutationId: string;
  readonly hypothesisId: string;
  readonly skillName: string;
  readonly tier: RSITierLabel;
  readonly description: string;
  readonly originalValue: string;
  readonly mutatedValue: string;
  readonly status: RSIMutationExtendedStatus;
  readonly appliedAt: string | null;
  readonly revertedAt: string | null;
}

// ─── A/B Testing ──────────────────────────────────────────────────────────────

export type ABTestStatus = 'running' | 'completed' | 'cancelled';
export type ABTestDecision = 'promote' | 'rollback' | 'continue';

export interface ABTest {
  readonly testId: string;
  readonly mutationId: string;
  readonly skillName: string;
  readonly baselineStats: SkillAggregateStats;
  readonly variantStats: SkillAggregateStats;
  readonly sampleSize: number;
  readonly minSampleSize: number;
  readonly startedAt: string;
  readonly status: ABTestStatus;
}

export interface ABTestResult {
  readonly testId: string;
  readonly decision: ABTestDecision;
  readonly improvement: number;
  readonly confidence: number;
}

// ─── RSI Audit ────────────────────────────────────────────────────────────────

export interface RSIAuditMetrics {
  readonly baseline: number;
  readonly current: number;
  readonly delta: number;
}

export interface RSIAuditEntry {
  readonly timestamp: string;
  readonly action: string;
  readonly skillName: string;
  readonly mutationId: string;
  readonly hypothesis: string;
  readonly metrics: RSIAuditMetrics;
  readonly decision: string;
  /**
   * Hash of the previous audit entry, or the genesis marker for the first entry.
   * Enables tamper-evident verification without changing the append-only JSONL format.
   */
  readonly previousHash?: string;
  /** SHA-256 hash of this entry after binding it to previousHash. */
  readonly entryHash?: string;
}

export interface RSIAuditIntegrityResult {
  readonly valid: boolean;
  readonly checkedEntries: number;
  readonly failedAt: number | null;
  readonly reason: string | null;
}
