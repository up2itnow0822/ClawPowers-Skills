/**
 * Cache Module Types
 *
 * Type definitions for the prompt caching system.
 * Designed around Anthropic's cache_control API with a provider-gated
 * abstraction seam for future multi-provider support.
 */

// ─── Cache Policy ─────────────────────────────────────────────────────────────

export interface CachePolicy {
  /** Cache the system prompt. Default: true */
  cacheSystemPrompt: boolean;
  /** Cache tool/skill definitions. Default: true */
  cacheTools: boolean;
  /** Cache conversation prefix (all but last 1-2 turns). Default: true */
  cacheConversationPrefix: boolean;
  /** Minimum token count before caching kicks in. Default: 1024 */
  minPrefixTokens: number;
  /** Provider to target for cache injection. Default: 'anthropic' */
  provider: CacheProvider;
}

export type CacheProvider = 'anthropic' | 'openai' | 'google' | 'passthrough';

// ─── Anthropic Message Types ──────────────────────────────────────────────────

export interface CacheControl {
  type: 'ephemeral';
}

export interface AnthropicContentBlock {
  type: 'text';
  text: string;
  cache_control?: CacheControl;
}

export interface AnthropicSystemBlock {
  type: 'text';
  text: string;
  cache_control?: CacheControl;
}

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

export interface AnthropicRequest {
  model: string;
  max_tokens: number;
  system?: string | AnthropicSystemBlock[];
  messages: AnthropicMessage[];
  tools?: Array<Record<string, unknown>>;
}

// ─── Cache Economics ──────────────────────────────────────────────────────────

export interface CacheEconomics {
  /** Tokens written to cache (25% cost premium on Anthropic) */
  cacheCreationTokens: number;
  /** Tokens read from cache (90% cost discount on Anthropic) */
  cacheReadTokens: number;
  /** Standard input tokens (no cache) */
  standardInputTokens: number;
  /** Total input tokens */
  totalInputTokens: number;
  /** Output tokens */
  outputTokens: number;
  /** Estimated cost savings vs no caching (0.0 - 1.0) */
  savingsRatio: number;
}

export interface CacheStats {
  /** Total requests processed */
  totalRequests: number;
  /** Requests where cache was injected */
  cacheInjected: number;
  /** Requests where cache was skipped (under minPrefixTokens, wrong provider, etc.) */
  cacheSkipped: number;
  /** Running totals of cache economics */
  economics: CacheEconomics;
}

// ─── Cache Result ─────────────────────────────────────────────────────────────

export interface CacheInjectionResult {
  /** The modified request with cache_control breakpoints */
  request: AnthropicRequest;
  /** Whether any cache breakpoints were injected */
  wasInjected: boolean;
  /** Number of cache breakpoints added */
  breakpointCount: number;
  /** Estimated cacheable token count */
  estimatedCacheableTokens: number;
}
