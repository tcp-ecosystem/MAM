/**
 * lifecycle.ts — `McpServer`: the high-level facade for the MAM MCP Server layer.
 *
 * {@link McpServer} composes the {@link SessionStore}, {@link SessionIndex} and
 * {@link RequestDispatcher} into a single server object that an application can drive
 * directly:
 *
 *  - Session lifecycle: {@link McpServer.createSession}, {@link McpServer.initialize},
 *    {@link McpServer.prune}, {@link McpServer.stop}.
 *  - Handler registration: {@link McpServer.registerToolHandler},
 *    {@link McpServer.registerResourceHandler}, {@link McpServer.registerPromptHandler}
 *    and the generic {@link McpServer.registerHandler}.
 *  - Raw transport: {@link McpServer.handleRawMessage} decodes wire text (via an
 *    injectable codec), dispatches, and re-encodes the response.
 *  - Outbound notifications: {@link McpServer.sendNotification}.
 *  - Observability: {@link McpServer.stats} and the EventEmitter surface for lifecycle
 *    events.
 *
 * The class extends Node's {@link EventEmitter}, so transports and monitoring code can
 * subscribe to `sessionCreated`, `sessionInitialized`, `messageHandled`, `notificationSent`,
 * `error`, `started` and `stopped` events without coupling to the internals.
 *
 * @module server/lifecycle
 */

import { EventEmitter } from "node:events";
import {
  ServerConfig,
  ServerOptions,
  ServerStats,
  SessionConfig,
  McpSession,
  Implementation,
  ClientCapabilities,
  ProtocolVersion,
  InitializeRequestParams,
  InitializeResult,
  ToolListing,
  ResourceListing,
  PromptListing,
  CallToolResult,
  GetPromptResult,
  JsonRpcCodec,
  JsonRpcResponse,
  JsonRpcNotification,
  DispatchOutput,
  DispatchResult,
  JsonRpcErrorCode,
  JsonRpcSuccessResponse,
  McpRequestError,
  createServerConfig,
  createServerStats,
  isJsonRpcRequest,
  isJsonRpcNotification,
  SUPPORTED_PROTOCOL_VERSIONS,
  LATEST_PROTOCOL_VERSION,
  MCP_METHOD,
} from "./types.js";
import { SessionStore } from "./store.js";
import { SessionIndex } from "./index.js";
import { RequestDispatcher, HandlerFn, DispatchContext } from "./retrieval.js";

/**
 * Event map emitted by {@link McpServer}. Subscribe via `server.on(event, (...args) => ...)`.
 */
export interface McpServerEvents {
  /** Emitted when a session is created. Args: session id. */
  sessionCreated: [sessionId: string];
  /** Emitted when a session completes the initialize handshake. Args: id, result. */
  sessionInitialized: [sessionId: string, result: InitializeResult];
  /** Emitted after every dispatched message. Args: session id, dispatch result. */
  messageHandled: [sessionId: string, result: DispatchResult];
  /** Emitted when a notification is sent. Args: session id, method. */
  notificationSent: [sessionId: string, method: string];
  /** Emitted for non-fatal server errors (dispatch failures, transport noise). */
  error: [error: Error];
  /** Emitted when the server transitions to started. */
  started: [];
  /** Emitted when the server transitions to stopped. */
  stopped: [];
}

/**
 * Typed listener for {@link McpServerEvents}.
 */
export type McpServerListener<K extends keyof McpServerEvents> = (
  ...args: McpServerEvents[K]
) => void;

/**
 * Default wire codec: plain JSON. Swap for a framed/streaming codec via `ServerOptions`.
 */
const DEFAULT_CODEC: JsonRpcCodec = {
  decode: (text: string): unknown => JSON.parse(text),
  encode: (message: unknown): string => JSON.stringify(message),
};

/**
 * McpServer — high-level MCP server facade combining store, index and dispatcher.
 */
export class McpServer extends EventEmitter {
  /** Resolved server configuration. */
  private readonly _config: ServerConfig;
  /** Wire codec for {@link McpServer.handleRawMessage} / {@link McpServer.sendNotification}. */
  private readonly _codec: JsonRpcCodec;
  /** Session registry. */
  private readonly _store: SessionStore;
  /** Query index over sessions. */
  private readonly _index: SessionIndex;
  /** Request router. */
  private readonly _dispatcher: RequestDispatcher;
  /** Tool call handlers keyed by tool name. */
  private readonly _toolHandlers: Map<string, HandlerFn>;
  /** Resource read handlers keyed by resource URI (with `*` fallback). */
  private readonly _resourceHandlers: Map<string, HandlerFn>;
  /** Prompt render handlers keyed by prompt name. */
  private readonly _promptHandlers: Map<string, HandlerFn>;
  /** Custom JSON-RPC method handlers. */
  private readonly _customHandlers: Map<string, HandlerFn>;
  /** Tool listing provider. */
  private _toolListings: ((ctx: DispatchContext) => ToolListing[] | Promise<ToolListing[]>) | undefined;
  /** Resource listing provider. */
  private _resourceListings:
    | ((ctx: DispatchContext) => ResourceListing[] | Promise<ResourceListing[]>)
    | undefined;
  /** Prompt listing provider. */
  private _promptListings:
    | ((ctx: DispatchContext) => PromptListing[] | Promise<PromptListing[]>)
    | undefined;
  /** Running flag. */
  private _running = false;
  /** Epoch ms the server started (or was constructed). */
  private _startedAt = Date.now();
  /** Id of the implicit default session used by session-less raw messages. */
  private _defaultSessionId: string | undefined;
  /** Zero-based stats accumulator, augmented on each dispatch. */
  private _stats: ServerStats = createServerStats();

  /**
   * Construct a server. All options are optional; unspecified fields fall back to
   * {@link DEFAULT_SERVER_CONFIG} semantics.
   *
   * @param options Construction options (config overrides, codec, prebuilt store/index).
   */
  constructor(options: ServerOptions = {}) {
    super();
    this._config = createServerConfig(options.config);
    this._codec = options.codec ?? DEFAULT_CODEC;
    this._store = options.sessionStore ?? new SessionStore({
      maxSessions: this._config.maxSessions,
      protocolVersion: this._config.protocolVersion,
      serverInfo: this._config.serverInfo,
    } satisfies SessionConfig);
    this._index = options.sessionIndex ?? new SessionIndex(this._store.values());

    this._toolHandlers = new Map<string, HandlerFn>();
    this._resourceHandlers = new Map<string, HandlerFn>();
    this._promptHandlers = new Map<string, HandlerFn>();
    this._customHandlers = new Map<string, HandlerFn>();

    this._dispatcher = new RequestDispatcher({
      config: this._config,
      serverInfo: this._config.serverInfo,
      capabilities: {},
    });

    // Keep the index in sync with store events.
    this._store.on("sessionCreated", (session) => {
      this._index.indexSession(session);
    });
    this._store.on("sessionInitialized", (session) => {
      this._index.indexSession(session);
    });
    this._store.on("sessionTouched", (session) => {
      this._index.indexSession(session);
    });
    this._store.on("sessionDeleted", (id) => {
      this._index.removeSession(id);
    });
  }

  /**
   * The resolved server configuration.
   */
  get config(): ServerConfig {
    return this._config;
  }

  /**
   * Whether the server is currently marked as started.
   */
  get running(): boolean {
    return this._running;
  }

  /**
   * The session store backing this server.
   */
  get store(): SessionStore {
    return this._store;
  }

  /**
   * The session index maintained alongside the store.
   */
  get index(): SessionIndex {
    return this._index;
  }

  /**
   * The request dispatcher used for routing.
   */
  get dispatcher(): RequestDispatcher {
    return this._dispatcher;
  }

  /**
   * Mark the server as started. Idempotent; emits `started` on the first call.
   */
  start(): this {
    if (!this._running) {
      this._running = true;
      this._startedAt = Date.now();
      this.emit("started");
    }
    return this;
  }

  /**
   * Mark the server as stopped. Emits `stopped`; sessions are left intact so the server
   * can be restarted without losing state.
   */
  stop(): this {
    if (this._running) {
      this._running = false;
      this.emit("stopped");
    }
    return this;
  }

  /**
   * Create a new session.
   *
   * @param clientInfo Optional client identity known ahead of the initialize handshake.
   * @param options Optional session-level settings (id override, protocol version, tags).
   * @returns The new session id.
   */
  createSession(clientInfo?: Implementation, options: { id?: string; protocolVersion?: ProtocolVersion } = {}): string {
    const session = this._store.create(clientInfo, undefined, {
      id: options.id,
      protocolVersion: options.protocolVersion,
    });
    this.emit("sessionCreated", session.id);
    return session.id;
  }

  /**
   * Run the initialize handshake for a session: negotiate the protocol version, mark the
   * session initialized, record client capabilities and return an {@link InitializeResult}.
   *
   * @param sessionId The target session.
   * @param params The client's initialize request parameters.
   * @returns The initialize result to send back to the client.
   */
  initialize(sessionId: string, params: InitializeRequestParams): Promise<InitializeResult> {
    const session = this._requireSession(sessionId);
    const negotiated = this._dispatcher.negotiateVersion(params.protocolVersion);
    const result = this._dispatcher.buildInitializeResult(negotiated);

    session.protocolVersion = negotiated;
    this._store.setInitialized(sessionId, params.capabilities, params);
    if (params.clientInfo !== undefined) {
      session.clientInfo = params.clientInfo;
    }
    this.emit("sessionInitialized", sessionId, result);
    return Promise.resolve(result);
  }

  /**
   * Register a tool call handler keyed by tool name. Invoked when a `tools/call` request
   * names this tool.
   *
   * @param name The tool name to handle.
   * @param fn Handler receiving `(args, ctx)` and returning a value or CallToolResult.
   * @returns This server, for chaining.
   */
  registerToolHandler(name: string, fn: HandlerFn): this {
    this._requireName(name, "registerToolHandler");
    this._toolHandlers.set(name, fn);
    return this;
  }

  /**
   * Register a resource read handler keyed by resource URI. Registering under `"*"` acts
   * as a fallback for any unhandled URI.
   *
   * @param uri The resource URI to handle (or `"*"` for a fallback).
   * @param fn Handler receiving `(params, ctx)` where `params.uri` is the requested URI.
   * @returns This server, for chaining.
   */
  registerResourceHandler(uri: string, fn: HandlerFn): this {
    this._requireName(uri, "registerResourceHandler");
    this._resourceHandlers.set(uri, fn);
    return this;
  }

  /**
   * Register a prompt render handler keyed by prompt name. Invoked when a `prompts/get`
   * request names this prompt.
   *
   * @param name The prompt name to handle.
   * @param fn Handler receiving `(args, ctx)` and returning a value or GetPromptResult.
   * @returns This server, for chaining.
   */
  registerPromptHandler(name: string, fn: HandlerFn): this {
    this._requireName(name, "registerPromptHandler");
    this._promptHandlers.set(name, fn);
    return this;
  }

  /**
   * Register a handler for any custom JSON-RPC method not covered by the core MCP set.
   *
   * @param method The method name.
   * @param fn Handler receiving `(params, ctx)`.
   * @returns This server, for chaining.
   */
  registerHandler(method: string, fn: HandlerFn): this {
    this._requireName(method, "registerHandler");
    this._customHandlers.set(method, fn);
    return this;
  }

  /**
   * Register a provider of the tool listing used by `tools/list`.
   */
  registerToolListings(
    fn: (ctx: DispatchContext) => ToolListing[] | Promise<ToolListing[]>,
  ): this {
    this._toolListings = fn;
    return this;
  }

  /**
   * Register a provider of the resource listing used by `resources/list`.
   */
  registerResourceListings(
    fn: (ctx: DispatchContext) => ResourceListing[] | Promise<ResourceListing[]>,
  ): this {
    this._resourceListings = fn;
    return this;
  }

  /**
   * Register a provider of the prompt listing used by `prompts/list`.
   */
  registerPromptListings(
    fn: (ctx: DispatchContext) => PromptListing[] | Promise<PromptListing[]>,
  ): this {
    this._promptListings = fn;
    return this;
  }

  /**
   * Validate a registration key.
   */
  private _requireName(name: string, caller: string): void {
    if (typeof name !== "string" || name.length === 0) {
      throw new TypeError(`${caller}: name must be a non-empty string`);
    }
  }

  /**
   * Fetch a live session or throw a descriptive error.
   */
  private _requireSession(sessionId: string): McpSession {
    const session = this._store.get(sessionId);
    if (session === undefined) {
      throw new Error(`McpServer: no session with id "${sessionId}"`);
    }
    return session;
  }

  /**
   * Resolve the session id for a raw message: an explicit hint wins, otherwise a lone
   * existing session is used, otherwise the implicit default session is created lazily.
   */
  private _resolveSessionId(hint?: string): string {
    if (hint !== undefined && hint.length > 0) {
      if (!this._store.has(hint)) {
        throw new Error(`McpServer: no session with id "${hint}"`);
      }
      return hint;
    }
    if (this._store.size === 1) {
      return this._store.keys()[0];
    }
    if (this._defaultSessionId === undefined || !this._store.has(this._defaultSessionId)) {
      this._defaultSessionId = this.createSession();
    }
    return this._defaultSessionId;
  }

  /**
   * Handle raw wire text: decode it via the codec, dispatch it, and re-encode the
   * response (or return null for notifications).
   *
   * @param text Raw incoming message text.
   * @param sessionId Optional session to associate the message with. When omitted, the
   *   lone live session or the implicit default session is used.
   * @returns The encoded response text, or `null` for notifications / no response.
   */
  async handleRawMessage(text: string, sessionId?: string): Promise<string | null> {
    let parsed: unknown;
    try {
      parsed = this._codec.decode(text);
    } catch {
      const errorResponse: JsonRpcResponse = {
        jsonrpc: "2.0",
        id: null,
        error: { code: JsonRpcErrorCode.ParseError, message: "Parse error" },
      };
      return this._codec.encode(errorResponse);
    }

    let sid: string;
    try {
      sid = this._resolveSessionId(sessionId);
    } catch {
      return this._codec.encode({
        jsonrpc: "2.0",
        id: null,
        error: { code: JsonRpcErrorCode.InvalidRequest, message: "Invalid Request: unknown session" },
      });
    }

    const output = await this.handleParsedMessage(parsed, sid);
    if (output === null) {
      return null;
    }
    return this._codec.encode(output);
  }

  /**
   * Dispatch an already-parsed message (or batch) against a session, tracking stats and
   * emitting `messageHandled` for each handled message. Exposed so non-text transports can
   * reuse the full routing pipeline.
   *
   * @param parsed A decoded JSON-RPC message or batch.
   * @param sessionId The session to associate the dispatch with.
   * @returns The dispatch output (response, batch, or null).
   */
  async handleParsedMessage(parsed: unknown, sessionId: string): Promise<DispatchOutput> {
    const startedAt = Date.now();
    this._stats.lastActivityAt = startedAt;
    this._store.touch(sessionId, startedAt);

    const ctx = this._buildContext(sessionId, startedAt);
    const customHandlers: Record<string, HandlerFn> = {};
    for (const [method, fn] of this._customHandlers) {
      customHandlers[method] = fn;
    }

    const output = await this._dispatcher.dispatch(parsed as never, customHandlers, ctx);

    const emitted = this._emitDispatchTraces(parsed, output, sessionId, startedAt);
    if (emitted) {
      this._stats.totalRequests += 1;
    }

    return output;
  }

  /**
   * Emit `messageHandled` traces for a dispatch and update error counters. Returns whether
   * a request (id-bearing) message was among the handled messages.
   */
  private _emitDispatchTraces(
    parsed: unknown,
    output: DispatchOutput,
    sessionId: string,
    startedAt: number,
  ): boolean {
    if (Array.isArray(parsed)) {
      const responses = Array.isArray(output) ? output : output === null ? [] : [output];
      let sawRequest = false;
      parsed.forEach((item, i) => {
        if (!isJsonRpcRequest(item) && !isJsonRpcNotification(item)) {
          return;
        }
        const response = responses[i];
        const result = this._dispatcher.buildDispatchResult(item, response, startedAt, sessionId);
        if (result.isError) {
          this._stats.totalErrors += 1;
        }
        if (result.isRequest) {
          sawRequest = true;
        }
        this.emit("messageHandled", sessionId, result);
      });
      return sawRequest;
    }
    if (!isJsonRpcRequest(parsed) && !isJsonRpcNotification(parsed)) {
      this._stats.totalErrors += 1;
      return false;
    }
    const response = Array.isArray(output) ? output[0] : output === null ? undefined : (output as JsonRpcResponse);
    const result = this._dispatcher.buildDispatchResult(parsed, response, startedAt, sessionId);
    if (result.isError) {
      this._stats.totalErrors += 1;
    }
    this.emit("messageHandled", sessionId, result);
    return result.isRequest;
  }

  /**
   * Build the dispatch context wiring the server's registries into the dispatcher's core
   * MCP method handlers.
   */
  private _buildContext(sessionId: string, startedAt: number): DispatchContext {
    const session = this._store.get(sessionId);
    return {
      session,
      sessionId,
      serverConfig: this._config,
      serverInfo: this._config.serverInfo,
      capabilities: {},
      protocolVersion: session?.protocolVersion ?? this._config.protocolVersion,
      startedAt,
      onInitialized: async (ctx, params) => {
        const target = this._store.get(ctx.sessionId ?? sessionId);
        if (target !== undefined) {
          target.protocolVersion = ctx.protocolVersion;
          target.clientInfo = params.clientInfo;
          this._store.setInitialized(target.id, params.capabilities, params);
          this.emit("sessionInitialized", target.id, this._dispatcher.buildInitializeResult(ctx.protocolVersion));
        }
      },
      listTools: (ctx) => (this._toolListings ? this._toolListings(ctx) : this._listToolsFromHandlers()),
      callTool: async (name, args, ctx) => {
        const handler = this._toolHandlers.get(name) ?? this._toolHandlers.get("*");
        if (handler === undefined) {
          throw new McpRequestError(JsonRpcErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
        return this._normalizeToolResult(await handler(args, ctx));
      },
      listResources: (ctx) =>
        this._resourceListings ? this._resourceListings(ctx) : this._listResourcesFromHandlers(),
      readResource: async (uri, ctx) => {
        const handler = this._resourceHandlers.get(uri) ?? this._resourceHandlers.get("*");
        if (handler === undefined) {
          throw new McpRequestError(JsonRpcErrorCode.MethodNotFound, `Unknown resource: ${uri}`);
        }
        return handler({ uri }, ctx);
      },
      listPrompts: (ctx) =>
        this._promptListings ? this._promptListings(ctx) : this._listPromptsFromHandlers(),
      getPrompt: async (name, args, ctx) => {
        const handler = this._promptHandlers.get(name) ?? this._promptHandlers.get("*");
        if (handler === undefined) {
          throw new McpRequestError(JsonRpcErrorCode.MethodNotFound, `Unknown prompt: ${name}`);
        }
        return this._normalizePromptResult(await handler(args, ctx));
      },
    };
  }

  /**
   * Derive a tool listing from the registered tool call handlers when no explicit listing
   * provider was registered.
   */
  private _listToolsFromHandlers(): ToolListing[] {
    return [...this._toolHandlers.keys()]
      .filter((name) => name !== "*")
      .map((name) => ({ name, inputSchema: { type: "object" } as Record<string, unknown> }));
  }

  /**
   * Derive a resource listing from the registered resource handlers when no explicit
   * listing provider was registered.
   */
  private _listResourcesFromHandlers(): ResourceListing[] {
    return [...this._resourceHandlers.keys()]
      .filter((uri) => uri !== "*")
      .map((uri) => ({ uri }));
  }

  /**
   * Derive a prompt listing from the registered prompt handlers when no explicit listing
   * provider was registered.
   */
  private _listPromptsFromHandlers(): PromptListing[] {
    return [...this._promptHandlers.keys()]
      .filter((name) => name !== "*")
      .map((name) => ({ name }));
  }

  /**
   * Wrap a raw tool result into a {@link CallToolResult} unless already shaped.
   */
  private _normalizeToolResult(raw: unknown): CallToolResult {
    if (
      raw !== null &&
      typeof raw === "object" &&
      Array.isArray((raw as { content?: unknown }).content)
    ) {
      return raw as CallToolResult;
    }
    const text =
      typeof raw === "string"
        ? raw
        : (() => {
            try {
              return JSON.stringify(raw);
            } catch {
              return String(raw);
            }
          })();
    return { content: [{ type: "text", text }] };
  }

  /**
   * Wrap a raw prompt result into a {@link GetPromptResult} unless already shaped.
   */
  private _normalizePromptResult(raw: unknown): GetPromptResult {
    if (
      raw !== null &&
      typeof raw === "object" &&
      Array.isArray((raw as { messages?: unknown }).messages)
    ) {
      return raw as GetPromptResult;
    }
    const text =
      typeof raw === "string"
        ? raw
        : (() => {
            try {
              return JSON.stringify(raw);
            } catch {
              return String(raw);
            }
          })();
    return { messages: [{ role: "assistant", content: { type: "text", text } }] };
  }

  /**
   * Send a JSON-RPC notification to a session, returning the encoded wire text.
   *
   * @param sessionId Target session.
   * @param method Notification method name.
   * @param params Optional notification payload.
   * @returns The encoded notification text (e.g. to write to a transport stream).
   */
  sendNotification(sessionId: string, method: string, params?: unknown): string {
    this._requireSession(sessionId);
    const notification: JsonRpcNotification = {
      jsonrpc: "2.0",
      method,
    };
    if (params !== undefined) {
      notification.params = params;
    }
    this.emit("notificationSent", sessionId, method);
    return this._codec.encode(notification);
  }

  /**
   * Send a typed `notifications/tools/list_changed` notification to a session.
   */
  sendToolsListChanged(sessionId: string): string {
    return this.sendNotification(sessionId, MCP_METHOD.NotificationsToolsListChanged);
  }

  /**
   * Send a typed `notifications/resources/list_changed` notification to a session.
   */
  sendResourcesListChanged(sessionId: string): string {
    return this.sendNotification(sessionId, MCP_METHOD.NotificationsResourcesListChanged);
  }

  /**
   * Send a typed `notifications/prompts/list_changed` notification to a session.
   */
  sendPromptsListChanged(sessionId: string): string {
    return this.sendNotification(sessionId, MCP_METHOD.NotificationsPromptsListChanged);
  }

  /**
   * Prune idle sessions (and optionally enforce capacity), keeping the index in sync.
   *
   * @param options Prune options (idle threshold, capacity enforcement).
   * @returns The number of sessions pruned.
   */
  prune(options: { idleTimeoutMs?: number; enforceCapacity?: boolean; maxSessions?: number } = {}): number {
    const pruned = this._store.prune({
      idleTimeoutMs: options.idleTimeoutMs ?? this._config.sessionIdleTimeoutMs,
      enforceCapacity: options.enforceCapacity,
      maxSessions: options.maxSessions ?? this._config.maxSessions,
    });
    this._stats.totalPruned += pruned;
    return pruned;
  }

  /**
   * Invoke a tool directly (outside the wire protocol) for tests and programmatic use.
   *
   * @param sessionId Session context.
   * @param name Tool name.
   * @param args Tool arguments.
   * @returns The tool result.
   */
  invokeTool(sessionId: string, name: string, args?: unknown): Promise<unknown> {
    const ctx = this._buildContext(sessionId, Date.now());
    const fn = ctx.callTool;
    if (fn === undefined) {
      return Promise.reject(new Error(`No tool handler available for "${name}"`));
    }
    return Promise.resolve(fn(name, args, ctx));
  }

  /**
   * Read a resource directly (outside the wire protocol).
   */
  readResource(sessionId: string, uri: string): Promise<unknown> {
    const ctx = this._buildContext(sessionId, Date.now());
    const fn = ctx.readResource;
    if (fn === undefined) {
      return Promise.reject(new Error(`No resource handler available for "${uri}"`));
    }
    return Promise.resolve(fn(uri, ctx));
  }

  /**
   * Render a prompt directly (outside the wire protocol).
   */
  getPrompt(sessionId: string, name: string, args?: unknown): Promise<unknown> {
    const ctx = this._buildContext(sessionId, Date.now());
    const fn = ctx.getPrompt;
    if (fn === undefined) {
      return Promise.reject(new Error(`No prompt handler available for "${name}"`));
    }
    return Promise.resolve(fn(name, args, ctx));
  }

  /**
   * Aggregate server statistics from the store, index and dispatcher.
   */
  stats(): ServerStats {
    const storeStats = this._store.stats();
    const indexStats = this._index.stats();
    const dispatcherStats = this._dispatcher.stats();

    return {
      ...this._stats,
      totalSessions: storeStats.totalCreated,
      activeSessions: storeStats.active,
      initializedSessions: indexStats.initialized,
      pendingSessions: indexStats.pending,
      totalPruned: storeStats.totalPruned,
      totalRequests: dispatcherStats.totalRequests,
      totalNotifications: dispatcherStats.totalNotifications,
      totalErrors: dispatcherStats.totalErrors,
      startedAt: this._startedAt,
      lastActivityAt: dispatcherStats.lastActivityAt,
      requestsByMethod: dispatcherStats.requestsByMethod,
      averageSessionLifetimeMs: storeStats.averageLifetimeMs,
    };
  }

  /**
   * Serialise the full server state (config + sessions) for persistence.
   */
  toJSON(): {
    config: ServerConfig;
    sessions: McpSession[];
  } {
    return {
      config: this._config,
      sessions: this._store.values().map((session) => ({ ...session })),
    };
  }

  /**
   * Restore server state from {@link McpServer.toJSON}. The store and index are replaced;
   * running state is preserved.
   *
   * @returns The number of sessions restored.
   */
  fromJSON(data: { config?: Partial<ServerConfig>; sessions?: McpSession[] }): number {
    if (data.config !== undefined) {
      const merged = createServerConfig(data.config);
      this._replaceConfig(merged);
    }
    const restored = this._store.fromJSON({
      version: 1,
      config: this._store.config,
      sessions: data.sessions ?? [],
      closed: [],
    });
    this._index.rebuild(this._store.values());
    return restored;
  }

  /**
   * Swap the live configuration and rebuild dependent components.
   */
  private _replaceConfig(merged: ServerConfig): void {
    const cfg = this._config as ServerConfig;
    Object.assign(cfg, merged);
  }
}

/**
 * Factory for constructing a fully-configured {@link McpServer}.
 *
 * @param config Partial server configuration (or a full ServerOptions object).
 * @returns A ready-to-use McpServer (call `start()` before serving).
 */
export function createMcpServer(config?: Partial<ServerConfig> | ServerOptions): McpServer {
  if (config !== undefined && "config" in config && config !== null && typeof config === "object") {
    return new McpServer(config as ServerOptions);
  }
  return new McpServer({ config: config as Partial<ServerConfig> | undefined });
}

/**
 * All protocol versions this server build can negotiate. Exposed for transport adapters
 * that advertise the version set out-of-band.
 */
export const SERVER_PROTOCOL_VERSIONS: readonly ProtocolVersion[] = SUPPORTED_PROTOCOL_VERSIONS;

/**
 * The newest protocol version this server build speaks.
 */
export const SERVER_LATEST_PROTOCOL_VERSION: ProtocolVersion = LATEST_PROTOCOL_VERSION;

/**
 * Helper: check whether a decoded value looks like a successful JSON-RPC response. Useful
 * in transport adapters that forward dispatcher output to a peer.
 */
export function isSuccessResponse(value: JsonRpcResponse | undefined | null): value is JsonRpcSuccessResponse {
  return value !== undefined && value !== null && "result" in value;
}