/**
 * ClawPowers — Skills Library for AI Agents
 * Drop-in capability layer: payments, memory, RSI, wallet.
 * No agent control loop — bring your own agent.
 *
 * @version 2.0.0
 * @license BSL-1.1
 * @patent-pending
 */

// Config
export { loadConfig, loadConfigSafe, saveConfig, initConfig, getConfigValue, setConfigValue } from './config.js';

// Constants
export { VERSION, PACKAGE_NAME, CLAWPOWERS_HOME, DEFAULT_CONFIG } from './constants.js';

// Types
export type {
  ConfigFile, RSIConfig, RSITier, RSITierMode, RSITierT4Mode,
  PaymentConfig, PaymentMode, LoggingConfig,
  ProfileName, SkillManifest, SkillRequirements,
  RSIMutation, RSIMutationStatus, MemoryEntry, MemoryOutcome, MemoryStats,
  StepResult, PlanResult, CriterionResult, ReviewResult, TaskOutcome, TaskCompletion,
  WorkingMemory, PaymentRequired, PaymentRequest, PaymentResult,
  SpendingDecision, PaymentAuditEntry, EpisodicEntry, ProceduralEntry, MutationRecord,
  CheckpointState, CheckpointInfo, TaskMetrics, SkillMetrics, SkillAggregateStats,
  TrendDirection, RSIHypothesis, RSITierLabel, RSIMutationExtended, RSIMutationExtendedStatus,
  ABTest, ABTestResult, ABTestDecision, ABTestStatus, RSIAuditEntry, RSIAuditMetrics,
  Goal, GoalSource, Plan, PlanStatus, Step, StepStatus, AgentStatus,
  Profile,
} from './types.js';

// Payments
export { detect402, isPaymentRequired } from './payments/discovery.js';
export { SpendingPolicy } from './payments/spending.js';
export { PaymentExecutor } from './payments/executor.js';
export type { MCPPaymentClient } from './payments/executor.js';

// Memory
export { WorkingMemoryManager, EpisodicMemory, ProceduralMemory, CheckpointManager, ContextInjector } from './memory/index.js';

// RSI
export { MetricsCollector, HypothesisEngine, MutationEngine, ABTestManager, RSIAuditLog, AutoResearcher, runAutoResearch } from './rsi/index.js';

// Skills
export { discoverSkills, loadSkillManifest, getActiveSkills, parseFrontmatter, listSkillsWithStatus, SkillExecutor } from './skills/index.js';
export type { SkillExecutionContext, SkillExecutionResult } from './skills/index.js';

// Wallet
export { WalletManager, generateWallet, importWallet, signMessage } from './wallet/index.js';
export type { WalletConfig, WalletInfo, SignedMessage } from './wallet/index.js';

// ITP — Identical Twins Protocol
export { encode as itpEncode, decode as itpDecode, healthCheck as itpHealthCheck } from './itp/index.js';
export type { EncodeResult as ItpEncodeResult, DecodeResult as ItpDecodeResult } from './itp/index.js';
export { encodeTaskDescription, decodeSwarmResult } from './itp/swarm-bridge.js';

// Parallel Swarm
export {
  ConcurrencyManager,
  TokenPool,
  classifyHeuristic,
  selectModel,
  classifyTasks,
} from './swarm/index.js';
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
} from './swarm/index.js';
