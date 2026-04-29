/**
 * Provider/model resolution for the LLM abstraction.
 *
 * Reads from `api_settings` (per-org). Per-feature override takes precedence
 * over the org-wide default. Falls back to env vars when settings are unset.
 *
 * Pure logic — no I/O, no SDK calls. Takes a settings map (already loaded by the
 * caller) and a feature name; returns the resolved provider + model. The caller
 * is responsible for fetching `storage.getApiSettings(orgId)` and passing it in.
 * This makes the function trivially unit-testable without mocking storage.
 */

import { LlmProviderId, LlmFeature, LlmConfigError } from './types';

export interface ResolvedConfig {
  provider: LlmProviderId;
  /** Anthropic model (e.g. "claude-opus-4-7") — set when provider is anthropic. */
  anthropicModel?: string;
  /** Azure OpenAI deployment ID — set when provider is azure_openai. */
  azureDeployment?: string;
}

/** Default model when org hasn't picked one. claude-opus-4-7 is the most
 *  capable; users can downgrade to sonnet/haiku for cost via the admin UI. */
const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-4-7';

const KNOWN_ANTHROPIC_MODELS = new Set([
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
]);

export interface SettingsMap {
  [key: string]: string | undefined;
}

export function resolveProvider(
  feature: LlmFeature,
  settings: SettingsMap,
  forceProvider?: LlmProviderId,
): ResolvedConfig {
  // Hard override (e.g. lead_agent forcing anthropic for web search) wins
  // over everything else. The feature is responsible for justifying it.
  if (forceProvider) {
    return finalize(forceProvider, feature, settings);
  }

  // Per-feature override beats org-wide default.
  const featureKey = `ai_provider_${feature}`;
  const featurePref = settings[featureKey];
  if (featurePref === 'anthropic' || featurePref === 'azure_openai') {
    return finalize(featurePref, feature, settings);
  }

  // Org-wide default. If unset, prefer azure_openai when those credentials are
  // configured (the more common existing setup), else anthropic.
  const orgPref = settings.ai_provider;
  if (orgPref === 'anthropic' || orgPref === 'azure_openai') {
    return finalize(orgPref, feature, settings);
  }

  const hasAzure = !!(settings.azure_openai_endpoint && settings.azure_openai_api_key && settings.azure_openai_deployment);
  const hasAnthropic = !!(settings.claude_api_key);
  if (hasAzure) return finalize('azure_openai', feature, settings);
  if (hasAnthropic) return finalize('anthropic', feature, settings);
  throw new LlmConfigError(
    'No AI provider configured. Set either Azure OpenAI (azure_openai_endpoint + azure_openai_api_key + azure_openai_deployment) or Anthropic (claude_api_key) in Advanced Settings.',
  );
}

function finalize(provider: LlmProviderId, feature: LlmFeature, settings: SettingsMap): ResolvedConfig {
  if (provider === 'anthropic') {
    const featureModel = settings[`ai_model_anthropic_${feature}`];
    const orgModel = settings.ai_model_anthropic;
    const model = featureModel || orgModel || DEFAULT_ANTHROPIC_MODEL;
    if (!KNOWN_ANTHROPIC_MODELS.has(model)) {
      throw new LlmConfigError(`Unknown Anthropic model "${model}". Valid: ${[...KNOWN_ANTHROPIC_MODELS].join(', ')}`);
    }
    if (!settings.claude_api_key) {
      throw new LlmConfigError('Anthropic provider selected but claude_api_key is not configured.');
    }
    return { provider: 'anthropic', anthropicModel: model };
  }
  // azure_openai
  if (!settings.azure_openai_endpoint || !settings.azure_openai_api_key || !settings.azure_openai_deployment) {
    throw new LlmConfigError(
      'Azure OpenAI provider selected but credentials incomplete. Need azure_openai_endpoint, azure_openai_api_key, and azure_openai_deployment.',
    );
  }
  return { provider: 'azure_openai', azureDeployment: settings.azure_openai_deployment };
}
