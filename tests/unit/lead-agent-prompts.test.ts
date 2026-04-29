/**
 * Tests for server/lib/lead-agent-prompts.ts
 *
 * Covers:
 *   - resolveSearchParams: defaults + clamps
 *   - buildPromptForMode: each mode produces sane output
 *   - LEAD_RESULT_SCHEMA: shape sanity-check
 */

import { describe, it, expect } from 'vitest';
import {
  resolveSearchParams,
  buildPromptForMode,
  LEAD_RESULT_SCHEMA,
} from '../../server/lib/lead-agent-prompts';

describe('resolveSearchParams', () => {
  it('applies defaults when params is empty', () => {
    const r = resolveSearchParams();
    expect(r.region).toBe('India');
    expect(r.daysBack).toBe(30);
    expect(r.industry).toBe('');
    expect(r.titles).toEqual([]);
    expect(r.maxResults).toBe(25);
    expect(r.customPrompt).toBe('');
    expect(r.customWebSearch).toBe(true);
  });

  it('clamps daysBack into [7, 365]', () => {
    expect(resolveSearchParams({ daysBack: 0 }).daysBack).toBe(7);
    expect(resolveSearchParams({ daysBack: 5 }).daysBack).toBe(7);
    expect(resolveSearchParams({ daysBack: 1000 }).daysBack).toBe(365);
    expect(resolveSearchParams({ daysBack: 60 }).daysBack).toBe(60);
  });

  it('clamps maxResults into [1, 100]', () => {
    expect(resolveSearchParams({ maxResults: 0 }).maxResults).toBe(1);
    expect(resolveSearchParams({ maxResults: 500 }).maxResults).toBe(100);
    expect(resolveSearchParams({ maxResults: 50 }).maxResults).toBe(50);
  });

  it('treats non-finite numeric inputs as defaults', () => {
    expect(resolveSearchParams({ daysBack: NaN }).daysBack).toBe(30);
    expect(resolveSearchParams({ maxResults: 'abc' as any }).maxResults).toBe(25);
  });

  it('trims region/industry/titles strings and caps titles at 20', () => {
    const r = resolveSearchParams({
      region: '  USA  ',
      industry: '  fintech ',
      titles: ['  CEO ', '', '  CFO ', ...Array.from({ length: 30 }, (_, i) => `Role${i}`)],
    });
    expect(r.region).toBe('USA');
    expect(r.industry).toBe('fintech');
    expect(r.titles[0]).toBe('CEO');
    expect(r.titles[1]).toBe('CFO');
    expect(r.titles.length).toBe(20);
  });

  it('respects customWebSearch=false explicitly', () => {
    expect(resolveSearchParams({ customWebSearch: false }).customWebSearch).toBe(false);
    expect(resolveSearchParams({ customWebSearch: true }).customWebSearch).toBe(true);
  });
});

describe('buildPromptForMode — funded', () => {
  const params = resolveSearchParams({ region: 'USA', daysBack: 14, industry: 'SaaS', maxResults: 10 });
  const r = buildPromptForMode('funded', params);

  it('mentions all search criteria in the user message', () => {
    expect(r.userMessage).toContain('USA');
    expect(r.userMessage).toContain('14 days');
    expect(r.userMessage).toContain('SaaS');
    expect(r.userMessage).toContain('10');
    expect(r.userMessage.toLowerCase()).toContain('funding');
  });

  it('requires web search', () => {
    expect(r.needsWebSearch).toBe(true);
  });

  it('system prompt emphasizes structured JSON output', () => {
    expect(r.systemPrompt).toMatch(/JSON/);
  });
});

describe('buildPromptForMode — cxo_changes', () => {
  it('uses default title list when none provided', () => {
    const params = resolveSearchParams({});
    const r = buildPromptForMode('cxo_changes', params);
    expect(r.userMessage).toContain('CEO');
    expect(r.userMessage).toContain('CTO');
    expect(r.needsWebSearch).toBe(true);
  });

  it('uses custom titles when provided', () => {
    const params = resolveSearchParams({ titles: ['Head of Revenue', 'Chief AI Officer'] });
    const r = buildPromptForMode('cxo_changes', params);
    expect(r.userMessage).toContain('Head of Revenue');
    expect(r.userMessage).toContain('Chief AI Officer');
    // Default-only roles should not be present when custom titles supplied
    expect(r.userMessage).not.toContain('Chief Revenue Officer');
  });
});

describe('buildPromptForMode — academics', () => {
  it('emphasizes public faculty pages and forbids guessing emails', () => {
    const params = resolveSearchParams({});
    const r = buildPromptForMode('academics', params);
    expect(r.systemPrompt.toLowerCase()).toContain('publicly listed');
    expect(r.systemPrompt.toLowerCase()).toContain('do not guess');
    expect(r.userMessage.toLowerCase()).toContain('faculty');
    expect(r.userMessage.toLowerCase()).toContain('do not guess');
    expect(r.needsWebSearch).toBe(true);
  });

  it('threads industry/department into user message when supplied', () => {
    const params = resolveSearchParams({ industry: 'computer science' });
    const r = buildPromptForMode('academics', params);
    expect(r.userMessage).toContain('computer science');
  });
});

describe('buildPromptForMode — custom', () => {
  it('throws when customPrompt is missing', () => {
    const params = resolveSearchParams({});
    expect(() => buildPromptForMode('custom', params)).toThrow(/customPrompt is required/);
  });

  it('threads customPrompt verbatim', () => {
    const params = resolveSearchParams({ customPrompt: 'Find Indian SaaS founders who tweet about devtools' });
    const r = buildPromptForMode('custom', params);
    expect(r.userMessage).toContain('Find Indian SaaS founders who tweet about devtools');
  });

  it('respects customWebSearch flag', () => {
    const onParams = resolveSearchParams({ customPrompt: 'x', customWebSearch: true });
    expect(buildPromptForMode('custom', onParams).needsWebSearch).toBe(true);

    const offParams = resolveSearchParams({ customPrompt: 'x', customWebSearch: false });
    expect(buildPromptForMode('custom', offParams).needsWebSearch).toBe(false);
  });
});

describe('LEAD_RESULT_SCHEMA', () => {
  it('is a valid object schema with required leads array', () => {
    expect(LEAD_RESULT_SCHEMA.type).toBe('object');
    expect(LEAD_RESULT_SCHEMA.required).toContain('leads');
    expect(LEAD_RESULT_SCHEMA.properties.leads.type).toBe('array');
    expect(LEAD_RESULT_SCHEMA.properties.leads.items.required).toContain('name');
    expect(LEAD_RESULT_SCHEMA.properties.leads.items.required).toContain('company');
  });

  it('declares all the lead fields callers depend on', () => {
    const props = LEAD_RESULT_SCHEMA.properties.leads.items.properties as Record<string, any>;
    expect(props.name).toBeDefined();
    expect(props.title).toBeDefined();
    expect(props.company).toBeDefined();
    expect(props.email).toBeDefined();
    expect(props.signal).toBeDefined();
    expect(props.sourceUrl).toBeDefined();
    expect(props.outreachHook).toBeDefined();
  });

  it('declares contact-mapping fields (phone, location splits, department)', () => {
    const props = LEAD_RESULT_SCHEMA.properties.leads.items.properties as Record<string, any>;
    expect(props.firstName).toBeDefined();
    expect(props.lastName).toBeDefined();
    expect(props.phone).toBeDefined();
    expect(props.mobilePhone).toBeDefined();
    expect(props.city).toBeDefined();
    expect(props.state).toBeDefined();
    expect(props.country).toBeDefined();
    expect(props.department).toBeDefined();
    expect(props.seniority).toBeDefined();
  });
});

describe('buildPromptForMode — funded returns one lead per person', () => {
  it('asks for one lead per founder, not per company', () => {
    const params = resolveSearchParams({});
    const r = buildPromptForMode('funded', params);
    expect(r.userMessage.toLowerCase()).toContain('one lead per person');
  });
});
