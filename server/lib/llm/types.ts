/**
 * Shared types for the LLM abstraction layer.
 *
 * The abstraction lets a feature call `runLlm()` without knowing whether the
 * underlying provider is Anthropic Claude or Azure OpenAI. Each provider
 * implementation translates this neutral request shape into its own SDK calls
 * and translates the response back. Capability mismatches (e.g. asking Azure
 * OpenAI for built-in web search, which it doesn't have without a Bing
 * connector) are caught at the abstraction layer with a clear error.
 */

export type LlmProviderId = 'anthropic' | 'azure_openai';

/** Names of features that may have per-feature provider overrides. */
export type LlmFeature =
  | 'lead_agent'         // AI Lead Agent — needs web search → Claude only
  | 'campaign_review'
  | 'lead_intel'
  | 'reply_drafting'
  | 'reply_classifier'
  | 'email_rating'
  | 'personalization'
  | 'context_engine'
  | 'campaign_planner';

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmRequest {
  /** Organization scope for credential and settings lookup. */
  orgId: string;
  /** Which feature is calling — drives per-feature provider overrides + cost telemetry. */
  feature: LlmFeature;
  /** System prompt (non-message instructions). */
  systemPrompt?: string;
  /** Conversation messages. */
  messages: LlmMessage[];
  /** Cap on response length. Defaults vary by provider; abstraction never silently truncates. */
  maxTokens?: number;
  /** When set, the response is constrained to this JSON schema and `parsed` is populated. */
  jsonSchema?: object;
  /** Adaptive thinking on Anthropic. Ignored by Azure OpenAI. */
  thinking?: boolean;
  /** Built-in web search. Anthropic-only — throws if provider resolves to Azure OpenAI. */
  webSearch?: boolean;
  /** Override the configured provider for this single call. Use only when the feature
   *  has a hard requirement (e.g. lead_agent forcing Anthropic for web search). */
  forceProvider?: LlmProviderId;
  /** Optional AbortSignal — providers wire it into their SDK call so a user-triggered
   *  cancel (e.g. lead-agent /cancel) can short-circuit the in-flight HTTP request
   *  rather than waiting for the model to finish and consuming credits. */
  abortSignal?: AbortSignal;
}

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  /** Best-effort cost estimate in USD using the provider's published per-token rate
   *  at the time the abstraction was last updated. Refresh manually as rates change. */
  estCostUsd: number;
}

export interface LlmResponse {
  /** Raw text content (the response body). */
  content: string;
  /** When the request included `jsonSchema`, this is the parsed and validated object. */
  parsed?: unknown;
  /** Token usage + cost estimate. */
  usage: LlmUsage;
  /** Which provider actually answered (after settings + override resolution). */
  provider: LlmProviderId;
  /** Specific model string used (e.g. "claude-opus-4-7", "gpt-4o"). */
  model: string;
}

export class LlmConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmConfigError';
  }
}

export class LlmCapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmCapabilityError';
  }
}

export class LlmProviderError extends Error {
  public readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'LlmProviderError';
    this.status = status;
  }
}
