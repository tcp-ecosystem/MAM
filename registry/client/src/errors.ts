/**
 * MAM Registry Client Errors
 */

/** HTTP status codes that are safe to retry (transient server-side failures) */
export const RETRYABLE_STATUS_CODES: ReadonlySet<number> = new Set([408, 429, 500, 502, 503, 504]);

export interface RegistryErrorOptions {
  /** HTTP status code, if applicable */
  statusCode?: number;
  /** Raw response body */
  body?: unknown;
  /** True when the failure is a network / DNS error */
  isNetworkError?: boolean;
  /** True when the request was aborted because it exceeded its deadline */
  isTimeout?: boolean;
}

export class RegistryError extends Error {
  /** HTTP status code, if applicable */
  readonly statusCode?: number;
  /** Raw response body */
  readonly body?: unknown;
  /** True when the failure is a network / DNS / timeout error */
  readonly isNetworkError: boolean;
  /** True when the request was aborted because it exceeded its deadline */
  readonly isTimeout: boolean;

  constructor(message: string, opts: RegistryErrorOptions = {}) {
    super(message);
    this.name = 'RegistryError';
    this.statusCode = opts.statusCode;
    this.body = opts.body;
    this.isTimeout = opts.isTimeout ?? false;
    // a timeout is a network failure for every consumer that predates `isTimeout`
    this.isNetworkError = opts.isNetworkError ?? this.isTimeout;
  }

  /** Convenience predicate – 401 / 403 */
  get isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }

  /** Convenience predicate – 404 */
  get isNotFound(): boolean {
    return this.statusCode === 404;
  }

  /**
   * Convenience predicate – network failure, timeout or transient status code.
   * Everything else (including a plain programming error) must be thrown at once.
   */
  get isRetryable(): boolean {
    if (this.isNetworkError || this.isTimeout) return true;
    if (this.statusCode === undefined) return false;
    return RETRYABLE_STATUS_CODES.has(this.statusCode);
  }
}

// ============================================================================
// Helpers – so callers never have to guess how an error was produced
// ============================================================================

/**
 * Detect a timeout without relying on `instanceof DOMException`: browsers,
 * Node 18 and polyfills disagree on the concrete class they throw, but all of
 * them report `name === 'TimeoutError'` (and/or leave the signal aborted).
 */
export function isTimeoutError(err: unknown, signal?: AbortSignal | null): boolean {
  if (signal?.aborted) return true;
  if (err instanceof RegistryError) return err.isTimeout;
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { name?: unknown; code?: unknown };
  return e.name === 'TimeoutError' || e.code === 'ETIMEDOUT' || e.code === 23;
}

/** True when the error is worth another attempt. */
export function isRetryableError(err: unknown): boolean {
  return toRegistryError(err).isRetryable;
}

/**
 * Normalise anything thrown into a `RegistryError`.
 * Existing `RegistryError`s pass through untouched; a non-Error is stringified;
 * timeouts keep their `isTimeout` flag. `context` is prefixed to the message so
 * the failing request is identifiable in logs.
 */
export function toRegistryError(err: unknown, context?: string): RegistryError {
  if (err instanceof RegistryError) return err;
  const prefix = context ? `${context}: ` : '';
  if (isTimeoutError(err)) {
    return new RegistryError(`${prefix}Request timed out`, { isTimeout: true });
  }
  const message = err instanceof Error ? err.message : String(err);
  return new RegistryError(`${prefix}${message}`);
}
