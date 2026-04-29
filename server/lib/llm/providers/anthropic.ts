/**
 * Anthropic provider implementation for the LLM abstraction.
 *
 * Uses the official @anthropic-ai/sdk with Claude 4.x models. Supports:
 *   - Adaptive thinking (Claude Opus/Sonnet 4.6+)
 *   - Built-in web search tool (web_search_20260209) when request.webSearch=true
 *   - JSON-schema constrained output via output_config.format
 *
 * Per the claude-api skill: model defaults to claude-opus-4-7, adaptive thinking
 * for anything complex, output_config.format for structured outputs (NOT the
 * deprecated output_format param). Streams when max_tokens is large enough to
 * risk HTTP timeout (>16K), otherwise non-streaming.
 */

import Anthropic from '@anthropic-ai/sdk';
import { LlmRequest, LlmResponse, LlmProviderError } from '../types';

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

  const params: any = {
    model,
    max_tokens: maxTokens,
    messages: request.messages.map(m => ({ role: m.role, content: m.content })),
  };
  if (request.systemPrompt) params.system = request.systemPrompt;
  if (request.thinking) params.thinking = { type: 'adaptive' };
  if (tools.length > 0) params.tools = tools;
  if (Object.keys(outputConfig).length > 0) params.output_config = outputConfig;

  let response: any;
  try {
    if (maxTokens > 16000) {
      // Stream for large max_tokens to avoid SDK HTTP timeouts
      const stream = client.messages.stream(params);
      response = await stream.finalMessage();
    } else {
      response = await client.messages.create(params);
    }
  } catch (e: any) {
    const status = e?.status || 500;
    throw new LlmProviderError(`Anthropic API error: ${e?.message || String(e)}`, status);
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
