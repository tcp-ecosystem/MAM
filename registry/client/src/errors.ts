/**
 * MAM Registry Client Errors
 */

export class RegistryError extends Error {
  /** HTTP status code, if applicable */
  readonly statusCode?: number;
  /** Raw response body */
  readonly body?: unknown;
  /** True when the failure is a network / DNS / timeout error */
  readonly isNetworkError: boolean;

  constructor(
    message: string,
    opts: { statusCode?: number; body?: unknown; isNetworkError?: boolean } = {},
  ) {
    super(message);
    this.name = 'RegistryError';
    this.statusCode = opts.statusCode;
    this.body = opts.body;
    this.isNetworkError = opts.isNetworkError ?? false;
  }

  /** Convenience predicate – 401 / 403 */
  get isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }

  /** Convenience predicate – 404 */
  get isNotFound(): boolean {
    return this.statusCode === 404;
  }
}
