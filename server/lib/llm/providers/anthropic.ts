/**
 * Anthropic provider implementation for the LLM abstraction.
 *
 * Uses the official @anthropic-ai/sdk with Claude 4.x models. Supports:
 *   - Adaptive thinking (Claude Opus/Sonnet 4.6+)
 *   - Built-in web search tool (web_search_20260209) when request.webSearch=true
 *   - JSON-schema constrained output via output_config.format
 *   - Retry + schema-strip fallback for transient overloads (see retry.ts).
 *     Notably handles "Grammar compilation is temporarily unavailable" by
 *     dropping output_config.format and retrying — the system prompt's
 *     "return JSON only" instruction is enough since callers parse defensively.
 *
 * Per the claude-api skill: model defaults to claude-opus-4-7, adaptive thinking
 * for anything complex, output_config.format for structured outputs (NOT the
 * deprecated output_format param). Streams when max_tokens is large enough to
 * risk HTTP timeout (>16K), otherwise non-streaming.
 */

import Anthropic from '@anthropic-ai/sdk';
import { LlmRequest, LlmResponse, LlmProviderError } from '../types';
import { classifyAnthropicError } from '../retry';

// Per-1M-token rates (USD) as of 2026-04. Refresh when Anthropic updates pricing.
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-7':   { input: 5.0,  output: 25.0 },
  'claude-opus-4-6':   { input: 5.0,  output: 25.0 },
  'claude-sonnet-4-6': { input: 3.0,  output: 15.0 },
  'claude-haiku-4-5':  { input: 1.0,  output: 5.0 },
};

export async function callAnthropic(
  request: LlmRequest,
  apiKey: string,
  model: string,
): Promise<LlmResponse> {
  const client = new Anthropic({ apiKey });
  const maxTokens = request.maxTokens ?? 16000;

  // Build tools array. Web search is a server-side Anthropic tool — declaring
  // it tells the model it can search; Anthropic executes the search and
  // returns results inline.
  const tools: any[] = [];
  if (request.webSearch) {
    tools.push({ type: 'web_search_20260209', name: 'web_search' });
  }

  // Output configuration. Use output_config.format (not the deprecated
  // output_format param) for JSON schema constraints.
  const outputConfig: any = {};
  if (request.jsonSchema) {
    outputConfig.format = { type: 'json_schema', schema: request.jsonSchema };
  }

  // When we fall back to schema-less mode (after grammar compiler fails), augment
  // the system prompt with an explicit "JSON only, no prose" instruction so the
  // model still produces parseable output that normalizeLeads can consume.
  const SCHEMA_FALLBACK_SUFFIX =
    '\n\nIMPORTANT: Return ONLY a single valid JSON object that conforms to the structure described in the user message. Do not wrap it in markdown code fences. Do not include any prose before or after the JSON.';

  const buildParams = (includeSchema: boolean): any => {
    const p: any = {
      model,
      max_tokens: maxTokens,
      messages: request.messages.map(m => ({ role: m.role, content: m.content })),
    };
    if (request.systemPrompt) {
      p.system = includeSchema || !request.jsonSchema
        ? request.systemPrompt
        : request.systemPrompt + SCHEMA_FALLBACK_SUFFIX;
    } else if (!includeSchema && request.jsonSchema) {
      p.system = SCHEMA_FALLBACK_SUFFIX.trim();
    }
    if (request.thinking) p.thinking = { type: 'adaptive' };
    if (tools.length > 0) p.tools = tools;
    if (includeSchema && Object.keys(outputConfig).length > 0) p.output_config = outputConfig;
    return p;
  };

  const callOnce = async (params: any): Promise<any> => {
    if (maxTokens > 16000) {
      const stream = client.messages.stream(params);
      return stream.finalMessage();
    }
    return client.messages.create(params);
  };

  // Retry / fallback loop. classifyAnthropicError is the only place the policy
  // lives — see server/lib/llm/retry.ts and tests/unit/llm-retry.test.ts.
  let response: any;
  let useSchema = !!request.jsonSchema;
  let attempt = 0;
  const MAX_RETRIES = 3;
  while (true) {
    attempt++;
    try {
      response = await callOnce(buildParams(useSchema));
      break;
    } catch (e: any) {
      const action = classifyAnthropicError(e, {
        attempt,
        hasJsonSchema: useSchema,
        maxRetries: MAX_RETRIES,
      });
      if (action.kind === 'fatal') {
        const status = e?.status || 500;
        throw new LlmProviderError(`Anthropic API error: ${e?.message || String(e)}`, status);
      }
      if (action.kind === 'retry_no_schema') {
        console.warn(`[Anthropic] Grammar compiler unavailable — falling back to schema-less call (attempt ${attempt})`);
        useSchema = false;
      } else {
        console.warn(`[Anthropic] Transient error on attempt ${attempt}, retrying in ${action.backoffMs}ms — ${e?.message?.slice(0, 200)}`);
      }
      if (action.backoffMs > 0) {
        await new Promise(r => setTimeout(r, action.backoffMs));
      }
    }
  }

  // Extract text content. Anthropic returns content[] as a discriminated union;
  // we concatenate all text blocks. Tool-use blocks (web_search results) are
  // handled by the model — its final answer lands in text blocks.
  const textBlocks = (response.content || []).filter((b: any) => b.type === 'text');
  const content = textBlocks.map((b: any) => b.text).join('\n');

  // Try to parse JSON when a schema was requested.
  let parsed: unknown | undefined;
  if (request.jsonSchema) {
    try {
      parsed = JSON.parse(content);
    } catch {
      // Leave parsed undefined — caller can inspect response.content and decide.
    }
  }

  const promptTokens = response.usage?.input_tokens || 0;
  const completionTokens = response.usage?.output_tokens || 0;
  const rate = PRICING[model] || { input: 0, output: 0 };
  const estCostUsd = (promptTokens * rate.input + completionTokens * rate.output) / 1_000_000;

  return {
    content,
    parsed,
    usage: { promptTokens, completionTokens, estCostUsd },
    provider: 'anthropic',
    model,
  };
}
