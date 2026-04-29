/**
 * Azure OpenAI provider implementation for the LLM abstraction.
 *
 * Uses raw HTTP against the Azure OpenAI Chat Completions endpoint (already
 * how every other service in this codebase calls Azure OpenAI — staying
 * consistent rather than introducing the openai SDK as a new dependency).
 *
 * Capability constraints (relative to Anthropic):
 *   - No built-in web search (Azure has separate Bing connectors but no
 *     drop-in equivalent of Anthropic's web_search_20260209 tool)
 *   - No "adaptive thinking" — `request.thinking` is silently ignored
 *   - JSON schema enforcement via response_format.json_schema (gpt-4o+)
 *
 * Caller must NOT pass webSearch=true when this provider is selected — the
 * abstraction layer (index.ts) catches that and throws LlmCapabilityError
 * before reaching here.
 */

import { LlmRequest, LlmResponse, LlmProviderError } from '../types';

// Per-1M-token rates (USD). Update when Azure OpenAI changes pricing.
// Best-effort — actual deployment may use a different tier; this is a guide.
const PRICING_FALLBACK = { input: 5.0, output: 15.0 }; // gpt-4o-ish baseline

export async function callAzureOpenAI(
  request: LlmRequest,
  endpoint: string,
  apiKey: string,
  deployment: string,
  apiVersion: string = '2024-08-01-preview',
): Promise<LlmResponse> {
  // Build messages array — Azure OpenAI uses OpenAI's chat schema where
  // system prompt is a message with role='system'.
  const messages: any[] = [];
  if (request.systemPrompt) {
    messages.push({ role: 'system', content: request.systemPrompt });
  }
  for (const m of request.messages) {
    messages.push({ role: m.role, content: m.content });
  }

  const body: any = {
    messages,
    max_tokens: request.maxTokens ?? 16000,
  };

  // JSON schema enforcement. response_format.json_schema is supported on
  // GPT-4o family — older deployments may need response_format: { type: 'json_object' }
  // and a system-prompt-driven schema. We use the strict variant.
  if (request.jsonSchema) {
    body.response_format = {
      type: 'json_schema',
      json_schema: {
        name: 'response',
        strict: true,
        schema: request.jsonSchema,
      },
    };
  }

  const url = `${endpoint.replace(/\/$/, '')}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify(body),
    });
  } catch (e: any) {
    throw new LlmProviderError(`Azure OpenAI network error: ${e?.message || String(e)}`, 0);
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new LlmProviderError(`Azure OpenAI ${resp.status}: ${errText.slice(0, 300)}`, resp.status);
  }

  const data: any = await resp.json();
  const content: string = data.choices?.[0]?.message?.content || '';

  let parsed: unknown | undefined;
  if (request.jsonSchema) {
    try {
      parsed = JSON.parse(content);
    } catch {
      // schema strict-mode usually guarantees valid JSON, but keep defensive
    }
  }

  const promptTokens = data.usage?.prompt_tokens || 0;
  const completionTokens = data.usage?.completion_tokens || 0;
  const estCostUsd = (promptTokens * PRICING_FALLBACK.input + completionTokens * PRICING_FALLBACK.output) / 1_000_000;

  return {
    content,
    parsed,
    usage: { promptTokens, completionTokens, estCostUsd },
    provider: 'azure_openai',
    model: deployment,
  };
}
