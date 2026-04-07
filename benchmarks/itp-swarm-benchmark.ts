#!/usr/bin/env tsx
/**
 * ITP + Parallel Swarm Benchmark
 *
 * Measures:
 * 1. ITP encode/decode latency and compression ratio
 * 2. Swarm parallel vs sequential execution wall time
 * 3. Token pool allocation overhead
 * 4. Model router classification throughput
 *
 * Run: npx tsx benchmarks/itp-swarm-benchmark.ts
 */

import { ConcurrencyManager } from '../src/swarm/concurrency.js';
import { TokenPool } from '../src/swarm/token_pool.js';
import { classifyHeuristic, selectModel, classifyTasks } from '../src/swarm/model_router.js';
import { encode, decode, healthCheck } from '../src/itp/index.js';
import { encodeTaskDescription, decodeSwarmResult } from '../src/itp/swarm-bridge.js';
import { getActiveTier, getCapabilitySummary } from '../src/native/index.js';
import { cpus, totalmem, platform, arch, hostname, release } from 'node:os';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Test Data ────────────────────────────────────────────────────────────────

const SAMPLE_TASKS = [
  {
    id: 'health-1',
    description: 'Check Docker container health status for all running services',
    message: 'Run docker ps and report container status, uptime, and port mappings for all running containers. Flag any containers in unhealthy or restarting state.',
    complexity: 'simple' as const,
  },
  {
    id: 'health-2',
    description: 'Verify API endpoint availability and response times',
    message: 'Check the health endpoints for the trading API (port 8080), the metrics server (port 9090), and the webhook receiver (port 3000). Report status codes and response latency in milliseconds.',
    complexity: 'simple' as const,
  },
  {
    id: 'health-3',
    description: 'Analyze disk usage and identify large files consuming storage',
    message: 'Check disk usage on all mounted volumes. Identify any directories over 1GB and any individual files over 100MB. Report total free space remaining as a percentage.',
    complexity: 'moderate' as const,
  },
  {
    id: 'health-4',
    description: 'Review system memory and process resource consumption',
    message: 'Report total, used, and available memory. List the top 10 processes by memory consumption with PID, name, and RSS. Flag any process using more than 2GB.',
    complexity: 'moderate' as const,
  },
  {
    id: 'health-5',
    description: 'Audit recent error logs across all services for anomalies',
    message: 'Scan the last 1000 lines of logs for each running Docker container. Extract ERROR and WARN level entries. Group by service and report counts. Highlight any new error patterns not seen in the previous 24 hours.',
    complexity: 'complex' as const,
  },
];

// Longer, more realistic messages for ITP compression testing
const SHARED_CONTEXT_PREAMBLE = `You are an autonomous infrastructure monitoring agent running inside the AI Agent Economy operations environment. Your role is to perform health checks, detect anomalies, and report findings through the structured SwarmMemory interface. You have access to Docker, system utilities, and the metrics API. Always report findings in structured JSON format with severity levels (info, warning, critical). Do not take corrective action — only observe and report. The current monitoring window is the last 15 minutes unless otherwise specified. Previous findings from other swarm agents are available through the shared memory interface.`;

const ITP_TEST_MESSAGES = SAMPLE_TASKS.map(t => ({
  id: t.id,
  full: `${SHARED_CONTEXT_PREAMBLE}\n\nTask: ${t.description}\n\n${t.message}`,
  taskOnly: t.message,
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hrMs(start: [number, number]): number {
  const [s, ns] = process.hrtime(start);
  return Math.round(s * 1000 + ns / 1_000_000);
}

function tokenEstimate(text: string): number {
  // Rough estimate: ~4 chars per token for English text
  return Math.ceil(text.length / 4);
}

// ─── Benchmark Runs ───────────────────────────────────────────────────────────

interface BenchmarkResults {
  metadata: {
    timestamp: string;
    hostname: string;
    platform: string;
    arch: string;
    osRelease: string;
    cpuModel: string;
    cpuCores: number;
    totalMemoryGB: number;
    nodeVersion: string;
    clawpowersTier: string;
    nativeCapabilities: ReturnType<typeof getCapabilitySummary>;
    itpServerAvailable: boolean;
  };
  itp: {
    serverStatus: string;
    encodeTests: Array<{
      taskId: string;
      inputChars: number;
      inputTokensEst: number;
      outputChars: number;
      outputTokensEst: number;
      wasCompressed: boolean;
      savingsPct: number;
      latencyMs: number;
    }>;
    decodeTests: Array<{
      taskId: string;
      inputChars: number;
      outputChars: number;
      wasItp: boolean;
      latencyMs: number;
    }>;
    summary: {
      avgEncodeSavingsPct: number;
      avgEncodeLatencyMs: number;
      avgDecodeLatencyMs: number;
      totalInputTokensEst: number;
      totalOutputTokensEst: number;
      overallCompressionPct: number;
    };
  };
  swarm: {
    sequentialMs: number;
    parallelMs: number;
    speedupFactor: number;
    concurrencyUsed: number;
    tokenPool: {
      totalBudget: number;
      totalAllocated: number;
      totalConsumed: number;
    };
  };
  modelRouter: {
    classificationsPerSecond: number;
    classifications: Array<{
      taskId: string;
      description: string;
      classified: string;
      expectedModel: string;
    }>;
  };
}

async function runBenchmark(): Promise<BenchmarkResults> {
  const timestamp = new Date().toISOString();
  const cpuInfo = cpus();

  console.log('═══════════════════════════════════════════════════');
  console.log('  ClawPowers ITP + Swarm Benchmark');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Host:     ${hostname()}`);
  console.log(`  Platform: ${platform()} ${arch()} ${release()}`);
  console.log(`  CPU:      ${cpuInfo[0]?.model ?? 'unknown'} (${cpuInfo.length} cores)`);
  console.log(`  Memory:   ${(totalmem() / 1024 / 1024 / 1024).toFixed(1)} GB`);
  console.log(`  Node:     ${process.version}`);
  console.log(`  Tier:     ${getActiveTier()}`);
  console.log('═══════════════════════════════════════════════════\n');

  // ── ITP Health Check ─────────────────────────────────────────
  console.log('▸ Checking ITP server...');
  const itpAvailable = await healthCheck();
  console.log(`  ITP server: ${itpAvailable ? '✓ available' : '✗ offline (passthrough mode)'}\n`);

  // ── ITP Encode Tests ─────────────────────────────────────────
  console.log('▸ Running ITP encode tests...');
  const encodeTests: BenchmarkResults['itp']['encodeTests'] = [];

  for (const msg of ITP_TEST_MESSAGES) {
    const start = process.hrtime();
    const result = await encode(msg.full, 'benchmark-agent');
    const elapsed = hrMs(start);

    const inputTokens = tokenEstimate(msg.full);
    const outputTokens = tokenEstimate(result.encoded);

    encodeTests.push({
      taskId: msg.id,
      inputChars: msg.full.length,
      inputTokensEst: inputTokens,
      outputChars: result.encoded.length,
      outputTokensEst: outputTokens,
      wasCompressed: result.wasCompressed,
      savingsPct: result.savingsPct,
      latencyMs: elapsed,
    });

    console.log(`  ${msg.id}: ${msg.full.length} → ${result.encoded.length} chars ` +
      `(compressed=${result.wasCompressed}, savings=${result.savingsPct.toFixed(1)}%, ` +
      `${elapsed}ms)`);
  }

  // ── ITP Decode Tests ─────────────────────────────────────────
  console.log('\n▸ Running ITP decode tests...');
  const decodeTests: BenchmarkResults['itp']['decodeTests'] = [];

  for (const enc of encodeTests) {
    const encodedMsg = ITP_TEST_MESSAGES.find(m => m.id === enc.taskId)!;
    const start = process.hrtime();
    // Decode the encoded output (or original if passthrough)
    const result = await decode(enc.wasCompressed ? enc.taskId : encodedMsg.full);
    const elapsed = hrMs(start);

    decodeTests.push({
      taskId: enc.taskId,
      inputChars: enc.outputChars,
      outputChars: result.decoded.length,
      wasItp: result.wasItp,
      latencyMs: elapsed,
    });

    console.log(`  ${enc.taskId}: decoded=${result.wasItp}, ${elapsed}ms`);
  }

  // ── ITP Summary ──────────────────────────────────────────────
  const totalInputTokens = encodeTests.reduce((s, e) => s + e.inputTokensEst, 0);
  const totalOutputTokens = encodeTests.reduce((s, e) => s + e.outputTokensEst, 0);
  const avgSavings = encodeTests.length > 0
    ? encodeTests.reduce((s, e) => s + e.savingsPct, 0) / encodeTests.length
    : 0;
  const avgEncodeLatency = encodeTests.length > 0
    ? encodeTests.reduce((s, e) => s + e.latencyMs, 0) / encodeTests.length
    : 0;
  const avgDecodeLatency = decodeTests.length > 0
    ? decodeTests.reduce((s, e) => s + e.latencyMs, 0) / decodeTests.length
    : 0;
  const overallCompression = totalInputTokens > 0
    ? ((totalInputTokens - totalOutputTokens) / totalInputTokens) * 100
    : 0;

  console.log(`\n  ITP Summary:`);
  console.log(`    Avg encode savings: ${avgSavings.toFixed(1)}%`);
  console.log(`    Overall token reduction: ${overallCompression.toFixed(1)}%`);
  console.log(`    Avg encode latency: ${avgEncodeLatency.toFixed(0)}ms`);
  console.log(`    Avg decode latency: ${avgDecodeLatency.toFixed(0)}ms`);
  console.log(`    Total input tokens (est): ${totalInputTokens}`);
  console.log(`    Total output tokens (est): ${totalOutputTokens}`);

  // ── Swarm: Sequential vs Parallel ────────────────────────────
  console.log('\n▸ Running swarm sequential vs parallel test...');

  // Simulate task execution (sleep proportional to complexity)
  const simulateTask = async (task: typeof SAMPLE_TASKS[0]): Promise<number> => {
    const delays: Record<string, number> = { simple: 50, moderate: 100, complex: 200 };
    const delay = delays[task.complexity ?? 'moderate'] ?? 100;
    await new Promise(r => setTimeout(r, delay));
    return tokenEstimate(task.message);
  };

  // Sequential
  const seqStart = process.hrtime();
  let seqTokens = 0;
  for (const task of SAMPLE_TASKS) {
    seqTokens += await simulateTask(task);
  }
  const seqMs = hrMs(seqStart);
  console.log(`  Sequential: ${seqMs}ms (${seqTokens} tokens est)`);

  // Parallel with ConcurrencyManager
  const cm = new ConcurrencyManager(5);
  const pool = new TokenPool(100_000, 20_000);

  const parStart = process.hrtime();
  const parResults = await Promise.all(
    SAMPLE_TASKS.map(async (task) => {
      await cm.acquire();
      pool.allocate(task.id, 20_000);
      try {
        const tokens = await simulateTask(task);
        pool.consume(task.id, tokens);
        return tokens;
      } finally {
        pool.release(task.id);
        cm.release();
      }
    })
  );
  const parMs = hrMs(parStart);
  const parTokens = parResults.reduce((s, t) => s + t, 0);
  const speedup = seqMs / Math.max(parMs, 1);

  console.log(`  Parallel:   ${parMs}ms (${parTokens} tokens est)`);
  console.log(`  Speedup:    ${speedup.toFixed(1)}x`);

  const report = pool.usageReport();

  // ── Model Router Classification ──────────────────────────────
  console.log('\n▸ Running model router classification benchmark...');
  const routerStart = process.hrtime();
  const iterations = 10_000;
  for (let i = 0; i < iterations; i++) {
    for (const task of SAMPLE_TASKS) {
      classifyHeuristic(task.description);
    }
  }
  const routerMs = hrMs(routerStart);
  const classificationsPerSec = Math.round((iterations * SAMPLE_TASKS.length) / (routerMs / 1000));

  const classifications = SAMPLE_TASKS.map(t => ({
    taskId: t.id,
    description: t.description,
    classified: classifyHeuristic(t.description),
    expectedModel: selectModel(classifyHeuristic(t.description)),
  }));

  console.log(`  ${classificationsPerSec.toLocaleString()} classifications/sec`);
  for (const c of classifications) {
    console.log(`  ${c.taskId}: ${c.classified} → ${c.expectedModel}`);
  }

  // ── Build Results ────────────────────────────────────────────
  const capabilities = getCapabilitySummary();

  const results: BenchmarkResults = {
    metadata: {
      timestamp,
      hostname: hostname(),
      platform: `${platform()} ${arch()}`,
      osRelease: release(),
      cpuModel: cpuInfo[0]?.model ?? 'unknown',
      cpuCores: cpuInfo.length,
      totalMemoryGB: Math.round(totalmem() / 1024 / 1024 / 1024 * 10) / 10,
      nodeVersion: process.version,
      clawpowersTier: getActiveTier(),
      nativeCapabilities: capabilities,
      itpServerAvailable: itpAvailable,
    },
    itp: {
      serverStatus: itpAvailable ? 'available' : 'offline (passthrough)',
      encodeTests,
      decodeTests,
      summary: {
        avgEncodeSavingsPct: Math.round(avgSavings * 10) / 10,
        avgEncodeLatencyMs: Math.round(avgEncodeLatency),
        avgDecodeLatencyMs: Math.round(avgDecodeLatency),
        totalInputTokensEst: totalInputTokens,
        totalOutputTokensEst: totalOutputTokens,
        overallCompressionPct: Math.round(overallCompression * 10) / 10,
      },
    },
    swarm: {
      sequentialMs: seqMs,
      parallelMs: parMs,
      speedupFactor: Math.round(speedup * 10) / 10,
      concurrencyUsed: 5,
      tokenPool: {
        totalBudget: report.total_budget,
        totalAllocated: report.total_allocated,
        totalConsumed: report.total_consumed,
      },
    },
    modelRouter: {
      classificationsPerSecond: classificationsPerSec,
      classifications,
    },
  };

  // Write results JSON
  const outPath = join(__dirname, 'results', `benchmark-${Date.now()}.json`);
  const outDir = join(__dirname, 'results');
  const { mkdirSync } = await import('node:fs');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, JSON.stringify(results, null, 2) + '\n');
  console.log(`\n✓ Results written to ${outPath}`);

  return results;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

runBenchmark()
  .then((r) => {
    console.log('\n═══════════════════════════════════════════════════');
    console.log('  Benchmark Complete');
    console.log('═══════════════════════════════════════════════════');
    console.log(`  ITP server:          ${r.metadata.itpServerAvailable ? 'ACTIVE' : 'PASSTHROUGH'}`);
    console.log(`  ITP compression:     ${r.itp.summary.overallCompressionPct}%`);
    console.log(`  Swarm speedup:       ${r.swarm.speedupFactor}x`);
    console.log(`  Router throughput:   ${r.modelRouter.classificationsPerSecond.toLocaleString()}/s`);
    console.log(`  ClawPowers tier:     ${r.metadata.clawpowersTier}`);
    console.log('═══════════════════════════════════════════════════');
  })
  .catch((err) => {
    console.error('Benchmark failed:', err);
    process.exit(1);
  });
