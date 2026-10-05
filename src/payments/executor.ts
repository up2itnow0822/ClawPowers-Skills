/**
 * ClawPowers Agent — Payment Executor
 * Executes payments via agentpay-mcp with spending policy enforcement.
 * Never auto-retries failed payments (financial safety).
 *
 * Flow: reserve → execute → settle | release | hold-unknown.
 * Release a reservation only when the client confirms not_charged.
 * Thrown errors and unknown status keep the reservation counted.
 */

import type {
  PaymentRequest,
  PaymentResult,
  PaymentAuditEntry,
  PaymentSettlement,
} from '../types.js';
import { SpendingPolicy, type SpendReservation } from './spending.js';

export type PaymentChargeStatus = PaymentSettlement;

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
    idempotencyKey?: string;
  }): Promise<{ txHash?: string; status: PaymentChargeStatus }>;
}

/**
 * Payment executor that enforces spending policy and logs all attempts.
 */
export class PaymentExecutor {
  private readonly policy: SpendingPolicy;
  private readonly client: MCPPaymentClient;
  private readonly auditLog: PaymentAuditEntry[] = [];
  private readonly flights = new Map<string, Promise<PaymentResult>>();

  constructor(policy: SpendingPolicy, client: MCPPaymentClient) {
    this.policy = policy;
    this.client = client;
  }

  /**
   * Execute a payment request.
   * 1. Single-flight by idempotencyKey when present
   * 2. Reserve against spending policy (atomic with the check)
   * 3. Execute via MCP client
   * 4. settle | release on not_charged | hold-unknown
   * 5. Never auto-retry on failure
   */
  async executePayment(request: PaymentRequest): Promise<PaymentResult> {
    const key = request.idempotencyKey;
    if (key) {
      const existing = this.flights.get(key);
      if (existing) {
        return existing;
      }
      const flight = this.runPayment(request);
      this.flights.set(key, flight);
      return flight;
    }
    return this.runPayment(request);
  }

  private async runPayment(request: PaymentRequest): Promise<PaymentResult> {
    const { decision, reservation } = this.policy.reserveTransaction(
      request.amount,
      request.domain
    );

    if (!decision.allowed || !reservation) {
      const result: PaymentResult = {
        success: false,
        error: `Spending policy rejected: ${decision.reason}`,
      };

      this.logAudit(request, result);
      return result;
    }

    try {
      const mcpResult = await this.client.executePayment({
        amount: request.amount,
        currency: request.currency,
        recipient: request.recipient,
        x402Headers: request.x402Headers,
        idempotencyKey: request.idempotencyKey,
      });

      return this.finishReservation(request, reservation, mcpResult.status, mcpResult.txHash);
    } catch (err: unknown) {
      // Ambiguous: payment may already have settled. Keep the reservation.
      this.policy.markReservationUnknown(reservation);

      const errorMessage = err instanceof Error ? err.message : String(err);
      const result: PaymentResult = {
        success: false,
        settlement: 'unknown',
        error: `Payment execution error: ${errorMessage}`,
      };

      this.logAudit(request, result);
      return result;
    }
  }

  private finishReservation(
    request: PaymentRequest,
    reservation: SpendReservation,
    status: PaymentChargeStatus,
    txHash?: string
  ): PaymentResult {
    if (status === 'settled') {
      this.policy.settleReservation(reservation);
      const result: PaymentResult = {
        success: true,
        settlement: 'settled',
        txHash,
      };
      this.logAudit(request, result);
      return result;
    }

    if (status === 'not_charged') {
      this.policy.voidReservation(reservation);
      const result: PaymentResult = {
        success: false,
        settlement: 'not_charged',
        error: 'Payment execution failed at MCP layer',
      };
      this.logAudit(request, result);
      return result;
    }

    this.policy.markReservationUnknown(reservation);
    const result: PaymentResult = {
      success: false,
      settlement: 'unknown',
      txHash,
      error: 'Payment settlement unknown at MCP layer',
    };
    this.logAudit(request, result);
    return result;
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
