/**
 * types.ts — Core type definitions, guards, factories and defaults for the MAM MCP Server layer.
 *
 * This module is the single source of truth for the data shapes used across the server
 * subpackage: JSON-RPC 2.0 message envelopes, MCP session records, configuration objects,
 * capability descriptors, listing records, result payloads and the aggregated statistics
 * surfaces produced by {@link SessionStore}, {@link SessionIndex}, {@link RequestDispatcher}
 * and {@link McpServer}.
 *
 * Every type in this file is deliberately framework-agnostic. There are no runtime
 * dependencies beyond Node built-ins, so the definitions can be shared by any transport
 * (stdio, HTTP, SSE, WebSocket or custom in-process bridges) without modification. The
 * guards and factory functions in the second half of the file make validation and
 * construction safe for untrusted input — which is exactly what a server that speaks
 * JSON-RPC over a wire must defend against.
 *
 * @module server/types
 */

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 core
// ---------------------------------------------------------------------------

/**
 * The JSON-RPC protocol version string mandated by the specification. Every message
 * emitted by the server MUST carry this exact value in its `jsonrpc` field.
 */
export const JSONRPC_VERSION = "2.0" as const;

/**
 * Well-known JSON-RPC 2.0 error codes. The negative range is reserved by the JSON-RPC
 * specification; MCP builds on top of these and does not redefine them.
 */
export enum JsonRpcErrorCode {
  /** Invalid JSON was received by the server. */
  ParseError = -32700,
  /** The JSON sent is not a valid Request/Notification object. */
  InvalidRequest = -32600,
  /** The method does not exist / is not available. */
  MethodNotFound = -32601,
  /** Invalid method parameter(s). */
  InvalidParams = -32602,
  /** Internal JSON-RPC error. */
  InternalError = -32603,
  /** Lower bound of the implementation-defined server error range. */
  ServerErrorStart = -32099,
  /** Upper bound of the implementation-defined server error range. */
  ServerErrorEnd = -32000,
}

/**
 * A JSON-RPC request object. Requests carry an `id` that the peer echoes back so that
 * responses can be correlated with their originating request.
 */
export interface JsonRpcRequest {
  jsonrpc: string;
  id: number | string | null;
  method: string;
  params?: unknown;
}

/**
 * A JSON-RPC notification object. Notifications are fire-and-forget: they carry no `id`
 * and therefore MUST NOT receive a response under the JSON-RPC 2.0 specification.
 */
export interface JsonRpcNotification {
  jsonrpc: string;
  method: string;
  params?: unknown;
}

/**
 * Union of the two kinds of inbound JSON-RPC messages that a server accepts. Batches are
 * handled as arrays of these.
 */
export type ParsedMessage = JsonRpcRequest | JsonRpcNotification;

/**
 * A JSON-RPC batch: an ordered array of requests and/or notifications processed in order.
 */
export type ParsedBatch = ParsedMessage[];

/**
 * A JSON-RPC error object carried inside an error response.
 */
export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

/**
 * A successful JSON-RPC response. The `result` may be any JSON-serialisable value.
 */
export interface JsonRpcSuccessResponse {
  jsonrpc: string;
  id: number | string | null;
  result: unknown;
}

/**
 * An unsuccessful JSON-RPC response carrying a structured error object.
 */
export interface JsonRpcErrorResponse {
  jsonrpc: string;
  id: number | string | null;
  error: JsonRpcErrorObject;
}

/**
 * Union of all valid JSON-RPC responses the server may emit.
 */
export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

/**
 * The output of a single dispatch operation: a response for a request, `null` for a
 * notification (or a batch that contained only notifications), or an array of responses
 * when a batch contained at least one request.
 */
export type DispatchOutput = JsonRpcResponse | JsonRpcResponse[] | null;

/**
 * A transport codec abstracts the wire format from the message envelope. MCP clients may
 * speak JSON, or a framed/streamed variant; swapping the codec changes the transport
 * without touching any routing logic.
 */
export interface JsonRpcCodec {
  /**
   * Decode raw text into a parsed JSON-RPC message (or batch). Throwing is the expected
   * way to signal a malformed payload, which callers translate into a ParseError response.
   */
  decode(text: string): unknown;
  /**
   * Encode a parsed JSON-RPC message into its wire representation. Must be the inverse of
   * {@link JsonRpcCodec.decode}.
   */
  encode(message: unknown): string;
}

// ---------------------------------------------------------------------------
// MCP protocol versions
// ---------------------------------------------------------------------------

/**
 * A concrete MCP protocol version string such as `"2024-11-05"`.
 */
export type ProtocolVersion = string;

/** The original MCP protocol version released November 2024. */
export const PROTOCOL_VERSION_2024_11_05 = "2024-11-05" as const;

/** The MCP protocol version released March 2025 (structured content, revisions). */
export const PROTOCOL_VERSION_2025_03_26 = "2025-03-26" as const;

/** The newest protocol version this server layer supports. */
export const LATEST_PROTOCOL_VERSION = PROTOCOL_VERSION_2025_03_26;

/**
 * Protocol versions this server can speak, ordered newest-first. Negotiation walks this
 * list to find the newest version the client also accepts.
 */
export const SUPPORTED_PROTOCOL_VERSIONS: readonly ProtocolVersion[] = [
  PROTOCOL_VERSION_2025_03_26,
  PROTOCOL_VERSION_2024_11_05,
] as const;

// ---------------------------------------------------------------------------
// MCP method names
// ---------------------------------------------------------------------------

/**
 * Canonical MCP method names. Keeping them as a frozen constant object prevents typos in
 * routing tables, handler registries and notification emitters.
 */
export const MCP_METHOD = {
  Initialize: "initialize",
  Ping: "ping",
  ToolsList: "tools/list",
  ToolsCall: "tools/call",
  ResourcesList: "resources/list",
  ResourcesRead: "resources/read",
  ResourcesSubscribe: "resources/subscribe",
  ResourcesUnsubscribe: "resources/unsubscribe",
  PromptsList: "prompts/list",
  PromptsGet: "prompts/get",
  CompletionComplete: "completion/complete",
  LoggingSetLevel: "logging/setLevel",
  NotificationsInitialized: "notifications/initialized",
  NotificationsCancelled: "notifications/cancelled",
  NotificationsProgress: "notifications/progress",
  NotificationsToolsListChanged: "notifications/tools/list_changed",
  NotificationsResourcesListChanged: "notifications/resources/list_changed",
  NotificationsPromptsListChanged: "notifications/prompts/list_changed",
} as const;

/** Union of every MCP method name the dispatcher knows how to route natively. */
export type McpMethodName = (typeof MCP_METHOD)[keyof typeof MCP_METHOD];

// ---------------------------------------------------------------------------
// Implementation & capabilities
// ---------------------------------------------------------------------------

/**
 * Identifies a participant (client or server) in an MCP conversation: a human-readable
 * name and a semantic version string.
 */
export interface Implementation {
  name: string;
  version: string;
}

/**
 * Capabilities the server advertises during the initialize handshake. Each capability may
 * carry sub-options such as change-notification support.
 */
export interface ServerCapabilities {
  /** Server supports tool discovery and invocation. */
  tools?: { listChanged?: boolean };
  /** Server supports resource listing, reading and (optionally) change subscription. */
  resources?: { subscribe?: boolean; listChanged?: boolean };
  /** Server supports prompt templates. */
  prompts?: { listChanged?: boolean };
  /** Server supports structured logging messages. */
  logging?: Record<string, never>;
  /** Extension points reserved for experimental features. */
  experimental?: Record<string, unknown>;
}

/**
 * Capabilities the client advertises during the initialize handshake.
 */
export interface ClientCapabilities {
  /** Client can receive root directory change notifications. */
  roots?: { listChanged?: boolean };
  /** Client can satisfy server-side sampling requests. */
  sampling?: Record<string, never>;
  /** Extension points reserved for experimental features. */
  experimental?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/**
 * A server-side MCP session. One session corresponds to one logical client connection
 * (for example one stdio process or one SSE connection) and owns its own protocol version,
 * capability negotiation state and lifetime bookkeeping.
 */
export interface McpSession {
  /** Stable, unique identifier for the session (e.g. a UUID). */
  id: string;
  /** The protocol version negotiated for this session. */
  protocolVersion: ProtocolVersion;
  /** Client identity as reported in the initialize request, once known. */
  clientInfo?: Implementation;
  /** Client capabilities reported in the initialize request, once known. */
  capabilities?: ClientCapabilities;
  /** True once the initialize request has been served successfully. */
  initialized: boolean;
  /** Epoch milliseconds at which the session was created. */
  connectedAt: number;
  /** Epoch milliseconds of the most recent activity (request/notification). */
  lastActiveAt: number;
  /** Raw initialize parameters retained for audit/inspection purposes. */
  initializeParams?: unknown;
  /** Optional session tags, e.g. `{ transport: "stdio" }`. */
  meta?: Record<string, unknown>;
}

/**
 * Minimum parameters required to create or restore a session.
 */
export interface SessionConfig {
  /** Maximum concurrent sessions; undefined means "inherit from ServerConfig". */
  maxSessions?: number;
  /** Default protocol version for newly created sessions. */
  protocolVersion?: ProtocolVersion;
  /** Server identity advertised to clients during initialization. */
  serverInfo?: Implementation;
}

// ---------------------------------------------------------------------------
// Server configuration & options
// ---------------------------------------------------------------------------

/**
 * Fully-resolved server configuration. Every field has a concrete default; construct
 * instances with {@link createServerConfig} so nothing is left undefined.
 */
export interface ServerConfig {
  /** Maximum number of concurrent live sessions. Excess sessions are rejected. */
  maxSessions: number;
  /** Default protocol version advertised to clients that omit a version. */
  protocolVersion: ProtocolVersion;
  /** Server identity reported in initialize results. */
  serverInfo: Implementation;
  /** Milliseconds of inactivity after which a session is eligible for pruning. */
  sessionIdleTimeoutMs: number;
  /** Hard cap on a single decoded JSON-RPC payload in bytes. */
  maxMessageBytes: number;
  /** Retain a bounded history of closed sessions for statistics. */
  trackClosedSessions: boolean;
  /** Maximum number of closed sessions retained when tracking is enabled. */
  maxClosedSessions: number;
  /** Free-form server instructions surfaced to clients in the initialize result. */
  instructions?: string;
}

/**
 * Immutable-by-convention default server configuration. Never mutate this object; copy it
 * with {@link createServerConfig} instead.
 */
export const DEFAULT_SERVER_CONFIG: ServerConfig = {
  maxSessions: 128,
  protocolVersion: LATEST_PROTOCOL_VERSION,
  serverInfo: { name: "mam-mcp-server", version: "0.1.0" },
  sessionIdleTimeoutMs: 30 * 60 * 1000,
  maxMessageBytes: 4 * 1024 * 1024,
  trackClosedSessions: true,
  maxClosedSessions: 1024,
  instructions: "MAM MCP Server. See server documentation for available tools, resources and prompts.",
};

/**
 * Default session-level settings used when no session config is supplied.
 */
export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  maxSessions: DEFAULT_SERVER_CONFIG.maxSessions,
  protocolVersion: DEFAULT_SERVER_CONFIG.protocolVersion,
  serverInfo: DEFAULT_SERVER_CONFIG.serverInfo,
};

/**
 * Options accepted by the {@link McpServer} constructor and the `createMcpServer` factory.
 * All fields are optional; unspecified fields fall back to {@link DEFAULT_SERVER_CONFIG}.
 */
export interface ServerOptions {
  /** Partial configuration overrides merged over the defaults. */
  config?: Partial<ServerConfig>;
  /** Optional transport codec; defaults to JSON.parse/JSON.stringify. */
  codec?: JsonRpcCodec;
  /** Optional pre-built session store to adopt (e.g. for hot reload). */
  sessionStore?: import("./store.js").SessionStore;
  /** Optional pre-built session index to adopt. */
  sessionIndex?: import("./index.js").SessionIndex;
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

/**
 * Aggregate statistics exposed by {@link McpServer.stats}. Combining counters from the
 * session store, the session index and the request dispatcher gives an operational view
 * of a running server.
 */
export interface ServerStats {
  /** Sessions created since the server started (including closed ones). */
  totalSessions: number;
  /** Sessions currently held by the store. */
  activeSessions: number;
  /** Sessions that have completed the initialize handshake. */
  initializedSessions: number;
  /** Sessions awaiting initialization. */
  pendingSessions: number;
  /** Sessions pruned/expired since the server started. */
  totalPruned: number;
  /** JSON-RPC requests dispatched since the server started. */
  totalRequests: number;
  /** JSON-RPC notifications dispatched since the server started. */
  totalNotifications: number;
  /** Error responses / failed dispatches since the server started. */
  totalErrors: number;
  /** Epoch milliseconds the server started. */
  startedAt: number;
  /** Epoch milliseconds of the most recent dispatch. */
  lastActivityAt: number;
  /** Requests dispatched, grouped by method name. */
  requestsByMethod: Record<string, number>;
  /** Average lifetime of sessions that have been closed, in milliseconds. */
  averageSessionLifetimeMs: number;
}

// ---------------------------------------------------------------------------
// Dispatch & handler results
// ---------------------------------------------------------------------------

/**
 * Structured outcome of a single dispatched message. The dispatcher and the lifecycle
 * facade both produce these so callers (and EventEmitter listeners) can observe routing
 * decisions without re-parsing responses.
 */
export interface DispatchResult {
  /** The request id, when the message was a request. */
  id?: number | string | null;
  /** The method that handled the message. */
  method?: string;
  /** True when the inbound message was a request. */
  isRequest: boolean;
  /** True when the inbound message was a notification. */
  isNotification: boolean;
  /** True when the dispatch produced (or threw) an error. */
  isError: boolean;
  /** The produced response, when a response was emitted. */
  response?: JsonRpcResponse;
  /** The structured error object, when the dispatch failed. */
  error?: JsonRpcErrorObject;
  /** Time spent dispatching, in milliseconds. */
  durationMs: number;
  /** Session id the message was dispatched against, when known. */
  sessionId?: string;
}

/**
 * Outcome of a single handler invocation. Used to time, trace and short-circuit chains of
 * handlers without exceptions.
 */
export interface HandlerResult {
  /** The value returned by the handler (or its resolved promise). */
  result: unknown;
  /** Milliseconds the handler took to complete. */
  durationMs: number;
  /** Name of the handler that ran (usually the JSON-RPC method). */
  handlerName: string;
  /** False when no handler matched and the default path was used. */
  applied: boolean;
}

// ---------------------------------------------------------------------------
// Tool / Resource / Prompt listings & result payloads
// ---------------------------------------------------------------------------

/**
 * Description of a single tool exposed via `tools/list`.
 */
export interface ToolListing {
  /** Unique tool name, used to invoke it via `tools/call`. */
  name: string;
  /** Human-readable description of what the tool does. */
  description?: string;
  /** JSON Schema describing the tool's input parameters. */
  inputSchema: Record<string, unknown>;
  /** Semantic hints describing side effects for client UX. */
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  /** Extension metadata. */
  meta?: Record<string, unknown>;
}

/**
 * A block of content inside a tool/resource/prompt result. MCP content is a discriminated
 * union keyed on `type`.
 */
export type ContentBlock = TextContentBlock | ImageContentBlock | EmbeddedResourceBlock;

/** Plain-text content block. */
export interface TextContentBlock {
  type: "text";
  text: string;
}

/** Base64-encoded image content block. */
export interface ImageContentBlock {
  type: "image";
  data: string;
  mimeType: string;
}

/** An embedded resource (usually a file) inside a result. */
export interface EmbeddedResourceBlock {
  type: "resource";
  resource: {
    uri: string;
    mimeType?: string;
    text?: string;
    blob?: string;
  };
}

/** Result payload of `tools/call`. */
export interface CallToolResult {
  content: ContentBlock[];
  /** True when the tool ran but reported an application-level error. */
  isError?: boolean;
  /** Machine-readable structured output when the tool supports it. */
  structuredContent?: unknown;
}

/** Result payload of `tools/list`. */
export interface ListToolsResult {
  tools: ToolListing[];
  /** Pagination cursor for the next page, when applicable. */
  nextCursor?: string;
}

/**
 * Description of a single resource exposed via `resources/list`.
 */
export interface ResourceListing {
  /** Unique resource URI (e.g. `file:///docs/readme.md`). */
  uri: string;
  /** Human-readable resource name. */
  name?: string;
  /** Human-readable description of the resource. */
  description?: string;
  /** MIME type of the resource body. */
  mimeType?: string;
  /** Size of the resource body in bytes, when known. */
  size?: number;
  /** Extension metadata. */
  meta?: Record<string, unknown>;
}

/** A single item inside the contents array of a read-resource result. */
export interface ResourceContents {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
}

/** Result payload of `resources/list`. */
export interface ListResourcesResult {
  resources: ResourceListing[];
  nextCursor?: string;
}

/** Result payload of `resources/read`. */
export interface ReadResourceResult {
  contents: ResourceContents[];
}

/** Describes an argument accepted by a prompt template. */
export interface PromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

/**
 * Description of a single prompt template exposed via `prompts/list`.
 */
export interface PromptListing {
  /** Unique prompt name, used to render it via `prompts/get`. */
  name: string;
  /** Human-readable description of the prompt. */
  description?: string;
  /** Arguments the template accepts. */
  arguments?: PromptArgument[];
}

/** Result payload of `prompts/list`. */
export interface ListPromptsResult {
  prompts: PromptListing[];
  nextCursor?: string;
}

/** A message inside a rendered prompt. */
export interface PromptMessage {
  role: "user" | "assistant";
  content: ContentBlock;
}

/** Result payload of `prompts/get`. */
export interface GetPromptResult {
  description?: string;
  messages: PromptMessage[];
}

// ---------------------------------------------------------------------------
// Initialize handshake payloads
// ---------------------------------------------------------------------------

/** Parameters of the `initialize` request sent by the client. */
export interface InitializeRequestParams {
  protocolVersion: ProtocolVersion;
  capabilities: ClientCapabilities;
  clientInfo: Implementation;
}

/** Result payload returned by the server for `initialize`. */
export interface InitializeResult {
  protocolVersion: ProtocolVersion;
  capabilities: ServerCapabilities;
  serverInfo: Implementation;
  instructions?: string;
}

/** Result payload of the `ping` request. */
export interface PingResult {
  /** Always empty; presence of the result is the point of a ping. */
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * An error a handler can throw to control the exact JSON-RPC error returned to the client.
 * Any other thrown value is normalised to {@link JsonRpcErrorCode.InternalError}.
 */
export class McpRequestError extends Error {
  /** JSON-RPC error code to surface to the client. */
  readonly code: number;
  /** Optional structured data attached to the error. */
  readonly data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "McpRequestError";
    this.code = code;
    this.data = data;
  }
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/**
 * Narrow an unknown value to a JSON-RPC request object.
 */
export function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.jsonrpc === JSONRPC_VERSION && typeof v.method === "string" && "id" in v;
}

/**
 * Narrow an unknown value to a JSON-RPC notification object. Notifications are requests
 * without an `id`.
 */
export function isJsonRpcNotification(value: unknown): value is JsonRpcNotification {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.jsonrpc === JSONRPC_VERSION && typeof v.method === "string" && !("id" in v);
}

/**
 * Narrow an unknown value to any parsed JSON-RPC message (request or notification).
 */
export function isParsedMessage(value: unknown): value is ParsedMessage {
  return isJsonRpcRequest(value) || isJsonRpcNotification(value);
}

/**
 * Narrow an unknown value to a JSON-RPC response object.
 */
export function isJsonRpcResponse(value: unknown): value is JsonRpcResponse {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.jsonrpc !== JSONRPC_VERSION || !("id" in v)) return false;
  return "result" in v || ("error" in v && isJsonRpcErrorObject(v.error));
}

/**
 * Narrow an unknown value to a JSON-RPC error object.
 */
export function isJsonRpcErrorObject(value: unknown): value is JsonRpcErrorObject {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.code === "number" && typeof v.message === "string";
}

/**
 * Narrow an unknown value to an {@link Implementation}.
 */
export function isImplementation(value: unknown): value is Implementation {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.name === "string" && typeof v.version === "string";
}

/**
 * Narrow an unknown value to a session record. Enforces every required field.
 */
export function isMcpSession(value: unknown): value is McpSession {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.protocolVersion === "string" &&
    typeof v.initialized === "boolean" &&
    typeof v.connectedAt === "number" &&
    typeof v.lastActiveAt === "number"
  );
}

/**
 * Narrow an unknown value to a {@link ServerCapabilities} object.
 */
export function isServerCapabilities(value: unknown): value is ServerCapabilities {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.tools !== undefined && (typeof v.tools !== "object" || v.tools === null)) return false;
  if (v.resources !== undefined && (typeof v.resources !== "object" || v.resources === null)) return false;
  if (v.prompts !== undefined && (typeof v.prompts !== "object" || v.prompts === null)) return false;
  return true;
}

/**
 * Narrow an unknown value to a single content block.
 */
export function isContentBlock(value: unknown): value is ContentBlock {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.type === "text") return typeof v.text === "string";
  if (v.type === "image") return typeof v.data === "string" && typeof v.mimeType === "string";
  if (v.type === "resource") return typeof v.resource === "object" && v.resource !== null;
  return false;
}

// ---------------------------------------------------------------------------
// Factories & defaults
// ---------------------------------------------------------------------------

/**
 * Create a fully-populated {@link ServerConfig} by merging a partial over the defaults.
 * The returned object is a fresh copy; the defaults are never mutated.
 */
export function createServerConfig(partial: Partial<ServerConfig> = {}): ServerConfig {
  return {
    ...DEFAULT_SERVER_CONFIG,
    ...partial,
    serverInfo: { ...DEFAULT_SERVER_CONFIG.serverInfo, ...(partial.serverInfo ?? {}) },
  };
}

/**
 * Create a fully-populated {@link SessionConfig} by merging a partial over the defaults.
 */
export function createSessionConfig(partial: Partial<SessionConfig> = {}): SessionConfig {
  return {
    ...DEFAULT_SESSION_CONFIG,
    ...partial,
    serverInfo: { ...DEFAULT_SESSION_CONFIG.serverInfo, ...(partial.serverInfo ?? {}) },
  };
}

/**
 * Create a zeroed {@link ServerStats} record. Use {@link McpServer.stats} to obtain a
 * live snapshot instead of this factory in normal operation.
 */
export function createServerStats(): ServerStats {
  return {
    totalSessions: 0,
    activeSessions: 0,
    initializedSessions: 0,
    pendingSessions: 0,
    totalPruned: 0,
    totalRequests: 0,
    totalNotifications: 0,
    totalErrors: 0,
    startedAt: Date.now(),
    lastActivityAt: 0,
    requestsByMethod: {},
    averageSessionLifetimeMs: 0,
  };
}

/**
 * Create an {@link Implementation} descriptor. Guards against empty names/versions.
 */
export function createImplementation(name: string, version: string): Implementation {
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new TypeError("createImplementation: `name` must be a non-empty string");
  }
  if (typeof version !== "string" || version.trim().length === 0) {
    throw new TypeError("createImplementation: `version` must be a non-empty string");
  }
  return { name, version };
}

/**
 * Create a fresh {@link McpSession} record stamped with the current time.
 */
export function createSessionRecord(
  id: string,
  clientInfo?: Implementation,
  capabilities?: ClientCapabilities,
  protocolVersion: ProtocolVersion = LATEST_PROTOCOL_VERSION,
): McpSession {
  const now = Date.now();
  return {
    id,
    protocolVersion,
    clientInfo,
    capabilities,
    initialized: false,
    connectedAt: now,
    lastActiveAt: now,
  };
}

/**
 * Merge client-reported capabilities with server-side capability flags, producing a
 * symmetric capability record that preserves any experimental extensions.
 */
export function mergeCapabilities(
  server: ServerCapabilities,
  client?: ClientCapabilities,
): ServerCapabilities {
  const merged: ServerCapabilities = {
    tools: server.tools ? { ...server.tools } : undefined,
    resources: server.resources ? { ...server.resources } : undefined,
    prompts: server.prompts ? { ...server.prompts } : undefined,
    logging: server.logging ? { ...server.logging } : undefined,
    experimental: {
      ...(server.experimental ?? {}),
      ...(client?.experimental ?? {}),
    },
  };
  return merged;
}