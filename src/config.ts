/**
 * ClawPowers Agent — Config Manager
 * CRUD for ~/.clawpowers/config.json with Zod validation.
 * T4 can never be set to "auto" — enforced at validation layer.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { CONFIG_PATH, DEFAULT_CONFIG, RSI_TIER_ALLOWED_MODES } from './constants.js';
import type { ConfigFile } from './types.js';

// ─── Zod Schemas ──────────────────────────────────────────────────────────────

const RSITierSchema = z.object({
  t1: z.enum(['auto', 'ask', 'off']),
  t2: z.enum(['auto', 'ask', 'off']),
  t3: z.enum(['auto', 'ask', 'off']),
  t4: z.enum(['ask', 'off']),  // NO "auto" — safety invariant
});

const RSIConfigSchema = z.object({
  enabled: z.boolean(),
  tiers: RSITierSchema,
});

const PaymentConfigSchema = z.object({
  mode: z.enum(['human-first', 'auto', 'disabled']),
  dailyLimitUsd: z.number().min(0),
  weeklyLimitUsd: z.number().min(0),
  allowedDomains: z.array(z.string()),
});

const LoggingConfigSchema = z.object({
  level: z.enum(['debug', 'info', 'warn', 'error']),
  retentionDays: z.number().min(1).max(365),
});

const ConfigFileSchema = z.object({
  version: z.string(),
  profile: z.enum(['dev', 'lead', 'secure', 'growth', 'full']),
  rsi: RSIConfigSchema,
  payments: PaymentConfigSchema,
  logging: LoggingConfigSchema,
  skillsDir: z.string(),
  dataDir: z.string(),
});

// ─── Config Manager ───────────────────────────────────────────────────────────

export function loadConfig(configPath: string = CONFIG_PATH): ConfigFile {
  if (!existsSync(configPath)) {
    return DEFAULT_CONFIG;
  }
  const raw = readFileSync(configPath, 'utf-8');
  const parsed: unknown = JSON.parse(raw);
  return ConfigFileSchema.parse(parsed);
}

/**
 * Safe config loader — returns defaults if file is missing or invalid.
 * Used by CLI where crashing on stale config is bad UX.
 */
export function loadConfigSafe(configPath: string = CONFIG_PATH): ConfigFile {
  try {
    return loadConfig(configPath);
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(config: ConfigFile, configPath: string = CONFIG_PATH): void {
  const validated = ConfigFileSchema.parse(config);
  const dir = dirname(configPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(configPath, JSON.stringify(validated, null, 2) + '\n', 'utf-8');
}

export function initConfig(configPath: string = CONFIG_PATH): ConfigFile {
  const config = DEFAULT_CONFIG;
  saveConfig(config, configPath);
  return config;
}

// ─── Dot-notation get/set ─────────────────────────────────────────────────────

/**
 * Get a value from config using dot notation (e.g., "rsi.tiers.t1")
 */
export function getConfigValue(config: ConfigFile, key: string): unknown {
  const parts = key.split('.');
  let current: unknown = config;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Set a value in config using dot notation. Returns the updated config.
 * Validates the entire config after the set to ensure consistency.
 * Throws on invalid values (e.g., T4 = "auto").
 */
export function setConfigValue(config: ConfigFile, key: string, value: string): ConfigFile {
  // Pre-validate RSI tier settings before deep set
  validateTierSetting(key, value);

  const parts = key.split('.');
  // Deep clone config to make it mutable
  const mutable = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;

  let current: Record<string, unknown> = mutable;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (current[part] === undefined || typeof current[part] !== 'object') {
      throw new Error(`Invalid config path: ${key}`);
    }
    current = current[part] as Record<string, unknown>;
  }

  const lastKey = parts[parts.length - 1]!;
  if (!(lastKey in current)) {
    throw new Error(`Invalid config key: ${key}`);
  }

  // Coerce value types
  const coerced = coerceValue(current[lastKey], value);
  current[lastKey] = coerced;

  // Validate entire config through Zod
  return ConfigFileSchema.parse(mutable);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function validateTierSetting(key: string, value: string): void {
  const tierMatch = key.match(/^rsi\.tiers\.(t[1-4])$/);
  if (tierMatch) {
    const tier = tierMatch[1] as keyof typeof RSI_TIER_ALLOWED_MODES;
    const allowed: readonly string[] = RSI_TIER_ALLOWED_MODES[tier];
    if (!allowed.includes(value)) {
      if (tier === 't4' && value === 'auto') {
        throw new Error(
          'T4 (Architecture Proposals) cannot be set to "auto". ' +
          'This is a safety invariant — T4 changes always require human approval. ' +
          'Allowed modes: ask, off'
        );
      }
      throw new Error(
        `Invalid mode "${value}" for tier ${tier}. Allowed: ${allowed.join(', ')}`
      );
    }
  }
}

function coerceValue(existing: unknown, value: string): unknown {
  if (typeof existing === 'boolean') {
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new Error(`Expected boolean value (true/false), got "${value}"`);
  }
  if (typeof existing === 'number') {
    const num = Number(value);
    if (Number.isNaN(num)) {
      throw new Error(`Expected number value, got "${value}"`);
    }
    return num;
  }
  return value;
}

// ─── Exports for schema access ────────────────────────────────────────────────

export { ConfigFileSchema };
