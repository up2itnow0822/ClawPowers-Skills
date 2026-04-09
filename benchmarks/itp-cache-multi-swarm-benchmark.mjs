#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import os from 'node:os';

const ITP_BASE_URL = 'http://127.0.0.1:8100';
const RUNNER_MODEL = process.env.BENCHMARK_RUNNER_MODEL || 'unknown';
const ANTHROPIC_CACHE_WRITE_MULTIPLIER = 1.25;
const ANTHROPIC_CACHE_READ_MULTIPLIER = 0.10;
const estimateTokens = (s) => Math.max(1, Math.ceil(s.length / 4));

const SHARED_SWARM_PREFIX = `You are Rex, the engineering lead inside a 5-task parallel swarm. Operate with production discipline. Use the shared conventions below on every task.\n\nMission:\n- protect release quality\n- prefer real fixes over explanations\n- keep outputs compact and action-oriented\n- surface blockers with exact evidence\n\nExecution contract:\n1. Inspect the assigned repo area before changing anything.\n2. Reuse existing tools and scripts before writing new ones.\n3. Validate with tests, linters, or deterministic checks whenever possible.\n4. Return a structured completion report with: summary, files changed, commands run, risks, next step.\n5. If a task is blocked, stop quickly and provide the smallest unblock needed.\n\nFormatting contract:\n- terse technical prose\n- no hype, no filler\n- include exact paths, versions, and failing checks\n- if you modify docs or release files, mention publish impact\n\nRepo context:\n- main package: ClawPowers-Skills\n- adjacent systems: ClawPowers-Agent, Agent Wallet SDK, AgentPay MCP\n- operating environment: MacBook Pro M1, Node 25, local ITP server available on port 8100\n- current launch priority: benchmark compression, prompt efficiency, and release readiness\n\nSafety:\n- no destructive deletes\n- do not expose secrets\n- treat benchmark outputs as internal unless asked to publish\n\nReturn format:\nHeadline\nBullet summary\nEvidence\nRisks\nNext action`;

const SWARM_SETS = [
  {
    id: 'set-a',
    name: 'Launch ops swarm',
    tasks: [
      { category: 'delegation', message: 'Delegate to Rex: review the ClawPowers-Skills repo, run the validator agent, and report status. Priority: P0. Deliverable: completion report in reports/.' },
      { category: 'ops', message: 'Execute: deploy ClawPowers-Skills v2.2.0 to npm, then update ClawPowers-Agent dependency to 2.2.0, then publish ClawPowers-Agent v1.1.0.' },
      { category: 'status', message: 'Status report to Max: AlphaWolf orchestrator up and healthy, AlphaWolf trend-watcher up, AlphaWolf ready-trader up. All 7 trading containers green. No action required.' },
      { category: 'ops', message: 'Execute: monitor btc-perp-trader, check trading status, fix any unhealthy containers, and report status back to Max within 5 minutes. Priority P0.' },
      { category: 'delegation', message: 'Rex, please execute the audit on agentwallet-sdk, fix the high severity findings, and merge the PR. Priority P1. Status report when done.' },
    ],
  },
  {
    id: 'set-b',
    name: 'Release readiness swarm',
    tasks: [
      { category: 'ops', message: 'Run the validator agent on ClawPowers-Skills before publishing. Check compile gate, lint, tests, security audit, type coverage, docs, changelog, and final review.' },
      { category: 'delegation', message: 'Delegate to Engineering Director: rebuild the ClawPowers-Agent dependency graph, test the import chain, deploy to npm, and report status with completion report.' },
      { category: 'status', message: 'Status: ClawPowers-Skills tests passing 261 of 261, ClawPowers-Agent tests passing 132 of 132, both repos committed and pushed to main. Ready for npm publish.' },
      { category: 'ops', message: 'Scan ClawPowers-Agent for security issues, audit the dependency tree, remove any critical vulnerabilities, and update the changelog. Priority P1.' },
      { category: 'delegation', message: 'Delegate to Rex: review the release checklist, verify npm package contents, check version tags, and report status. Priority: P0. Deliverable: completion report.' },
    ],
  },
  {
    id: 'set-c',
    name: 'Infra and trading swarm',
    tasks: [
      { category: 'status', message: 'Status report: trading bots all healthy, btc-perp-trader balance $9617, paper-trader-v5 at 44.6% drawdown which exceeds the 30% threshold. Alert level P0.' },
      { category: 'status', message: 'Status report: all 8 swarm cron groups running clean, exit code 0 across the board. Infrastructure monitor flagged 10KB of stderr warnings but they are cosmetic.' },
      { category: 'ops', message: 'Execute: monitor btc-perp-trader, check trading status, fix any unhealthy containers, and report status back to Max within 5 minutes. Priority P0.' },
      { category: 'delegation', message: 'Delegate to Trading Director: check Docker containers, analyze current regime, update position status, and report status in metrics-only format. Priority P0.' },
      { category: 'status', message: 'Status report to Max: AlphaWolf orchestrator up and healthy, AlphaWolf trend-watcher up, AlphaWolf ready-trader up. All 7 trading containers green. No action required.' },
    ],
  },
];

async function fetchJson(path, options = {}) {
  const r = await fetch(`${ITP_BASE_URL}${path}`, {
    ...options,
    signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) throw new Error(`${path} failed: ${r.status}`);
  return r.json();
}

async function encode(message, sourceAgent = 'benchmark') {
  const started = Date.now();
  const r = await fetch(`${ITP_BASE_URL}/tools/encode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, source_agent: sourceAgent, target_agent: 'swarm' }),
    signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) throw new Error(`encode failed: ${r.status}`);
  const j = await r.json();
  return {
    encoded: j.encoded ?? message,
    wasCompressed: Boolean(j.was_compressed),
    savingsPct: Number(j.savings_pct ?? 0),
    originalTokens: Number(j.original_tokens ?? estimateTokens(message)),
    encodedTokens: Number(j.encoded_tokens ?? estimateTokens(j.encoded ?? message)),
    latencyMs: Date.now() - started,
  };
}

function scenarioTotals(prefixTokens, rawTasks, encodedTasks) {
  const baseline = rawTasks.reduce((sum, t) => sum + prefixTokens + t.rawTokens, 0);
  const itpOnly = encodedTasks.reduce((sum, t) => sum + prefixTokens + t.encodedTokens, 0);
  const cacheOnly = rawTasks.reduce((sum, t, idx) => {
    const prefixCost = idx === 0 ? prefixTokens * ANTHROPIC_CACHE_WRITE_MULTIPLIER : prefixTokens * ANTHROPIC_CACHE_READ_MULTIPLIER;
    return sum + prefixCost + t.rawTokens;
  }, 0);
  const combined = encodedTasks.reduce((sum, t, idx) => {
    const prefixCost = idx === 0 ? prefixTokens * ANTHROPIC_CACHE_WRITE_MULTIPLIER : prefixTokens * ANTHROPIC_CACHE_READ_MULTIPLIER;
    return sum + prefixCost + t.encodedTokens;
  }, 0);
  return { baseline, itpOnly, cacheOnly, combined };
}

function pctReduction(before, after) {
  return Number((((before - after) / before) * 100).toFixed(2));
}

function mean(nums) {
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function stddev(nums) {
  const m = mean(nums);
  return Math.sqrt(mean(nums.map((n) => (n - m) ** 2)));
}

async function runSet(sw) {
  const prefixTokens = estimateTokens(SHARED_SWARM_PREFIX);
  const rawTasks = [];
  const encodedTasks = [];

  for (const task of sw.tasks) {
    const enc = await encode(task.message, sw.id);
    rawTasks.push({ category: task.category, rawTokens: estimateTokens(task.message) });
    encodedTasks.push({
      category: task.category,
      rawTokens: enc.originalTokens,
      encodedTokens: enc.encodedTokens,
      wasCompressed: enc.wasCompressed,
      latencyMs: enc.latencyMs,
      savingsPct: enc.savingsPct,
      encoded: enc.encoded,
      original: task.message,
    });
  }

  const totals = scenarioTotals(prefixTokens, rawTasks, encodedTasks);
  const rawTokens = encodedTasks.reduce((sum, t) => sum + t.rawTokens, 0);
  const encodedTokens = encodedTasks.reduce((sum, t) => sum + t.encodedTokens, 0);
  const compressedTasks = encodedTasks.filter((t) => t.wasCompressed).length;

  return {
    id: sw.id,
    name: sw.name,
    taskCount: sw.tasks.length,
    sharedPrefixTokensEstimated: prefixTokens,
    messageCompression: {
      rawTokens,
      encodedTokens,
      tokensSaved: rawTokens - encodedTokens,
      reductionPct: pctReduction(rawTokens, encodedTokens),
      compressedTasks,
      avgLatencyMs: Number(mean(encodedTasks.map((t) => t.latencyMs)).toFixed(2)),
    },
    scenarios: {
      baselineNoCacheNoItp: Number(totals.baseline.toFixed(2)),
      itpOnly: Number(totals.itpOnly.toFixed(2)),
      itpOnlyReductionPct: pctReduction(totals.baseline, totals.itpOnly),
      promptCacheOnly: Number(totals.cacheOnly.toFixed(2)),
      promptCacheOnlyReductionPct: pctReduction(totals.baseline, totals.cacheOnly),
      combinedItpPlusPromptCache: Number(totals.combined.toFixed(2)),
      combinedReductionPct: pctReduction(totals.baseline, totals.combined),
    },
    tasks: encodedTasks,
  };
}

async function main() {
  const [health, codebookResp, stats] = await Promise.all([
    fetchJson('/health'),
    fetchJson('/tools/codebook'),
    fetchJson('/tools/stats'),
  ]);

  const sets = [];
  for (const sw of SWARM_SETS) sets.push(await runSet(sw));

  const combinedReductions = sets.map((s) => s.scenarios.combinedReductionPct);
  const itpPayloadReductions = sets.map((s) => s.messageCompression.reductionPct);

  const result = {
    timestamp: new Date().toISOString(),
    benchmark: 'itp-cache-multi-swarm-benchmark',
    benchmarkRunnerModel: RUNNER_MODEL,
    hardware: {
      hostname: os.hostname(),
      machine: 'MacBook Pro',
      chip: os.cpus()[0]?.model || 'unknown',
      cores: os.cpus().length,
      memoryGb: Number((os.totalmem() / 1024 / 1024 / 1024).toFixed(1)),
      platform: `${os.platform()} ${os.release()} ${os.arch()}`,
      node: process.version,
    },
    server: {
      baseUrl: ITP_BASE_URL,
      health,
      codebook: {
        version: codebookResp.codebook?.version,
        totalEntries: stats.codebook?.total_entries,
        compressionThreshold: stats.codebook?.compression_threshold,
        categories: stats.codebook?.categories,
      },
    },
    cacheModel: {
      providerAssumption: 'Anthropic-style prompt caching multipliers',
      firstPrefixWriteMultiplier: ANTHROPIC_CACHE_WRITE_MULTIPLIER,
      laterPrefixReadMultiplier: ANTHROPIC_CACHE_READ_MULTIPLIER,
      note: 'Cache economics are modeled from live prompt sizes, not billed API receipts.',
    },
    swarmSets: sets,
    summary: {
      setCount: sets.length,
      combinedReductionPctMean: Number(mean(combinedReductions).toFixed(2)),
      combinedReductionPctStdDev: Number(stddev(combinedReductions).toFixed(2)),
      payloadReductionPctMean: Number(mean(itpPayloadReductions).toFixed(2)),
      payloadReductionPctStdDev: Number(stddev(itpPayloadReductions).toFixed(2)),
    },
  };

  writeFileSync('./benchmarks/itp-cache-multi-swarm-results.json', JSON.stringify(result, null, 2));

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('LIVE ITP + MODELED PROMPT CACHE MULTI-SWARM BENCHMARK');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Runner model: ${RUNNER_MODEL}`);
  console.log(`Machine: ${result.hardware.machine}, ${result.hardware.chip}, ${result.hardware.memoryGb} GB RAM, ${result.hardware.cores} cores`);
  console.log(`Server: ${health.status} | Codebook v${result.server.codebook.version} | ${result.server.codebook.totalEntries} entries`);
  console.log('');

  for (const s of sets) {
    console.log(`${s.id} - ${s.name}`);
    console.log(`  Payload compression: ${s.messageCompression.rawTokens} -> ${s.messageCompression.encodedTokens} tokens (${s.messageCompression.reductionPct}%)`);
    console.log(`  Combined effective input cost: ${s.scenarios.baselineNoCacheNoItp} -> ${s.scenarios.combinedItpPlusPromptCache} (${s.scenarios.combinedReductionPct}% reduction)`);
    console.log(`  Cache only: ${s.scenarios.promptCacheOnlyReductionPct}% reduction | ITP only: ${s.scenarios.itpOnlyReductionPct}% reduction`);
    console.log(`  Avg encode latency: ${s.messageCompression.avgLatencyMs}ms | compressed tasks: ${s.messageCompression.compressedTasks}/${s.taskCount}`);
    console.log('');
  }

  console.log('Consistency summary:');
  console.log(`  Combined reduction mean: ${result.summary.combinedReductionPctMean}%`);
  console.log(`  Combined reduction stddev: ${result.summary.combinedReductionPctStdDev}`);
  console.log(`  Payload reduction mean: ${result.summary.payloadReductionPctMean}%`);
  console.log(`  Payload reduction stddev: ${result.summary.payloadReductionPctStdDev}`);
  console.log('');
  console.log('Saved to benchmarks/itp-cache-multi-swarm-results.json');
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
