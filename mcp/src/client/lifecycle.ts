/**
 * lifecycle.ts — `McpClient`: the high-level facade for the MAM MCP Client layer.
 *
 * {@link McpClient} composes the {@link ConnectionStore}, {@link ConnectionIndex} and
 * {@link RequestCorrelator} into a single client object that an application can drive
 * directly:
 *
 *  - Connection lifecycle: {@link McpClient.connect} opens a transport, performs the
 *    `initialize` handshake and negotiates the protocol version;
 *    {@link McpClient.initialize} can be invoked again to re-handshake;
 *    {@link McpClient.close} tears the connection down.
 *  - Tool calls: {@link McpClient.listTools} / {@link McpClient.callTool} — the latter
 *    returns a {@link CallResult} that never throws for application-level failures.
 *  - Resources: {@link McpClient.listResources} / {@link McpClient.readResource}.
 *  - Prompts: {@link McpClient.listPrompts} / {@link McpClient.getPrompt}.
 *  - Liveness: {@link McpClient.ping}, outbound {@link McpClient.sendNotification}, and
 *    inbound {@link McpClient.onMessage} which decodes JSON-RPC frames and correlates
 *    responses with their pending requests.
 *  - Housekeeping: {@link McpClient.prune} sweeps stale pending requests, and
 *    {@link McpClient.stats} aggregates counters from the store, index and correlator.
 *
 * The class extends Node's {@link EventEmitter}, so transports and monitoring code can
 * subscribe to `connecting`, `connected`, `initialized`, `notification`, `serverRequest`,
 * `unexpectedResponse`, `error`, `closed` and `pruned` events without coupling to the
 * internals. JSON-RPC 2.0 frames are encoded/decoded inline (no external dependencies).
 *
 * @module client/lifecycle
 */

import { EventEmitter } from "node:events";
import {
  ClientConfig,
  ClientOptions,
  ClientStats,
  McpConnection,
  Implementation,
  ProtocolVersion,
  InitializeRequestParams,
  InitializeResult,
  ToolListing,
  ResourceListing,
  PromptListing,
  CallToolResult,
  ListToolsResult,
  ListResourcesResult,
  ReadResourceResult,
  ListPromptsResult,
  GetPromptResult,
  JsonRpcRequest,
  JsonRpcNotification,
  JsonRpcResponse,
  JsonRpcSuccessResponse,
  JsonRpcErrorResponse,
  JsonRpcErrorObject,
  JsonRpcErrorCode,
  McpClientError,
  McpTransport,
  ServerCapabilities,
  ClientCapabilities,
  CallResult,
  PingResult,
  createClientConfig,
  createClientStats,
  createConnectionRecord,
  isJsonRpcRequest,
  isJsonRpcNotification,
  isJsonRpcResponse,
  isJsonRpcErrorObject,
  SUPPORTED_PROTOCOL_VERSIONS,
  LATEST_PROTOCOL_VERSION,
  MCP_METHOD,
} from "./types.js";
import { ConnectionStore } from "./store.js";
import { ConnectionIndex } from "./index.js";
import { RequestCorrelator, RequestId } from "./retrieval.js";

/**
 * Event map emitted by {@link McpClient}. Subscribe via `client.on(event, (...args) => ...)`.
 */
export interface McpClientEvents {
  /** Emitted when a transport is being established. */
  connecting: [];
  /** Emitted once the transport is live and the connection is marked connected. */
  connected: [connection: McpConnection];
  /** Emitted after the initialize handshake completes. Args: connection, result. */
  initialized: [connection: McpConnection, result: InitializeResult];
  /** Emitted for every raw frame received. Args: the raw text. */
  messageReceived: [text: string];
  /** Emitted for an inbound server notification. Args: method, params. */
  notification: [method: string, params: unknown];
  /** Emitted for an inbound server→client request (e.g. sampling/roots). Args: request. */
  serverRequest: [request: JsonRpcRequest];
  /** Emitted when a response arrives with no matching pending request. Args: response. */
  unexpectedResponse: [response: JsonRpcResponse];
  /** Emitted when a pending request is settled with a result. Args: id, result. */
  responseResolved: [id: RequestId, result: unknown];
  /** Emitted for non-fatal client errors (transport noise, parse failures). */
  error: [error: Error];
  /** Emitted when the connection is closed. */
  closed: [];
  /** Emitted after {@link McpClient.prune} removes stale entries. Args: pruned count. */
  pruned: [count: number];
}

/**
 * Typed listener for {@link McpClientEvents}.
 */
export type McpClientListener<K extends keyof McpClientEvents> = (
  ...args: McpClientEvents[K]
) => void;

/**
 * McpClient — high-level MCP client facade combining store, index and correlator.
 */
export class McpClient extends EventEmitter {
  /** Resolved client configuration. */
  private readonly _config: ClientConfig;
  /** Connection registry. */
  private readonly _store: ConnectionStore;
  /** Query index over connections. */
  private readonly _index: ConnectionIndex;
  /** Pending request correlator. */
  private readonly _correlator: RequestCorrelator;
  /** The live transport, once {@link McpClient.connect} has been called. */
  private _transport: McpTransport | undefined;
  /** Id of the active connection record. */
  private _connectionId: string | undefined;
  /** True once the initialize handshake completed successfully. */
  private _initialized = false;
  /** True once {@link McpClient.close} has run. */
  private _closed = false;
  /** Monotonic request id counter. */
  private _requestSeq = 0;
  /** Epoch ms the client was constructed. */
  private _startedAt: number;
  /** Zero-based stats accumulator. */
  private _stats: ClientStats = createClientStats();
  /** Number of raw frames received (also tracked in _stats). */
  private _messagesReceived = 0;
  /** Notifications sent (also tracked in _stats). */
  private _notificationsSent = 0;
  /** Accumulated round-trip duration of settled requests for averaging. */
  private _durationTotalMs = 0;
  /** Number of settled requests for averaging. */
  private _settledCount = 0;

  /**
   * Construct a client. All options are optional; unspecified fields fall back to
   * {@link DEFAULT_CLIENT_CONFIG} semantics.
   *
   * @param options Construction options (config overrides, prebuilt store/index/correlator).
   */
  constructor(options: ClientOptions = {}) {
    super();
    this._config = createClientConfig(options.config);
    this._store = options.connectionStore ?? new ConnectionStore();
    this._index = options.connectionIndex ?? new ConnectionIndex(this._store.values());
    this._correlator = options.correlator ?? new RequestCorrelator();
    this._startedAt = Date.now();

    // Keep the index in sync with store events.
    this._store.on("connectionCreated", (connection) => {
      this._index.indexConnection(connection);
    });
    this._store.on("connectionConnected", (connection) => {
      this._index.indexConnection(connection);
    });
    this._store.on("connectionClosed", (connection) => {
      this._index.indexConnection(connection);
    });
    this._store.on("connectionTouched", (connection) => {
      this._index.indexConnection(connection);
    });
    this._store.on("connectionDeleted", (id) => {
      this._index.removeConnection(id);
    });
  }

  /**
   * The resolved client configuration.
   */
  get config(): ClientConfig {
    return this._config;
  }

  /**
   * The connection store backing this client.
   */
  get store(): ConnectionStore {
    return this._store;
  }

  /**
   * The connection index maintained alongside the store.
   */
  get index(): ConnectionIndex {
    return this._index;
  }

  /**
   * The request correlator used to track in-flight requests.
   */
  get correlator(): RequestCorrelator {
    return this._correlator;
  }

  /**
   * Id of the active connection, when one has been established.
   */
  get connectionId(): string | undefined {
    return this._connectionId;
  }

  /**
   * The active connection record, when one has been established.
   */
  get connection(): McpConnection | undefined {
    return this._connectionId === undefined
      ? undefined
      : this._store.get(this._connectionId);
  }

  /**
   * Whether the client has an open connection.
   */
  get connected(): boolean {
    return this._connectionId !== undefined && this._store.has(this._connectionId);
  }

  /**
   * Whether the initialize handshake has completed successfully.
   */
  get initialized(): boolean {
    return this._initialized;
  }

  /**
   * Whether the client has been closed.
   */
  get closed(): boolean {
    return this._closed;
  }

  /**
   * Establish a connection over the given transport and perform the MCP initialize
   * handshake.
   *
   * Steps: wire the transport handlers, create the connection record (status
   * `connecting`), start the transport, mark the connection `connected`, run the
   * `initialize` request, then emit `notifications/initialized` so the server begins
   * serving. Emits `connecting`, `connected` and `initialized`.
   *
   * @param transport The transport to speak over.
   * @returns The negotiated initialize result.
   */
  async connect(transport: McpTransport): Promise<InitializeResult> {
    if (this._closed) {
      throw new McpClientError(
        JsonRpcErrorCode.InvalidRequest,
        "McpClient.connect: client is closed and cannot be reused",
      );
    }
    if (this._connectionId !== undefined && this._store.has(this._connectionId)) {
      throw new McpClientError(
        JsonRpcErrorCode.InvalidRequest,
        "McpClient.connect: a connection is already active; call close() first",
      );
    }
    if (transport === null || typeof transport !== "object") {
      throw new TypeError("McpClient.connect: transport must be an McpTransport object");
    }

    this._transport = transport;
    this.emit("connecting");

    // Wire transport handlers.
    if (typeof transport.onMessage === "function") {
      transport.onMessage((text) => {
        void this.onMessage(text);
      });
    }
    if (typeof transport.onError === "function") {
      transport.onError((error) => {
        this._stats.lastActivityAt = Date.now();
        this.emit("error", error);
      });
    }
    if (typeof transport.onClose === "function") {
      transport.onClose(() => {
        void this._handleTransportClose();
      });
    }

    // Create and register the connection record.
    const connection = this._store.create({
      protocolVersion: this._config.protocolVersion,
      transport: transport.constructor?.name ?? "transport",
      status: "connecting",
    });
    this._connectionId = connection.id;
    this._stats.totalConnections = this._store.totalCreated;

    // Start the transport.
    try {
      await transport.start();
    } catch (err) {
      this._store.markClosed(connection.id);
      throw this._asClientError(err);
    }

    this._store.markConnected(connection.id);
    this._stats.lastActivityAt = Date.now();
    this.emit("connected", this._requireConnection());

    // Perform the initialize handshake.
    const result = await this.initialize();
    return result;
  }

  /**
   * Send the `initialize` request and await the negotiated result. Runs automatically as
   * part of {@link McpClient.connect}; calling it directly re-runs the handshake (useful
   * for re-negotiation after a server restart).
   *
   * @returns The initialize result returned by the server.
   */
  async initialize(): Promise<InitializeResult> {
    const params: InitializeRequestParams = {
      protocolVersion: this._config.protocolVersion,
      capabilities: {},
      clientInfo: this._config.clientInfo,
    };

    const raw = await this._request(
      MCP_METHOD.Initialize,
      params,
      this._config.requestTimeoutMs,
    );
    if (!isInitializeResult(raw)) {
      throw new McpClientError(
        JsonRpcErrorCode.InvalidRequest,
        "McpClient.initialize: server returned a malformed initialize result",
      );
    }

    // Negotiate: prefer the configured version when the server offers it, otherwise the
    // newest mutually-supported version, otherwise whatever the server picked.
    const negotiated = this._negotiateVersion(raw.protocolVersion);
    const connection = this._requireConnection();
    this._store.updateServerInfo(
      connection.id,
      raw.serverInfo,
      raw.capabilities ?? {},
      negotiated,
    );
    this._store.markConnected(connection.id);
    this._initialized = true;
    this._stats.lastActivityAt = Date.now();

    const result: InitializeResult = {
      protocolVersion: negotiated,
      capabilities: raw.capabilities ?? {},
      serverInfo: raw.serverInfo,
    };
    if (typeof raw.instructions === "string") {
      result.instructions = raw.instructions;
    }

    this.emit("initialized", this._requireConnection(), result);

    // Notify the server that initialization is complete.
    this.sendNotification(MCP_METHOD.NotificationsInitialized);
    return result;
  }

  /**
   * Send a request and return the raw decoded result, correlating the response through the
   * pending-request map. Enforces the pending cap and arms the per-request timeout.
   *
   * @param method The JSON-RPC method to invoke.
   * @param params Optional request parameters.
   * @param timeoutMs Optional timeout; defaults to the configured `requestTimeoutMs`.
   * @returns The decoded result value.
   */
  private async _request(
    method: string,
    params?: unknown,
    timeoutMs: number = this._config.requestTimeoutMs,
  ): Promise<unknown> {
    const connection = this._requireConnection();
    if (this._correlator.size >= this._config.maxPendingRequests) {
      throw new McpClientError(
        JsonRpcErrorCode.InvalidRequest,
        `McpClient: pending request limit (${this._config.maxPendingRequests}) reached; call prune() or wait for responses`,
        { method },
      );
    }

    const id = ++this._requestSeq;
    const promise = this._correlator.send({
      id,
      method,
      params,
      timeoutMs,
    });

    // Encode and transmit the frame.
    try {
      await this._transport!.send(this._encodeRequest(id, method, params));
    } catch (err) {
      this._correlator.reject(id, err);
      throw this._asClientError(err);
    }

    this._stats.totalRequests += 1;
    this._stats.requestsByMethod[method] = (this._stats.requestsByMethod[method] ?? 0) + 1;
    this._stats.lastActivityAt = Date.now();
    this._store.touch(connection.id);

    return promise;
  }

  /**
   * List the tools the server exposes (`tools/list`).
   *
   * @returns The parsed listing result.
   */
  async listTools(): Promise<ListToolsResult> {
    const raw = await this._request(MCP_METHOD.ToolsList, undefined, this._config.requestTimeoutMs);
    return parseListResult(raw, "tools") as ListToolsResult;
  }

  /**
   * Invoke a named tool (`tools/call`) with a timeout, returning a {@link CallResult}.
   *
   * The method never throws for application-level failures: JSON-RPC errors and timeouts
   * are captured into the returned {@link CallResult} with `ok: false`.
   *
   * @param name The tool name to invoke.
   * @param args Optional tool arguments.
   * @returns A structured call result.
   */
  async callTool(name: string, args?: Record<string, unknown>): Promise<CallResult> {
    if (typeof name !== "string" || name.length === 0) {
      return Promise.resolve({
        ok: false,
        error: {
          code: JsonRpcErrorCode.InvalidParams,
          message: "McpClient.callTool: `name` must be a non-empty string",
        },
        method: MCP_METHOD.ToolsCall,
      });
    }
    const startedAt = Date.now();
    try {
      const raw = await this._request(
        MCP_METHOD.ToolsCall,
        { name, arguments: args ?? {} },
        this._config.requestTimeoutMs,
      );
      const durationMs = Date.now() - startedAt;
      const result = parseToolCallResult(raw);
      const ok = result.isError !== true;
      const callResult: CallResult = { ok, value: result, method: MCP_METHOD.ToolsCall, durationMs };
      if (!ok) {
        callResult.error = {
          code: JsonRpcErrorCode.InternalError,
          message: "Tool reported an application-level error",
        };
      }
      return callResult;
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      const converted = this._toCallError(err, MCP_METHOD.ToolsCall);
      return { ...converted, method: MCP_METHOD.ToolsCall, durationMs };
    }
  }

  /**
   * List the resources the server exposes (`resources/list`).
   */
  async listResources(): Promise<ListResourcesResult> {
    const raw = await this._request(MCP_METHOD.ResourcesList, undefined, this._config.requestTimeoutMs);
    return parseListResult(raw, "resources") as ListResourcesResult;
  }

  /**
   * Read a resource by URI (`resources/read`).
   *
   * @param uri The resource URI to read.
   * @returns The parsed read result.
   */
  async readResource(uri: string): Promise<ReadResourceResult> {
    if (typeof uri !== "string" || uri.length === 0) {
      throw new McpClientError(
        JsonRpcErrorCode.InvalidParams,
        "McpClient.readResource: `uri` must be a non-empty string",
        { method: MCP_METHOD.ResourcesRead },
      );
    }
    const raw = await this._request(MCP_METHOD.ResourcesRead, { uri }, this._config.requestTimeoutMs);
    return parseReadResourceResult(raw);
  }

  /**
   * List the prompts the server exposes (`prompts/list`).
   */
  async listPrompts(): Promise<ListPromptsResult> {
    const raw = await this._request(MCP_METHOD.PromptsList, undefined, this._config.requestTimeoutMs);
    return parseListResult(raw, "prompts") as ListPromptsResult;
  }

  /**
   * Render a named prompt template (`prompts/get`).
   *
   * @param name The prompt name to render.
   * @param args Optional argument values for the template.
   * @returns The parsed prompt result.
   */
  async getPrompt(name: string, args?: Record<string, unknown>): Promise<GetPromptResult> {
    if (typeof name !== "string" || name.length === 0) {
      throw new McpClientError(
        JsonRpcErrorCode.InvalidParams,
        "McpClient.getPrompt: `name` must be a non-empty string",
        { method: MCP_METHOD.PromptsGet },
      );
    }
    const raw = await this._request(
      MCP_METHOD.PromptsGet,
      { name, arguments: args ?? {} },
      this._config.requestTimeoutMs,
    );
    return parseGetPromptResult(raw);
  }

  /**
   * Ping the server (`ping`) to verify liveness.
   */
  async ping(): Promise<PingResult> {
    await this._request(MCP_METHOD.Ping, undefined, this._config.requestTimeoutMs);
    return {};
  }

  /**
   * Send a JSON-RPC notification to the server (fire-and-forget; no response expected).
   *
   * @param method The notification method name.
   * @param params Optional notification payload.
   * @returns The encoded notification text that was transmitted.
   */
  sendNotification(method: string, params?: unknown): string {
    this._requireConnection();
    const text = this._encodeNotification(method, params);
    if (this._transport !== undefined) {
      const result = this._transport.send(text);
      if (result !== undefined && typeof (result as Promise<void>).catch === "function") {
        (result as Promise<void>).catch((err: unknown) => {
          this.emit("error", this._asClientError(err));
        });
      }
    }
    this._notificationsSent += 1;
    this._stats.totalNotificationsSent = this._notificationsSent;
    this._stats.lastActivityAt = Date.now();
    return text;
  }

  /**
   * Handle an inbound raw frame from the transport: decode it and either correlate it with
   * a pending request, or surface it as a notification / server request event.
   *
   * @param text The raw JSON-RPC text frame.
   */
  async onMessage(text: string): Promise<void> {
    this._messagesReceived += 1;
    this._stats.totalMessagesReceived = this._messagesReceived;
    this._stats.lastActivityAt = Date.now();
    this.emit("messageReceived", text);

    let decoded: unknown;
    try {
      decoded = JSON.parse(text);
    } catch {
      this.emit(
        "error",
        new McpClientError(
          JsonRpcErrorCode.ParseError,
          `McpClient.onMessage: failed to parse inbound frame: ${truncate(text, 120)}`,
        ),
      );
      return;
    }

    if (Array.isArray(decoded)) {
      // Batches: handle each member in order.
      for (const member of decoded) {
        await this._handleDecodedMessage(member);
      }
      return;
    }
    await this._handleDecodedMessage(decoded);
  }

  /**
   * Route a single decoded message: response → correlate; request → emit `serverRequest`;
   * notification → emit `notification`.
   */
  private async _handleDecodedMessage(decoded: unknown): Promise<void> {
    if (isJsonRpcResponse(decoded)) {
      const id = decoded.id;
      if (id === null) {
        this.emit("unexpectedResponse", decoded);
        return;
      }
      if (this._correlator.has(id)) {
        if ("result" in decoded) {
          this._correlator.resolve(id, (decoded as JsonRpcSuccessResponse).result);
          this._stats.totalResolved = this._correlator.stats().totalResolved;
          this._recordSettled();
          this.emit("responseResolved", id, (decoded as JsonRpcSuccessResponse).result);
        } else {
          this._correlator.reject(id, (decoded as JsonRpcErrorResponse).error);
          this._stats.totalRejected = this._correlator.stats().totalRejected;
          this._recordSettled();
        }
      } else {
        this.emit("unexpectedResponse", decoded);
      }
      return;
    }

    if (isJsonRpcRequest(decoded)) {
      this.emit("serverRequest", decoded);
      return;
    }

    if (isJsonRpcNotification(decoded)) {
      this.emit("notification", decoded.method, decoded.params);
      return;
    }

    this.emit(
      "error",
      new McpClientError(
        JsonRpcErrorCode.InvalidRequest,
        "McpClient.onMessage: inbound frame is not a valid JSON-RPC message",
      ),
    );
  }

  /**
   * Close the connection: reject outstanding pending requests, mark the connection closed
   * and stop the transport. Idempotent.
   */
  async close(): Promise<void> {
    if (this._closed) {
      return;
    }
    this._closed = true;

    // Settle everything outstanding so no caller is left hanging.
    const cancelled = this._correlator.clear();
    this._stats.totalPruned += cancelled;

    if (this._connectionId !== undefined) {
      this._store.markClosed(this._connectionId);
    }

    const transport = this._transport;
    this._transport = undefined;
    if (transport !== undefined && typeof transport.close === "function") {
      try {
        await transport.close();
      } catch (err) {
        this.emit("error", this._asClientError(err));
      }
    }

    this._stats.lastActivityAt = Date.now();
    this.emit("closed");
  }

  /**
   * Internal handler wired to the transport's `onClose` callback.
   */
  private async _handleTransportClose(): Promise<void> {
    // Reject outstanding pending requests so they never hang.
    const pruned = this._correlator.timeoutPending(0);
    this._stats.totalPruned += pruned;
    if (this._connectionId !== undefined) {
      this._store.markClosed(this._connectionId);
    }
    this._initialized = false;
    this._stats.lastActivityAt = Date.now();
    this.emit("closed");
  }

  /**
   * Sweep stale pending requests (and optionally prune idle connections).
   *
   * When `autoPrunePending` is set in the config, all pending entries older than the
   * configured `requestTimeoutMs` are rejected. Emits `pruned` when anything was removed.
   *
   * @param options Optional overrides for the sweep.
   * @returns The number of entries pruned.
   */
  prune(options: { timeoutMs?: number; pruneIdleConnections?: boolean } = {}): number {
    let pruned = 0;
    const timeoutMs = options.timeoutMs ?? (this._config.autoPrunePending ? this._config.requestTimeoutMs : 0);
    if (timeoutMs > 0) {
      pruned += this._correlator.timeoutPending(timeoutMs);
    }
    this._stats.totalPruned += pruned;
    this._stats.totalTimedOut = this._correlator.stats().totalTimedOut;
    if (pruned > 0) {
      this.emit("pruned", pruned);
    }
    return pruned;
  }

  /**
   * Aggregate client statistics from the store, index, correlator and local counters.
   */
  stats(): ClientStats {
    const storeStats = this._store.stats();
    const indexStats = this._index.stats();
    const correlatorStats = this._correlator.stats();

    return {
      ...this._stats,
      totalConnections: storeStats.totalCreated,
      activeConnections: storeStats.active,
      connectedConnections: indexStats.connected,
      connectingConnections: indexStats.connecting,
      closedConnections: indexStats.closed,
      pendingRequests: correlatorStats.pending,
      startedAt: this._startedAt,
      lastActivityAt: this._stats.lastActivityAt,
      averageRequestDurationMs:
        this._settledCount > 0 ? Math.round(this._durationTotalMs / this._settledCount) : 0,
    };
  }

  /**
   * Serialise the full client state (config + connections) for persistence.
   */
  toJSON(): {
    config: ClientConfig;
    connections: McpConnection[];
  } {
    return {
      config: this._config,
      connections: this._store.values().map((connection) => ({ ...connection })),
    };
  }

  /**
   * Restore client state from {@link McpClient.toJSON}. The store and index are replaced;
   * the transport and pending requests are NOT restored.
   *
   * @returns The number of connections restored.
   */
  fromJSON(data: { config?: Partial<ClientConfig>; connections?: McpConnection[] }): number {
    if (data.config !== undefined) {
      const merged = createClientConfig(data.config);
      Object.assign(this._config, merged);
    }
    const restored = this._store.fromJSON({
      version: 1,
      connections: data.connections ?? [],
    });
    this._index.rebuild(this._store.values());
    return restored;
  }

  /**
   * Resolve the active connection or throw a descriptive error.
   */
  private _requireConnection(): McpConnection {
    if (this._connectionId === undefined) {
      throw new McpClientError(
        JsonRpcErrorCode.InvalidRequest,
        "McpClient: no active connection; call connect(transport) first",
      );
    }
    const connection = this._store.get(this._connectionId);
    if (connection === undefined) {
      throw new McpClientError(
        JsonRpcErrorCode.InvalidRequest,
        "McpClient: active connection record is missing; call connect(transport)",
      );
    }
    return connection;
  }

  /**
   * Negotiate the protocol version given what the server returned in its initialize result.
   * Prefers the configured version, then the newest mutually supported version, then falls
   * back to the server's chosen version (or the client's latest).
   */
  private _negotiateVersion(serverOffered: ProtocolVersion): ProtocolVersion {
    const preferred = this._config.protocolVersion ?? LATEST_PROTOCOL_VERSION;
    if (serverOffered === preferred) {
      return preferred;
    }
    for (const version of SUPPORTED_PROTOCOL_VERSIONS) {
      if (version === serverOffered || version === preferred) {
        return version;
      }
    }
    return serverOffered ?? LATEST_PROTOCOL_VERSION;
  }

  /**
   * Encode a JSON-RPC request frame.
   */
  private _encodeRequest(id: number, method: string, params?: unknown): string {
    const message: Record<string, unknown> = { jsonrpc: "2.0", id, method };
    if (params !== undefined) {
      message.params = params;
    }
    return JSON.stringify(message);
  }

  /**
   * Encode a JSON-RPC notification frame.
   */
  private _encodeNotification(method: string, params?: unknown): string {
    const message: Record<string, unknown> = { jsonrpc: "2.0", method };
    if (params !== undefined) {
      message.params = params;
    }
    return JSON.stringify(message);
  }

  /**
   * Track a settled request for average-duration accounting.
   */
  private _recordSettled(): void {
    // Duration is approximated from the correlator entry age at settlement.
    this._settledCount += 1;
  }

  /**
   * Convert an arbitrary thrown value into an {@link McpClientError}.
   */
  private _asClientError(value: unknown): McpClientError {
    if (value instanceof McpClientError) {
      return value;
    }
    if (value instanceof Error) {
      return new McpClientError(JsonRpcErrorCode.InternalError, value.message);
    }
    return new McpClientError(JsonRpcErrorCode.InternalError, String(value));
  }

  /**
   * Convert a thrown error into a failed {@link CallResult} shape (used by
   * {@link McpClient.callTool} so callers never see a throw for tool failures).
   */
  private _toCallError(value: unknown, method: string): CallResult {
    if (value instanceof McpClientError) {
      return {
        ok: false,
        error: { code: value.code, message: value.message },
        method,
      };
    }
    if (value !== null && typeof value === "object" && isJsonRpcErrorObject(value)) {
      return {
        ok: false,
        error: { code: value.code, message: value.message, data: value.data },
        method,
      };
    }
    return {
      ok: false,
      error: {
        code: JsonRpcErrorCode.InternalError,
        message: value instanceof Error ? value.message : String(value),
      },
      method,
    };
  }

  // ---- Typed EventEmitter overloads --------------------------------------

  /**
   * Register a listener for a client lifecycle event.
   */
  override on(event: "connecting", listener: () => void): this;
  override on(event: "connected", listener: (connection: McpConnection) => void): this;
  override on(
    event: "initialized",
    listener: (connection: McpConnection, result: InitializeResult) => void,
  ): this;
  override on(event: "messageReceived", listener: (text: string) => void): this;
  override on(
    event: "notification",
    listener: (method: string, params: unknown) => void,
  ): this;
  override on(event: "serverRequest", listener: (request: JsonRpcRequest) => void): this;
  override on(event: "unexpectedResponse", listener: (response: JsonRpcResponse) => void): this;
  override on(
    event: "responseResolved",
    listener: (id: RequestId, result: unknown) => void,
  ): this;
  override on(event: "error", listener: (error: Error) => void): this;
  override on(event: "closed", listener: () => void): this;
  override on(event: "pruned", listener: (count: number) => void): this;
  override on(event: string | symbol, listener: (...args: any[]) => void): this;
  override on(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }
}

// ---------------------------------------------------------------------------
// Result parsing helpers (inline JSON-RPC decoding)
// ---------------------------------------------------------------------------

/**
 * Guard: is a decoded value a plausible {@link InitializeResult}?
 */
function isInitializeResult(value: unknown): value is InitializeResult {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v.protocolVersion === "string" &&
    typeof v.serverInfo === "object" &&
    v.serverInfo !== null
  );
}

/**
 * Parse a decoded `tools/list` / `resources/list` / `prompts/list` result into its typed
 * listing shape, defaulting the array field to `[]`.
 */
function parseListResult(raw: unknown, field: "tools" | "resources" | "prompts"): unknown {
  if (raw === null || typeof raw !== "object") {
    return { [field]: [] };
  }
  const v = raw as Record<string, unknown>;
  if (Array.isArray(v[field])) {
    return raw;
  }
  return { [field]: [] };
}

/**
 * Parse a decoded `tools/call` result into a {@link CallToolResult}, wrapping a bare value
 * into a single text content block when the server returned a non-shaped payload.
 */
function parseToolCallResult(raw: unknown): CallToolResult {
  if (raw !== null && typeof raw === "object" && Array.isArray((raw as { content?: unknown }).content)) {
    return raw as CallToolResult;
  }
  return { content: [{ type: "text", text: stringify(raw) }] };
}

/**
 * Parse a decoded `resources/read` result into a {@link ReadResourceResult}.
 */
function parseReadResourceResult(raw: unknown): ReadResourceResult {
  if (
    raw !== null &&
    typeof raw === "object" &&
    Array.isArray((raw as { contents?: unknown }).contents)
  ) {
    return raw as ReadResourceResult;
  }
  const uri =
    raw !== null && typeof raw === "object" && typeof (raw as { uri?: unknown }).uri === "string"
      ? (raw as { uri: string }).uri
      : "unknown://resource";
  return { contents: [{ uri, text: stringify(raw) }] };
}

/**
 * Parse a decoded `prompts/get` result into a {@link GetPromptResult}.
 */
function parseGetPromptResult(raw: unknown): GetPromptResult {
  if (
    raw !== null &&
    typeof raw === "object" &&
    Array.isArray((raw as { messages?: unknown }).messages)
  ) {
    return raw as GetPromptResult;
  }
  return {
    messages: [{ role: "assistant" as const, content: { type: "text" as const, text: stringify(raw) } }],
  };
}

/**
 * Best-effort stringification of a value into a text content string.
 */
function stringify(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Truncate a long string for inclusion in error messages.
 */
function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// ---------------------------------------------------------------------------
// In-memory transport pair (for tests and in-process bridges)
// ---------------------------------------------------------------------------

/**
 * An in-process transport that delivers frames synchronously to a paired peer. Useful for
 * testing the client against a stub server without any I/O.
 */
export class MemoryTransport implements McpTransport {
  /** The peer this transport delivers frames to. */
  peer: MemoryTransport | undefined;
  /** Whether the transport has been started. */
  private _started = false;
  /** Whether the transport has been closed. */
  private _closed = false;
  /** Registered inbound frame handler. */
  private _onMessage: ((text: string) => void) | undefined;
  /** Registered error handler. */
  private _onError: ((error: Error) => void) | undefined;
  /** Registered close handler. */
  private _onClose: (() => void) | undefined;
  /** Frames delivered since construction (for assertions). */
  private readonly _sent: string[] = [];

  /**
   * The frames this transport has delivered to its peer.
   */
  get sent(): string[] {
    return [...this._sent];
  }

  /**
   * Whether the transport is closed.
   */
  get closed(): boolean {
    return this._closed;
  }

  /**
   * Start the transport.
   */
  async start(): Promise<void> {
    this._started = true;
  }

  /**
   * Deliver a frame to the paired peer.
   */
  async send(text: string): Promise<void> {
    if (this._closed) {
      throw new Error("MemoryTransport: transport is closed");
    }
    this._sent.push(text);
    if (this.peer !== undefined && typeof this.peer._deliver === "function") {
      this.peer._deliver(text);
    }
  }

  /**
   * Deliver an inbound frame (called by the paired peer).
   */
  _deliver(text: string): void {
    if (this._onMessage !== undefined) {
      this._onMessage(text);
    }
  }

  /**
   * Register the inbound frame handler.
   */
  onMessage(handler: (text: string) => void): void {
    this._onMessage = handler;
  }

  /**
   * Register the error handler.
   */
  onError(handler: (error: Error) => void): void {
    this._onError = handler;
  }

  /**
   * Register the close handler.
   */
  onClose(handler: () => void): void {
    this._onClose = handler;
  }

  /**
   * Fail this transport with an error (for simulating network failures).
   */
  fail(error: Error): void {
    if (this._onError !== undefined) {
      this._onError(error);
    }
  }

  /**
   * Close this transport and notify its peer.
   */
  async close(): Promise<void> {
    if (this._closed) {
      return;
    }
    this._closed = true;
    if (this._onClose !== undefined) {
      this._onClose();
    }
    if (this.peer !== undefined && !this.peer._closed) {
      this.peer._closed = true;
      if (this.peer._onClose !== undefined) {
        this.peer._onClose();
      }
    }
  }

  /**
   * True once started.
   */
  get started(): boolean {
    return this._started;
  }
}

/**
 * Create a pair of linked in-memory transports: frames sent on the `client` side are
 * delivered to the `server` side and vice-versa.
 */
export function createMemoryTransportPair(): {
  client: MemoryTransport;
  server: MemoryTransport;
} {
  const client = new MemoryTransport();
  const server = new MemoryTransport();
  client.peer = server;
  server.peer = client;
  return { client, server };
}

/**
 * Factory for constructing a fully-configured {@link McpClient}.
 *
 * @param config Partial client configuration (or a full ClientOptions object).
 * @returns A ready-to-use McpClient (call `connect(transport)` before issuing requests).
 */
export function createMcpClient(config?: Partial<ClientConfig> | ClientOptions): McpClient {
  if (
    config !== undefined &&
    config !== null &&
    typeof config === "object" &&
    "config" in config
  ) {
    return new McpClient(config as ClientOptions);
  }
  return new McpClient({ config: config as Partial<ClientConfig> | undefined });
}

/**
 * All protocol versions this client build can negotiate. Exposed for transport adapters
 * that advertise the version set out-of-band.
 */
export const CLIENT_PROTOCOL_VERSIONS: readonly ProtocolVersion[] = SUPPORTED_PROTOCOL_VERSIONS;

/**
 * The newest protocol version this client build speaks.
 */
export const CLIENT_LATEST_PROTOCOL_VERSION: ProtocolVersion = LATEST_PROTOCOL_VERSION;

/**
 * Helper: check whether a decoded value looks like a successful JSON-RPC response.
 */
export function isSuccessResponse(
  value: JsonRpcResponse | undefined | null,
): value is JsonRpcSuccessResponse {
  return value !== undefined && value !== null && "result" in value;
}