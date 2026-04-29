/**
 * Public entry point for the LLM abstraction layer.
 *
 * Usage:
 *   import { runLlm } from "../lib/llm";
 *   const result = await runLlm({
 *     orgId,
 *     feature: "lead_agent",
 *     systemPrompt: "...",
 *     messages: [{ role: "user", content: "..." }],
 *     jsonSchema: { ... },
 *     webSearch: true,        // anthropic-only
 *     forceProvider: "anthropic",  // optional hard override
 *   });
 *   if (result.parsed) ... else fallback to result.content
 *
 * Resolution rules (see config.ts):
 *   1. forceProvider param wins
 *   2. ai_provider_<feature> setting
 *   3. ai_provider setting (org default)
 *   4. fallback based on which credentials are configured
 *
 * Capability rule:
 *   webSearch=true is anthropic-only. If resolution lands on azure_openai,
 *   we throw LlmCapabilityError BEFORE making any API call so the caller can
 *   present a clear error.
 */

import { storage } from '../../storage';
import {
  LlmRequest,
  LlmResponse,
  LlmCapabilityError,
} from './types';
import { resolveProvider, SettingsMap } from './config';
import { callAnthropic } from './providers/anthropic';
import { callAzureOpenAI } from './providers/azure-openai';

export * from './types';
export { resolveProvider } from './config';

export async function runLlm(request: LlmRequest): Promise<LlmResponse> {
  const settings = (await storage.getApiSettings(request.orgId)) as SettingsMap;
  const config = resolveProvider(request.feature, settings, request.forceProvider);

  // Capability check — webSearch needs Anthropic's built-in tool. Azure
  // OpenAI doesn't have a drop-in equivalent in this codebase yet.
  if (request.webSearch && config.provider !== 'anthropic') {
    throw new LlmCapabilityError(
      `Feature "${request.feature}" requested webSearch=true but provider resolved to "${config.provider}". Web search requires Anthropic. Set forceProvider:"anthropic" or change ai_provider_${request.feature} to anthropic.`,
    );
  }

  if (config.provider === 'anthropic') {
    return callAnthropic(request, settings.claude_api_key as string, config.anthropicModel!);
  }
  return callAzureOpenAI(
    request,
    settings.azure_openai_endpoint as string,
    settings.azure_openai_api_key as string,
    config.azureDeployment!,
    settings.azure_openai_api_version || '2024-08-01-preview',
  );
}
