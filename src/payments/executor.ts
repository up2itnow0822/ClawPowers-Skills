/**
 * ClawPowers Agent — Payment Executor
 * Executes payments via agentpay-mcp with spending policy enforcement.
 * Never auto-retries failed payments (financial safety).
 */

import type {
  PaymentRequest,
  PaymentResult,
  PaymentAuditEntry,
} from '../types.js';
import { SpendingPolicy } from './spending.js';

/**
 * Interface for an MCP payment client.
 * In production, this wraps agentpay-mcp; in tests, it can be substituted.
 */
export interface MCPPaymentClient {
  executePayment(params: {
    amount: number;
    currency: string;
    recipient: string;
    x402Headers: Readonly<Record<string, string>>;
  }): Promise<{ txHash: string; status: 'success' | 'failed' }>;
}

/**
 * Payment executor that enforces spending policy and logs all attempts.
 */
export class PaymentExecutor {
  private readonly policy: SpendingPolicy;
  private readonly client: MCPPaymentClient;
  private readonly auditLog: PaymentAuditEntry[] = [];

  constructor(policy: SpendingPolicy, client: MCPPaymentClient) {
    this.policy = policy;
    this.client = client;
  }

  /**
   * Execute a payment request.
   * 1. Check spending policy
   * 2. If allowed, execute via MCP client
   * 3. Log the result (success or failure)
   * 4. Never auto-retry on failure
   */
  async executePayment(request: PaymentRequest): Promise<PaymentResult> {
    // Step 1: Check spending policy
    const decision = this.policy.checkTransaction(request.amount, request.domain);

    if (!decision.allowed) {
      const result: PaymentResult = {
        success: false,
        error: `Spending policy rejected: ${decision.reason}`,
      };

      this.logAudit(request, result);
      return result;
    }

    // Step 2: Execute payment via MCP client
    try {
      const mcpResult = await this.client.executePayment({
        amount: request.amount,
        currency: request.currency,
        recipient: request.recipient,
        x402Headers: request.x402Headers,
      });

      if (mcpResult.status === 'success') {
        // Record successful spend
        this.policy.recordSpend(request.amount, request.domain);

        const result: PaymentResult = {
          success: true,
          txHash: mcpResult.txHash,
        };

        this.logAudit(request, result);
        return result;
      }

      // MCP returned failure status
      const result: PaymentResult = {
        success: false,
        error: 'Payment execution failed at MCP layer',
      };

      this.logAudit(request, result);
      return result;
    } catch (err: unknown) {
      // Execution error — DO NOT retry (financial safety)
      const errorMessage = err instanceof Error ? err.message : String(err);
      const result: PaymentResult = {
        success: false,
        error: `Payment execution error: ${errorMessage}`,
      };

      this.logAudit(request, result);
      return result;
    }
  }

  /**
   * Get the full payment audit log.
   */
  getAuditLog(): readonly PaymentAuditEntry[] {
    return [...this.auditLog];
  }

  /**
   * Log a payment attempt to the audit trail.
   */
  private logAudit(request: PaymentRequest, result: PaymentResult): void {
    this.auditLog.push({
      timestamp: new Date().toISOString(),
      request,
      result,
      spendingSnapshot: {
        dailySpent: this.policy.getDailySpent(),
        dailyLimit: this.policy.dailyLimit,
      },
    });
  }
}
