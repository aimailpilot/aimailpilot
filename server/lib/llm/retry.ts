/**
 * Anthropic API retry / fallback decision logic.
 *
 * Pure function — given an error from a Claude API call, decides whether the
 * caller should retry (and how), fall back to a schema-less call, or surface
 * the error.
 *
 * Why a separate module: the actual API call lives in providers/anthropic.ts
 * and is hard to unit-test (live SDK). The decision tree is small and
 * dense — easier to reason about as a pure function. Tests live in
 * tests/unit/llm-retry.test.ts.
 *
 * The two transient error classes we observed in production:
 *
 *   1. 529 / 503 + overloaded_error
 *      Anthropic's general overload. Retry with backoff.
 *
 *   2. 503 + overloaded_error + "Grammar compilation is temporarily unavailable"
 *      Specific failure of the JSON-schema grammar compiler. Retry once;
 *      if still failing, drop output_config.format and retry without
 *      structured-output enforcement. Caller's normalizeLeads / parse path
 *      already handles non-strict JSON gracefully.
 *
 *   3. 429 rate_limit_error
 *      Standard rate limit. Retry with backoff.
 */

export type RetryAction =
  | { kind: 'retry_same'; backoffMs: number }       // same request, after backoff
  | { kind: 'retry_no_schema'; backoffMs: number }  // strip jsonSchema, after backoff
  | { kind: 'fatal' };                              // give up, surface error

export interface ErrorContext {
  /** Number of attempts already made (1-indexed, so first retry sees attempt=1). */
  attempt: number;
  /** Whether the original request had a JSON schema attached. */
  hasJsonSchema: boolean;
  /** How many same-request retries we permit before fall-back. */
  maxRetries?: number;
}

const DEFAULT_MAX_RETRIES = 3;

interface NormalizedError {
  status: number;
  message: string;
  errorType?: string;
}

/**
 * Normalize the various shapes of Anthropic SDK errors into a flat record.
 * Handles thrown SDK errors, plain Error objects, and parsed-message strings.
 */
export function normalizeAnthropicError(err: any): NormalizedError {
  if (!err) return { status: 500, message: 'Unknown error' };
  const status = Number(err.status || err.statusCode || 0) || 500;
  let message = '';
  if (typeof err.message === 'string') message = err.message;
  else if (typeof err === 'string') message = err;
  else { try { message = JSON.stringify(err); } catch { message = String(err); } }

  // Try to extract Anthropic's structured error.type from the message body —
  // SDK errors include the JSON response in `.message`. Cheap regex is fine.
  const typeMatch = message.match(/"type"\s*:\s*"([a-z_]+)"/);
  // Skip the outer "type":"error" wrapper — we want the inner error.type.
  const errorType = typeMatch ? typeMatch[typeMatch.index === message.indexOf('"type"') ? 1 : 1] : undefined;
  // Better: look for "error":{"type":"X"} specifically.
  const innerMatch = message.match(/"error"\s*:\s*\{\s*"type"\s*:\s*"([a-z_]+)"/);
  return { status, message, errorType: innerMatch ? innerMatch[1] : errorType };
}

export function classifyAnthropicError(err: any, ctx: ErrorContext): RetryAction {
  // Abort triggered by caller (user-cancelled job, request timeout etc.) —
  // never retry, surface immediately.
  if (err?.name === 'AbortError' || /aborted/i.test(err?.message || '')) {
    return { kind: 'fatal' };
  }

  const e = normalizeAnthropicError(err);
  const maxRetries = ctx.maxRetries ?? DEFAULT_MAX_RETRIES;
  const isGrammarCompilation = /grammar compilation/i.test(e.message);
  const isOverloaded = e.errorType === 'overloaded_error' || e.status === 503 || e.status === 529;
  const isRateLimit = e.errorType === 'rate_limit_error' || e.status === 429;

  // Grammar compiler unavailable → after 1 retry, fall back to schema-less call.
  // This is the case the production lead-agent search hit.
  if (isGrammarCompilation && ctx.hasJsonSchema) {
    if (ctx.attempt < 2) {
      return { kind: 'retry_same', backoffMs: backoffFor(ctx.attempt) };
    }
    return { kind: 'retry_no_schema', backoffMs: backoffFor(ctx.attempt) };
  }

  // General overload or rate-limit → exponential backoff, up to maxRetries.
  if (isOverloaded || isRateLimit) {
    if (ctx.attempt < maxRetries) {
      return { kind: 'retry_same', backoffMs: backoffFor(ctx.attempt) };
    }
    return { kind: 'fatal' };
  }

  // Anything else (auth, bad request, model errors) — don't retry.
  return { kind: 'fatal' };
}

/**
 * Exponential backoff with jitter: 1s, 2s, 4s, 8s, capped at 16s.
 * `attempt` is 1-indexed (first failure → 1s).
 */
export function backoffFor(attempt: number): number {
  const base = Math.min(16000, 1000 * Math.pow(2, Math.max(0, attempt - 1)));
  // ±20% jitter so concurrent callers don't lockstep
  const jitter = base * (Math.random() * 0.4 - 0.2);
  return Math.round(base + jitter);
}
