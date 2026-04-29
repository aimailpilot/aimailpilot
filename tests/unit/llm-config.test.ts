/**
 * Tests for server/lib/llm/config.ts (resolveProvider)
 * --------------------------------------------------
 * Pure function — exhaustively covers the resolution rules:
 *   1. forceProvider wins over everything
 *   2. per-feature override (ai_provider_<feature>) beats org default
 *   3. org default (ai_provider) used when no per-feature override
 *   4. fallback inference when no setting at all (prefers azure_openai if
 *      both credentials configured, else falls back to whichever exists)
 *   5. throws LlmConfigError on unknown model or missing credentials
 */

import { describe, it, expect } from 'vitest';
import { resolveProvider } from '../../server/lib/llm/config';
import { LlmConfigError } from '../../server/lib/llm/types';

const fullCreds = {
  azure_openai_endpoint: 'https://x.openai.azure.com/',
  azure_openai_api_key: 'sk-aaa',
  azure_openai_deployment: 'gpt-4o',
  claude_api_key: 'sk-ant-bbb',
};

describe('resolveProvider — forceProvider wins', () => {
  it('forceProvider=anthropic overrides everything', () => {
    const r = resolveProvider('lead_agent', { ...fullCreds, ai_provider: 'azure_openai', ai_provider_lead_agent: 'azure_openai' }, 'anthropic');
    expect(r.provider).toBe('anthropic');
    expect(r.anthropicModel).toBe('claude-opus-4-7');
  });

  it('forceProvider=azure_openai overrides per-feature anthropic preference', () => {
    const r = resolveProvider('lead_intel', { ...fullCreds, ai_provider_lead_intel: 'anthropic' }, 'azure_openai');
    expect(r.provider).toBe('azure_openai');
    expect(r.azureDeployment).toBe('gpt-4o');
  });
});

describe('resolveProvider — per-feature override beats org default', () => {
  it('feature override = anthropic, org default = azure_openai → anthropic', () => {
    const r = resolveProvider('campaign_review', { ...fullCreds, ai_provider: 'azure_openai', ai_provider_campaign_review: 'anthropic' });
    expect(r.provider).toBe('anthropic');
  });

  it('feature override = azure_openai, org default = anthropic → azure_openai', () => {
    const r = resolveProvider('email_rating', { ...fullCreds, ai_provider: 'anthropic', ai_provider_email_rating: 'azure_openai' });
    expect(r.provider).toBe('azure_openai');
  });

  it('invalid per-feature value falls back to org default', () => {
    const r = resolveProvider('reply_drafting', { ...fullCreds, ai_provider: 'anthropic', ai_provider_reply_drafting: 'invalid' });
    expect(r.provider).toBe('anthropic');
  });
});

describe('resolveProvider — org default', () => {
  it('ai_provider = anthropic → anthropic', () => {
    const r = resolveProvider('lead_intel', { ...fullCreds, ai_provider: 'anthropic' });
    expect(r.provider).toBe('anthropic');
  });

  it('ai_provider = azure_openai → azure_openai', () => {
    const r = resolveProvider('lead_intel', { ...fullCreds, ai_provider: 'azure_openai' });
    expect(r.provider).toBe('azure_openai');
  });
});

describe('resolveProvider — credential-based fallback', () => {
  it('only Azure credentials → azure_openai', () => {
    const r = resolveProvider('lead_intel', {
      azure_openai_endpoint: 'https://x.openai.azure.com/',
      azure_openai_api_key: 'sk-x',
      azure_openai_deployment: 'gpt-4o',
    });
    expect(r.provider).toBe('azure_openai');
  });

  it('only Anthropic credentials → anthropic', () => {
    const r = resolveProvider('lead_intel', { claude_api_key: 'sk-ant-x' });
    expect(r.provider).toBe('anthropic');
  });

  it('both credentials, no preference → prefers azure_openai (more common existing setup)', () => {
    const r = resolveProvider('lead_intel', fullCreds);
    expect(r.provider).toBe('azure_openai');
  });

  it('no credentials at all → throws LlmConfigError', () => {
    expect(() => resolveProvider('lead_intel', {})).toThrow(LlmConfigError);
  });
});

describe('resolveProvider — model selection (Anthropic)', () => {
  it('default model is claude-opus-4-7 when nothing set', () => {
    const r = resolveProvider('lead_intel', { ...fullCreds, ai_provider: 'anthropic' });
    expect(r.anthropicModel).toBe('claude-opus-4-7');
  });

  it('org-level model preference is respected', () => {
    const r = resolveProvider('lead_intel', { ...fullCreds, ai_provider: 'anthropic', ai_model_anthropic: 'claude-sonnet-4-6' });
    expect(r.anthropicModel).toBe('claude-sonnet-4-6');
  });

  it('per-feature model override beats org-level', () => {
    const r = resolveProvider('reply_drafting', {
      ...fullCreds,
      ai_provider: 'anthropic',
      ai_model_anthropic: 'claude-opus-4-7',
      ai_model_anthropic_reply_drafting: 'claude-haiku-4-5',
    });
    expect(r.anthropicModel).toBe('claude-haiku-4-5');
  });

  it('unknown model throws LlmConfigError', () => {
    expect(() =>
      resolveProvider('lead_intel', { ...fullCreds, ai_provider: 'anthropic', ai_model_anthropic: 'gpt-99' }),
    ).toThrow(LlmConfigError);
  });
});

describe('resolveProvider — config errors', () => {
  it('anthropic selected but no API key → throws', () => {
    expect(() => resolveProvider('lead_intel', { ai_provider: 'anthropic' })).toThrow(/claude_api_key/);
  });

  it('azure_openai selected but missing endpoint → throws', () => {
    expect(() =>
      resolveProvider('lead_intel', { ai_provider: 'azure_openai', azure_openai_api_key: 'sk', azure_openai_deployment: 'gpt-4o' }),
    ).toThrow(/azure_openai_endpoint/);
  });

  it('azure_openai selected but missing deployment → throws', () => {
    expect(() =>
      resolveProvider('lead_intel', { ai_provider: 'azure_openai', azure_openai_endpoint: 'https://x', azure_openai_api_key: 'sk' }),
    ).toThrow(/azure_openai_deployment/);
  });
});

describe('resolveProvider — feature-specific overrides for known features', () => {
  // Cover every feature name to make sure key lookups work for each of them.
  const features = ['lead_agent', 'campaign_review', 'lead_intel', 'reply_drafting', 'reply_classifier', 'email_rating', 'personalization', 'context_engine', 'campaign_planner'] as const;
  for (const f of features) {
    it(`per-feature override works for "${f}"`, () => {
      const settings = { ...fullCreds, ai_provider: 'anthropic', [`ai_provider_${f}`]: 'azure_openai' };
      const r = resolveProvider(f, settings);
      expect(r.provider).toBe('azure_openai');
    });
  }
});
