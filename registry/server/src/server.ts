/**
 * MAM Registry Server
 *
 * Handler class for the MAM module registry.
 *
 * There is no HTTP framework here. A host mounts these handlers on whatever
 * server it likes and passes in the request identity, so the class owns the
 * parts a framework would not: keeping the search index in step with the
 * store, and enforcing the limits declared in the config.
 */

import { ModuleStore } from './store.js';
import { AuthManager, type AuthManagerOptions, type UserInfo } from './auth.js';
import {
  SearchEngine,
  compareModulesBySort,
  normalizeSearchLimit,
  normalizeSearchOffset,
  type SearchSort,
} from './search.js';

// ============================================================================
// Types
// ============================================================================

/** Where the server reports lifecycle and indexing events. */
export interface RegistryLogger {
  info(message: string, ...details: unknown[]): void;
  error(message: string, ...details: unknown[]): void;
}

const consoleLogger: RegistryLogger = {
  info: (message, ...details) => console.log(message, ...details),
  error: (message, ...details) => console.error(message, ...details),
};

const DEFAULT_CORS_METHODS = 'GET, POST, PUT, DELETE, OPTIONS';
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;

export interface RegistryServerConfig {
  /** Server port */
  port: number;
  /** Data directory */
  dataDir: string;
  /** Authentication required. When true, every handler except login and
   *  register requires a valid token. */
  authRequired: boolean;
  /** Rate limit requests per window, per token or client. Zero or less
   *  disables rate limiting. */
  rateLimit: number;
  /** Maximum upload size in bytes. Zero or less disables the check. */
  maxUploadSize: number;
  /** CORS origins. `*` allows any origin. */
  corsOrigins: string[];
  /** Auth manager tuning: bootstrap admin, token lifetime, lockout. */
  auth?: AuthManagerOptions;
  /** Where lifecycle and indexing events go. Defaults to the console. */
  logger?: RegistryLogger;
  /** Length of the rate limit window in ms. Defaults to 60 seconds. */
  rateLimitWindowMs?: number;
}

/** Request identity a host passes in, since there is no HTTP layer here. */
export interface HandlerRequest {
  /** Bearer token, when the caller supplied one. */
  token?: string;
  /** Caller IP or other client key, used for rate limiting. */
  clientId?: string;
}

export interface SearchOptions extends HandlerRequest {
  limit?: number;
  offset?: number;
  sort?: SearchSort;
  tags?: string[];
  author?: string;
  /** Include archived modules. Defaults to false. */
  includeArchived?: boolean;
}

export interface ListModulesOptions extends HandlerRequest {
  /** Free text matched against name, description and tags. */
  query?: string;
  tags?: string[];
  author?: string;
  sort?: SearchSort;
  limit?: number;
  offset?: number;
  /** Include archived modules. Defaults to false. */
  includeArchived?: boolean;
}

export interface ArchiveOptions extends HandlerRequest {
  /** True to archive, false to unarchive. Defaults to true. */
  archived?: boolean;
}

export interface CorsResponse {
  status: number;
  headers: Record<string, string>;
}

export interface ApiResponse<T = unknown> {
  /** Whether request succeeded */
  success: boolean;
  /** Response data */
  data?: T;
  /** Error message */
  error?: string;
  /** Metadata */
  meta?: {
    total?: number;
    page?: number;
    limit?: number;
    offset?: number;
  };
}

// ============================================================================
// Registry Server
// ============================================================================

export class RegistryServer {
  private config: RegistryServerConfig;
  private store: ModuleStore;
  private auth: AuthManager;
  private search: SearchEngine;
  private logger: RegistryLogger;
  private rateLimitHits: Map<string, number[]> = new Map();

  constructor(config: RegistryServerConfig) {
    this.config = config;
    this.store = new ModuleStore(config.dataDir);
    this.auth = new AuthManager(config.auth ?? {});
    this.search = new SearchEngine();
    this.logger = config.logger ?? consoleLogger;
  }

  /**
   * Start the server
   *
   * Loading the store and indexing it are the same step: an index built only
   * from later publishes never sees the modules already on disk, so every
   * search came back empty after a restart.
   */
  async start(): Promise<void> {
    await this.store.init();
    await this.auth.init();
    const indexed = await this.reindexSearch();
    this.logger.info(
      `MAM Registry server started on port ${this.config.port} (${indexed} modules indexed)`
    );
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    this.rateLimitHits.clear();
    this.logger.info('MAM Registry server stopped');
  }

  /**
   * The effective configuration.
   *
   * Exposed read-only so an HTTP transport can enforce the same `corsOrigins`,
   * `maxUploadSize` and `rateLimit` the handlers use, rather than keeping a
   * second copy of the policy that can drift.
   */
  get settings(): Readonly<RegistryServerConfig> {
    return this.config;
  }

  /**
   * The module store.
   *
   * Exposed so a transport layer can hand the *same* store to another
   * subsystem — GraphQL resolvers, notably. A second store pointed at the same
   * directory is a second, independently locked view of one set of files.
   */
  get moduleStore(): ModuleStore {
    return this.store;
  }

  /** The auth manager, for the auth routes a transport has to serve. */
  get authManager(): AuthManager {
    return this.auth;
  }

  /**
   * Rebuild the search index from the store. Returns how many modules are indexed.
   */
  async reindexSearch(): Promise<number> {
    const modules = await this.store.getAllModules();
    this.search.reindex(modules);
    return this.search.getIndexSize();
  }

  /** How many modules the search index currently holds. */
  getSearchIndexSize(): number {
    return this.search.getIndexSize();
  }

  // ==========================================================================
  // API Handlers
  // ==========================================================================

  /**
   * Search modules
   */
  async handleSearch(query: string, options: SearchOptions = {}): Promise<ApiResponse> {
    const gate = await this.gate(options);
    if ('response' in gate) return gate.response;

    const results = await this.search.search({
      text: query,
      sort: options.sort,
      tags: options.tags,
      author: options.author,
      includeArchived: options.includeArchived,
      limit: options.limit,
      offset: options.offset,
    });

    return {
      success: true,
      data: results.modules,
      meta: {
        total: results.total,
        // The limits actually applied, not the ones asked for: a caller that
        // asked for 1000000 rows needs to know it was served 100.
        limit: normalizeSearchLimit(options.limit),
        offset: normalizeSearchOffset(options.offset),
      },
    };
  }

  /**
   * List modules
   *
   * The store is the source of truth here, so this also picks up modules
   * published out of band. Archived modules are hidden unless asked for.
   */
  async handleListModules(options: ListModulesOptions = {}): Promise<ApiResponse> {
    const gate = await this.gate(options);
    if ('response' in gate) return gate.response;

    const includeArchived = options.includeArchived === true;
    const query = options.query?.toLowerCase();
    const all = await this.store.getAllModules();

    const filtered = all.filter((module) => {
      if (module.archived === true && !includeArchived) return false;
      if (query) {
        const hit =
          module.name.toLowerCase().includes(query) ||
          module.description.toLowerCase().includes(query) ||
          module.tags.some((tag) => tag.toLowerCase().includes(query));
        if (!hit) return false;
      }
      if (options.tags && options.tags.length > 0) {
        if (!options.tags.some((tag) => module.tags.includes(tag))) return false;
      }
      if (options.author && module.author !== options.author) return false;
      return true;
    });

    // A listing has no query, so there is no score to order by; `relevance`
    // becomes newest first rather than an arbitrary order.
    const sort: SearchSort = options.sort === 'relevance' || !options.sort
      ? 'updated'
      : options.sort;
    filtered.sort((a, b) => compareModulesBySort(a, b, sort));

    const limit = normalizeSearchLimit(options.limit);
    const offset = normalizeSearchOffset(options.offset);

    return {
      success: true,
      data: filtered.slice(offset, offset + limit),
      meta: { total: filtered.length, limit, offset },
    };
  }

  /**
   * Get module info
   */
  async handleGetModule(name: string, req: HandlerRequest = {}): Promise<ApiResponse> {
    const gate = await this.gate(req);
    if ('response' in gate) return gate.response;

    const module = await this.store.getModule(name);
    if (!module) {
      return { success: false, error: `Module "${name}" not found` };
    }
    return { success: true, data: module };
  }

  /**
   * Get module versions
   */
  async handleGetVersions(name: string, req: HandlerRequest = {}): Promise<ApiResponse> {
    const gate = await this.gate(req);
    if ('response' in gate) return gate.response;

    // An empty list for a module that does not exist reads the same as a
    // module with no versions, so a missing module has to fail.
    const module = await this.store.getModule(name);
    if (!module) {
      return { success: false, error: `Module "${name}" not found` };
    }

    const versions = await this.store.getVersions(name);
    return { success: true, data: versions };
  }

  /**
   * Get specific version
   */
  async handleGetVersion(name: string, version: string, req: HandlerRequest = {}): Promise<ApiResponse> {
    const gate = await this.gate(req);
    if ('response' in gate) return gate.response;

    const versionData = await this.store.getVersion(name, version);
    if (!versionData) {
      return { success: false, error: `Version "${version}" not found for "${name}"` };
    }
    return { success: true, data: versionData };
  }

  /**
   * Publish module
   */
  async handlePublish(
    manifest: Record<string, unknown>,
    files: Map<string, string>,
    token: string
  ): Promise<ApiResponse> {
    const gate = await this.gate({ token });
    if ('response' in gate) return gate.response;

    // Authenticate. Publishing is a write, so it needs a real token even when
    // `authRequired` is off.
    const user = gate.user ?? await this.auth.verifyToken(token);
    if (!user) {
      return { success: false, error: 'Invalid authentication token' };
    }

    // Reject oversized payloads before anything is written to disk.
    const bytes = this.payloadSize(manifest, files);
    const maxUploadSize = this.config.maxUploadSize;
    if (maxUploadSize > 0 && bytes > maxUploadSize) {
      this.logger.error(
        `Rejected publish of ${bytes} bytes for "${String(manifest.name)}": over the ${maxUploadSize} byte limit`
      );
      return {
        success: false,
        error: `Upload of ${bytes} bytes exceeds the maximum upload size of ${maxUploadSize} bytes`,
      };
    }

    // Validate manifest
    if (!manifest.name || !manifest.version) {
      return { success: false, error: 'Name and version are required' };
    }

    // Publish
    try {
      const result = await this.store.publish(
        manifest as any,
        files,
        user.username
      );
      // Index the stored record, not the request manifest: that is the one
      // that carries the timestamps, the version list and the archived flag.
      await this.indexStoredModule(result.name);
      return {
        success: true,
        data: {
          name: result.name,
          version: result.version,
          url: `/api/v1/modules/${result.name}`,
        },
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Delete module
   */
  async handleDeleteModule(name: string, token: string): Promise<ApiResponse> {
    const gate = await this.gate({ token });
    if ('response' in gate) return gate.response;

    const user = gate.user ?? await this.auth.verifyToken(token);
    if (!user) {
      return { success: false, error: 'Invalid authentication token' };
    }

    const module = await this.store.getModule(name);
    if (!module) {
      return { success: false, error: `Module "${name}" not found` };
    }

    // The author may always delete their own module. An admin-scoped token may
    // delete anyone's, so a takedown is not blocked on the author being
    // reachable or cooperative.
    const isAdmin = (await this.auth.verifyTokenWithScope(token, 'admin')) !== null;
    if (module.author !== user.username && !isAdmin) {
      return { success: false, error: 'Not authorized to delete this module' };
    }

    await this.store.deleteModule(name);
    // Leaving the record in the index would let a deleted module keep showing
    // up in search results.
    this.search.removeModule(name);
    return { success: true };
  }

  /**
   * Archive or unarchive a module
   *
   * Archived modules stay resolvable by name and version; only their
   * availability in listings and search changes.
   */
  async handleArchive(name: string, options: ArchiveOptions = {}): Promise<ApiResponse> {
    const gate = await this.gate(options);
    if ('response' in gate) return gate.response;

    const user = gate.user ?? (options.token ? await this.auth.verifyToken(options.token) : null);
    if (!user) {
      return { success: false, error: 'Invalid authentication token' };
    }

    const module = await this.store.getModule(name);
    if (!module) {
      return { success: false, error: `Module "${name}" not found` };
    }

    const isAdmin = options.token
      ? (await this.auth.verifyTokenWithScope(options.token, 'admin')) !== null
      : false;
    if (module.author !== user.username && !isAdmin) {
      return { success: false, error: 'Not authorized to archive this module' };
    }

    try {
      // Delegates to the store so the flag reaches meta.json.
      const record = await this.store.setArchived(name, options.archived ?? true);
      this.search.indexModule(record);
      return { success: true, data: record };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Login
   */
  async handleLogin(username: string, password: string, req: HandlerRequest = {}): Promise<ApiResponse> {
    // Login is how a caller gets a token in the first place, so the auth
    // requirement cannot apply to it. The rate limit still does.
    const gate = await this.gate(req, { allowAnonymous: true });
    if ('response' in gate) return gate.response;

    const token = await this.auth.authenticate(username, password);
    if (!token) {
      return { success: false, error: 'Invalid credentials' };
    }
    return { success: true, data: { token } };
  }

  /**
   * Register
   */
  async handleRegister(
    username: string,
    email: string,
    password: string,
    req: HandlerRequest = {}
  ): Promise<ApiResponse> {
    const gate = await this.gate(req, { allowAnonymous: true });
    if ('response' in gate) return gate.response;

    try {
      const user = await this.auth.register(username, email, password);
      return { success: true, data: { username: user.username } };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Get stats
   */
  async handleStats(req: HandlerRequest = {}): Promise<ApiResponse> {
    const gate = await this.gate(req);
    if ('response' in gate) return gate.response;

    const stats = await this.store.getStats();
    return { success: true, data: stats };
  }

  // ==========================================================================
  // Session handlers
  //
  // The client calls these on every session change, and none of them had a
  // handler, so all four have always 404'd. A logout that is a 404 leaves the
  // token live; a profile that is a 404 makes every authenticated client look
  // broken.
  // ==========================================================================

  /**
   * Revoke the caller's own token.
   *
   * Reports success even when the token was already unknown: logout is
   * idempotent by contract, and a caller clearing a session should not be told
   * it failed because the session had already lapsed.
   */
  async handleLogout(token: string): Promise<ApiResponse> {
    const gate = await this.gate({ token });
    if ('response' in gate) return gate.response;

    if (!token) {
      return { success: false, error: 'Invalid or missing authentication token' };
    }
    const revoked = await this.auth.revokeToken(token);
    return { success: true, data: { revoked } };
  }

  /**
   * The caller's own profile.
   */
  async handleProfile(token: string): Promise<ApiResponse> {
    const gate = await this.gate({ token });
    if ('response' in gate) return gate.response;

    const user = gate.user ?? (token ? await this.auth.verifyToken(token) : null);
    if (!user) {
      return { success: false, error: 'Invalid or missing authentication token' };
    }
    return { success: true, data: user };
  }

  /**
   * Change the caller's password.
   *
   * Takes the username from the token rather than the body, so a caller cannot
   * change somebody else's password by naming them. A successful change retires
   * every existing token for that user, which includes the one making the
   * request — the response is the last thing that token authorises.
   */
  async handleChangePassword(token: string, oldPassword: string, newPassword: string): Promise<ApiResponse> {
    const gate = await this.gate({ token });
    if ('response' in gate) return gate.response;

    const user = gate.user ?? (token ? await this.auth.verifyToken(token) : null);
    if (!user) {
      return { success: false, error: 'Invalid or missing authentication token' };
    }

    if (typeof oldPassword !== 'string' || typeof newPassword !== 'string') {
      return { success: false, error: 'oldPassword and newPassword are required' };
    }

    try {
      const changed = await this.auth.changePassword(user.username, oldPassword, newPassword);
      if (!changed) {
        return { success: false, error: 'Current password is incorrect' };
      }
      return { success: true, data: { changed: true } };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Exchange a refresh token for a new session token.
   *
   * There is no refresh token to exchange: this manager mints one opaque
   * session token per login and stores no separate renewal credential, so a
   * request carrying one is not something this server can honour. It says so
   * rather than answering 401, which would send a client looking for a
   * credential problem it does not have — the client's own contract is to treat
   * 401 as a lapsed session and try again.
   */
  async handleRefresh(_refreshToken: string): Promise<ApiResponse> {
    return {
      success: false,
      error: 'Token refresh is not supported: this registry issues session tokens only. Authenticate again with POST /auth/login.',
    };
  }

  // ==========================================================================
  // Module metadata handlers
  //
  // The client calls all three of these; before they existed they always 404'd.
  // ==========================================================================

  /**
   * A module's declared dependencies.
   *
   * Read from the version manifest rather than from a lockfile or a resolved
   * graph, because that is the only thing a registry stores: a dependency the
   * publisher declared, at the version they declared it for. Read from the
   * latest version unless a version is named, matching every other versioned
   * route.
   */
  async handleGetDependencies(
    name: string,
    req: HandlerRequest = {},
    version?: string
  ): Promise<ApiResponse> {
    const gate = await this.gate(req);
    if ('response' in gate) return gate.response;

    const module = await this.store.getModule(name);
    if (!module) {
      return { success: false, error: `Module "${name}" not found` };
    }

    const resolvedVersion = version ?? module.latest;
    const record = module.versions[resolvedVersion];
    if (!record) {
      return { success: false, error: `Version "${resolvedVersion}" not found for "${name}"` };
    }

    const declared = (record.manifest as { dependencies?: unknown })?.dependencies;
    const dependencies = Array.isArray(declared)
      ? declared
          .filter(
            (dep): dep is { name: string; version: string; optional?: boolean } =>
              !!dep &&
              typeof dep === 'object' &&
              typeof (dep as { name?: unknown }).name === 'string'
          )
          .map((dep) => ({
            name: dep.name,
            // A range is what a manifest holds; a dependency with no range
            // resolves against any version, and "" says that more honestly
            // than inventing "*".
            version: typeof dep.version === 'string' ? dep.version : '',
            ...(dep.optional === true ? { optional: true } : {}),
          }))
      : [];

    return { success: true, data: dependencies };
  }

  /**
   * Where to download a module.
   *
   * Returns a URL on this server that actually serves the bytes: the tarball
   * route reads the stored version and writes a real gzipped tar of its files.
   * A URL that no route resolves would be worse than an error, because a client
   * has no way to tell the difference between a registry that is slow and one
   * that is lying.
   */
  async handleGetDownload(
    name: string,
    version?: string,
    req: HandlerRequest = {}
  ): Promise<ApiResponse> {
    const gate = await this.gate(req);
    if ('response' in gate) return gate.response;

    const module = await this.store.getModule(name);
    if (!module) {
      return { success: false, error: `Module "${name}" not found` };
    }

    const resolvedVersion = version ?? module.latest;
    const record = module.versions[resolvedVersion];
    if (!record) {
      return { success: false, error: `Version "${resolvedVersion}" not found for "${name}"` };
    }

    return {
      success: true,
      data: {
        url: `/tarballs/${encodeURIComponent(name)}/${encodeURIComponent(resolvedVersion)}.tgz`,
        version: resolvedVersion,
        integrity: record.integrity,
      },
    };
  }

  /**
   * Per-module statistics.
   *
   * `downloads` is a real zero: the store does not count downloads, and a
   * fabricated count is worse than a missing one — it sorts and reports as if
   * it meant something. `dependents` is computable, because every module's
   * manifest records what it depends on, so it is counted across the corpus
   * rather than guessed.
   */
  async handleModuleStats(name: string, req: HandlerRequest = {}): Promise<ApiResponse> {
    const gate = await this.gate(req);
    if ('response' in gate) return gate.response;

    const module = await this.store.getModule(name);
    if (!module) {
      return { success: false, error: `Module "${name}" not found` };
    }

    const all = await this.store.getAllModules();
    let dependents = 0;
    for (const candidate of all) {
      if (candidate.name === name) continue;
      const declared = (candidate.versions[candidate.latest]?.manifest as { dependencies?: unknown })
        ?.dependencies;
      if (!Array.isArray(declared)) continue;
      if (
        declared.some(
          (dep) =>
            !!dep &&
            typeof dep === 'object' &&
            (dep as { name?: unknown }).name === name
        )
      ) {
        dependents++;
      }
    }

    return {
      success: true,
      data: {
        name,
        version: module.latest,
        versionCount: Object.keys(module.versions).length,
        // The store does not track download counts, so this is a real zero.
        downloads: 0,
        dependents,
        lastUpdated: module.updatedAt,
        archived: module.archived === true,
      },
    };
  }

  // ==========================================================================
  // CORS
  // ==========================================================================

  /** True when `origin` is configured, or `*` allows every origin. */
  isOriginAllowed(origin: string | undefined | null): boolean {
    if (!origin) return false;
    const allowed = this.config.corsOrigins ?? [];
    return allowed.includes('*') || allowed.includes(origin);
  }

  /**
   * CORS response headers for `origin`.
   *
   * Returns nothing at all for an origin that is not allowed, rather than
   * echoing an origin the config never granted.
   */
  getCorsHeaders(
    origin: string | undefined | null,
    methods: string = DEFAULT_CORS_METHODS
  ): Record<string, string> {
    if (!this.isOriginAllowed(origin)) return {};
    return {
      'Access-Control-Allow-Origin': origin as string,
      'Access-Control-Allow-Methods': methods,
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
    };
  }

  /**
   * Answers a CORS preflight: 204 with headers for an allowed origin and
   * method, 403 for an origin the config does not grant, 405 for a method it
   * does not allow.
   */
  handlePreflight(origin: string | undefined | null, method?: string): CorsResponse {
    const headers = this.getCorsHeaders(origin);
    if (Object.keys(headers).length === 0) {
      return { status: 403, headers: {} };
    }
    if (method) {
      const allowed = headers['Access-Control-Allow-Methods'].split(', ');
      if (!allowed.includes(method.toUpperCase())) {
        return { status: 405, headers: {} };
      }
    }
    return { status: 204, headers };
  }

  // ==========================================================================
  // Internals
  // ==========================================================================

  /**
   * Applies the rate limit, then authentication.
   *
   * Rate limiting comes first so a caller that is over budget cannot use the
   * auth path to make the server do work. Every handler goes through this, so
   * `authRequired` cannot be forgotten on a new one. `allowAnonymous` is for
   * the two handlers that mint credentials, which have no token yet.
   */
  private async gate(
    req: HandlerRequest,
    options: { allowAnonymous?: boolean } = {}
  ): Promise<{ user: UserInfo | null } | { response: ApiResponse }> {
    const limited = this.checkRateLimit(req);
    if (limited) return { response: { success: false, error: limited } };

    const user = req.token ? await this.auth.verifyToken(req.token) : null;

    if (this.config.authRequired && !user && !options.allowAnonymous) {
      return { response: { success: false, error: 'Invalid or missing authentication token' } };
    }
    return { user };
  }

  /**
   * Counts one request for this caller, or returns the error to send instead.
   *
   * Keyed by token when there is one and by client id otherwise, so a shared
   * NAT does not pool separate users into one budget.
   */
  private checkRateLimit(req: HandlerRequest): string | null {
    const limit = this.config.rateLimit;
    if (!Number.isFinite(limit) || limit <= 0) return null;

    const windowMs = this.config.rateLimitWindowMs ?? DEFAULT_RATE_LIMIT_WINDOW_MS;
    const now = Date.now();
    const key = req.token ?? req.clientId ?? 'anonymous';

    const hits = (this.rateLimitHits.get(key) ?? []).filter(hit => now - hit < windowMs);
    if (hits.length >= limit) {
      this.rateLimitHits.set(key, hits);
      const retryAfterMs = windowMs - (now - hits[0]);
      const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
      return `Rate limit exceeded. Retry in ${seconds}s`;
    }

    hits.push(now);
    this.rateLimitHits.set(key, hits);
    return null;
  }

  /** Re-indexes a module from what the store actually persisted. */
  private async indexStoredModule(name: string): Promise<void> {
    const record = await this.store.getModule(name);
    if (record) {
      this.search.indexModule(record);
    } else {
      this.search.removeModule(name);
    }
  }

  /**
   * Total bytes a publish would write: the manifest plus every file path and
   * its contents, measured as UTF-8 so multi-byte content is not undercounted.
   */
  private payloadSize(manifest: Record<string, unknown>, files: Map<string, string>): number {
    const sizeOf = (value: unknown): number =>
      typeof value === 'string' ? Buffer.byteLength(value, 'utf-8') : 0;

    let total = 0;
    try {
      total += sizeOf(JSON.stringify(manifest));
    } catch {
      // A manifest that will not serialise cannot be stored either; treat it
      // as over the limit so nothing is written.
      return Number.POSITIVE_INFINITY;
    }

    for (const [path, content] of files) {
      total += sizeOf(path) + sizeOf(content);
    }
    return total;
  }
}
