/**
 * Tests for server/lib/llm/retry.ts — pure error classification + backoff.
 *
 * Covers the cases observed in production:
 *   - 503 overloaded_error → retry same request (up to maxRetries)
 *   - 503 with "Grammar compilation is temporarily unavailable" → retry once,
 *     then strip jsonSchema and retry one more time
 *   - 429 rate_limit_error → retry same request
 *   - 401/400/etc → fatal, no retry
 *
 * Backoff invariant: monotonically increasing base, with bounded jitter.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyAnthropicError,
  normalizeAnthropicError,
  backoffFor,
} from '../../server/lib/llm/retry';

// Real-world error string from the Lead Agent failure (request_id sanitized).
const GRAMMAR_ERROR_503 = `Anthropic API error: 503 {"type":"error","error":{"type":"overloaded_error","message":"Grammar compilation is temporarily unavailable. Please try again."},"request_id":"req_X"}`;

// Generic overload — Anthropic's standard "service is busy" shape.
const OVERLOAD_ERROR_503 = { status: 503, message: `503 {"type":"error","error":{"type":"overloaded_error","message":"Service temporarily unavailable"}}` };
const OVERLOAD_ERROR_529 = { status: 529, message: `529 overloaded` };

const RATE_LIMIT_429 = { status: 429, message: `429 {"type":"error","error":{"type":"rate_limit_error","message":"Too many requests"}}` };

const AUTH_401 = { status: 401, message: `401 {"type":"error","error":{"type":"authentication_error","message":"Invalid API key"}}` };
const BAD_REQUEST_400 = { status: 400, message: `400 {"type":"error","error":{"type":"invalid_request_error","message":"messages required"}}` };

describe('normalizeAnthropicError', () => {
  it('extracts status and inner error.type from a typical SDK error', () => {
    const r = normalizeAnthropicError(OVERLOAD_ERROR_503);
    expect(r.status).toBe(503);
    expect(r.errorType).toBe('overloaded_error');
  });

  it('handles a plain string error gracefully', () => {
    const r = normalizeAnthropicError('boom');
    expect(r.status).toBe(500);
    expect(r.message).toBe('boom');
  });

  it('handles null/undefined', () => {
    expect(normalizeAnthropicError(null).status).toBe(500);
    expect(normalizeAnthropicError(undefined).status).toBe(500);
  });

  it('extracts inner error.type when message has the SDK JSON shape', () => {
    const r = normalizeAnthropicError({ status: 429, message: RATE_LIMIT_429.message });
    expect(r.errorType).toBe('rate_limit_error');
  });
});

describe('classifyAnthropicError — grammar compilation 503', () => {
  const err = { status: 503, message: GRAMMAR_ERROR_503 };

  it('attempt 1 with jsonSchema → retry_same (give the compiler one more shot)', () => {
    const r = classifyAnthropicError(err, { attempt: 1, hasJsonSchema: true });
    expect(r.kind).toBe('retry_same');
    if (r.kind === 'retry_same') expect(r.backoffMs).toBeGreaterThan(0);
  });

  it('attempt 2 with jsonSchema → retry_no_schema (drop schema, rely on system prompt)', () => {
    const r = classifyAnthropicError(err, { attempt: 2, hasJsonSchema: true });
    expect(r.kind).toBe('retry_no_schema');
  });

  it('attempt 3 with jsonSchema → still retry_no_schema (only one no-schema attempt is meaningful)', () => {
    const r = classifyAnthropicError(err, { attempt: 3, hasJsonSchema: true });
    expect(r.kind).toBe('retry_no_schema');
  });

  it('without jsonSchema → not a grammar problem; treat as overload', () => {
    const r = classifyAnthropicError(err, { attempt: 1, hasJsonSchema: false });
    expect(r.kind).toBe('retry_same');
  });
});

describe('classifyAnthropicError — generic overload', () => {
  it('503 overloaded → retry_same on early attempts', () => {
    expect(classifyAnthropicError(OVERLOAD_ERROR_503, { attempt: 1, hasJsonSchema: false }).kind).toBe('retry_same');
    expect(classifyAnthropicError(OVERLOAD_ERROR_503, { attempt: 2, hasJsonSchema: false }).kind).toBe('retry_same');
  });

  it('529 overloaded → retry_same', () => {
    expect(classifyAnthropicError(OVERLOAD_ERROR_529, { attempt: 1, hasJsonSchema: false }).kind).toBe('retry_same');
  });

  it('after maxRetries exhausted → fatal', () => {
    const r = classifyAnthropicError(OVERLOAD_ERROR_503, { attempt: 3, hasJsonSchema: false, maxRetries: 3 });
    expect(r.kind).toBe('fatal');
  });
});

describe('classifyAnthropicError — rate limit', () => {
  it('429 rate_limit_error → retry_same', () => {
    expect(classifyAnthropicError(RATE_LIMIT_429, { attempt: 1, hasJsonSchema: false }).kind).toBe('retry_same');
  });

  it('429 exhausted → fatal', () => {
    const r = classifyAnthropicError(RATE_LIMIT_429, { attempt: 5, hasJsonSchema: false, maxRetries: 3 });
    expect(r.kind).toBe('fatal');
  });
});

describe('classifyAnthropicError — non-retryable', () => {
  it('401 auth → fatal immediately', () => {
    expect(classifyAnthropicError(AUTH_401, { attempt: 1, hasJsonSchema: false }).kind).toBe('fatal');
  });

  it('400 invalid request → fatal immediately', () => {
    expect(classifyAnthropicError(BAD_REQUEST_400, { attempt: 1, hasJsonSchema: false }).kind).toBe('fatal');
  });

  it('500 with no recognizable error type → fatal', () => {
    const r = classifyAnthropicError({ status: 500, message: 'boom' }, { attempt: 1, hasJsonSchema: true });
    expect(r.kind).toBe('fatal');
  });
});

describe('backoffFor', () => {
  it('grows monotonically up to the cap', () => {
    // Average over many calls to defeat jitter
    const avg = (n: number) => {
      let sum = 0;
      for (let i = 0; i < 50; i++) sum += backoffFor(n);
      return sum / 50;
    };
    expect(avg(1)).toBeLessThan(avg(2));
    expect(avg(2)).toBeLessThan(avg(3));
    expect(avg(3)).toBeLessThan(avg(4));
  });

  it('caps at 16 seconds (with jitter)', () => {
    for (let i = 0; i < 50; i++) {
      const r = backoffFor(10);
      expect(r).toBeLessThanOrEqual(16000 * 1.21); // 20% jitter ceiling, +1ms rounding
    }
  });

  it('first attempt is around 1 second', () => {
    let sum = 0;
    for (let i = 0; i < 100; i++) sum += backoffFor(1);
    const avg = sum / 100;
    expect(avg).toBeGreaterThan(700);
    expect(avg).toBeLessThan(1300);
  });
});
