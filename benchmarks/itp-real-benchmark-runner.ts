#!/usr/bin/env tsx
/**
 * ITP Real Benchmark — Data Preparation
 *
 * Prepares raw vs ITP-compressed prompts and measures character/token reduction.
 * The actual LLM calls are made externally via OpenClaw's llm-task tool.
 *
 * This script just prepares the payloads and outputs the comparison data.
 *
 * Run: ITP_BASE_URL=http://127.0.0.1:8101 npx tsx benchmarks/itp-real-benchmark-runner.ts
 */

import { encode, healthCheck } from '../src/itp/index.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SYSTEM_PREAMBLE = `You are an autonomous infrastructure monitoring agent running inside the AI Agent Economy operations environment. Your role is to perform health checks, detect anomalies, and report findings through the structured SwarmMemory interface. You have access to Docker, system utilities, and the metrics API. Always report findings in structured JSON format with severity levels (info, warning, critical). Do not take corrective action — only observe and report. The current monitoring window is the last 15 minutes unless otherwise specified. Previous findings from other swarm agents are available through the shared memory interface.`;

const TASKS = [
  { id: 'health-1', message: 'Check Docker container health status for all running services. Run docker ps and report container status, uptime, and port mappings for all running containers. Flag any containers in unhealthy or restarting state.' },
  { id: 'health-2', message: 'Verify API endpoint availability and response times. Check the health endpoints for the trading API (port 8080), the metrics server (port 9090), and the webhook receiver (port 3000). Report status codes and response latency in milliseconds.' },
  { id: 'health-3', message: 'Analyze disk usage and identify large files consuming storage on all mounted volumes. Identify any directories over 1GB and any individual files over 100MB. Report total free space remaining as a percentage.' },
  { id: 'health-4', message: 'Review system memory and process resource consumption. Report total, used, and available memory. List the top 10 processes by memory consumption with PID, name, and RSS. Flag any process using more than 2GB.' },
  { id: 'health-5', message: 'Audit recent error logs across all services for anomalies. Scan the last 1000 lines of logs for each running Docker container. Extract ERROR and WARN level entries. Group by service and report counts. Highlight any new error patterns not seen in the previous 24 hours.' },
];

async function main() {
  const itpAlive = await healthCheck();
  console.log(`ITP server: ${itpAlive ? 'active' : 'offline'}`);

  if (!itpAlive) {
    console.error('ITP server must be running. Start with:');
    console.error('cd tools/itp && python -m uvicorn itp_server:app --host 127.0.0.1 --port 8101');
    process.exit(1);
  }

  const results: any[] = [];

  for (const task of TASKS) {
    const rawPrompt = `${SYSTEM_PREAMBLE}\n\nTask: ${task.message}`;

    // ITP encode both parts
    const [sysEnc, msgEnc] = await Promise.all([
      encode(SYSTEM_PREAMBLE, 'benchmark'),
      encode(task.message, 'benchmark'),
    ]);

    const itpPrompt = `${sysEnc.encoded}\n\nTask: ${msgEnc.encoded}`;

    results.push({
      taskId: task.id,
      raw: {
        prompt: rawPrompt,
        chars: rawPrompt.length,
        estTokens: Math.ceil(rawPrompt.length / 4),
      },
      itp: {
        prompt: itpPrompt,
        chars: itpPrompt.length,
        estTokens: Math.ceil(itpPrompt.length / 4),
        systemSavingsPct: sysEnc.savingsPct,
        messageSavingsPct: msgEnc.savingsPct,
      },
      charSavingsPct: ((rawPrompt.length - itpPrompt.length) / rawPrompt.length * 100).toFixed(1),
    });

    console.log(`${task.id}: ${rawPrompt.length} → ${itpPrompt.length} chars (${((rawPrompt.length - itpPrompt.length) / rawPrompt.length * 100).toFixed(1)}% savings)`);
  }

  // Output payloads file for llm-task calls
  const outDir = join(__dirname, 'results');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'real-benchmark-payloads.json');
  writeFileSync(outPath, JSON.stringify(results, null, 2) + '\n');
  console.log(`\nPayloads written to ${outPath}`);

  // Summary
  const totalRaw = results.reduce((s, r) => s + r.raw.chars, 0);
  const totalItp = results.reduce((s, r) => s + r.itp.chars, 0);
  console.log(`\nTotal: ${totalRaw} → ${totalItp} chars (${((totalRaw - totalItp) / totalRaw * 100).toFixed(1)}% savings)`);
  console.log(`Est tokens: ${Math.ceil(totalRaw / 4)} → ${Math.ceil(totalItp / 4)}`);
}

main().catch(console.error);
