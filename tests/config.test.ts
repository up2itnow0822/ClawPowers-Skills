/**
 * Config manager tests — CRUD + T4 safety invariant
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  loadConfig, saveConfig, initConfig,
  getConfigValue, setConfigValue,
} from '../src/config.js';
import { DEFAULT_CONFIG } from '../src/constants.js';
import type { ConfigFile } from '../src/types.js';

describe('Config Manager', () => {
  let testDir: string;
  let testConfigPath: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `clawpowers-test-${randomUUID()}`);
    mkdirSync(testDir, { recursive: true });
    testConfigPath = join(testDir, 'config.json');
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('returns default config when file does not exist', () => {
    const config = loadConfig(join(testDir, 'nonexistent.json'));
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it('saves and loads config correctly', () => {
    saveConfig(DEFAULT_CONFIG, testConfigPath);
    const loaded = loadConfig(testConfigPath);
    expect(loaded).toEqual(DEFAULT_CONFIG);
  });

  it('initConfig creates config file with defaults', () => {
    const config = initConfig(testConfigPath);
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(existsSync(testConfigPath)).toBe(true);
  });

  it('rejects invalid config file', () => {
    writeFileSync(testConfigPath, '{"invalid": true}', 'utf-8');
    expect(() => loadConfig(testConfigPath)).toThrow();
  });

  // ─── T4 Safety Invariant ────────────────────────────────────────────────────

  it('T4 cannot be set to "auto" — safety invariant', () => {
    expect(() => setConfigValue(DEFAULT_CONFIG, 'rsi.tiers.t4', 'auto')).toThrow(
      /T4.*cannot be set to "auto"/
    );
  });

  it('T4 can be set to "ask"', () => {
    const updated = setConfigValue(DEFAULT_CONFIG, 'rsi.tiers.t4', 'ask');
    expect(updated.rsi.tiers.t4).toBe('ask');
  });

  it('T4 can be set to "off"', () => {
    const updated = setConfigValue(DEFAULT_CONFIG, 'rsi.tiers.t4', 'off');
    expect(updated.rsi.tiers.t4).toBe('off');
  });

  it('T1 can be set to "auto"', () => {
    const updated = setConfigValue(DEFAULT_CONFIG, 'rsi.tiers.t1', 'auto');
    expect(updated.rsi.tiers.t1).toBe('auto');
  });

  it('T2 can be set to "off"', () => {
    const updated = setConfigValue(DEFAULT_CONFIG, 'rsi.tiers.t2', 'off');
    expect(updated.rsi.tiers.t2).toBe('off');
  });

  it('T3 can be set to "ask"', () => {
    const updated = setConfigValue(DEFAULT_CONFIG, 'rsi.tiers.t3', 'ask');
    expect(updated.rsi.tiers.t3).toBe('ask');
  });

  // ─── Dot-notation get/set ───────────────────────────────────────────────────

  it('getConfigValue reads nested values', () => {
    expect(getConfigValue(DEFAULT_CONFIG, 'rsi.tiers.t1')).toBe('auto');
    expect(getConfigValue(DEFAULT_CONFIG, 'profile')).toBe('dev');
    expect(getConfigValue(DEFAULT_CONFIG, 'payments.dailyLimitUsd')).toBe(25);
  });

  it('getConfigValue returns undefined for invalid keys', () => {
    expect(getConfigValue(DEFAULT_CONFIG, 'nonexistent.key')).toBeUndefined();
  });

  it('setConfigValue updates profile', () => {
    const updated = setConfigValue(DEFAULT_CONFIG, 'profile', 'lead');
    expect(updated.profile).toBe('lead');
  });

  it('setConfigValue coerces boolean values', () => {
    const updated = setConfigValue(DEFAULT_CONFIG, 'rsi.enabled', 'false');
    expect(updated.rsi.enabled).toBe(false);
  });

  it('setConfigValue coerces numeric values', () => {
    const updated = setConfigValue(DEFAULT_CONFIG, 'payments.dailyLimitUsd', '50');
    expect(updated.payments.dailyLimitUsd).toBe(50);
  });

  it('setConfigValue rejects invalid path', () => {
    expect(() => setConfigValue(DEFAULT_CONFIG, 'totally.bogus.path', 'value')).toThrow();
  });

  it('setConfigValue rejects invalid profile name', () => {
    expect(() => setConfigValue(DEFAULT_CONFIG, 'profile', 'invalid-profile')).toThrow();
  });
});
