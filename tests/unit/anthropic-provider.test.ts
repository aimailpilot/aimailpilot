/**
 * Integration test for the Anthropic provider's retry / schema-strip fallback
 * + streaming-on-web-search + hard-timeout behavior.
 *
 * Mocks the @anthropic-ai/sdk module with a single dispatcher whose behavior
 * is controlled by a top-level state object. Avoids vi.resetModules / doMock /
 * doUnmock interactions which leave the module cache polluted across tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Shared state — every test sets these before triggering callAnthropic.
const state = {
  scenario: 'two_grammar_then_ok_no_schema' as
    | 'always_grammar'
    | 'always_overload'
    | 'two_grammar_then_ok_no_schema'
    | 'two_then_ok'
    | 'hang_forever'
    | 'wait_for_abort'
    | 'ok',
  sentParams: [] as any[],
  sdkOpts: [] as any[],
  createCalls: 0,
  streamCalls: 0,
};

const reset = () => {
  state.scenario = 'two_grammar_then_ok_no_schema';
  state.sentParams = [];
  state.sdkOpts = [];
  state.createCalls = 0;
  state.streamCalls = 0;
};

const fakeOk = (text: string) => ({
  content: [{ type: 'text', text }],
  usage: { input_tokens: 100, output_tokens: 50 },
});

const grammar503 = () => {
  const err: any = new Error(
    'Anthropic API error: 503 {"type":"error","error":{"type":"overloaded_error","message":"Grammar compilation is temporarily unavailable. Please try again."}}',
  );
  err.status = 503;
  return err;
};

const overload503 = () => {
  const err: any = new Error('503 {"type":"error","error":{"type":"overloaded_error","message":"busy"}}');
  err.status = 503;
  return err;
};

async function dispatch(params: any, opts?: any): Promise<any> {
  state.sentParams.push(JSON.parse(JSON.stringify(params)));
  state.sdkOpts.push(opts);
  switch (state.scenario) {
    case 'always_grammar': throw grammar503();
    case 'always_overload': throw overload503();
    case 'two_grammar_then_ok_no_schema':
      if (state.sentParams.length <= 2) throw grammar503();
      return fakeOk('{"summary":"ok","leads":[{"name":"Alice","company":"Acme"}]}');
    case 'two_then_ok':
      if (state.sentParams.length <= 2) throw overload503();
      return fakeOk('{"summary":"ok","leads":[]}');
    case 'hang_forever':
      return new Promise(() => {}); // never resolves
    case 'wait_for_abort':
      // Reject with AbortError when the caller's signal fires.
      return new Promise((_, reject) => {
        const sig: AbortSignal | undefined = opts?.signal;
        if (sig?.aborted) {
          const err: any = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
          return;
        }
        sig?.addEventListener('abort', () => {
          const err: any = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    case 'ok':
    default:
      return fakeOk('{}');
  }
}

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      create: (params: any, opts?: any) => { state.createCalls++; return dispatch(params, opts); },
      stream: (params: any, opts?: any) => {
        state.streamCalls++;
        return { finalMessage: () => dispatch(params, opts) };
      },
    };
  },
}));

// Import AFTER vi.mock (top-level mocks are hoisted, but this is the canonical order).
const importProvider = async () => (await import('../../server/lib/llm/providers/anthropic')).callAnthropic;
const importErrorClass = async () => (await import('../../server/lib/llm/types')).LlmProviderError;

describe('Anthropic provider — schema-strip fallback', () => {
  beforeEach(reset);

  it('drops output_config after a grammar-compilation 503 and succeeds', async () => {
    state.scenario = 'two_grammar_then_ok_no_schema';
    const callAnthropic = await importProvider();
    vi.useFakeTimers();
    const promise = callAnthropic(
      {
        orgId: 'o1',
        feature: 'lead_agent',
        systemPrompt: 'You are an agent. Return JSON.',
        messages: [{ role: 'user', content: 'find leads' }],
        jsonSchema: { type: 'object', properties: {} } as any,
      },
      'k',
      'claude-opus-4-7',
    );
    await vi.runAllTimersAsync();
    const result = await promise;
    vi.useRealTimers();

    expect(state.sentParams.length).toBe(3);
    expect(state.sentParams[0].output_config).toBeDefined();
    expect(state.sentParams[1].output_config).toBeDefined();
    expect(state.sentParams[2].output_config).toBeUndefined();
    expect(String(state.sentParams[2].system)).toMatch(/Return ONLY a single valid JSON object/);
    expect(result.parsed).toEqual({ summary: 'ok', leads: [{ name: 'Alice', company: 'Acme' }] });
  });
});

describe('Anthropic provider — generic retry', () => {
  beforeEach(reset);

  it('retries on plain overload 503 without dropping schema, eventually succeeds', async () => {
    state.scenario = 'two_then_ok';
    const callAnthropic = await importProvider();
    vi.useFakeTimers();
    const promise = callAnthropic(
      { orgId: 'o', feature: 'lead_agent', messages: [{ role: 'user', content: 'x' }], jsonSchema: { type: 'object' } as any },
      'k',
      'claude-opus-4-7',
    );
    await vi.runAllTimersAsync();
    const r = await promise;
    vi.useRealTimers();

    expect(state.sentParams.length).toBe(3);
    expect(state.sentParams[0].output_config).toBeDefined();
    expect(state.sentParams[1].output_config).toBeDefined();
    expect(state.sentParams[2].output_config).toBeDefined();
    expect(r.provider).toBe('anthropic');
  });

  it('eventually surfaces a fatal error when overload persists past max retries', async () => {
    state.scenario = 'always_overload';
    const callAnthropic = await importProvider();
    const LlmProviderError = await importErrorClass();
    vi.useFakeTimers();
    const promise = callAnthropic(
      { orgId: 'o', feature: 'lead_agent', messages: [{ role: 'user', content: 'x' }] },
      'k',
      'claude-opus-4-7',
    ).catch(e => e);
    await vi.runAllTimersAsync();
    const err = await promise;
    vi.useRealTimers();

    expect(state.sentParams.length).toBe(3);
    expect(err).toBeInstanceOf(LlmProviderError);
    expect(String(err.message)).toMatch(/503|overloaded/);
  });
});

describe('Anthropic provider — streaming + timeout', () => {
  beforeEach(reset);

  it('uses streaming when webSearch=true (avoids HTTP timeout on long calls)', async () => {
    state.scenario = 'two_then_ok';
    const callAnthropic = await importProvider();
    vi.useFakeTimers();
    const promise = callAnthropic(
      { orgId: 'o', feature: 'lead_agent', messages: [{ role: 'user', content: 'x' }], webSearch: true },
      'k',
      'claude-opus-4-7',
    );
    await vi.runAllTimersAsync();
    await promise;
    vi.useRealTimers();

    expect(state.streamCalls).toBe(3);
    expect(state.createCalls).toBe(0);
  });

  it('uses non-streaming for ordinary calls (no webSearch, default max_tokens)', async () => {
    state.scenario = 'ok';
    const callAnthropic = await importProvider();
    await callAnthropic(
      { orgId: 'o', feature: 'lead_agent', messages: [{ role: 'user', content: 'x' }] },
      'k',
      'claude-opus-4-7',
    );

    expect(state.createCalls).toBe(1);
    expect(state.streamCalls).toBe(0);
  });

  it('passes abort signal to SDK and surfaces AbortError as fatal (no retry)', async () => {
    state.scenario = 'wait_for_abort';
    const callAnthropic = await importProvider();
    const LlmProviderError = await importErrorClass();

    const controller = new AbortController();
    const promise = callAnthropic(
      { orgId: 'o', feature: 'lead_agent', messages: [{ role: 'user', content: 'x' }], abortSignal: controller.signal },
      'k',
      'claude-opus-4-7',
    ).catch(e => e);

    // Fire abort on the next tick — dispatch is already awaiting the signal
    setTimeout(() => controller.abort(), 5);
    const err = await promise;

    // SDK was called with { signal: ... }
    expect(state.sdkOpts[0]?.signal).toBeDefined();
    // Only ONE call attempted — abort was classified as fatal
    expect(state.sentParams.length).toBe(1);
    // Result is a fatal LlmProviderError (no retry storm)
    expect(err).toBeInstanceOf(LlmProviderError);
    expect(String(err.message).toLowerCase()).toMatch(/abort/);
  });

  it('short-circuits before SDK call when abortSignal is already aborted', async () => {
    state.scenario = 'ok';
    const callAnthropic = await importProvider();
    const LlmProviderError = await importErrorClass();

    const controller = new AbortController();
    controller.abort(); // already aborted before the call

    const err = await callAnthropic(
      { orgId: 'o', feature: 'lead_agent', messages: [{ role: 'user', content: 'x' }], abortSignal: controller.signal },
      'k',
      'claude-opus-4-7',
    ).catch(e => e);

    // SDK should never have been called
    expect(state.sentParams.length).toBe(0);
    expect(err).toBeInstanceOf(LlmProviderError);
  });

  it('hard timeout fires when a single attempt hangs longer than 4 minutes', async () => {
    state.scenario = 'hang_forever';
    const callAnthropic = await importProvider();
    const LlmProviderError = await importErrorClass();
    vi.useFakeTimers();
    const promise = callAnthropic(
      { orgId: 'o', feature: 'lead_agent', messages: [{ role: 'user', content: 'x' }] },
      'k',
      'claude-opus-4-7',
    ).catch(e => e);
    // Burn enough virtual time to exhaust 3 timeout attempts + their backoffs
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    const err = await promise;
    vi.useRealTimers();

    // 504 timeouts are NOT classified as retryable — first hang trips fatal.
    // sentParams was incremented inside dispatch but the timeout cuts the call
    // before we can record more, so we expect at least one entry.
    expect(state.sentParams.length).toBeGreaterThanOrEqual(1);
    expect(err).toBeInstanceOf(LlmProviderError);
    expect(String(err.message)).toMatch(/timeout|exceeded/i);
  });
});
