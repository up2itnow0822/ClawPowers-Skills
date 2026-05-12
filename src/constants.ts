/**
 * ClawPowers Skills — Constants
 * Default paths, version, config values, RSI tier boundaries.
 */

import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ConfigFile, AgentStatus } from './types.js';

// ─── Version ──────────────────────────────────────────────────────────────────

export const VERSION = '2.2.7';
export const PACKAGE_NAME = 'clawpowers';

// ─── Paths ────────────────────────────────────────────────────────────────────

export const CLAWPOWERS_HOME = join(homedir(), '.clawpowers');
export const CONFIG_PATH = join(CLAWPOWERS_HOME, 'config.json');
export const SKILLS_DIR = join(CLAWPOWERS_HOME, 'skills');
export const DATA_DIR = join(CLAWPOWERS_HOME, 'data');
export const LOGS_DIR = join(CLAWPOWERS_HOME, 'logs');
export const MEMORY_DIR = join(CLAWPOWERS_HOME, 'memory');
export const METRICS_DIR = join(CLAWPOWERS_HOME, 'metrics');
export const PROFILES_DIR = join(CLAWPOWERS_HOME, 'profiles');
export const WALLET_DIR = join(CLAWPOWERS_HOME, 'wallet');
export const CHECKPOINTS_DIR = join(CLAWPOWERS_HOME, 'state', 'checkpoints');

// ─── Default Config ───────────────────────────────────────────────────────────

export const DEFAULT_CONFIG: ConfigFile = {
  version: VERSION,
  profile: 'dev',
  rsi: {
    enabled: true,
    tiers: {
      t1: 'auto',
      t2: 'auto',
      t3: 'ask',
      t4: 'ask',
    },
  },
  payments: {
    mode: 'human-first',
    dailyLimitUsd: 25,
    weeklyLimitUsd: 100,
    allowedDomains: [],
  },
  logging: {
    level: 'info',
    retentionDays: 30,
  },
  skillsDir: SKILLS_DIR,
  dataDir: DATA_DIR,
} as const;

// ─── RSI Tier Definitions ─────────────────────────────────────────────────────

export const RSI_TIER_DESCRIPTIONS = {
  t1: 'Parameter Tuning — model params, retry counts, timeouts, thresholds',
  t2: 'Strategy Evolution — skill selection order, fallback chains, execution strategies',
  t3: 'Skill Composition — create new skill chains from existing skills',
  t4: 'Architecture Proposals — structural changes, human approval required',
} as const;

/**
 * Modes allowed per tier. T4 NEVER allows "auto" — this is a safety invariant.
 */
export const RSI_TIER_ALLOWED_MODES = {
  t1: ['auto', 'ask', 'off'] as const,
  t2: ['auto', 'ask', 'off'] as const,
  t3: ['auto', 'ask', 'off'] as const,
  t4: ['ask', 'off'] as const,
} as const;

// ─── Safety Invariants (NEVER modifiable by RSI) ──────────────────────────────

export const SAFETY_INVARIANTS = [
  'Spending limits and SpendingPolicy',
  'Core identity and directives',
  'RSI safety tier definitions',
  'Sandbox boundaries',
  'Authentication credentials',
] as const;

// ─── Agent State Machine ──────────────────────────────────────────────────────

/**
 * Valid state transitions. Maps each status to the set of statuses it can
 * transition to. Retained for checkpoint compatibility.
 */
export const VALID_TRANSITIONS: Record<AgentStatus, readonly AgentStatus[]> = {
  idle: ['intake'],
  intake: ['planning', 'failed'],
  planning: ['executing', 'failed'],
  executing: ['reviewing', 'failed', 'paused'],
  reviewing: ['complete', 'failed', 'executing'],
  complete: ['idle'],
  failed: ['idle'],
  paused: ['executing', 'idle'],
} as const;

// ─── Performance Targets ──────────────────────────────────────────────────────

export const PERFORMANCE = {
  coldStartupMs: 2000,
  maxMemoryRssMb: 150,
  maxContextTokens: 2000,
  checkpointWriteMs: 100,
  episodicSearchMs: 50,
  profileSwitchMs: 500,
  healthCheckIntervalMs: 30000,
  maxRetries: 3,
} as const;
