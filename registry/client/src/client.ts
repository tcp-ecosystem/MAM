/**
 * MAM Registry Client
 *
 * Production-grade HTTP client for the MAM module registry.
 * Uses native `fetch` – zero external dependencies.
 */

import { RegistryError } from './errors.js';
import { RegistryAuth, type AuthConfig } from './auth.js';

// ============================================================================
// Types
// ============================================================================

export interface RegistryConfig {
  /** Registry base URL, e.g. "https://registry.mam.dev" */
  baseUrl: string;
  /** Request timeout in milliseconds (default 30 000) */
  timeout?: number;
  /** Number of automatic retries for transient failures (default 2) */
  retries?: number;
  /** Delay between retries in ms (default 500, doubled each attempt) */
  retryDelay?: number;
  /** Extra headers appended to every request */
  headers?: Record<string, string>;
  /** Authentication configuration */
  auth?: AuthConfig;
  /** Custom fetch implementation (for testing / Node 18 polyfill) */
  fetch?: typeof globalThis.fetch;
}

export interface ModuleMetadata {
  name: string;
  version: string;
  description?: string;
  author?: string;
  tags?: string[];
  downloads?: number;
  publishedAt?: string;
}

export interface ModuleRecord extends ModuleMetadata {
  latest: string;
  createdAt: string;
  updatedAt: string;
  versions: Record<string, unknown>;
}

export interface VersionInfo {
  version: string;
  manifest?: unknown;
  tarball?: string;
  integrity?: string;
  publishedAt?: string;
  publishedBy?: string;
}

export interface ModuleDependency {
  name: string;
  version: string;
  optional?: boolean;
}

export interface ModuleStats {
  name: string;
  downloads: number;
  dependents?: number;
  lastUpdated?: string;
}

export interface SearchQuery {
  /** Free-text search term */
  q: string;
  /** Filter by tag */
  tag?: string;
  /** Filter by author */
  author?: string;
  /** Sort field */
  sort?: 'relevance' | 'downloads' | 'updated' | 'name';
  /** Page number (1-based) */
  page?: number;
  /** Results per page */
  limit?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface PublishModuleInput {
  name: string;
  version: string;
  description?: string;
  author?: string;
  tags?: string[];
  files: Record<string, string>;
}

export interface RequestInterceptor {
  (config: RequestInit & { url: string }): RequestInit & { url: string } | Promise<RequestInit & { url: string }>;
}

export interface ResponseInterceptor {
  (response: Response): Response | Promise<Response>;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_DELAY = 500;
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

// ============================================================================
// RegistryClient
// ============================================================================

export class RegistryClient {
  private config: Required<Pick<RegistryConfig, 'timeout' | 'retries' | 'retryDelay'>> &
    Omit<RegistryConfig, 'timeout' | 'retries' | 'retryDelay'>;
  private auth: RegistryAuth | null;
  private _fetch: typeof globalThis.fetch;
  private requestInterceptors: RequestInterceptor[] = [];
  private responseInterceptors: ResponseInterceptor[] = [];

  constructor(config: RegistryConfig) {
    this.config = {
      timeout: config.timeout ?? DEFAULT_TIMEOUT,
      retries: config.retries ?? DEFAULT_RETRIES,
      retryDelay: config.retryDelay ?? DEFAULT_RETRY_DELAY,
      ...config,
    };
    this._fetch = config.fetch ?? globalThis.fetch;

    if (config.auth) {
      this.auth = new RegistryAuth({
        ...config.auth,
        baseUrl: config.baseUrl,
        fetch: this._fetch,
      });
    } else {
      this.auth = null;
    }
  }

  // -------------------------------------------------------------------------
  // Interceptors
  // -------------------------------------------------------------------------

  addRequestInterceptor(interceptor: RequestInterceptor): void {
    this.requestInterceptors.push(interceptor);
  }

  addResponseInterceptor(interceptor: ResponseInterceptor): void {
    this.responseInterceptors.push(interceptor);
  }

  // -------------------------------------------------------------------------
  // Auth helpers
  // -------------------------------------------------------------------------

  /**
   * Wire up an auth instance after construction.
   */
  setAuth(auth: RegistryAuth): void {
    this.auth = auth;
  }

  /**
   * Convenience: set a static auth token on the underlying auth module.
   */
  setAuthToken(token: string): void {
    if (!this.auth) {
      this.auth = new RegistryAuth({
        baseUrl: this.config.baseUrl,
        token,
        fetch: this._fetch,
      });
    } else {
      this.auth.setToken(token);
    }
  }

  /**
   * Remove any stored authentication state.
   */
  clearAuthToken(): void {
    this.auth?.clearTokens();
  }

  // -------------------------------------------------------------------------
  // Module operations
  // -------------------------------------------------------------------------

  /**
   * GET /modules/:name
   */
  async getModule(name: string): Promise<ModuleRecord> {
    return this.request<ModuleRecord>('GET', `/modules/${enc(name)}`);
  }

  /**
   * GET /modules – list modules with optional filtering
   */
  async listModules(
    query?: { tag?: string; author?: string; page?: number; limit?: number },
  ): Promise<PaginatedResponse<ModuleRecord>> {
    const params = this.toQueryParams(query);
    return this.request<PaginatedResponse<ModuleRecord>>('GET', `/modules${params}`);
  }

  /**
   * POST /modules – publish a new module or new version
   */
  async publishModule(input: PublishModuleInput): Promise<{ name: string; version: string; url: string }> {
    return this.request('POST', '/modules', input);
  }

  /**
   * DELETE /modules/:name
   */
  async deleteModule(name: string): Promise<void> {
    await this.request<void>('DELETE', `/modules/${enc(name)}`);
  }

  /**
   * GET /modules/:name/versions – list all published versions
   */
  async getVersions(name: string): Promise<string[]> {
    return this.request<string[]>('GET', `/modules/${enc(name)}/versions`);
  }

  /**
   * GET /modules/:name/versions/:version
   */
  async getVersion(name: string, version: string): Promise<VersionInfo> {
    return this.request<VersionInfo>(
      'GET',
      `/modules/${enc(name)}/versions/${enc(version)}`,
    );
  }

  /**
   * GET /modules/search?q=...
   */
  async searchModules(query: SearchQuery): Promise<PaginatedResponse<ModuleMetadata>> {
    const params = this.toQueryParams({
      q: query.q,
      tag: query.tag,
      author: query.author,
      sort: query.sort,
      page: query.page,
      limit: query.limit,
    });
    return this.request<PaginatedResponse<ModuleMetadata>>('GET', `/modules/search${params}`);
  }

  /**
   * GET /modules/:name/dependencies
   */
  async getModuleDependencies(name: string): Promise<ModuleDependency[]> {
    return this.request<ModuleDependency[]>('GET', `/modules/${enc(name)}/dependencies`);
  }

  /**
   * GET /modules/:name/download – returns the tarball URL or a redirect
   */
  async downloadModule(name: string, version?: string): Promise<{ url: string }> {
    const vPart = version ? `?version=${enc(version)}` : '';
    return this.request<{ url: string }>('GET', `/modules/${enc(name)}/download${vPart}`);
  }

  /**
   * GET /modules/:name/stats
   */
  async getModuleStats(name: string): Promise<ModuleStats> {
    return this.request<ModuleStats>('GET', `/modules/${enc(name)}/stats`);
  }

  // -------------------------------------------------------------------------
  // Core request engine
  // -------------------------------------------------------------------------

  /**
   * Low-level request method with retry, timeout, auth and interceptor support.
   */
  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let lastError: RegistryError | null = null;

    for (let attempt = 0; attempt <= this.config.retries; attempt++) {
      try {
        return await this.doRequest<T>(method, path, body);
      } catch (err) {
        lastError = err instanceof RegistryError ? err : new RegistryError(String(err));

        // don't retry on non-retryable errors
        if (
          !lastError.isNetworkError &&
          lastError.statusCode !== undefined &&
          !RETRYABLE_STATUS_CODES.has(lastError.statusCode)
        ) {
          throw lastError;
        }

        // don't retry on final attempt
        if (attempt === this.config.retries) {
          throw lastError;
        }

        await this.delay(this.config.retryDelay * Math.pow(2, attempt));
      }
    }

    // unreachable – TypeScript needs the null check
    throw lastError ?? new RegistryError('Request failed');
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async doRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.config.baseUrl.replace(/\/+$/, '')}${path}`;

    let init: RequestInit & { url: string } = {
      url,
      method,
      headers: { ...this.config.headers },
      signal: AbortSignal.timeout(this.config.timeout),
    };

    // attach auth
    if (this.auth) {
      const authHeaders = await this.auth.getAuthHeaders();
      init.headers = { ...init.headers, ...authHeaders };
    }

    // set content-type for bodies
    if (body !== undefined) {
      (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    // run request interceptors
    for (const interceptor of this.requestInterceptors) {
      init = await interceptor(init);
    }

    let response: Response;
    try {
      response = await this._fetch(init.url, init);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        throw new RegistryError(`Request to ${path} timed out after ${this.config.timeout}ms`, {
          isNetworkError: true,
        });
      }
      throw new RegistryError(`Network error: ${(err as Error).message}`, {
        isNetworkError: true,
      });
    }

    // run response interceptors
    for (const interceptor of this.responseInterceptors) {
      response = await interceptor(response);
    }

    // parse body
    const text = await response.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!response.ok) {
      const message =
        (parsed as { error?: string } | null)?.error ??
        (parsed as { message?: string } | null)?.message ??
        `Request failed with status ${response.status}`;
      throw new RegistryError(message, {
        statusCode: response.status,
        body: parsed,
      });
    }

    return parsed as T;
  }

  private toQueryParams(obj?: Record<string, unknown>): string {
    if (!obj) return '';
    const entries = Object.entries(obj).filter(
      ([, v]) => v !== undefined && v !== null && v !== '',
    );
    if (entries.length === 0) return '';
    const qs = entries
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    return `?${qs}`;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Helpers
// ============================================================================

/** Percent-encode a path segment */
function enc(s: string): string {
  return encodeURIComponent(s);
}
