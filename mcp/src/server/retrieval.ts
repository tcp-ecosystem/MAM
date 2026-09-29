/**
 * retrieval.ts — `RequestDispatcher`: routes parsed JSON-RPC messages to handlers.
 *
 * The dispatcher is the pure routing core of the server layer. It accepts a parsed
 * JSON-RPC message (or batch) and produces the correct response envelope, applying these
 * rules:
 *
 *  - Requests carry an `id` and always produce exactly one response.
 *  - Notifications carry no `id` and never produce a response.
 *  - Batches are processed in order; only requests contribute responses.
 *  - Unknown methods produce a {@link JsonRpcErrorCode.MethodNotFound} error response.
 *  - Exceptions thrown by handlers are normalised into error responses (an
 *    {@link McpRequestError} is honoured verbatim; anything else becomes `InternalError`).
 *
 * The dispatcher natively understands the core MCP methods — `initialize`, `ping`,
 * `tools/list`, `tools/call`, `resources/list`, `resources/read`, `prompts/list`,
 * `prompts/get` — delegating to context-provided accessors so the lifecycle layer can wire
 * in real tool/resource/prompt registries without the dispatcher knowing about them.
 *
 * @module server/retrieval
 */

import {
  JSONRPC_VERSION,
  JsonRpcErrorCode,
  JsonRpcRequest,
  JsonRpcNotification,
  JsonRpcResponse,
  JsonRpcSuccessResponse,
  JsonRpcErrorResponse,
  JsonRpcErrorObject,
  ParsedMessage,
  DispatchOutput,
  DispatchResult,
  HandlerResult,
  McpSession,
  ProtocolVersion,
  ServerConfig,
  ServerCapabilities,
  Implementation,
  InitializeRequestParams,
  InitializeResult,
  ToolListing,
  ResourceListing,
  PromptListing,
  CallToolResult,
  ResourceContents,
  GetPromptResult,
  McpRequestError,
  isJsonRpcRequest,
  isJsonRpcNotification,
  SUPPORTED_PROTOCOL_VERSIONS,
  LATEST_PROTOCOL_VERSION,
  MCP_METHOD,
} from "./types.js";

/**
 * A handler function for a JSON-RPC method. It receives the decoded `params` and a
 * dispatch context, and may return any JSON-serialisable value (or a promise thereof).
 */
export type HandlerFn = (
  params: unknown,
  ctx: DispatchContext,
) => unknown | Promise<unknown>;

/**
 * A map of method name to handler function. This is the shape accepted by
 * {@link RequestDispatcher.dispatch} as the `handlers` argument.
 */
export type HandlerRegistry = Record<string, HandlerFn>;

/**
 * Accessors the dispatcher uses to fulfil the core MCP methods. The lifecycle layer builds
 * these from its own registries, so the dispatcher stays free of application concerns.
 */
export interface DispatcherAccessors {
  /** Provide the tool list for `tools/list`. Defaults to an empty list. */
  listTools?: (ctx: DispatchContext) => ToolListing[] | Promise<ToolListing[]>;
  /** Invoke a named tool for `tools/call`. Throwing produces an error response. */
  callTool?: (name: string, args: unknown, ctx: DispatchContext) => unknown | Promise<unknown>;
  /** Provide the resource list for `resources/list`. Defaults to an empty list. */
  listResources?: (ctx: DispatchContext) => ResourceListing[] | Promise<ResourceListing[]>;
  /** Read a resource by URI for `resources/read`. */
  readResource?: (uri: string, ctx: DispatchContext) => unknown | Promise<unknown>;
  /** Provide the prompt list for `prompts/list`. Defaults to an empty list. */
  listPrompts?: (ctx: DispatchContext) => PromptListing[] | Promise<PromptListing[]>;
  /** Render a named prompt for `prompts/get`. */
  getPrompt?: (name: string, args: unknown, ctx: DispatchContext) => unknown | Promise<unknown>;
  /** Hook fired after a successful `initialize` so the session can be marked initialized. */
  onInitialized?: (ctx: DispatchContext, params: InitializeRequestParams) => void | Promise<void>;
}

/**
 * Per-message context passed to every handler. Carries the session, server identity,
 * resolved configuration and the accessors for core MCP methods.
 */
export interface DispatchContext extends DispatcherAccessors {
  /** The session the message is associated with, when resolvable. */
  session: McpSession | undefined;
  /** Id of the associated session, when known. */
  sessionId: string | null;
  /** Resolved server configuration. */
  serverConfig: ServerConfig;
  /** Server identity reported to clients. */
  serverInfo: Implementation;
  /** Capabilities advertised in initialize results. */
  capabilities: ServerCapabilities;
  /** The negotiated protocol version for this dispatch. */
  protocolVersion: ProtocolVersion;
  /** Epoch ms at which this dispatch began. */
  startedAt: number;
}

/**
 * Options for constructing a {@link RequestDispatcher}.
 */
export interface DispatcherOptions {
  /** Resolved server configuration. */
  config: ServerConfig;
  /** Server identity. Defaults to the config's serverInfo. */
  serverInfo?: Implementation;
  /** Capabilities advertised to clients. Defaults to an empty capability set. */
  capabilities?: ServerCapabilities;
  /** Initial handlers to register. */
  handlers?: HandlerRegistry;
}

/**
 * RequestDispatcher — routes parsed JSON-RPC messages to handlers and builds responses.
 */
export class RequestDispatcher {
  /** Resolved server configuration. */
  private readonly _config: ServerConfig;
  /** Server identity reported to clients. */
  private readonly _serverInfo: Implementation;
  /** Capabilities advertised in initialize results. */
  private readonly _capabilities: ServerCapabilities;
  /** User-registered handlers by method name. */
  private readonly _handlers: Map<string, HandlerFn>;
  /** Total requests dispatched. */
  private _totalRequests = 0;
  /** Total notifications dispatched. */
  private _totalNotifications = 0;
  /** Total errors produced. */
  private _totalErrors = 0;
  /** Epoch ms of the most recent dispatch. */
  private _lastActivityAt = 0;
  /** Requests counted by method name. */
  private readonly _requestsByMethod: Map<string, number>;

  /**
   * Construct a dispatcher.
   */
  constructor(options: DispatcherOptions) {
    this._config = options.config;
    this._serverInfo = options.serverInfo ?? options.config.serverInfo;
    this._capabilities = options.capabilities ?? {};
    this._handlers = new Map<string, HandlerFn>();
    this._requestsByMethod = new Map<string, number>();
    if (options.handlers !== undefined) {
      for (const [method, fn] of Object.entries(options.handlers)) {
        this._handlers.set(method, fn);
      }
    }
  }

  /**
   * Resolved server configuration.
   */
  get config(): ServerConfig {
    return this._config;
  }

  /**
   * Register (or replace) a handler for a JSON-RPC method.
   *
   * @returns This dispatcher, for chaining.
   */
  registerHandler(method: string, fn: HandlerFn): this {
    if (typeof method !== "string" || method.length === 0) {
      throw new TypeError("registerHandler: method must be a non-empty string");
    }
    if (typeof fn !== "function") {
      throw new TypeError("registerHandler: handler must be a function");
    }
    this._handlers.set(method, fn);
    return this;
  }

  /**
   * Remove a handler by method name.
   *
   * @returns True when a handler was removed.
   */
  unregisterHandler(method: string): boolean {
    return this._handlers.delete(method);
  }

  /**
   * Whether a handler is registered for the given method.
   */
  hasHandler(method: string): boolean {
    return this._handlers.has(method);
  }

  /**
   * The set of methods with registered handlers.
   */
  registeredMethods(): string[] {
    return [...this._handlers.keys()];
  }

  /**
   * Route a parsed JSON-RPC message (or batch) to its handler and produce the response.
   *
   * Notifications return `null`. Batches containing only notifications also return `null`;
   * batches containing at least one request return an array of responses in order. An
   * empty batch produces a single `InvalidRequest` error response, per the JSON-RPC spec.
   *
   * @param message A parsed message or batch.
   * @param handlers Optional per-call handlers merged over the dispatcher's registry.
   * @param ctx Optional dispatch context; a default is synthesised when omitted.
   * @returns The dispatch output (response, batch, or null).
   */
  async dispatch(
    message: ParsedMessage | ParsedMessage[],
    handlers?: HandlerRegistry,
    ctx?: DispatchContext,
  ): Promise<DispatchOutput> {
    if (Array.isArray(message)) {
      return this._dispatchBatch(message, handlers, ctx);
    }
    if (isJsonRpcRequest(message)) {
      return this.handleRequest(message, ctx, handlers);
    }
    if (isJsonRpcNotification(message)) {
      await this.handleNotification(message, ctx, handlers);
      return null;
    }
    this._totalErrors += 1;
    this._lastActivityAt = Date.now();
    return this._error(null, JsonRpcErrorCode.InvalidRequest, "Invalid Request");
  }

  /**
   * Dispatch a JSON-RPC batch, honouring the empty-batch and all-notification edge cases.
   */
  private async _dispatchBatch(
    batch: ParsedMessage[],
    handlers?: HandlerRegistry,
    ctx?: DispatchContext,
  ): Promise<DispatchOutput> {
    if (batch.length === 0) {
      this._totalErrors += 1;
      this._lastActivityAt = Date.now();
      return this._error(null, JsonRpcErrorCode.InvalidRequest, "Invalid Request: empty batch");
    }
    const responses: JsonRpcResponse[] = [];
    for (const item of batch) {
      if (isJsonRpcRequest(item)) {
        responses.push(await this.handleRequest(item, ctx, handlers));
      } else if (isJsonRpcNotification(item)) {
        await this.handleNotification(item, ctx, handlers);
      } else {
        // A malformed member in a batch yields an InvalidRequest response with null id.
        responses.push(
          this._error(null, JsonRpcErrorCode.InvalidRequest, "Invalid Request"),
        );
      }
    }
    return responses.length === 0 ? null : responses;
  }

  /**
   * Handle a single request: resolve a handler, invoke it, and return a response.
   *
   * @param req The parsed request.
   * @param ctx Optional dispatch context.
   * @param handlers Optional per-call handler overrides.
   * @returns A JSON-RPC response (success or error).
   */
  async handleRequest(
    req: JsonRpcRequest,
    ctx?: DispatchContext,
    handlers?: HandlerRegistry,
  ): Promise<JsonRpcResponse> {
    const startedAt = ctx?.startedAt ?? Date.now();
    this._totalRequests += 1;
    this._lastActivityAt = startedAt;
    this._requestsByMethod.set(req.method, (this._requestsByMethod.get(req.method) ?? 0) + 1);

    let handler: HandlerFn | undefined;
    if (handlers !== undefined && typeof handlers[req.method] === "function") {
      handler = handlers[req.method];
    } else if (this._handlers.has(req.method)) {
      handler = this._handlers.get(req.method);
    } else {
      handler = this._builtinHandler(req.method);
    }

    try {
      if (handler === undefined) {
        throw new McpRequestError(
          JsonRpcErrorCode.MethodNotFound,
          `Method not found: ${req.method}`,
        );
      }
      const result = await handler(req.params, ctx ?? this._defaultContext(startedAt));
      return this._success(req.id, result);
    } catch (err) {
      this._totalErrors += 1;
      return this._wrapError(req.id, err);
    }
  }

  /**
   * Handle a single notification: resolve a handler, invoke it fire-and-forget, and never
   * produce a response. Errors are recorded but swallowed, per JSON-RPC semantics.
   */
  async handleNotification(
    notif: JsonRpcNotification,
    ctx?: DispatchContext,
    handlers?: HandlerRegistry,
  ): Promise<void> {
    const startedAt = ctx?.startedAt ?? Date.now();
    this._totalNotifications += 1;
    this._lastActivityAt = startedAt;

    let handler: HandlerFn | undefined;
    if (handlers !== undefined && typeof handlers[notif.method] === "function") {
      handler = handlers[notif.method];
    } else if (this._handlers.has(notif.method)) {
      handler = this._handlers.get(notif.method);
    } else {
      handler = this._builtinHandler(notif.method);
    }

    if (handler === undefined) {
      // Unknown notifications are silently ignored by JSON-RPC.
      return;
    }
    try {
      await handler(notif.params, ctx ?? this._defaultContext(startedAt));
    } catch {
      this._totalErrors += 1;
    }
  }

  /**
   * Build a default dispatch context for ad-hoc dispatches that did not supply one.
   */
  private _defaultContext(startedAt: number): DispatchContext {
    return {
      session: undefined,
      sessionId: null,
      serverConfig: this._config,
      serverInfo: this._serverInfo,
      capabilities: this._capabilities,
      protocolVersion: this._config.protocolVersion,
      startedAt,
    };
  }

  /**
   * Resolve a built-in handler for a core MCP method, or `undefined` for unknown methods.
   */
  private _builtinHandler(method: string): HandlerFn | undefined {
    switch (method) {
      case MCP_METHOD.Initialize:
        return (params, ctx) => this._handleInitialize(params, ctx);
      case MCP_METHOD.Ping:
        return () => ({});
      case MCP_METHOD.ToolsList:
        return (params, ctx) => this._handleToolsList(params, ctx);
      case MCP_METHOD.ToolsCall:
        return (params, ctx) => this._handleToolsCall(params, ctx);
      case MCP_METHOD.ResourcesList:
        return (params, ctx) => this._handleResourcesList(params, ctx);
      case MCP_METHOD.ResourcesRead:
        return (params, ctx) => this._handleResourcesRead(params, ctx);
      case MCP_METHOD.PromptsList:
        return (params, ctx) => this._handlePromptsList(params, ctx);
      case MCP_METHOD.PromptsGet:
        return (params, ctx) => this._handlePromptsGet(params, ctx);
      default:
        return undefined;
    }
  }

  /**
   * Built-in `initialize` handler: negotiate the protocol version, build the result, fire
   * the `onInitialized` hook (so the lifecycle layer can mark the session initialized),
   * and return the initialize result.
   */
  private async _handleInitialize(
    params: unknown,
    ctx: DispatchContext,
  ): Promise<InitializeResult> {
    const p = (params ?? {}) as Partial<InitializeRequestParams>;
    const negotiated = this.negotiateVersion(p.protocolVersion);
    const result = this.buildInitializeResult(negotiated, ctx.capabilities, ctx.serverInfo);

    if (typeof ctx.onInitialized === "function") {
      await ctx.onInitialized(ctx, {
        protocolVersion: p.protocolVersion ?? negotiated,
        capabilities: p.capabilities ?? {},
        clientInfo: p.clientInfo ?? { name: "unknown", version: "unknown" },
      });
    }
    return result;
  }

  /**
   * Built-in `tools/list` handler, delegating to the context accessor.
   */
  private async _handleToolsList(_params: unknown, ctx: DispatchContext): Promise<{ tools: ToolListing[] }> {
    const tools = typeof ctx.listTools === "function" ? await ctx.listTools(ctx) : [];
    return { tools };
  }

  /**
   * Built-in `tools/call` handler. Requires a `callTool` accessor; when absent, an
   * `InvalidParams` error is raised so clients learn the tool cannot be invoked.
   */
  private async _handleToolsCall(
    params: unknown,
    ctx: DispatchContext,
  ): Promise<CallToolResult> {
    const p = (params ?? {}) as { name?: unknown; arguments?: unknown };
    const name = p.name;
    if (typeof name !== "string" || name.length === 0) {
      throw new McpRequestError(JsonRpcErrorCode.InvalidParams, "tools/call requires a `name` string");
    }
    if (typeof ctx.callTool !== "function") {
      throw new McpRequestError(
        JsonRpcErrorCode.InvalidRequest,
        `No tool call handler is registered for tool "${name}"`,
      );
    }
    const raw = await ctx.callTool(name, p.arguments, ctx);
    return this._normalizeCallToolResult(raw);
  }

  /**
   * Built-in `resources/list` handler, delegating to the context accessor.
   */
  private async _handleResourcesList(
    _params: unknown,
    ctx: DispatchContext,
  ): Promise<{ resources: ResourceListing[] }> {
    const resources = typeof ctx.listResources === "function" ? await ctx.listResources(ctx) : [];
    return { resources };
  }

  /**
   * Built-in `resources/read` handler. Requires a `readResource` accessor and a string URI.
   */
  private async _handleResourcesRead(
    params: unknown,
    ctx: DispatchContext,
  ): Promise<{ contents: ResourceContents[] }> {
    const p = (params ?? {}) as { uri?: unknown };
    const uri = p.uri;
    if (typeof uri !== "string" || uri.length === 0) {
      throw new McpRequestError(JsonRpcErrorCode.InvalidParams, "resources/read requires a `uri` string");
    }
    if (typeof ctx.readResource !== "function") {
      throw new McpRequestError(
        JsonRpcErrorCode.InvalidRequest,
        `No resource read handler is registered for uri "${uri}"`,
      );
    }
    const raw = await ctx.readResource(uri, ctx);
    if (
      raw !== null &&
      typeof raw === "object" &&
      Array.isArray((raw as { contents?: unknown }).contents)
    ) {
      return raw as { contents: ResourceContents[] };
    }
    return { contents: [{ uri, text: this._stringify(raw) }] };
  }

  /**
   * Built-in `prompts/list` handler, delegating to the context accessor.
   */
  private async _handlePromptsList(
    _params: unknown,
    ctx: DispatchContext,
  ): Promise<{ prompts: PromptListing[] }> {
    const prompts = typeof ctx.listPrompts === "function" ? await ctx.listPrompts(ctx) : [];
    return { prompts };
  }

  /**
   * Built-in `prompts/get` handler. Requires a `getPrompt` accessor and a prompt name.
   */
  private async _handlePromptsGet(
    params: unknown,
    ctx: DispatchContext,
  ): Promise<GetPromptResult> {
    const p = (params ?? {}) as { name?: unknown; arguments?: unknown };
    const name = p.name;
    if (typeof name !== "string" || name.length === 0) {
      throw new McpRequestError(JsonRpcErrorCode.InvalidParams, "prompts/get requires a `name` string");
    }
    if (typeof ctx.getPrompt !== "function") {
      throw new McpRequestError(
        JsonRpcErrorCode.InvalidRequest,
        `No prompt handler is registered for prompt "${name}"`,
      );
    }
    const raw = await ctx.getPrompt(name, p.arguments, ctx);
    if (
      raw !== null &&
      typeof raw === "object" &&
      Array.isArray((raw as { messages?: unknown }).messages)
    ) {
      return raw as GetPromptResult;
    }
    return { messages: [{ role: "assistant", content: { type: "text", text: this._stringify(raw) } }] };
  }

  /**
   * Normalise a raw tool result into a {@link CallToolResult}. String/number/object
   * results are wrapped into a text content block; already-shaped results pass through.
   */
  private _normalizeCallToolResult(raw: unknown): CallToolResult {
    if (
      raw !== null &&
      typeof raw === "object" &&
      Array.isArray((raw as { content?: unknown }).content)
    ) {
      return raw as CallToolResult;
    }
    return { content: [{ type: "text", text: this._stringify(raw) }] };
  }

  /**
   * Best-effort stringification of a handler return value into a text block.
   */
  private _stringify(value: unknown): string {
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
   * Negotiate the protocol version against the client's requested version(s).
   *
   * The requested value may be a single string or an array of strings. The server picks
   * the newest version it supports that the client also requested. When the client
   * requests nothing, or requests only unsupported versions, the server falls back to its
   * newest supported version (permissive negotiation — the client may reject if it
   * strictly needs a version the server does not offer).
   *
   * @param requested The client's requested protocol version(s), or undefined.
   * @returns The negotiated protocol version.
   */
  negotiateVersion(requested: unknown): ProtocolVersion {
    const requestedVersions = this._normalizeRequestedVersions(requested);
    for (const supported of SUPPORTED_PROTOCOL_VERSIONS) {
      if (requestedVersions.includes(supported)) {
        return supported;
      }
    }
    return LATEST_PROTOCOL_VERSION;
  }

  /**
   * Normalise the `protocolVersion` param into an array of candidate version strings.
   */
  private _normalizeRequestedVersions(requested: unknown): string[] {
    if (requested === undefined || requested === null) {
      return [LATEST_PROTOCOL_VERSION];
    }
    if (typeof requested === "string") {
      return requested.length > 0 ? [requested] : [LATEST_PROTOCOL_VERSION];
    }
    if (Array.isArray(requested)) {
      const versions = requested.filter((v): v is string => typeof v === "string" && v.length > 0);
      return versions.length > 0 ? versions : [LATEST_PROTOCOL_VERSION];
    }
    return [LATEST_PROTOCOL_VERSION];
  }

  /**
   * Build an {@link InitializeResult} for the given negotiated protocol version.
   *
   * @param protocolVersion The negotiated version.
   * @param capabilities Capabilities to advertise (defaults to this dispatcher's).
   * @param serverInfo Server identity (defaults to this dispatcher's).
   * @returns A fully-formed initialize result.
   */
  buildInitializeResult(
    protocolVersion: ProtocolVersion,
    capabilities?: ServerCapabilities,
    serverInfo?: Implementation,
  ): InitializeResult {
    const result: InitializeResult = {
      protocolVersion,
      capabilities: capabilities ?? this._capabilities,
      serverInfo: serverInfo ?? this._serverInfo,
    };
    if (typeof this._config.instructions === "string" && this._config.instructions.length > 0) {
      result.instructions = this._config.instructions;
    }
    return result;
  }

  /**
   * Wrap a thrown value into a JSON-RPC error response. `McpRequestError` instances keep
   * their code and data; everything else becomes `InternalError` with a sanitised message.
   */
  private _wrapError(id: number | string | null, err: unknown): JsonRpcErrorResponse {
    if (err instanceof McpRequestError) {
      return this._error(id, err.code, err.message, err.data);
    }
    if (
      err !== null &&
      typeof err === "object" &&
      typeof (err as { code?: unknown }).code === "number" &&
      typeof (err as { message?: unknown }).message === "string"
    ) {
      const e = err as { code: number; message: string; data?: unknown };
      return this._error(id, e.code, e.message, e.data);
    }
    const message = err instanceof Error ? err.message : String(err);
    return this._error(id, JsonRpcErrorCode.InternalError, `Internal error: ${message}`);
  }

  /**
   * Build a successful JSON-RPC response.
   */
  private _success(id: number | string | null, result: unknown): JsonRpcSuccessResponse {
    return { jsonrpc: JSONRPC_VERSION, id, result };
  }

  /**
   * Build a JSON-RPC error response.
   */
  private _error(
    id: number | string | null,
    code: number,
    message: string,
    data?: unknown,
  ): JsonRpcErrorResponse {
    const error: JsonRpcErrorObject = { code, message };
    if (data !== undefined) {
      error.data = data;
    }
    return { jsonrpc: JSONRPC_VERSION, id, error };
  }

  /**
   * Build a {@link DispatchResult} describing a completed dispatch. This is the structured
   * trace the lifecycle layer emits to listeners.
   */
  buildDispatchResult(
    message: ParsedMessage,
    response: JsonRpcResponse | undefined,
    startedAt: number,
    sessionId?: string,
  ): DispatchResult {
    const isRequest = isJsonRpcRequest(message);
    const isNotification = isJsonRpcNotification(message);
    const isError = response !== undefined && "error" in response;
    return {
      id: isRequest ? (message as JsonRpcRequest).id : undefined,
      method: message.method,
      isRequest,
      isNotification,
      isError,
      response,
      error: isError ? (response as JsonRpcErrorResponse).error : undefined,
      durationMs: Date.now() - startedAt,
      sessionId,
    };
  }

  /**
   * Invoke a handler in isolation and time it, returning a {@link HandlerResult}. Useful
   * for benchmarking and for the lifecycle layer's high-level `invoke` affordance.
   */
  async runHandler(
    method: string,
    params: unknown,
    ctx?: DispatchContext,
    handlers?: HandlerRegistry,
  ): Promise<HandlerResult> {
    const startedAt = Date.now();
    const fn =
      (handlers !== undefined && typeof handlers[method] === "function"
        ? handlers[method]
        : this._handlers.get(method)) ??
      this._builtinHandler(method);
    if (fn === undefined) {
      return {
        result: undefined,
        durationMs: Date.now() - startedAt,
        handlerName: method,
        applied: false,
      };
    }
    const result = await fn(params, ctx ?? this._defaultContext(startedAt));
    return {
      result,
      durationMs: Date.now() - startedAt,
      handlerName: method,
      applied: true,
    };
  }

  /**
   * Operational counters for this dispatcher.
   */
  stats(): {
    totalRequests: number;
    totalNotifications: number;
    totalErrors: number;
    lastActivityAt: number;
    requestsByMethod: Record<string, number>;
  } {
    const requestsByMethod: Record<string, number> = {};
    for (const [method, count] of this._requestsByMethod) {
      requestsByMethod[method] = count;
    }
    return {
      totalRequests: this._totalRequests,
      totalNotifications: this._totalNotifications,
      totalErrors: this._totalErrors,
      lastActivityAt: this._lastActivityAt,
      requestsByMethod,
    };
  }
}

/**
 * Convenience factory for building a dispatcher with a resolved config.
 */
export function createRequestDispatcher(options: DispatcherOptions): RequestDispatcher {
  return new RequestDispatcher(options);
}