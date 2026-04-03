/**
 * ClawPowers × ElizaOS Integration Demo
 *
 * Shows how to wire ClawPowers memory + payments into an ElizaOS plugin.
 * This creates a plugin that gives any ElizaOS agent:
 *  - Three-tier memory (episodic, procedural, working)
 *  - x402 payment handling with spending policy
 *  - RSI metrics collection
 *
 * npm install clawpowers
 */

import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  EpisodicMemory,
  ProceduralMemory,
  WorkingMemoryManager,
  ContextInjector,
  CheckpointManager,
  SpendingPolicy,
  PaymentExecutor,
  detect402,
  MetricsCollector,
  type MCPPaymentClient,
  type EpisodicEntry,
  type Goal,
  type TaskMetrics,
} from 'clawpowers';

// ─── Plugin State ─────────────────────────────────────────────────────────────

const CLAWPOWERS_DIR = join(homedir(), '.clawpowers');

const episodic = new EpisodicMemory(join(CLAWPOWERS_DIR, 'memory', 'episodic.jsonl'));
const procedural = new ProceduralMemory(join(CLAWPOWERS_DIR, 'memory', 'procedural.json'));
const workingMemory = new WorkingMemoryManager();
const injector = new ContextInjector(episodic, procedural);
const checkpoints = new CheckpointManager(join(CLAWPOWERS_DIR, 'state', 'checkpoints'));
const metrics = new MetricsCollector(
  join(CLAWPOWERS_DIR, 'metrics', 'task-metrics.jsonl'),
  join(CLAWPOWERS_DIR, 'metrics', 'skill-metrics.jsonl')
);

// ─── ElizaOS Plugin Interface ─────────────────────────────────────────────────

interface ElizaPlugin {
  name: string;
  description: string;
  actions: Record<string, ElizaAction>;
  providers: Record<string, ElizaProvider>;
}

interface ElizaAction {
  name: string;
  description: string;
  handler: (params: Record<string, unknown>) => Promise<unknown>;
}

interface ElizaProvider {
  name: string;
  get: (params: Record<string, unknown>) => Promise<unknown>;
}

// ─── Payment Setup ────────────────────────────────────────────────────────────

function createPaymentExecutor(client: MCPPaymentClient): PaymentExecutor {
  const policy = new SpendingPolicy({
    dailyLimit: 25,
    transactionLimit: 10,
    allowedDomains: [],
  });
  return new PaymentExecutor(policy, client);
}

// ─── Plugin Definition ────────────────────────────────────────────────────────

export function createClawPowersPlugin(mcpClient: MCPPaymentClient): ElizaPlugin {
  const executor = createPaymentExecutor(mcpClient);

  return {
    name: 'clawpowers',
    description: 'Memory, payments, and RSI capabilities for ElizaOS agents',

    actions: {
      recordEpisode: {
        name: 'recordEpisode',
        description: 'Record a task completion in episodic memory',
        handler: async (params) => {
          const entry: EpisodicEntry = {
            taskId: String(params['taskId'] ?? 'unknown'),
            timestamp: new Date().toISOString(),
            description: String(params['description'] ?? ''),
            outcome: (params['outcome'] as 'success' | 'failure' | 'partial') ?? 'success',
            lessonsLearned: (params['lessons'] as string[]) ?? [],
            skillsUsed: (params['skills'] as string[]) ?? [],
            durationMs: Number(params['durationMs'] ?? 0),
            tags: (params['tags'] as string[]) ?? [],
          };
          await episodic.append(entry);
          return { recorded: true, taskId: entry.taskId };
        },
      },

      updateSkill: {
        name: 'updateSkill',
        description: 'Update procedural memory for a skill execution',
        handler: async (params) => {
          const skillName = String(params['skillName'] ?? '');
          await procedural.update(skillName, {
            succeeded: Boolean(params['succeeded']),
            durationMs: Number(params['durationMs'] ?? 0),
            taskId: String(params['taskId'] ?? 'unknown'),
          });
          return { updated: true, skillName };
        },
      },

      handlePayment: {
        name: 'handlePayment',
        description: 'Handle an x402 payment required response',
        handler: async (params) => {
          const status = Number(params['status'] ?? 0);
          const headers = (params['headers'] as Record<string, string>) ?? {};

          const paymentRequired = detect402({ status, headers });
          if (!paymentRequired) {
            return { paymentNeeded: false };
          }

          const result = await executor.executePayment({
            amount: paymentRequired.amount,
            currency: paymentRequired.currency,
            recipient: paymentRequired.recipient,
            domain: String(params['domain'] ?? 'unknown'),
            x402Headers: paymentRequired.x402Headers,
          });

          return {
            paymentNeeded: true,
            success: result.success,
            txHash: result.txHash,
            error: result.error,
          };
        },
      },

      recordMetrics: {
        name: 'recordMetrics',
        description: 'Record task completion metrics for RSI',
        handler: async (params) => {
          const taskMetrics: TaskMetrics = {
            taskId: String(params['taskId'] ?? 'unknown'),
            timestamp: new Date().toISOString(),
            durationMs: Number(params['durationMs'] ?? 0),
            stepCount: Number(params['stepCount'] ?? 1),
            stepsCompleted: Number(params['stepsCompleted'] ?? 1),
            stepsFailed: Number(params['stepsFailed'] ?? 0),
            retryCount: Number(params['retryCount'] ?? 0),
            skillsUsed: (params['skillsUsed'] as string[]) ?? [],
            outcome: (params['outcome'] as 'success' | 'failure' | 'partial') ?? 'success',
            memoryEntriesCreated: Number(params['memoryEntries'] ?? 1),
          };
          await metrics.recordTaskMetrics(taskMetrics);
          return { recorded: true };
        },
      },
    },

    providers: {
      context: {
        name: 'clawpowers-context',
        get: async (params) => {
          const goal: Goal = {
            taskId: String(params['taskId'] ?? 'current'),
            description: String(params['description'] ?? ''),
            constraints: [],
            successCriteria: [],
            createdAt: new Date().toISOString(),
            source: 'interactive',
          };
          const context = await injector.inject(goal, 2000);
          return { context, entryCount: context.length };
        },
      },

      recentMemory: {
        name: 'clawpowers-recent',
        get: async (params) => {
          const count = Number(params['count'] ?? 10);
          const entries = await episodic.readRecent(count);
          return { entries, count: entries.length };
        },
      },

      skillStats: {
        name: 'clawpowers-skills',
        get: async (params) => {
          const skillName = String(params['skillName'] ?? '');
          const stats = await metrics.getAggregatedSkillStats(skillName);
          return stats;
        },
      },

      auditLog: {
        name: 'clawpowers-audit',
        get: async () => {
          const log = executor.getAuditLog();
          return { entries: log, count: log.length };
        },
      },
    },
  };
}

export {
  episodic,
  procedural,
  workingMemory,
  injector,
  checkpoints,
  metrics,
};
