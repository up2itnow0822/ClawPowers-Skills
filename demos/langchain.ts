/**
 * ClawPowers × LangChain Integration Demo
 *
 * Shows how to use SpendingPolicy + PaymentExecutor as a LangChain tool
 * so your agent can autonomously pay for x402-gated API resources.
 *
 * npm install clawpowers @langchain/core @langchain/openai
 */

import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import {
  SpendingPolicy,
  PaymentExecutor,
  detect402,
  EpisodicMemory,
  ProceduralMemory,
  ContextInjector,
  type MCPPaymentClient,
  type PaymentRequest,
  type EpisodicEntry,
  type Goal,
} from 'clawpowers';

// ─── 1. Configure Spending Policy ─────────────────────────────────────────────

const policy = new SpendingPolicy({
  dailyLimit: 25,       // $25/day max
  transactionLimit: 5,  // $5 per request max
  allowedDomains: ['api.premium-data.com', 'compute.ai-service.io'],
});

// ─── 2. Create MCP Payment Client ─────────────────────────────────────────────
// In production, this connects to agentpay-mcp via stdio or HTTP.
// Here we show the interface contract.

const mcpClient: MCPPaymentClient = {
  async executePayment(params) {
    // Real implementation: call agentpay-mcp
    const response = await fetch('http://localhost:3000/pay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: params.amount,
        currency: params.currency,
        recipient: params.recipient,
        x402Headers: params.x402Headers,
      }),
    });
    const data = await response.json() as { txHash: string; status: 'success' | 'failed' };
    return data;
  },
};

// ─── 3. Build LangChain Tool ──────────────────────────────────────────────────

const executor = new PaymentExecutor(policy, mcpClient);

const paymentTool = new DynamicStructuredTool({
  name: 'execute_x402_payment',
  description: 'Pay for an x402-gated API resource. Use when you receive a 402 Payment Required error.',
  schema: z.object({
    amount: z.number().describe('Payment amount in USD'),
    currency: z.string().describe('Currency (e.g., USDC)'),
    recipient: z.string().describe('Recipient wallet address'),
    domain: z.string().describe('Domain of the API being accessed'),
    x402Headers: z.record(z.string()).describe('x402 payment headers from the 402 response'),
  }),
  func: async ({ amount, currency, recipient, domain, x402Headers }) => {
    const request: PaymentRequest = { amount, currency, recipient, domain, x402Headers };
    const result = await executor.executePayment(request);

    if (result.success) {
      return `Payment successful. TX: ${result.txHash}. Retry the original request with the payment receipt.`;
    }
    return `Payment failed: ${result.error}. Do not retry automatically.`;
  },
});

// ─── 4. Auto-detect 402 in fetch wrapper ──────────────────────────────────────

async function fetchWithPayment(url: string, options?: RequestInit): Promise<Response> {
  const response = await fetch(url, options);

  if (response.status === 402) {
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    const paymentRequired = detect402({ status: 402, headers });
    if (paymentRequired) {
      const domain = new URL(url).hostname;
      const paymentResult = await executor.executePayment({
        amount: paymentRequired.amount,
        currency: paymentRequired.currency,
        recipient: paymentRequired.recipient,
        domain,
        x402Headers: paymentRequired.x402Headers,
      });

      if (paymentResult.success) {
        // Retry with payment receipt
        return fetch(url, {
          ...options,
          headers: {
            ...options?.headers,
            'X-Payment-TX': paymentResult.txHash ?? '',
          },
        });
      }
    }
  }

  return response;
}

// ─── 5. Memory Integration ────────────────────────────────────────────────────

const episodic = new EpisodicMemory('/tmp/clawpowers-demo/episodic.jsonl');
const procedural = new ProceduralMemory('/tmp/clawpowers-demo/procedural.json');
const injector = new ContextInjector(episodic, procedural);

async function recordTaskCompletion(taskId: string, description: string, success: boolean): Promise<void> {
  const entry: EpisodicEntry = {
    taskId,
    timestamp: new Date().toISOString(),
    description,
    outcome: success ? 'success' : 'failure',
    lessonsLearned: [],
    skillsUsed: ['x402-payment'],
    durationMs: 0,
    tags: ['payment', 'api-access'],
  };
  await episodic.append(entry);
}

async function getRelevantContext(taskDescription: string): Promise<string[]> {
  const goal: Goal = {
    taskId: 'current',
    description: taskDescription,
    constraints: [],
    successCriteria: [],
    createdAt: new Date().toISOString(),
    source: 'interactive',
  };
  return injector.inject(goal, 2000);
}

// ─── 6. Export for agent framework ────────────────────────────────────────────

export {
  paymentTool,
  fetchWithPayment,
  recordTaskCompletion,
  getRelevantContext,
  policy,
  executor,
};
