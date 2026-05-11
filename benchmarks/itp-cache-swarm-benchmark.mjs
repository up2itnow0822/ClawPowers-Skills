#!/usr/bin/env node
import { writeFileSync } from 'node:fs';

const ITP_BASE_URL = 'http://127.0.0.1:8100';
const ANTHROPIC_CACHE_WRITE_MULTIPLIER = 1.25;
const ANTHROPIC_CACHE_READ_MULTIPLIER = 0.10;
const estimateTokens = (s) => Math.max(1, Math.ceil(s.length / 4));

const SHARED_SWARM_PREFIX = `You are Rex, the engineering lead inside a 5-task parallel swarm. Operate with production discipline. Use the shared conventions below on every task.\n\nMission:\n- protect release quality\n- prefer real fixes over explanations\n- keep outputs compact and action-oriented\n- surface blockers with exact evidence\n\nExecution contract:\n1. Inspect the assigned repo area before changing anything.\n2. Reuse existing tools and scripts before writing new ones.\n3. Validate with tests, linters, or deterministic checks whenever possible.\n4. Return a structured completion report with: summary, files changed, commands run, risks, next step.\n5. If a task is blocked, stop quickly and provide the smallest unblock needed.\n\nFormatting contract:\n- terse technical prose\n- no hype, no filler\n- include exact paths, versions, and failing checks\n- if you modify docs or release files, mention publish impact\n\nRepo context:\n- main package: ClawPowers-Skills\n- adjacent systems: ClawPowers-Agent, Agent Wallet SDK, AgentPay MCP\n- operating environment: MacBook Pro M1, Node 25, local ITP server available on port 8100\n- current launch priority: benchmark compression, prompt efficiency, and release readiness\n\nSafety:\n- no destructive deletes\n- do not expose secrets\n- treat benchmark outputs as internal unless asked to publish\n\nReturn format:\nHeadline\nBullet summary\nEvidence\nRisks\nNext action`;

const TASKS = [
  {
    id: 'task-1',
    category: 'delegation',
    message: 'Delegate to Rex: review the ClawPowers-Skills repo, run the validator agent, and report status. Priority: P0. Deliverable: completion report in reports/.'
  },
  {
    id: 'task-2',
    category: 'ops',
    message: 'Execute: deploy ClawPowers-Skills v2.2.0 to npm, then update ClawPowers-Agent dependency to 2.2.0, then publish ClawPowers-Agent v1.1.0.'
  },
  {
    id: 'task-3',
    category: 'status',
    message: 'Status report to Max: AlphaWolf orchestrator up and healthy, AlphaWolf trend-watcher up, AlphaWolf ready-trader up. All 7 trading containers green. No action required.'
  },
  {
    id: 'task-4',
    category: 'ops',
    message: 'Execute: monitor btc-perp-trader, check trading status, fix any unhealthy containers, and report status back to Max within 5 minutes. Priority P0.'
  },
  {
    id: 'task-5',
    category: 'delegation',
    message: 'Rex, please execute the audit on wallet module, fix the high severity findings, and merge the PR. Priority P1. Status report when done.'
  }
];

async function healthCheck() {
  const r = await fetch(`${ITP_BASE_URL}/health`, { signal: AbortSignal.timeout(3000) });
  if (!r.ok) throw new Error(`health check failed: ${r.status}`);
  return r.json();
}

async function getCodebook() {
  const r = await fetch(`${ITP_BASE_URL}/tools/codebook`, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`codebook fetch failed: ${r.status}`);
  return r.json();
}

async function getStats() {
  const r = await fetch(`${ITP_BASE_URL}/tools/stats`, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`stats fetch failed: ${r.status}`);
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

function fullPrompt(prefix, payload) {
  return `${prefix}\n\nAssigned task:\n${payload}`;
}

function scenarioTotals(prefixTokens, rawTasks, encodedTasks) {
  const baseline = rawTasks.reduce((sum, t) => sum + prefixTokens + t.rawTokens, 0);
  const itpOnly = encodedTasks.reduce((sum, t) => sum + prefixTokens + t.encodedTokens, 0);

  const cacheOnly = rawTasks.reduce((sum, t, idx) => {
    const prefixCost = idx === 0
      ? prefixTokens * ANTHROPIC_CACHE_WRITE_MULTIPLIER
      : prefixTokens * ANTHROPIC_CACHE_READ_MULTIPLIER;
    return sum + prefixCost + t.rawTokens;
  }, 0);

  const combined = encodedTasks.reduce((sum, t, idx) => {
    const prefixCost = idx === 0
      ? prefixTokens * ANTHROPIC_CACHE_WRITE_MULTIPLIER
      : prefixTokens * ANTHROPIC_CACHE_READ_MULTIPLIER;
    return sum + prefixCost + t.encodedTokens;
  }, 0);

  return { baseline, itpOnly, cacheOnly, combined };
}

function pctReduction(before, after) {
  return Number((((before - after) / before) * 100).toFixed(2));
}

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('LIVE ITP + MODELED PROMPT CACHE SWARM BENCHMARK');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const [health, codebookResp, stats] = await Promise.all([
    healthCheck(),
    getCodebook(),
    getStats(),
  ]);

  const prefixTokens = estimateTokens(SHARED_SWARM_PREFIX);
  const prefixChars = SHARED_SWARM_PREFIX.length;
  const encodedTasks = [];
  const rawTasks = [];

  for (const task of TASKS) {
    const enc = await encode(task.message, 'swarm-benchmark');
    const rawPromptTokens = estimateTokens(fullPrompt(SHARED_SWARM_PREFIX, task.message));
    const encodedPromptTokens = estimateTokens(fullPrompt(SHARED_SWARM_PREFIX, enc.encoded));

    rawTasks.push({
      id: task.id,
      category: task.category,
      rawMessage: task.message,
      rawTokens: estimateTokens(task.message),
      rawPromptTokens,
    });

    encodedTasks.push({
      id: task.id,
      category: task.category,
      rawMessage: task.message,
      encoded: enc.encoded,
      rawTokens: enc.originalTokens,
      encodedTokens: enc.encodedTokens,
      rawPromptTokens,
      encodedPromptTokens,
      wasCompressed: enc.wasCompressed,
      savingsPct: enc.savingsPct,
      latencyMs: enc.latencyMs,
    });
  }

  const totals = scenarioTotals(prefixTokens, rawTasks, encodedTasks);
  const directItpMessageTokens = encodedTasks.reduce((sum, t) => sum + t.rawTokens, 0);
  const directItpEncodedTokens = encodedTasks.reduce((sum, t) => sum + t.encodedTokens, 0);

  const result = {
    timestamp: new Date().toISOString(),
    benchmark: 'itp-cache-swarm-benchmark',
    corpus: {
      tasks: TASKS.length,
      swarmSize: 5,
      sharedPrefixChars: prefixChars,
      sharedPrefixTokensEstimated: prefixTokens,
    },
    server: {
      baseUrl: ITP_BASE_URL,
      health,
      stats,
      codebook: {
        version: codebookResp.codebook?.version,
        totalEntries: stats.codebook?.total_entries,
        compressionThreshold: stats.codebook?.compression_threshold,
        categories: stats.codebook?.categories,
      },
    },
    messageCompression: {
      rawTokens: directItpMessageTokens,
      encodedTokens: directItpEncodedTokens,
      tokensSaved: directItpMessageTokens - directItpEncodedTokens,
      reductionPct: pctReduction(directItpMessageTokens, directItpEncodedTokens),
      compressedTasks: encodedTasks.filter(t => t.wasCompressed).length,
      avgLatencyMs: Number((encodedTasks.reduce((sum, t) => sum + t.latencyMs, 0) / encodedTasks.length).toFixed(2)),
    },
    scenarios: {
      baselineNoCacheNoItp: {
        effectiveInputTokenUnits: Number(totals.baseline.toFixed(2)),
      },
      itpOnly: {
        effectiveInputTokenUnits: Number(totals.itpOnly.toFixed(2)),
        reductionPctVsBaseline: pctReduction(totals.baseline, totals.itpOnly),
      },
      promptCacheOnly: {
        effectiveInputTokenUnits: Number(totals.cacheOnly.toFixed(2)),
        reductionPctVsBaseline: pctReduction(totals.baseline, totals.cacheOnly),
        pricingModel: {
          firstPrefixWriteMultiplier: ANTHROPIC_CACHE_WRITE_MULTIPLIER,
          subsequentPrefixReadMultiplier: ANTHROPIC_CACHE_READ_MULTIPLIER,
        },
      },
      combinedItpPlusPromptCache: {
        effectiveInputTokenUnits: Number(totals.combined.toFixed(2)),
        reductionPctVsBaseline: pctReduction(totals.baseline, totals.combined),
      },
    },
    tasks: encodedTasks,
    notes: [
      'ITP encode path, server health, codebook metadata, and encode latency are live measurements against the running server.',
      'Prompt caching economics are modeled using Anthropic cache-write (1.25x) and cache-read (0.10x) input pricing multipliers.',
      'Token counts are estimated as ceil(chars/4), matching the existing ITP benchmark convention. Output tokens are excluded.',
    ],
  };

  writeFileSync(
    './benchmarks/itp-cache-swarm-results.json',
    JSON.stringify(result, null, 2)
  );

  console.log(`✅ ITP server healthy: ${health.status} (${health.protocol} v${health.version})`);
  console.log(`✅ Codebook: v${result.server.codebook.version}, ${result.server.codebook.totalEntries} entries`);
  console.log(`✅ Shared swarm prefix: ${prefixChars} chars, ~${prefixTokens} tokens`);
  console.log('');
  console.log('MESSAGE-LEVEL ITP COMPRESSION (live):');
  console.log(`  Raw task tokens:     ${result.messageCompression.rawTokens}`);
  console.log(`  Encoded task tokens: ${result.messageCompression.encodedTokens}`);
  console.log(`  Savings:             ${result.messageCompression.tokensSaved} (${result.messageCompression.reductionPct}%)`);
  console.log(`  Compressed tasks:    ${result.messageCompression.compressedTasks}/${TASKS.length}`);
  console.log(`  Avg encode latency:  ${result.messageCompression.avgLatencyMs}ms`);
  console.log('');
  console.log('5-TASK SWARM EFFECTIVE INPUT COST (HYBRID MODEL):');
  console.log(`  Baseline:            ${result.scenarios.baselineNoCacheNoItp.effectiveInputTokenUnits}`);
  console.log(`  ITP only:            ${result.scenarios.itpOnly.effectiveInputTokenUnits} (${result.scenarios.itpOnly.reductionPctVsBaseline}% reduction)`);
  console.log(`  Prompt cache only:   ${result.scenarios.promptCacheOnly.effectiveInputTokenUnits} (${result.scenarios.promptCacheOnly.reductionPctVsBaseline}% reduction)`);
  console.log(`  Combined:            ${result.scenarios.combinedItpPlusPromptCache.effectiveInputTokenUnits} (${result.scenarios.combinedItpPlusPromptCache.reductionPctVsBaseline}% reduction)`);
  console.log('');
  console.log('PER TASK:');
  for (const task of encodedTasks) {
    console.log(`  ${task.id} ${task.category.padEnd(10)} ${String(task.rawTokens).padStart(3)} -> ${String(task.encodedTokens).padStart(3)} tokens | compressed=${String(task.wasCompressed).padEnd(5)} | ${task.latencyMs}ms`);
  }
  console.log('');
  console.log('Saved to benchmarks/itp-cache-swarm-results.json');
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});

