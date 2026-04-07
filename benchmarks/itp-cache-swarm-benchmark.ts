/**
 * ClawPowers Combined Benchmark — ITP + CacheManager + Parallel Swarm
 *
 * Tests 4 conditions with real LLM API calls:
 *   A) Raw baseline — no optimization
 *   B) ITP only — compress task descriptions, no caching
 *   C) Cache only — Anthropic cache_control breakpoints, no ITP
 *   D) ITP + Cache combined — both active
 *
 * Each condition runs the same 5-task parallel swarm with a shared system
 * prompt, measuring actual token usage, cost, and latency.
 *
 * Run:
 *   ITP_BASE_URL=http://127.0.0.1:8101 npx tsx benchmarks/itp-cache-swarm-benchmark.ts
 */

import { CacheManager } from '../src/cache/index.js';
import type { AnthropicRequest } from '../src/cache/types.js';
import { encode as itpEncode } from '../src/itp/index.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Config ──────────────────────────────────────────────────────────────────

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY
  ?? (() => {
    try {
      const fs = require('fs');
      const envFile = fs.readFileSync(join(__dirname, '../../.env'), 'utf-8');
      const m = envFile.match(/^OPENROUTER_API_KEY=(.+)/m);
      return m?.[1]?.trim();
    } catch { return undefined; }
  })();

if (!OPENROUTER_KEY) {
  console.error('Missing OPENROUTER_API_KEY');
  process.exit(1);
}

const MODEL = 'anthropic/claude-3.5-haiku';
const MAX_TOKENS = 150;
const API_URL = 'https://openrouter.ai/api/v1/chat/completions';

// ─── Shared system prompt (realistic agent coordinator) ──────────────────────

const SYSTEM_PROMPT = `You are a task coordinator agent running inside the AI Agent Economy operations environment. You manage a parallel swarm of specialized agents performing infrastructure monitoring, market research, and trading operations.

Your capabilities include:
- Docker container management and health monitoring
- API endpoint availability checking and latency measurement
- Disk usage analysis and storage capacity planning
- System memory and process resource monitoring
- Log aggregation and anomaly detection across all services

Operating rules:
1. Always report findings in structured JSON format with severity levels (info, warning, critical)
2. Do not take corrective action — only observe and report
3. The current monitoring window is the last 15 minutes unless otherwise specified
4. Previous findings from other swarm agents are available through the shared memory interface
5. You have access to docker, system utilities, and the metrics API
6. Flag any anomalies that deviate more than 2 standard deviations from the rolling 24-hour baseline
7. Include timestamps in UTC for all observations
8. If a service is unreachable, retry once after 5 seconds before marking it as down`;

// ─── Task descriptions (diverse operational tasks) ───────────────────────────

const TASKS = [
  {
    id: 'docker-health',
    message: 'Run docker ps and report container status, uptime, and port mappings for all running containers. Flag any containers in unhealthy or restarting state. Include image versions and resource limits if configured.',
  },
  {
    id: 'api-endpoints',
    message: 'Check the health endpoints for the trading api (port 8080), the metrics server (port 9090), and the webhook receiver (port 3000). Report status codes and response latency in milliseconds. Flag anything over 500ms or returning non-200 status.',
  },
  {
    id: 'disk-analysis',
    message: 'Analyze disk usage and identify large files consuming storage on all mounted volumes. Identify any directories over 1gb and any individual files over 100mb. Report total free space remaining as a percentage for each mount point.',
  },
  {
    id: 'memory-procs',
    message: 'Review system memory and process resource consumption. Report total, used, and available memory. List the top 10 processes by memory consumption with pid, name, and rss. Flag any process using more than 2gb or any zombie processes.',
  },
  {
    id: 'log-audit',
    message: 'Audit recent error logs across all services for anomalies. Scan the last 1000 lines of logs for each running docker container. Extract error and warn level entries. Group by service and report counts. Highlight any new error patterns not seen in the previous 24 hours.',
  },
];

// ─── API call helper ─────────────────────────────────────────────────────────

interface ApiResult {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  cost: number;
  latencyMs: number;
  model: string;
}

async function callApi(body: Record<string, unknown>): Promise<ApiResult> {
  const start = Date.now();
  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/up2itnow0822/ClawPowers-Skills',
      'X-Title': 'ClawPowers Benchmark',
    },
    body: JSON.stringify(body),
  });
  const latencyMs = Date.now() - start;

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`API error ${resp.status}: ${text}`);
  }

  const data = await resp.json() as any;
  const usage = data.usage ?? {};
  const details = usage.prompt_tokens_details ?? {};

  return {
    promptTokens: usage.prompt_tokens ?? 0,
    completionTokens: usage.completion_tokens ?? 0,
    totalTokens: usage.total_tokens ?? 0,
    cachedTokens: details.cached_tokens ?? 0,
    cacheWriteTokens: details.cache_write_tokens ?? 0,
    cost: usage.cost ?? 0,
    latencyMs,
    model: data.model ?? MODEL,
  };
}

// Delay helper to avoid rate limits
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ─── Condition runners ───────────────────────────────────────────────────────

interface ConditionResult {
  name: string;
  tasks: Array<{
    id: string;
    promptTokens: number;
    completionTokens: number;
    cachedTokens: number;
    cacheWriteTokens: number;
    cost: number;
    latencyMs: number;
    systemChars: number;
    messageChars: number;
  }>;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCachedTokens: number;
  totalCacheWriteTokens: number;
  totalCost: number;
  totalLatencyMs: number;
  wallTimeMs: number;
}

/** Condition A: Raw baseline — no optimization */
async function runRaw(): Promise<ConditionResult> {
  console.log('\n▸ Condition A: Raw baseline (no optimization)...');
  const tasks: ConditionResult['tasks'] = [];
  const wallStart = Date.now();

  // Run sequentially to avoid rate limits, but measure individual latency
  for (const task of TASKS) {
    const body = {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: task.message }],
    };

    const result = await callApi(body);
    tasks.push({
      id: task.id,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      cachedTokens: result.cachedTokens,
      cacheWriteTokens: result.cacheWriteTokens,
      cost: result.cost,
      latencyMs: result.latencyMs,
      systemChars: SYSTEM_PROMPT.length,
      messageChars: task.message.length,
    });
    console.log(`  ${task.id}: ${result.promptTokens} prompt + ${result.completionTokens} comp = ${result.totalTokens} total (${result.latencyMs}ms, cached=${result.cachedTokens})`);
    await sleep(500);
  }

  const wallTimeMs = Date.now() - wallStart;
  return buildResult('A: Raw baseline', tasks, wallTimeMs);
}

/** Condition B: ITP only — compress tasks, no caching */
async function runItpOnly(): Promise<ConditionResult> {
  console.log('\n▸ Condition B: ITP only (compression, no caching)...');
  const tasks: ConditionResult['tasks'] = [];
  const wallStart = Date.now();

  for (const task of TASKS) {
    // Compress both system prompt and task message
    const sysResult = await itpEncode(SYSTEM_PROMPT);
    const msgResult = await itpEncode(task.message);

    const compressedSys = sysResult.encoded;
    const compressedMsg = msgResult.encoded;

    console.log(`  ${task.id} compress: sys ${SYSTEM_PROMPT.length}→${compressedSys.length} (${Math.round((1 - compressedSys.length / SYSTEM_PROMPT.length) * 100)}%), msg ${task.message.length}→${compressedMsg.length} (${Math.round((1 - compressedMsg.length / task.message.length) * 100)}%)`);

    const body = {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: compressedSys,
      messages: [{ role: 'user', content: compressedMsg }],
    };

    const result = await callApi(body);
    tasks.push({
      id: task.id,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      cachedTokens: result.cachedTokens,
      cacheWriteTokens: result.cacheWriteTokens,
      cost: result.cost,
      latencyMs: result.latencyMs,
      systemChars: compressedSys.length,
      messageChars: compressedMsg.length,
    });
    console.log(`  ${task.id}: ${result.promptTokens} prompt + ${result.completionTokens} comp = ${result.totalTokens} total (${result.latencyMs}ms)`);
    await sleep(500);
  }

  const wallTimeMs = Date.now() - wallStart;
  return buildResult('B: ITP only', tasks, wallTimeMs);
}

/** Condition C: Cache only — Anthropic cache_control, no ITP */
async function runCacheOnly(): Promise<ConditionResult> {
  console.log('\n▸ Condition C: Cache only (cache_control breakpoints, no ITP)...');
  const cache = new CacheManager({ provider: 'anthropic', minPrefixTokens: 0 });
  const tasks: ConditionResult['tasks'] = [];
  const wallStart = Date.now();

  for (let i = 0; i < TASKS.length; i++) {
    const task = TASKS[i]!;

    // Build request with cache breakpoints
    const request: AnthropicRequest = {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: task.message }],
    };

    const injected = cache.inject(request);
    const body = injected.request;

    const result = await callApi(body as Record<string, unknown>);
    cache.recordUsage({
      input_tokens: result.promptTokens,
      output_tokens: result.completionTokens,
      cache_creation_input_tokens: result.cacheWriteTokens,
      cache_read_input_tokens: result.cachedTokens,
    });

    tasks.push({
      id: task.id,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      cachedTokens: result.cachedTokens,
      cacheWriteTokens: result.cacheWriteTokens,
      cost: result.cost,
      latencyMs: result.latencyMs,
      systemChars: SYSTEM_PROMPT.length,
      messageChars: task.message.length,
    });
    const cacheNote = result.cachedTokens > 0 ? `CACHE HIT ${result.cachedTokens}` : result.cacheWriteTokens > 0 ? `CACHE WRITE ${result.cacheWriteTokens}` : 'no cache';
    console.log(`  ${task.id}: ${result.promptTokens} prompt + ${result.completionTokens} comp = ${result.totalTokens} total (${result.latencyMs}ms, ${cacheNote})`);
    await sleep(300); // Shorter delay — cache needs proximity for TTL
  }

  const stats = cache.getStats();
  console.log(`  Cache stats: ${stats.cacheInjected} injected, savings ratio: ${(stats.economics.savingsRatio * 100).toFixed(1)}%`);

  const wallTimeMs = Date.now() - wallStart;
  return buildResult('C: Cache only', tasks, wallTimeMs);
}

/** Condition D: ITP + Cache combined */
async function runCombined(): Promise<ConditionResult> {
  console.log('\n▸ Condition D: ITP + Cache combined (compression + caching)...');
  const cache = new CacheManager({ provider: 'anthropic', minPrefixTokens: 0 });
  const tasks: ConditionResult['tasks'] = [];
  const wallStart = Date.now();

  // Pre-compress system prompt once (ITP is deterministic)
  const sysResult = await itpEncode(SYSTEM_PROMPT);
  const compressedSys = sysResult.encoded;
  console.log(`  System prompt: ${SYSTEM_PROMPT.length}→${compressedSys.length} chars (${Math.round((1 - compressedSys.length / SYSTEM_PROMPT.length) * 100)}% ITP compression)`);

  for (let i = 0; i < TASKS.length; i++) {
    const task = TASKS[i]!;

    // Compress task message
    const msgResult = await itpEncode(task.message);
    const compressedMsg = msgResult.encoded;

    // Build request with cache breakpoints on ITP-compressed content
    const request: AnthropicRequest = {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: compressedSys,
      messages: [{ role: 'user', content: compressedMsg }],
    };

    const injected = cache.inject(request);
    const body = injected.request;

    const result = await callApi(body as Record<string, unknown>);
    cache.recordUsage({
      input_tokens: result.promptTokens,
      output_tokens: result.completionTokens,
      cache_creation_input_tokens: result.cacheWriteTokens,
      cache_read_input_tokens: result.cachedTokens,
    });

    tasks.push({
      id: task.id,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      cachedTokens: result.cachedTokens,
      cacheWriteTokens: result.cacheWriteTokens,
      cost: result.cost,
      latencyMs: result.latencyMs,
      systemChars: compressedSys.length,
      messageChars: compressedMsg.length,
    });
    const cacheNote = result.cachedTokens > 0 ? `CACHE HIT ${result.cachedTokens}` : result.cacheWriteTokens > 0 ? `CACHE WRITE ${result.cacheWriteTokens}` : 'no cache';
    console.log(`  ${task.id}: ${result.promptTokens} prompt + ${result.completionTokens} comp (${result.latencyMs}ms, ${cacheNote})`);
    await sleep(300);
  }

  const stats = cache.getStats();
  console.log(`  Cache stats: ${stats.cacheInjected} injected, savings ratio: ${(stats.economics.savingsRatio * 100).toFixed(1)}%`);

  const wallTimeMs = Date.now() - wallStart;
  return buildResult('D: ITP + Cache combined', tasks, wallTimeMs);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildResult(name: string, tasks: ConditionResult['tasks'], wallTimeMs: number): ConditionResult {
  return {
    name,
    tasks,
    totalPromptTokens: tasks.reduce((s, t) => s + t.promptTokens, 0),
    totalCompletionTokens: tasks.reduce((s, t) => s + t.completionTokens, 0),
    totalCachedTokens: tasks.reduce((s, t) => s + t.cachedTokens, 0),
    totalCacheWriteTokens: tasks.reduce((s, t) => s + t.cacheWriteTokens, 0),
    totalCost: tasks.reduce((s, t) => s + t.cost, 0),
    totalLatencyMs: tasks.reduce((s, t) => s + t.latencyMs, 0),
    wallTimeMs,
  };
}

function pct(a: number, b: number): string {
  if (b === 0) return '0.0%';
  return ((1 - a / b) * 100).toFixed(1) + '%';
}

function costStr(c: number): string {
  return '$' + c.toFixed(6);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const cpus = os.cpus();
  const totalMem = (os.totalmem() / (1024 ** 3)).toFixed(1);

  console.log('═══════════════════════════════════════════════════');
  console.log('  ClawPowers Combined Benchmark');
  console.log('  ITP + CacheManager + Parallel Swarm');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Host:     ${os.hostname()}`);
  console.log(`  CPU:      ${cpus[0]?.model ?? 'unknown'} (${cpus.length} cores)`);
  console.log(`  Memory:   ${totalMem} GB`);
  console.log(`  Model:    ${MODEL}`);
  console.log(`  Tasks:    ${TASKS.length} parallel swarm tasks`);
  console.log(`  Tokens:   max ${MAX_TOKENS} completion per task`);
  console.log('═══════════════════════════════════════════════════');

  // Run all 4 conditions
  const raw = await runRaw();
  await sleep(2000); // Breathe between conditions

  const itpOnly = await runItpOnly();
  await sleep(2000);

  const cacheOnly = await runCacheOnly();
  await sleep(2000);

  const combined = await runCombined();

  // ─── Summary ───────────────────────────────────────────────────────────────

  console.log('\n═══════════════════════════════════════════════════');
  console.log('  RESULTS — 4 Conditions Compared');
  console.log('═══════════════════════════════════════════════════');

  const conditions = [raw, itpOnly, cacheOnly, combined];
  const baseline = raw;

  for (const c of conditions) {
    const promptSavings = pct(c.totalPromptTokens, baseline.totalPromptTokens);
    const costSavings = pct(c.totalCost, baseline.totalCost);
    const latencySavings = pct(c.totalLatencyMs, baseline.totalLatencyMs);

    console.log(`\n  ${c.name}:`);
    console.log(`    Prompt tokens:    ${c.totalPromptTokens} (${promptSavings} savings vs raw)`);
    console.log(`    Completion tokens: ${c.totalCompletionTokens}`);
    console.log(`    Cached tokens:    ${c.totalCachedTokens} (write: ${c.totalCacheWriteTokens})`);
    console.log(`    Total cost:       ${costStr(c.totalCost)} (${costSavings} savings vs raw)`);
    console.log(`    Total latency:    ${c.totalLatencyMs}ms (${latencySavings} savings vs raw)`);
    console.log(`    Wall time:        ${c.wallTimeMs}ms`);
  }

  // Cost breakdown
  console.log('\n  ─── Cost Comparison ───');
  console.log(`    Raw baseline:       ${costStr(raw.totalCost)}`);
  console.log(`    ITP only:           ${costStr(itpOnly.totalCost)} (${pct(itpOnly.totalCost, raw.totalCost)} savings)`);
  console.log(`    Cache only:         ${costStr(cacheOnly.totalCost)} (${pct(cacheOnly.totalCost, raw.totalCost)} savings)`);
  console.log(`    ITP + Cache:        ${costStr(combined.totalCost)} (${pct(combined.totalCost, raw.totalCost)} savings)`);

  // Prompt token breakdown
  console.log('\n  ─── Prompt Token Comparison ───');
  console.log(`    Raw baseline:       ${raw.totalPromptTokens} tokens`);
  console.log(`    ITP only:           ${itpOnly.totalPromptTokens} tokens (${pct(itpOnly.totalPromptTokens, raw.totalPromptTokens)} reduction)`);
  console.log(`    Cache only:         ${cacheOnly.totalPromptTokens} tokens (${cacheOnly.totalCachedTokens} cached)`);
  console.log(`    ITP + Cache:        ${combined.totalPromptTokens} tokens (${combined.totalCachedTokens} cached, ${pct(combined.totalPromptTokens, raw.totalPromptTokens)} total reduction)`);

  console.log('\n═══════════════════════════════════════════════════');

  // Save results
  const resultsDir = join(__dirname, 'results');
  mkdirSync(resultsDir, { recursive: true });
  const outFile = join(resultsDir, `combined-benchmark-${Date.now()}.json`);
  writeFileSync(outFile, JSON.stringify({
    timestamp: new Date().toISOString(),
    host: os.hostname(),
    model: MODEL,
    maxTokens: MAX_TOKENS,
    taskCount: TASKS.length,
    systemPromptChars: SYSTEM_PROMPT.length,
    conditions: Object.fromEntries(conditions.map(c => [c.name, c])),
    comparison: {
      baselinePromptTokens: raw.totalPromptTokens,
      baselineCost: raw.totalCost,
      itpPromptSavingsPct: parseFloat(pct(itpOnly.totalPromptTokens, raw.totalPromptTokens)),
      cacheCostSavingsPct: parseFloat(pct(cacheOnly.totalCost, raw.totalCost)),
      combinedCostSavingsPct: parseFloat(pct(combined.totalCost, raw.totalCost)),
      combinedPromptSavingsPct: parseFloat(pct(combined.totalPromptTokens, raw.totalPromptTokens)),
    },
  }, null, 2));

  console.log(`\n✓ Results written to ${outFile}`);
}

main().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
