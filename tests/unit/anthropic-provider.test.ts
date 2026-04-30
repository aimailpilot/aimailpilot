/**
 * Integration test for the Anthropic provider's retry / schema-strip fallback.
 *
 * Mocks the @anthropic-ai/sdk module so we can simulate Anthropic returning
 * the exact 503 + "Grammar compilation is temporarily unavailable" error and
 * verify the provider:
 *   1. retries the same request once (first attempt failed)
 *   2. on a second failure, retries WITHOUT output_config (schema stripped)
 *   3. parses the schema-less response normally
 *
 * Without this test we'd only have verified the pure decision tree
 * (llm-retry.test.ts) — this confirms the wiring in providers/anthropic.ts
 * correctly consumes that decision and reshapes the request.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture every set of params the SDK was called with — lets us assert the
// fallback removed output_config on the third call.
const sentParams: any[] = [];
let scenario: 'always_grammar' | 'two_then_ok' | 'two_grammar_then_ok_no_schema' | 'always_overload' = 'two_grammar_then_ok_no_schema';

const fakeOk = (text: string) => ({
  content: [{ type: 'text', text }],
  usage: { input_tokens: 100, output_tokens: 50 },
});

const grammar503 = () => {
  const err: any = new Error(
    'Anthropic API error: 503 {"type":"error","error":{"type":"overloaded_error","message":"Grammar compilation is temporarily unavailable. Please try again."},"request_id":"req_X"}'
  );
  err.status = 503;
  return err;
};

const overload503 = () => {
  const err: any = new Error('503 {"type":"error","error":{"type":"overloaded_error","message":"busy"}}');
  err.status = 503;
  return err;
};

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class {
      messages = {
        create: async (params: any) => {
          sentParams.push(JSON.parse(JSON.stringify(params)));
          if (scenario === 'always_grammar') throw grammar503();
          if (scenario === 'always_overload') throw overload503();
          if (scenario === 'two_grammar_then_ok_no_schema') {
            // First two calls (with schema) fail with grammar 503; third call
            // (with schema stripped) succeeds.
            if (sentParams.length <= 2) throw grammar503();
            return fakeOk('{"summary":"ok","leads":[{"name":"Alice","company":"Acme"}]}');
          }
          if (scenario === 'two_then_ok') {
            if (sentParams.length <= 2) throw overload503();
            return fakeOk('{"summary":"ok","leads":[]}');
          }
          return fakeOk('{}');
        },
        stream: () => ({
          finalMessage: async () => fakeOk('{}'),
        }),
      };
    },
  };
});

describe('Anthropic provider — retry + schema-strip fallback', () => {
  beforeEach(() => {
    sentParams.length = 0;
  });

  it('drops output_config after a grammar-compilation 503 and succeeds', async () => {
    scenario = 'two_grammar_then_ok_no_schema';
    // Stub setTimeout so backoff completes synchronously
    vi.useFakeTimers();
    const { callAnthropic } = await import('../../server/lib/llm/providers/anthropic');

    const promise = callAnthropic(
      {
        orgId: 'o1',
        feature: 'lead_agent',
        systemPrompt: 'You are an agent. Return JSON.',
        messages: [{ role: 'user', content: 'find leads' }],
        jsonSchema: {
          type: 'object',
          required: ['leads'],
          additionalProperties: false,
          properties: {
            summary: { type: 'string' },
            leads: { type: 'array', items: { type: 'object' } },
          },
        } as any,
        thinking: false,
      },
      'sk-ant-fake',
      'claude-opus-4-7',
    );

    // Drain pending backoff timers
    await vi.runAllTimersAsync();
    const result = await promise;
    vi.useRealTimers();

    expect(sentParams.length).toBe(3);
    // First two attempts include output_config (schema enforcement)
    expect(sentParams[0].output_config).toBeDefined();
    expect(sentParams[1].output_config).toBeDefined();
    // Third attempt — fallback path — output_config stripped
    expect(sentParams[2].output_config).toBeUndefined();
    // System prompt on the fallback call has the schema-fallback suffix appended
    expect(String(sentParams[2].system)).toMatch(/Return ONLY a single valid JSON object/);

    expect(result.content).toContain('Alice');
    expect(result.parsed).toEqual({ summary: 'ok', leads: [{ name: 'Alice', company: 'Acme' }] });
    expect(result.provider).toBe('anthropic');
  });

  it('retries on plain overload 503 without dropping schema, eventually succeeds', async () => {
    scenario = 'two_then_ok';
    vi.useFakeTimers();
    const { callAnthropic } = await import('../../server/lib/llm/providers/anthropic');

    const promise = callAnthropic(
      { orgId: 'o', feature: 'lead_agent', messages: [{ role: 'user', content: 'x' }], jsonSchema: { type: 'object' } as any },
      'k', 'claude-opus-4-7',
    );
    await vi.runAllTimersAsync();
    const r = await promise;
    vi.useRealTimers();

    expect(sentParams.length).toBe(3);
    // All three attempts should have kept output_config (overload is not grammar-specific)
    expect(sentParams[0].output_config).toBeDefined();
    expect(sentParams[1].output_config).toBeDefined();
    expect(sentParams[2].output_config).toBeDefined();
    expect(r.provider).toBe('anthropic');
  });

  it('eventually surfaces a fatal error when overload persists past max retries', async () => {
    scenario = 'always_overload';
    vi.useFakeTimers();
    const { callAnthropic, LlmProviderError } = await import('../../server/lib/llm/providers/anthropic')
      .then(async (m) => ({ ...m, LlmProviderError: (await import('../../server/lib/llm/types')).LlmProviderError }));

    const promise = callAnthropic(
      { orgId: 'o', feature: 'lead_agent', messages: [{ role: 'user', content: 'x' }] },
      'k', 'claude-opus-4-7',
    ).catch(e => e);
    await vi.runAllTimersAsync();
    const err = await promise;
    vi.useRealTimers();

    // Default MAX_RETRIES=3 → expect 3 attempts before fatal
    expect(sentParams.length).toBe(3);
    expect(err).toBeInstanceOf(LlmProviderError);
    expect(String(err.message)).toMatch(/503|overloaded/);
  });
});
