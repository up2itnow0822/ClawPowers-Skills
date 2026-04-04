/**
 * ClawPowers Agent — RSI Module Re-exports
 */

export { MetricsCollector } from './metrics.js';
export { HypothesisEngine } from './hypothesis.js';
export { MutationEngine } from './mutation.js';
export { ABTestManager } from './ab-test.js';
export { RSIAuditLog } from './audit.js';
export {
  AutoResearcher,
  runAutoResearch,
  buildSearchQuery,
  scoreConfidence,
} from './auto-research.js';
export type {
  FailureTrace,
  CandidateSolution,
  TestResult,
  SkillDefinition,
  TaskContext,
} from './auto-research.js';
