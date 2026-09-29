/**
 * types.ts — Core type definitions, guards, factories and defaults for the MAM MCP Client layer.
 *
 * This module is the single source of truth for the data shapes used across the client
 * subpackage: JSON-RPC 2.0 message envelopes, the {@link McpConnection} lifecycle record,
 * client configuration objects, capability descriptors, tool/resource/prompt listing and
 * result payloads, the high-level {@link CallResult} surface, aggregated statistics and
 * the transport contract the client speaks over.
 *
 * Every type in this file is deliberately framework-agnostic and carries no runtime
 * dependencies beyond Node built-ins. The client layer is self-contained: it encodes and
 * decodes JSON-RPC inline, correlates requests with responses through an id-keyed pending
 * map, and talks to any object that satisfies the {@link McpTransport} interface (stdio,
 * HTTP, SSE, WebSocket, or in-process memory bridges for testing).
 *
 * The second half of the file provides the runtime safety net: structural guards that
 * narrow untrusted `unknown` values (decoded wire frames, restored snapshots, caller
 * arguments) into fully typed objects, plus factory functions and default constants so
 * callers never construct partial or malformed records by hand.
 *
 * @module client/types
 */

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 core
// ---------------------------------------------------------------------------

/**
 * The JSON-RPC protocol version string mandated by the specification. Every message the
 * client emits MUST carry this exact value in its `jsonrpc` field.
 */
export const JSONRPC_VERSION = "2.0" as const;

/**
 * Well-known JSON-RPC 2.0 error codes. The negative range is reserved by the JSON-RPC
 * specification; MCP builds on top of these and does not redefine them.
 */
export enum JsonRpcErrorCode {
  /** Invalid JSON was received by the peer. */
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
 * Union of the two kinds of JSON-RPC messages the client may receive. Batches are handled
 * as arrays of these.
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
 * Union of all valid JSON-RPC responses the client may receive from a server.
 */
export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

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

/**
 * The newest protocol version this client layer supports. The client layer is deliberately
 * conservative and pins the original `2024-11-05` release as its latest, preferring
 * maximal interoperability with older servers.
 */
export const LATEST_PROTOCOL_VERSION: ProtocolVersion = PROTOCOL_VERSION_2024_11_05;

/**
 * Protocol versions this client can speak, ordered newest-first. Negotiation walks this
 * list to find the newest version the server also offers.
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
 * routing tables, correlation bookkeeping and notification emitters.
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
  RootsList: "roots/list",
  SamplingCreateMessage: "sampling/createMessage",
} as const;

/** Union of every MCP method name the client knows how to address. */
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

/**
 * Capabilities the server advertises in its initialize result.
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

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

/**
 * The lifecycle status of a single {@link McpConnection}. A connection is `connecting`
 * from the moment it is created until the initialize handshake completes, `connected` for
 * the rest of its active lifetime, and `closed` once torn down.
 */
export type ConnectionStatus = "connecting" | "connected" | "closed";

/**
 * Every valid {@link ConnectionStatus} value in a stable order.
 */
export const CONNECTION_STATUSES: readonly ConnectionStatus[] = [
  "connecting",
  "connected",
  "closed",
] as const;

/**
 * A client-side MCP connection record. One connection corresponds to one logical server
 * transport (for example one stdio process or one SSE endpoint) and owns its own protocol
 * version, negotiated capabilities and lifetime bookkeeping.
 */
export interface McpConnection {
  /** Stable, unique identifier for the connection. */
  id: string;
  /** Server identity reported in the initialize result, once known. */
  serverInfo?: Implementation;
  /** The protocol version negotiated for this connection. */
  protocolVersion: ProtocolVersion;
  /** Server capabilities reported in the initialize result, once known. */
  capabilities: ServerCapabilities;
  /** Epoch milliseconds at which the connection was created. */
  connectedAt: number;
  /** Epoch milliseconds of the most recent activity (request/response/frame). */
  lastActiveAt: number;
  /** Current lifecycle status of the connection. */
  status: ConnectionStatus;
  /** Optional transport label, e.g. `"stdio"` or `"memory"`. */
  transport?: string;
  /** Optional connection tags, e.g. `{ env: "prod" }`. */
  meta?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Client configuration & options
// ---------------------------------------------------------------------------

/**
 * Fully-resolved client configuration. Every field has a concrete default; construct
 * instances with {@link createClientConfig} so nothing is left undefined.
 */
export interface ClientConfig {
  /** Milliseconds after which an unanswered request is rejected as timed out. */
  requestTimeoutMs: number;
  /** Default protocol version the client requests during initialization. */
  protocolVersion: ProtocolVersion;
  /** Client identity reported in the initialize request. */
  clientInfo: Implementation;
  /** Maximum number of concurrently pending requests before new sends are rejected. */
  maxPendingRequests: number;
  /** Keep closed connections in the store for statistics/audit. */
  trackClosedConnections: boolean;
  /** Maximum number of closed connections retained when tracking is enabled. */
  maxClosedConnections: number;
  /** When true, stale pending requests are swept on every `prune()` call. */
  autoPrunePending: boolean;
}

/**
 * Immutable-by-convention default client configuration. Never mutate this object; copy it
 * with {@link createClientConfig} instead.
 */
export const DEFAULT_CLIENT_CONFIG: ClientConfig = {
  requestTimeoutMs: 30_000,
  protocolVersion: LATEST_PROTOCOL_VERSION,
  clientInfo: { name: "mam-mcp-client", version: "0.1.0" },
  maxPendingRequests: 256,
  trackClosedConnections: true,
  maxClosedConnections: 1024,
  autoPrunePending: true,
};

/**
 * Options accepted by the {@link McpClient} constructor and the `createMcpClient` factory.
 * All fields are optional; unspecified fields fall back to {@link DEFAULT_CLIENT_CONFIG}.
 */
export interface ClientOptions {
  /** Partial configuration overrides merged over the defaults. */
  config?: Partial<ClientConfig>;
  /** Optional pre-built connection store to adopt (e.g. for hot reload). */
  connectionStore?: import("./store.js").ConnectionStore;
  /** Optional pre-built connection index to adopt. */
  connectionIndex?: import("./index.js").ConnectionIndex;
  /** Optional pre-built request correlator to adopt. */
  correlator?: import("./retrieval.js").RequestCorrelator;
}

// ---------------------------------------------------------------------------
// High-level call & request shapes
// ---------------------------------------------------------------------------

/**
 * Structured outcome of a single tool invocation ({@link callTool}). The client never
 * throws for application-level tool failures — it always returns a {@link CallResult} so
 * callers can branch on `ok` without try/catch ceremony.
 */
export interface CallResult {
  /** True when the request completed (including JSON-RPC error responses). */
  ok: boolean;
  /** The decoded result value, present when `ok` is true and a value was returned. */
  value?: unknown;
  /** Structured failure detail, present when `ok` is false. */
  error?: {
    /** JSON-RPC error code (or a client-side code such as a timeout). */
    code: number;
    /** Human-readable error message. */
    message: string;
    /** Optional structured error data from the server. */
    data?: unknown;
  };
  /** The JSON-RPC method that was invoked (e.g. `"tools/call"`). */
  method?: string;
  /** Milliseconds the round-trip took. */
  durationMs?: number;
}

/**
 * A tool invocation request: the tool `name` and the JSON-serialisable `arguments` object
 * passed to it. Use {@link createToolCall} to validate input.
 */
export interface ToolCall {
  /** Unique tool name as advertised by `tools/list`. */
  name: string;
  /** JSON-serialisable argument object (JSON Schema `properties` keys). */
  arguments?: Record<string, unknown>;
}

/**
 * A resource read request: the unique resource URI to load.
 */
export interface ResourceRequest {
  /** Resource URI, e.g. `file:///docs/readme.md`. */
  uri: string;
}

/**
 * A prompt render request: the prompt template `name` and optional argument values.
 */
export interface PromptRequest {
  /** Unique prompt name as advertised by `prompts/list`. */
  name: string;
  /** Argument values consumed by the prompt template. */
  arguments?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

/**
 * Aggregate statistics exposed by {@link McpClient.stats}. Combining counters from the
 * connection store, the connection index and the request correlator gives an operational
 * view of a running client.
 */
export interface ClientStats {
  /** Connections created since the client started (including closed ones). */
  totalConnections: number;
  /** Connections currently held by the store. */
  activeConnections: number;
  /** Connections in the `connected` state. */
  connectedConnections: number;
  /** Connections in the `connecting` state. */
  connectingConnections: number;
  /** Connections in the `closed` state. */
  closedConnections: number;
  /** JSON-RPC requests sent since the client started. */
  totalRequests: number;
  /** Requests settled with a result since the client started. */
  totalResolved: number;
  /** Requests settled with an error since the client started. */
  totalRejected: number;
  /** Requests abandoned as timed out since the client started. */
  totalTimedOut: number;
  /** Requests currently pending a response. */
  pendingRequests: number;
  /** Raw text frames received since the client started. */
  totalMessagesReceived: number;
  /** Notifications sent since the client started. */
  totalNotificationsSent: number;
  /** Requests pruned/timed out by `prune()` since the client started. */
  totalPruned: number;
  /** Epoch milliseconds the client started. */
  startedAt: number;
  /** Epoch milliseconds of the most recent activity. */
  lastActivityAt: number;
  /** Requests sent, grouped by method name. */
  requestsByMethod: Record<string, number>;
  /** Average round-trip duration of settled requests, in milliseconds. */
  averageRequestDurationMs: number;
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
// Transport
// ---------------------------------------------------------------------------

/**
 * The transport contract the client speaks over. A transport moves raw JSON-RPC text
 * frames in both directions and reports errors/closure asynchronously. Any object that
 * satisfies this interface can back an {@link McpClient} — stdio, HTTP, SSE, WebSocket or
 * an in-process memory pair.
 */
export interface McpTransport {
  /**
   * Start the transport so frames can be exchanged. May be a no-op for already-live
   * transports. The client awaits this before sending the initialize request.
   */
  start(): Promise<void> | void;
  /**
   * Send a raw JSON-RPC frame (encoded text) to the server. Should reject when the
   * transport is closed or failed.
   */
  send(text: string): Promise<void> | void;
  /**
   * Register the callback invoked for each inbound raw frame. Called exactly once during
   * connection setup.
   */
  onMessage?(handler: (text: string) => void): void;
  /**
   * Register the callback invoked on transport-level failures (network reset, protocol
   * corruption). Non-fatal by default; the client emits an `error` event.
   */
  onError?(handler: (error: Error) => void): void;
  /**
   * Register the callback invoked when the transport closes. The client marks the
   * connection closed and rejects outstanding pending requests.
   */
  onClose?(handler: () => void): void;
  /**
   * Stop the transport and release underlying resources. Idempotent.
   */
  close(): Promise<void> | void;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * A client-side error raised when a JSON-RPC round-trip cannot complete: request timeouts,
 * transport failures, protocol violations, or server-reported JSON-RPC errors. Carries an
 * optional {@link JsonRpcErrorCode} so callers can branch on the failure class.
 */
export class McpClientError extends Error {
  /** JSON-RPC (or client-side) error code. */
  readonly code: number;
  /** Optional structured data attached to the failure. */
  readonly data?: unknown;
  /** The JSON-RPC method the failing request targeted, when known. */
  readonly method?: string;

  constructor(code: number, message: string, options: { data?: unknown; method?: string } = {}) {
    super(message);
    this.name = "McpClientError";
    this.code = code;
    this.data = options.data;
    this.method = options.method;
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
 * Narrow an unknown value to a {@link ConnectionStatus}.
 */
export function isConnectionStatus(value: unknown): value is ConnectionStatus {
  return (
    typeof value === "string" &&
    (CONNECTION_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * Narrow an unknown value to a {@link McpConnection} record. Enforces every required field.
 */
export function isMcpConnection(value: unknown): value is McpConnection {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.protocolVersion === "string" &&
    typeof v.connectedAt === "number" &&
    typeof v.lastActiveAt === "number" &&
    isConnectionStatus(v.status) &&
    (v.capabilities === undefined || (typeof v.capabilities === "object" && v.capabilities !== null))
  );
}

/**
 * Narrow an unknown value to a {@link CallResult}.
 */
export function isCallResult(value: unknown): value is CallResult {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.ok === "boolean";
}

/**
 * Narrow an unknown value to a {@link ToolCall}.
 */
export function isToolCall(value: unknown): value is ToolCall {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.name === "string";
}

/**
 * Narrow an unknown value to a {@link ResourceRequest}.
 */
export function isResourceRequest(value: unknown): value is ResourceRequest {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.uri === "string";
}

/**
 * Narrow an unknown value to a {@link PromptRequest}.
 */
export function isPromptRequest(value: unknown): value is PromptRequest {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.name === "string";
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
 * Create a fully-populated {@link ClientConfig} by merging a partial over the defaults.
 * The returned object is a fresh copy; the defaults are never mutated.
 */
export function createClientConfig(partial: Partial<ClientConfig> = {}): ClientConfig {
  return {
    ...DEFAULT_CLIENT_CONFIG,
    ...partial,
    clientInfo: { ...DEFAULT_CLIENT_CONFIG.clientInfo, ...(partial.clientInfo ?? {}) },
  };
}

/**
 * Create a fresh {@link McpConnection} record stamped with the current time.
 *
 * @param id The stable connection identifier.
 * @param options Optional overrides (server info, capabilities, protocol version, status,
 *   transport label, meta tags).
 * @returns A fully-formed connection record.
 */
export function createConnectionRecord(
  id: string,
  options: {
    serverInfo?: Implementation;
    capabilities?: ServerCapabilities;
    protocolVersion?: ProtocolVersion;
    status?: ConnectionStatus;
    transport?: string;
    meta?: Record<string, unknown>;
  } = {},
): McpConnection {
  if (typeof id !== "string" || id.length === 0) {
    throw new TypeError("createConnectionRecord: `id` must be a non-empty string");
  }
  const now = Date.now();
  const connection: McpConnection = {
    id,
    protocolVersion: options.protocolVersion ?? LATEST_PROTOCOL_VERSION,
    capabilities: options.capabilities ?? {},
    connectedAt: now,
    lastActiveAt: now,
    status: options.status ?? "connecting",
  };
  if (options.serverInfo !== undefined) {
    connection.serverInfo = { ...options.serverInfo };
  }
  if (options.transport !== undefined) {
    connection.transport = options.transport;
  }
  if (options.meta !== undefined) {
    connection.meta = { ...options.meta };
  }
  return connection;
}

/**
 * Build a successful {@link CallResult}.
 *
 * @param method The JSON-RPC method that completed.
 * @param value The decoded result value.
 * @param durationMs Optional round-trip duration.
 */
export function createCallResultSuccess(
  method: string,
  value: unknown,
  durationMs?: number,
): CallResult {
  const result: CallResult = { ok: true, value, method };
  if (durationMs !== undefined) {
    result.durationMs = durationMs;
  }
  return result;
}

/**
 * Build a failed {@link CallResult}.
 *
 * @param method The JSON-RPC method that failed.
 * @param code JSON-RPC (or client-side) error code.
 * @param message Human-readable failure message.
 * @param data Optional structured error data.
 * @param durationMs Optional round-trip duration.
 */
export function createCallResultError(
  method: string,
  code: number,
  message: string,
  data?: unknown,
  durationMs?: number,
): CallResult {
  const result: CallResult = {
    ok: false,
    error: { code, message },
    method,
  };
  if (data !== undefined) {
    result.error!.data = data;
  }
  if (durationMs !== undefined) {
    result.durationMs = durationMs;
  }
  return result;
}

/**
 * Create a zeroed {@link ClientStats} record. Use {@link McpClient.stats} to obtain a live
 * snapshot instead of this factory in normal operation.
 */
export function createClientStats(): ClientStats {
  return {
    totalConnections: 0,
    activeConnections: 0,
    connectedConnections: 0,
    connectingConnections: 0,
    closedConnections: 0,
    totalRequests: 0,
    totalResolved: 0,
    totalRejected: 0,
    totalTimedOut: 0,
    pendingRequests: 0,
    totalMessagesReceived: 0,
    totalNotificationsSent: 0,
    totalPruned: 0,
    startedAt: Date.now(),
    lastActivityAt: 0,
    requestsByMethod: {},
    averageRequestDurationMs: 0,
  };
}

/**
 * Validate a {@link ToolCall} and return a guaranteed-valid copy. Throws a `TypeError`
 * when `name` is missing or non-string.
 */
export function createToolCall(name: string, args?: Record<string, unknown>): ToolCall {
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new TypeError("createToolCall: `name` must be a non-empty string");
  }
  const call: ToolCall = { name };
  if (args !== undefined) {
    call.arguments = { ...args };
  }
  return call;
}

/**
 * Validate a {@link ResourceRequest} and return a guaranteed-valid copy.
 */
export function createResourceRequest(uri: string): ResourceRequest {
  if (typeof uri !== "string" || uri.trim().length === 0) {
    throw new TypeError("createResourceRequest: `uri` must be a non-empty string");
  }
  return { uri };
}

/**
 * Validate a {@link PromptRequest} and return a guaranteed-valid copy.
 */
export function createPromptRequest(
  name: string,
  args?: Record<string, unknown>,
): PromptRequest {
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new TypeError("createPromptRequest: `name` must be a non-empty string");
  }
  const request: PromptRequest = { name };
  if (args !== undefined) {
    request.arguments = { ...args };
  }
  return request;
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
 * Merge server-reported capabilities with client-side flags, producing a symmetric
 * capability record that preserves any experimental extensions.
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

/**
 * Extract a best-effort plain-text rendering of a {@link CallToolResult}: the joined text
 * of every text content block, falling back to JSON for structured content. Useful when a
 * caller wants a single string summary of a tool's output.
 */
export function callResultText(result: CallToolResult): string {
  const texts: string[] = [];
  for (const block of result.content ?? []) {
    if (block.type === "text") {
      texts.push(block.text);
    }
  }
  if (texts.length > 0) {
    return texts.join("\n");
  }
  if (result.structuredContent !== undefined) {
    try {
      return JSON.stringify(result.structuredContent);
    } catch {
      return String(result.structuredContent);
    }
  }
  return "";
}