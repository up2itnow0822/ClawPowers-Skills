#!/usr/bin/env tsx
/**
 * ITP Real LLM Benchmark
 *
 * Makes actual LLM API calls via OpenRouter with and without ITP compression
 * to measure real token usage differences.
 *
 * Run:
 *   ITP_BASE_URL=http://127.0.0.1:8101 npx tsx benchmarks/itp-real-llm-benchmark.ts
 *
 * Requires: OPENROUTER_API_KEY env var or loads from workspace .env
 */

import { encode, decode, healthCheck } from '../src/itp/index.js';
import { cpus, totalmem, hostname, platform, arch, release } from 'node:os';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Load env if needed ───────────────────────────────────────────────────────

function loadEnv() {
  if (process.env.OPENROUTER_API_KEY) return;
  try {
    const envPaths = [
      join(__dirname, '../../.env'),
      'C:\\Users\\max\\.openclaw\\workspace\\.env',
      'C:\\Users\\max\\.openclaw\\.env',
    ];
    for (const p of envPaths) {
      try {
        const content = readFileSync(p, 'utf8');
        const match = content.match(/^OPENROUTER_API_KEY=(.+)$/m);
        if (match) {
          process.env.OPENROUTER_API_KEY = match[1].trim();
          console.log(`  Loaded API key from ${p}`);
          return;
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
}

loadEnv();

// ─── Config ───────────────────────────────────────────────────────────────────

const API_KEY = process.env.OPENROUTER_API_KEY;
const API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'anthropic/claude-3.5-haiku';
const MAX_TOKENS = 200;

// ─── Shared System Preamble ───────────────────────────────────────────────────

const SYSTEM_PREAMBLE = `You are an autonomous infrastructure monitoring agent running inside the AI Agent Economy operations environment. Your role is to perform health checks, detect anomalies, and report findings through the structured SwarmMemory interface. You have access to Docker, system utilities, and the metrics API. Always report findings in structured JSON format with severity levels (info, warning, critical). Do not take corrective action — only observe and report. The current monitoring window is the last 15 minutes unless otherwise specified. Previous findings from other swarm agents are available through the shared memory interface.`;

const TASKS = [
  { id: 'health-1', message: 'Check Docker container health status for all running services. Run docker ps and report container status, uptime, and port mappings for all running containers. Flag any containers in unhealthy or restarting state.' },
  { id: 'health-2', message: 'Verify API endpoint availability and response times. Check the health endpoints for the trading API (port 8080), the metrics server (port 9090), and the webhook receiver (port 3000). Report status codes and response latency in milliseconds.' },
  { id: 'health-3', message: 'Analyze disk usage and identify large files consuming storage on all mounted volumes. Identify any directories over 1GB and any individual files over 100MB. Report total free space remaining as a percentage.' },
  { id: 'health-4', message: 'Review system memory and process resource consumption. Report total, used, and available memory. List the top 10 processes by memory consumption with PID, name, and RSS. Flag any process using more than 2GB.' },
  { id: 'health-5', message: 'Audit recent error logs across all services for anomalies. Scan the last 1000 lines of logs for each running Docker container. Extract ERROR and WARN level entries. Group by service and report counts. Highlight any new error patterns not seen in the previous 24 hours.' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hrMs(start: [number, number]): number {
  const [s, ns] = process.hrtime(start);
  return Math.round(s * 1000 + ns / 1_000_000);
}

interface OpenRouterResponse {
  id: string;
  model: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
}

async function callLLM(systemPrompt: string, userMessage: string): Promise<{
  response: OpenRouterResponse;
  latencyMs: number;
}> {
  const start = process.hrtime();

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
      'HTTP-Referer': 'https://github.com/up2itnow0822/ClawPowers-Skills',
      'X-Title': 'ClawPowers ITP Benchmark',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    }),
  });

  const latencyMs = hrMs(start);

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API error ${res.status}: ${err}`);
  }

  const response = (await res.json()) as OpenRouterResponse;
  return { response, latencyMs };
}

// ─── Main Benchmark ───────────────────────────────────────────────────────────

interface TaskResult {
  taskId: string;
  mode: 'raw' | 'itp';
  systemChars: number;
  messageChars: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  responsePreview: string;
}

async function run() {
  const cpuInfo = cpus();

  console.log('═══════════════════════════════════════════════════');
  console.log('  ClawPowers ITP — Real LLM Benchmark');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Host:     ${hostname()}`);
  console.log(`  CPU:      ${cpuInfo[0]?.model?.trim()} (${cpuInfo.length} cores)`);
  console.log(`  Model:    ${MODEL}`);

  const itpAlive = await healthCheck();
  console.log(`  ITP:      ${itpAlive ? '✓ active' : '✗ offline'}`);

  if (!itpAlive) {
    console.error('\n✗ ITP server must be running. Set ITP_BASE_URL=http://127.0.0.1:8101');
    process.exit(1);
  }

  if (!API_KEY) {
    console.error('\n✗ OPENROUTER_API_KEY not found in env or .env files');
    process.exit(1);
  }

  console.log(`  API Key:  ${API_KEY.slice(0, 12)}...`);
  console.log('═══════════════════════════════════════════════════\n');

  const rawResults: TaskResult[] = [];
  const itpResults: TaskResult[] = [];

  // ── Phase 1: Raw calls ───────────────────────────────────────
  console.log('▸ Phase 1: Raw calls (no ITP)...\n');

  for (const task of TASKS) {
    try {
      const { response, latencyMs } = await callLLM(SYSTEM_PREAMBLE, task.message);

      rawResults.push({
        taskId: task.id,
        mode: 'raw',
        systemChars: SYSTEM_PREAMBLE.length,
        messageChars: task.message.length,
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
        latencyMs,
        responsePreview: response.choices[0]?.message.content.slice(0, 80) ?? '',
      });

      console.log(`  ${task.id}: ${response.usage.prompt_tokens} prompt + ${response.usage.completion_tokens} completion = ${response.usage.total_tokens} total (${latencyMs}ms)`);
    } catch (err: any) {
      console.error(`  ${task.id}: FAILED — ${err.message.slice(0, 200)}`);
    }

    await new Promise(r => setTimeout(r, 1000)); // rate limit
  }

  // ── Phase 2: ITP-compressed calls ────────────────────────────
  console.log('\n▸ Phase 2: ITP-compressed calls...\n');

  for (const task of TASKS) {
    try {
      const [sysEnc, msgEnc] = await Promise.all([
        encode(SYSTEM_PREAMBLE, 'benchmark'),
        encode(task.message, 'benchmark'),
      ]);

      console.log(`  ${task.id} compress: sys ${SYSTEM_PREAMBLE.length}→${sysEnc.encoded.length} (${sysEnc.savingsPct.toFixed(0)}%), msg ${task.message.length}→${msgEnc.encoded.length} (${msgEnc.savingsPct.toFixed(0)}%)`);

      const { response, latencyMs } = await callLLM(sysEnc.encoded, msgEnc.encoded);

      itpResults.push({
        taskId: task.id,
        mode: 'itp',
        systemChars: sysEnc.encoded.length,
        messageChars: msgEnc.encoded.length,
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
        latencyMs,
        responsePreview: response.choices[0]?.message.content.slice(0, 80) ?? '',
      });

      console.log(`  ${task.id}: ${response.usage.prompt_tokens} prompt + ${response.usage.completion_tokens} completion = ${response.usage.total_tokens} total (${latencyMs}ms)`);
    } catch (err: any) {
      console.error(`  ${task.id}: FAILED — ${err.message.slice(0, 200)}`);
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  // ── Results ──────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  RESULTS — Real Token Usage Comparison');
  console.log('═══════════════════════════════════════════════════\n');

  const rawTotals = rawResults.reduce((s, r) => ({
    prompt: s.prompt + r.promptTokens,
    completion: s.completion + r.completionTokens,
    total: s.total + r.totalTokens,
    latency: s.latency + r.latencyMs,
  }), { prompt: 0, completion: 0, total: 0, latency: 0 });

  const itpTotals = itpResults.reduce((s, r) => ({
    prompt: s.prompt + r.promptTokens,
    completion: s.completion + r.completionTokens,
    total: s.total + r.totalTokens,
    latency: s.latency + r.latencyMs,
  }), { prompt: 0, completion: 0, total: 0, latency: 0 });

  console.log('  Per-task prompt token comparison:');
  for (let i = 0; i < Math.min(rawResults.length, itpResults.length); i++) {
    const raw = rawResults[i];
    const itp = itpResults[i];
    const savings = ((raw.promptTokens - itp.promptTokens) / raw.promptTokens * 100).toFixed(1);
    console.log(`    ${raw.taskId}: ${raw.promptTokens} → ${itp.promptTokens} prompt tokens (${savings}% savings)`);
  }

  const promptSavings = rawTotals.prompt > 0
    ? ((rawTotals.prompt - itpTotals.prompt) / rawTotals.prompt * 100).toFixed(1) : '0.0';

  console.log(`\n  TOTALS:`);
  console.log(`    Raw:  ${rawTotals.prompt} prompt + ${rawTotals.completion} completion = ${rawTotals.total} total tokens`);
  console.log(`    ITP:  ${itpTotals.prompt} prompt + ${itpTotals.completion} completion = ${itpTotals.total} total tokens`);
  console.log(`    Prompt token savings: ${promptSavings}% (${rawTotals.prompt - itpTotals.prompt} tokens)`);
  console.log(`    Total latency: raw ${rawTotals.latency}ms vs itp ${itpTotals.latency}ms`);

  // Haiku 3.5 pricing
  const INPUT_RATE = 0.80 / 1_000_000;
  const OUTPUT_RATE = 4.00 / 1_000_000;
  const rawCost = rawTotals.prompt * INPUT_RATE + rawTotals.completion * OUTPUT_RATE;
  const itpCost = itpTotals.prompt * INPUT_RATE + itpTotals.completion * OUTPUT_RATE;
  const costSavePct = rawCost > 0 ? ((rawCost - itpCost) / rawCost * 100).toFixed(1) : '0.0';

  console.log(`\n  Cost (Haiku 3.5: $0.80/M in, $4.00/M out):`);
  console.log(`    Raw: $${rawCost.toFixed(6)}`);
  console.log(`    ITP: $${itpCost.toFixed(6)}`);
  console.log(`    Savings: ${costSavePct}%`);

  // Save
  const fullResults = {
    metadata: {
      timestamp: new Date().toISOString(),
      hostname: hostname(),
      platform: `${platform()} ${arch()}`,
      model: MODEL,
      maxTokens: MAX_TOKENS,
      itpServerActive: true,
      codebookSize: 54,
    },
    raw: { tasks: rawResults, totals: rawTotals },
    itp: { tasks: itpResults, totals: itpTotals },
    comparison: {
      promptTokenSavingsPct: parseFloat(promptSavings),
      promptTokensSaved: rawTotals.prompt - itpTotals.prompt,
      costSavingsPct: parseFloat(costSavePct),
      rawCostUSD: rawCost,
      itpCostUSD: itpCost,
    },
  };

  const outDir = join(__dirname, 'results');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `real-llm-benchmark-${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify(fullResults, null, 2) + '\n');
  console.log(`\n✓ Written to ${outPath}`);
}

run().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
