/**
 * CacheManager — Prompt caching for LLM API calls.
 *
 * Injects provider-specific cache directives into API requests to reduce
 * redundant token processing. Currently supports Anthropic's cache_control
 * breakpoint system. Other providers pass through unchanged.
 *
 * Designed to sit AFTER ITP compression in the pipeline:
 *   Raw prompt → ITP compress → CacheManager → Model Router → Provider API
 *
 * ITP produces deterministic output for the same input, making compressed
 * prefixes stable and cache-friendly.
 *
 * Anthropic cache economics:
 *   - Cache writes: 25% premium on input token cost
 *   - Cache reads: 90% discount on input token cost
 *   - Minimum useful size: ~1024 tokens (breakeven after 1-2 re-reads)
 *   - TTL: 5 minutes (ephemeral), refreshed on each read
 */

import type {
  CachePolicy,
  CacheProvider,
  CacheStats,
  CacheEconomics,
  CacheInjectionResult,
  AnthropicRequest,
  AnthropicSystemBlock,
  AnthropicContentBlock,
  AnthropicMessage,
  CacheControl,
} from './types.js';

export type {
  CachePolicy,
  CacheProvider,
  CacheStats,
  CacheEconomics,
  CacheInjectionResult,
  AnthropicRequest,
  AnthropicSystemBlock,
  AnthropicContentBlock,
  AnthropicMessage,
  CacheControl,
};

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_POLICY: CachePolicy = {
  cacheSystemPrompt: true,
  cacheTools: true,
  cacheConversationPrefix: true,
  minPrefixTokens: 1024,
  provider: 'anthropic',
};

// Rough chars-per-token estimate for prefix size gating
const CHARS_PER_TOKEN = 4;

// ─── CacheManager ─────────────────────────────────────────────────────────────

export class CacheManager {
  private policy: CachePolicy;
  private stats: CacheStats;

  constructor(policy?: Partial<CachePolicy>) {
    this.policy = { ...DEFAULT_POLICY, ...policy };
    this.stats = {
      totalRequests: 0,
      cacheInjected: 0,
      cacheSkipped: 0,
      economics: {
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        standardInputTokens: 0,
        totalInputTokens: 0,
        outputTokens: 0,
        savingsRatio: 0,
      },
    };
  }

  /**
   * Inject cache_control breakpoints into an Anthropic API request.
   *
   * Places breakpoints at:
   * 1. End of system prompt (if cacheSystemPrompt is true)
   * 2. End of tools array (if cacheTools is true)
   * 3. End of conversation prefix, excluding last 2 messages (if cacheConversationPrefix is true)
   *
   * Returns the modified request and injection metadata.
   */
  inject(request: AnthropicRequest): CacheInjectionResult {
    this.stats.totalRequests++;

    // Only inject for Anthropic
    if (this.policy.provider !== 'anthropic') {
      this.stats.cacheSkipped++;
      return {
        request,
        wasInjected: false,
        breakpointCount: 0,
        estimatedCacheableTokens: 0,
      };
    }

    // Deep clone to avoid mutating the original
    const req: AnthropicRequest = JSON.parse(JSON.stringify(request));
    let breakpoints = 0;
    let cacheableChars = 0;

    // 1. System prompt caching
    if (this.policy.cacheSystemPrompt && req.system) {
      if (typeof req.system === 'string') {
        // Convert string system to block array with cache_control
        const systemBlock: AnthropicSystemBlock = {
          type: 'text',
          text: req.system,
          cache_control: { type: 'ephemeral' },
        };
        req.system = [systemBlock];
        cacheableChars += req.system[0]?.text.length ?? 0;
        breakpoints++;
      } else if (Array.isArray(req.system) && req.system.length > 0) {
        // Add cache_control to last system block
        const lastBlock = req.system[req.system.length - 1];
        if (lastBlock) {
          lastBlock.cache_control = { type: 'ephemeral' };
          cacheableChars += lastBlock.text.length;
        }
        breakpoints++;
      }
    }

    // 2. Tools caching
    if (this.policy.cacheTools && req.tools && req.tools.length > 0) {
      // Anthropic supports cache_control on the last tool definition
      const lastTool = req.tools[req.tools.length - 1];
      (lastTool as any).cache_control = { type: 'ephemeral' };
      cacheableChars += JSON.stringify(req.tools).length;
      breakpoints++;
    }

    // 3. Conversation prefix caching
    if (this.policy.cacheConversationPrefix && req.messages.length > 2) {
      // Cache everything except the last 2 messages (current turn)
      const prefixEnd = req.messages.length - 2;
      const prefixMsg = req.messages[prefixEnd - 1];

      if (prefixMsg) {
        if (typeof prefixMsg.content === 'string') {
          // Convert to block array with cache_control
          prefixMsg.content = [{
            type: 'text',
            text: prefixMsg.content,
            cache_control: { type: 'ephemeral' },
          }];
        } else if (Array.isArray(prefixMsg.content) && prefixMsg.content.length > 0) {
          const lastContent = prefixMsg.content[prefixMsg.content.length - 1];
          if (lastContent) lastContent.cache_control = { type: 'ephemeral' };
        }

        // Sum prefix chars
        for (let i = 0; i < prefixEnd; i++) {
          const msg = req.messages[i];
          if (!msg) continue;
          if (typeof msg.content === 'string') {
            cacheableChars += msg.content.length;
          } else if (Array.isArray(msg.content)) {
            for (const block of msg.content) {
              if (block.type === 'text') cacheableChars += block.text.length;
            }
          }
        }
        breakpoints++;
      }
    }

    // Check minimum prefix token threshold
    const estimatedTokens = Math.ceil(cacheableChars / CHARS_PER_TOKEN);
    if (breakpoints > 0 && estimatedTokens < this.policy.minPrefixTokens) {
      // Under threshold — strip all cache_control we just added
      this.stats.cacheSkipped++;
      return {
        request, // Return original, not modified
        wasInjected: false,
        breakpointCount: 0,
        estimatedCacheableTokens: estimatedTokens,
      };
    }

    if (breakpoints > 0) {
      this.stats.cacheInjected++;
    } else {
      this.stats.cacheSkipped++;
    }

    return {
      request: req,
      wasInjected: breakpoints > 0,
      breakpointCount: breakpoints,
      estimatedCacheableTokens: estimatedTokens,
    };
  }

  /**
   * Record cache economics from an API response.
   * Call this after receiving a response to track savings.
   *
   * @param usage - The usage object from the Anthropic API response
   */
  recordUsage(usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  }): void {
    const econ = this.stats.economics;

    econ.cacheCreationTokens += usage.cache_creation_input_tokens ?? 0;
    econ.cacheReadTokens += usage.cache_read_input_tokens ?? 0;
    econ.standardInputTokens += usage.input_tokens - (usage.cache_creation_input_tokens ?? 0) - (usage.cache_read_input_tokens ?? 0);
    econ.totalInputTokens += usage.input_tokens;
    econ.outputTokens += usage.output_tokens;

    // Calculate running savings ratio
    // Without caching: all input tokens at full price
    // With caching: creation at 1.25x, reads at 0.1x, standard at 1x
    const fullCost = econ.totalInputTokens; // normalized units
    const cachedCost = econ.standardInputTokens
      + (econ.cacheCreationTokens * 1.25)
      + (econ.cacheReadTokens * 0.10);
    econ.savingsRatio = fullCost > 0 ? Math.max(0, (fullCost - cachedCost) / fullCost) : 0;
  }

  /**
   * Get current cache statistics.
   */
  getStats(): CacheStats {
    return JSON.parse(JSON.stringify(this.stats));
  }

  /**
   * Reset statistics (between benchmark runs, etc.)
   */
  resetStats(): void {
    this.stats = {
      totalRequests: 0,
      cacheInjected: 0,
      cacheSkipped: 0,
      economics: {
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        standardInputTokens: 0,
        totalInputTokens: 0,
        outputTokens: 0,
        savingsRatio: 0,
      },
    };
  }

  /**
   * Get the current policy.
   */
  getPolicy(): CachePolicy {
    return { ...this.policy };
  }

  /**
   * Update the policy.
   */
  updatePolicy(updates: Partial<CachePolicy>): void {
    this.policy = { ...this.policy, ...updates };
  }

  /**
   * Helper: prepare a simple request with system prompt + user message
   * and inject cache breakpoints. Convenience for common single-turn usage.
   */
  prepareRequest(options: {
    model: string;
    systemPrompt: string;
    userMessage: string;
    maxTokens?: number;
    tools?: Array<Record<string, unknown>>;
  }): CacheInjectionResult {
    const request: AnthropicRequest = {
      model: options.model,
      max_tokens: options.maxTokens ?? 4096,
      system: options.systemPrompt,
      messages: [{ role: 'user', content: options.userMessage }],
    };
    if (options.tools) {
      request.tools = options.tools;
    }
    return this.inject(request);
  }
}
