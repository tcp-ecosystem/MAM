/**
 * types.ts
 *
 * Core message shapes, protocol version constants, capability declarations,
 * error codes, type guards and factories for the standalone MAM MCP (Model
 * Context Protocol) implementation.
 *
 * MCP is a JSON-RPC 2.0 based protocol. Every frame exchanged between a client
 * and a server is exactly one of:
 *
 *   - a **request**   (carries an `id` so the peer can answer),
 *   - a **response**  (the successful answer to a request, carries the same `id`),
 *   - an **error response** (the failed answer to a request),
 *   - a **notification**   (fire-and-forget, deliberately carries no `id`).
 *
 * This module is the single source of truth for those shapes, the
 * method-agnostic envelope types (`McpRequest` / `McpResult`), the capability
 * objects exchanged during `initialize`, and the runtime guards used to reduce
 * untrusted `unknown` payloads (from sockets, streams, stdio or HTTP bodies) to
 * fully typed message objects without a single `as` cast.
 *
 * The module is dependency-free (Node built-ins only) so every other layer in
 * this package (store, index, codec, lifecycle) can import it without creating
 * import cycles or pulling in external packages.
 *
 * @module protocol/types
 */

/**
 * The JSON-RPC version literal mandated by the JSON-RPC 2.0 specification.
 * Every serialized frame produced by the codec carries this value.
 */
export const JSON_RPC_VERSION = '2.0' as const;

/**
 * The JSON-RPC version expressed as a TypeScript literal type. Kept as a
 * single literal so that `switch`/comparison logic remains exhaustively
 * checkable at compile time.
 */
export type JsonRpcVersion = typeof JSON_RPC_VERSION;

/**
 * The latest MCP protocol revision understood by this implementation. The
 * value `2024-11-05` is the stable, widely deployed revision that introduced
 * the modern initialize/capabilities negotiation shape.
 */
export const LATEST_PROTOCOL_VERSION = '2024-11-05' as const;

/**
 * Every protocol revision this implementation can speak. A peer that sends an
 * `initialize` request with a `protocolVersion` outside this list is answered
 * with a `MethodNotFound`-style `UnsupportedProtocolVersion` error.
 *
 * The array is ordered newest-first; consumers should always prefer the first
 * entry they are able to satisfy.
 */
export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [
  LATEST_PROTOCOL_VERSION,
  '2024-10-07',
] as const;

/**
 * Convenience: the protocol revision a MAM MCP server answers an
 * `initialize` request with when the client requests an older-but-supported
 * version. Kept equal to the latest version for now.
 */
export const DEFAULT_PROTOCOL_VERSION = LATEST_PROTOCOL_VERSION;

/**
 * The kind of message a protocol frame represents. Used by the store, the
 * method index and the lifecycle layer to bucket messages cheaply.
 */
export type MessageType = 'request' | 'response' | 'notification' | 'error';

/**
 * All {@link MessageType} values, in a stable order. Useful for iteration,
 * documentation and serialization round-trips.
 */
export const MESSAGE_TYPES: readonly MessageType[] = [
  'request',
  'response',
  'notification',
  'error',
] as const;

/**
 * Whether a message was produced by this side of the connection (`sent`) or
 * read from the peer (`received`).
 */
export type Direction = 'sent' | 'received';

/**
 * All {@link Direction} values, in a stable order.
 */
export const DIRECTIONS: readonly Direction[] = ['sent', 'received'] as const;

/**
 * A JSON-RPC request identifier. The specification allows either a string or a
 * number; numbers must be finite, and the empty string is technically legal
 * but discouraged. This alias centralizes the choice so guards and indexes
 * agree on a single shape.
 */
export type RequestId = string | number;

/**
 * The request identifier that appears on an error response when the peer could
 * not even determine which request failed (for example a malformed frame).
 */
export type RequestIdOrNull = RequestId | null;

/**
 * Structural guard: returns `true` when `value` is a plain object literal
 * (prototype is `Object.prototype` or `null`). Every other frame shape in this
 * module is validated on top of this primitive, which deliberately rejects
 * class instances, arrays and boxed primitives.
 *
 * @param value - the value to inspect.
 * @returns `true` when `value` is a plain object.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Guard for {@link RequestId}. Accepts strings and finite numbers only, so
 * `NaN`, `Infinity` and boxed `Number` objects are rejected up front.
 *
 * @param value - the value to inspect.
 * @returns `true` when `value` can serve as a JSON-RPC request id.
 */
export function isRequestId(value: unknown): value is RequestId {
  if (typeof value === 'string') {
    return true;
  }
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * A JSON-RPC 2.0 request object.
 *
 * A request always carries an `id` (so the peer can correlate the eventual
 * response) and a `method` name. The `params` field is optional and may be any
 * JSON value. The `jsonrpc` field is included by factories but tolerated as
 * absent by the guards for interop with minimal third-party peers.
 */
export interface JsonRpcRequest {
  /** The JSON-RPC version marker, `'2.0'` when produced by this package. */
  readonly jsonrpc?: JsonRpcVersion;
  /** Request identifier used to correlate the eventual response. */
  readonly id: RequestId;
  /** The remote method to invoke, e.g. `'tools/list'`. */
  readonly method: string;
  /** Structured parameters passed to the method. Optional. */
  readonly params?: unknown;
}

/**
 * A JSON-RPC 2.0 success response object.
 *
 * The `result` field is optional on the type to make the shape tolerant of
 * peers that omit empty results; the guards still require the field to be
 * present (any JSON value, including `null`) to keep the response/notification
 * discrimination unambiguous.
 */
export interface JsonRpcResponse {
  /** The JSON-RPC version marker, `'2.0'` when produced by this package. */
  readonly jsonrpc?: JsonRpcVersion;
  /** The id of the request this response answers. */
  readonly id: RequestId;
  /** The successful result payload. */
  readonly result?: unknown;
}

/**
 * The structured `error` object mandated by JSON-RPC 2.0 for failed responses.
 * `code` is a signed integer, `message` a short human-readable string, and
 * `data` an optional value carrying additional detail.
 */
export interface JsonRpcError {
  /** Machine-readable, protocol-stable error code (see {@link ErrorCodes}). */
  readonly code: number;
  /** Short human-readable description of the failure. */
  readonly message: string;
  /** Optional structured detail about the failure. */
  readonly data?: unknown;
}

/**
 * A JSON-RPC 2.0 error response object: the failed counterpart of
 * {@link JsonRpcResponse}. Carries the id of the request that failed (or
 * `null` when the id could not be recovered) plus the structured error.
 */
export interface JsonRpcErrorResponse {
  /** The JSON-RPC version marker, `'2.0'` when produced by this package. */
  readonly jsonrpc?: JsonRpcVersion;
  /** The id of the failed request, or `null` when it could not be recovered. */
  readonly id: RequestIdOrNull;
  /** The structured error detail. */
  readonly error: JsonRpcError;
}

/**
 * A JSON-RPC 2.0 notification object.
 *
 * Notifications are fire-and-forget: they carry a `method` and optional
 * `params` but deliberately no `id`, so the peer must not answer them. MCP uses
 * notifications for events such as `notifications/initialized`,
 * `notifications/tools/list_changed` and logging messages.
 */
export interface JsonRpcNotification {
  /** The JSON-RPC version marker, `'2.0'` when produced by this package. */
  readonly jsonrpc?: JsonRpcVersion;
  /** The remote method to notify about. */
  readonly method: string;
  /** Structured parameters attached to the notification. Optional. */
  readonly params?: unknown;
}

/**
 * Discriminated-union wrapper for a `request` frame. The `type` discriminant
 * lets the store, index and lifecycle layers switch exhaustively.
 */
export interface RequestMessage {
  /** Discriminant: this message is a request. */
  readonly type: 'request';
  /** The underlying JSON-RPC request object. */
  readonly request: JsonRpcRequest;
}

/**
 * Discriminated-union wrapper for a `response` frame.
 */
export interface ResponseMessage {
  /** Discriminant: this message is a response. */
  readonly type: 'response';
  /** The underlying JSON-RPC response object. */
  readonly response: JsonRpcResponse;
}

/**
 * Discriminated-union wrapper for an `error` frame.
 */
export interface ErrorMessage {
  /** Discriminant: this message is an error response. */
  readonly type: 'error';
  /** The underlying JSON-RPC error response object. */
  readonly error: JsonRpcErrorResponse;
}

/**
 * Discriminated-union wrapper for a `notification` frame.
 */
export interface NotificationMessage {
  /** Discriminant: this message is a notification. */
  readonly type: 'notification';
  /** The underlying JSON-RPC notification object. */
  readonly notification: JsonRpcNotification;
}

/**
 * The canonical protocol message type used across the whole MCP package. Every
 * frame that enters or leaves the system is normalized to exactly one of these
 * four variants so that downstream logic (message logs, indexes, codecs,
 * lifecycle hooks) never has to re-derive intent from raw JSON.
 */
export type ProtocolMessage =
  | RequestMessage
  | ResponseMessage
  | ErrorMessage
  | NotificationMessage;

/**
 * Extract the JSON-RPC method of a {@link ProtocolMessage}. Requests and
 * notifications carry methods; responses and error responses do not.
 *
 * @param message - the normalized message.
 * @returns the method name, or `undefined` for response/error messages.
 */
export function messageMethod(message: ProtocolMessage): string | undefined {
  switch (message.type) {
    case 'request':
      return message.request.method;
    case 'notification':
      return message.notification.method;
    case 'response':
    case 'error':
      return undefined;
  }
}

/**
 * Extract the correlation id of a {@link ProtocolMessage}. Requests, responses
 * and error responses all carry an id; notifications carry none.
 *
 * @param message - the normalized message.
 * @returns the request id, or `undefined` for notifications.
 */
export function messageId(message: ProtocolMessage): RequestId | undefined {
  switch (message.type) {
    case 'request':
      return message.request.id;
    case 'response':
      return message.response.id;
    case 'error':
      return message.error.id ?? undefined;
    case 'notification':
      return undefined;
  }
}

/**
 * Determine whether a {@link ProtocolMessage} is "active" in the sense that a
 * peer is expected to answer it. Only requests qualify; everything else is a
 * terminal message.
 *
 * @param message - the normalized message.
 * @returns `true` for request frames.
 */
export function isPendingMessage(message: ProtocolMessage): boolean {
  return message.type === 'request';
}

/**
 * Guard: reports whether `value` satisfies the {@link JsonRpcRequest} shape.
 * Checks, in order: plain object, optional version marker, non-empty `method`
 * string, presence of a valid `id`, and `params` (when present) being an
 * object or array.
 *
 * @param value - the untrusted value to validate.
 * @returns `true` when `value` is a well-formed JSON-RPC request.
 */
export function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (!isPlainObject(value)) {
    return false;
  }
  if (value['jsonrpc'] !== undefined && value['jsonrpc'] !== JSON_RPC_VERSION) {
    return false;
  }
  if (typeof value['method'] !== 'string' || value['method'].length === 0) {
    return false;
  }
  if (!('id' in value) || !isRequestId(value['id'])) {
    return false;
  }
  if (value['params'] !== undefined && !isPlainObject(value['params']) && !Array.isArray(value['params'])) {
    return false;
  }
  return true;
}

/**
 * Guard: reports whether `value` satisfies the {@link JsonRpcNotification}
 * shape. A notification is a request-shaped frame without an `id`.
 *
 * @param value - the untrusted value to validate.
 * @returns `true` when `value` is a well-formed JSON-RPC notification.
 */
export function isJsonRpcNotification(value: unknown): value is JsonRpcNotification {
  if (!isPlainObject(value)) {
    return false;
  }
  if (value['jsonrpc'] !== undefined && value['jsonrpc'] !== JSON_RPC_VERSION) {
    return false;
  }
  if (typeof value['method'] !== 'string' || value['method'].length === 0) {
    return false;
  }
  if ('id' in value) {
    return false;
  }
  if (value['params'] !== undefined && !isPlainObject(value['params']) && !Array.isArray(value['params'])) {
    return false;
  }
  return true;
}

/**
 * Guard: reports whether `value` satisfies the {@link JsonRpcResponse} shape.
 * A response must carry a valid `id`, must not carry an `error` member, and
 * must carry a `result` member (any JSON value, including `null`).
 *
 * @param value - the untrusted value to validate.
 * @returns `true` when `value` is a well-formed JSON-RPC success response.
 */
export function isJsonRpcResponse(value: unknown): value is JsonRpcResponse {
  if (!isPlainObject(value)) {
    return false;
  }
  if (value['jsonrpc'] !== undefined && value['jsonrpc'] !== JSON_RPC_VERSION) {
    return false;
  }
  if (!('id' in value) || !isRequestId(value['id'])) {
    return false;
  }
  if ('error' in value) {
    return false;
  }
  if (!('result' in value)) {
    return false;
  }
  return true;
}

/**
 * Guard: reports whether `value` satisfies the standalone {@link JsonRpcError}
 * shape (the `error` member of an error response).
 *
 * @param value - the untrusted value to validate.
 * @returns `true` when `value` is a well-formed JSON-RPC error object.
 */
export function isJsonRpcError(value: unknown): value is JsonRpcError {
  if (!isPlainObject(value)) {
    return false;
  }
  if (typeof value['code'] !== 'number' || !Number.isInteger(value['code'])) {
    return false;
  }
  if (typeof value['message'] !== 'string') {
    return false;
  }
  return true;
}

/**
 * Guard: reports whether `value` satisfies the {@link JsonRpcErrorResponse}
 * shape. The `id` may be a valid request id or `null` (when the peer could not
 * recover the id), and the `error` member must validate via
 * {@link isJsonRpcError}.
 *
 * @param value - the untrusted value to validate.
 * @returns `true` when `value` is a well-formed JSON-RPC error response.
 */
export function isJsonRpcErrorResponse(value: unknown): value is JsonRpcErrorResponse {
  if (!isPlainObject(value)) {
    return false;
  }
  if (value['jsonrpc'] !== undefined && value['jsonrpc'] !== JSON_RPC_VERSION) {
    return false;
  }
  const id = value['id'];
  if (id !== null && !isRequestId(id)) {
    return false;
  }
  if (!isJsonRpcError(value['error'])) {
    return false;
  }
  return true;
}

/**
 * Guard: is `value` a {@link ProtocolMessage} wrapping a request?
 *
 * @param value - the untrusted value to validate.
 * @returns `true` when `value` is a request message.
 */
export function isRequest(value: unknown): value is RequestMessage {
  return isPlainObject(value) && value['type'] === 'request' && isJsonRpcRequest(value['request']);
}

/**
 * Guard: is `value` a {@link ProtocolMessage} wrapping a response?
 *
 * @param value - the untrusted value to validate.
 * @returns `true` when `value` is a response message.
 */
export function isResponse(value: unknown): value is ResponseMessage {
  return isPlainObject(value) && value['type'] === 'response' && isJsonRpcResponse(value['response']);
}

/**
 * Guard: is `value` a {@link ProtocolMessage} wrapping an error response?
 *
 * This is the canonical `error` discriminant check used by the store and the
 * codec. The companion name {@link isErrorResponse} is kept as an alias for
 * callers that prefer the "response" framing.
 *
 * @param value - the untrusted value to validate.
 * @returns `true` when `value` is an error message.
 */
export function isError(value: unknown): value is ErrorMessage {
  return isPlainObject(value) && value['type'] === 'error' && isJsonRpcErrorResponse(value['error']);
}

/**
 * Guard: is `value` a {@link ProtocolMessage} wrapping a notification?
 *
 * @param value - the untrusted value to validate.
 * @returns `true` when `value` is a notification message.
 */
export function isNotification(value: unknown): value is NotificationMessage {
  return isPlainObject(value) && value['type'] === 'notification' && isJsonRpcNotification(value['notification']);
}

/**
 * Guard: alias of {@link isError} for readers that describe error responses by
 * their protocol role.
 *
 * @param value - the untrusted value to validate.
 * @returns `true` when `value` is an error message.
 */
export function isErrorResponse(value: unknown): value is ErrorMessage {
  return isError(value);
}

/**
 * Guard: reports whether `value` is any valid {@link ProtocolMessage}.
 *
 * @param value - the untrusted value to validate.
 * @returns `true` when `value` is a request, response, error or notification message.
 */
export function isProtocolMessage(value: unknown): value is ProtocolMessage {
  return isRequest(value) || isResponse(value) || isError(value) || isNotification(value);
}

/**
 * Standard JSON-RPC 2.0 and MCP error codes.
 *
 * The `-32700`..`-32603` block is defined by the JSON-RPC specification. The
 * `-32000`..`-32099` block is reserved for server/implementation-defined
 * errors; MCP uses a handful of values there for protocol-level failures.
 */
export const ErrorCodes = {
  /** Malformed JSON was received (JSON-RPC spec). */
  PARSE_ERROR: -32700,
  /** The JSON was valid but the frame does not match any protocol shape. */
  INVALID_REQUEST: -32600,
  /** The method does not exist or is not implemented. */
  METHOD_NOT_FOUND: -32601,
  /** Invalid method parameter(s). */
  INVALID_PARAMS: -32602,
  /** Internal JSON-RPC error (unexpected exception). */
  INTERNAL_ERROR: -32603,
  /** The transport connection was closed before a response arrived. */
  CONNECTION_CLOSED: -32000,
  /** A request timed out waiting for its response. */
  REQUEST_TIMEOUT: -32001,
  /** A requested resource URI does not exist on the server. */
  RESOURCE_NOT_FOUND: -32002,
  /** The client lacks a capability required to process the request. */
  MISSING_REQUIRED_CLIENT_CAPABILITY: -32003,
  /** The requested protocol version is unknown or unsupported. */
  UNSUPPORTED_PROTOCOL_VERSION: -32004,
  /** URL elicitation is required but was not performed. */
  URL_ELICITATION_REQUIRED: -32042,
} as const;

/**
 * An error code that crosses the wire. Type alias over the known constants so
 * helpers can type `code` strictly while still accepting arbitrary integers.
 */
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes] | number;

/**
 * Human-readable label for a numeric error code; useful for logs and dashboards.
 *
 * @param code - the numeric code to label.
 * @returns a short label, or the number itself formatted as a string.
 */
export function describeErrorCode(code: number): string {
  for (const [label, value] of Object.entries(ErrorCodes)) {
    if (value === code) {
      return label;
    }
  }
  return String(code);
}

/**
 * A protocol error that is safe to serialize as a JSON-RPC error response.
 * Every failure that the codec or lifecycle layer raises is an instance of this
 * class so that upstream handlers can always recover `code`/`message`/`data`
 * without inspecting ad-hoc exception shapes.
 */
export class McpProtocolError extends Error {
  /** The wire-stable numeric error code. */
  readonly code: number;
  /** Optional structured detail attached to the error. */
  readonly data?: unknown;

  /**
   * Create a new protocol error.
   *
   * @param code - the numeric JSON-RPC/MCP error code.
   * @param message - a short human-readable description.
   * @param data - optional structured detail (serialized into `error.data`).
   * @param options - standard `Error` options, notably `cause` for chaining.
   */
  constructor(code: number, message: string, data?: unknown, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'McpProtocolError';
    this.code = code;
    this.data = data;
  }

  /**
   * Convert this error into a standalone {@link JsonRpcError} object.
   *
   * @returns the structured error object.
   */
  toJsonRpcError(): JsonRpcError {
    return { code: this.code, message: this.message, data: this.data };
  }

  /**
   * Convert this error into a full {@link JsonRpcErrorResponse} bound to a
   * request id.
   *
   * @param id - the id of the failed request, or `null` when unknown.
   * @returns a complete error response object.
   */
  toJsonRpcErrorResponse(id: RequestIdOrNull): JsonRpcErrorResponse {
    return {
      jsonrpc: JSON_RPC_VERSION,
      id,
      error: this.toJsonRpcError(),
    };
  }

  /**
   * Reconstruct a protocol error from a standalone {@link JsonRpcError}.
   *
   * @param error - the structured error object.
   * @returns a new `McpProtocolError` mirroring its fields.
   */
  static fromJsonRpcError(error: JsonRpcError): McpProtocolError {
    return new McpProtocolError(error.code, error.message, error.data);
  }

  /**
   * Reconstruct a protocol error from a full {@link JsonRpcErrorResponse}.
   * The response id is not needed on the error itself but is carried in
   * `data.responseId` for diagnostics when present.
   *
   * @param response - the error response frame.
   * @returns a new `McpProtocolError` mirroring its fields.
   */
  static fromJsonRpcErrorResponse(response: JsonRpcErrorResponse): McpProtocolError {
    const data =
      response.error.data === undefined && response.id !== null
        ? { responseId: response.id }
        : response.error.data;
    return new McpProtocolError(response.error.code, response.error.message, data);
  }

  /**
   * Build a standard "parse error" for malformed JSON.
   *
   * @param detail - optional detail (e.g. a truncated raw snippet).
   * @returns a configured parse-error instance.
   */
  static parseError(detail?: unknown): McpProtocolError {
    return new McpProtocolError(ErrorCodes.PARSE_ERROR, 'Parse error', detail);
  }

  /**
   * Build a standard "invalid request" error.
   *
   * @param detail - optional detail (e.g. the offending payload).
   * @returns a configured invalid-request instance.
   */
  static invalidRequest(detail?: unknown): McpProtocolError {
    return new McpProtocolError(ErrorCodes.INVALID_REQUEST, 'Invalid request', detail);
  }
}

/**
 * A method-agnostic MCP request envelope. `_result` is a phantom type that
 * lets generic handlers carry the expected result type at compile time without
 * ever existing at runtime.
 */
export interface McpRequest<Params = unknown, Result = McpResult> {
  /** The MCP method name (one of {@link MCP_METHODS} at runtime). */
  readonly method: string;
  /** Structured request parameters, shaped per-method. */
  readonly params?: Params;
  /** Phantom: expected result type, erased at runtime. */
  readonly _result?: Result;
}

/**
 * A method-agnostic MCP result union. MCP results are plain JSON objects; the
 * union below names the common shapes (tool/resource/prompt listings, tool
 * call output, initialize results) while still accepting arbitrary objects.
 */
export type McpResult =
  | { readonly tools: readonly Tool[] }
  | { readonly resources: readonly Resource[] }
  | { readonly prompts: readonly Prompt[] }
  | { readonly contents: readonly ResourceContent[] }
  | { readonly content: readonly ContentBlock[]; readonly isError?: boolean }
  | { readonly completion: string }
  | InitializeResult
  | Readonly<Record<string, unknown>>;

/**
 * Capabilities a server may advertise inside its `initialize` result. Each
 * field maps to a feature group; an empty object `{}` means "supported with no
 * extra flags".
 */
export interface ServerCapabilities {
  /** Tool discovery and invocation support. */
  readonly tools?: ToolCapabilities | Record<string, never>;
  /** Resource subscription/listing support. */
  readonly resources?: ResourceCapabilities | Record<string, never>;
  /** Prompt listing/retrieval support. */
  readonly prompts?: PromptCapabilities | Record<string, never>;
  /** Structured logging support (`logging/setLevel`). */
  readonly logging?: Record<string, never>;
  /** Argument-completion support (`completion/complete`). */
  readonly completion?: Record<string, never>;
  /** Experimental/implementation-specific capability surface. */
  readonly experimental?: Readonly<Record<string, unknown>>;
}

/**
 * Options a server may declare for the `tools` capability.
 */
export interface ToolCapabilities {
  /** Whether the server emits `notifications/tools/list_changed`. */
  readonly listChanged?: boolean;
}

/**
 * Options a server may declare for the `resources` capability.
 */
export interface ResourceCapabilities {
  /** Whether the server supports `resources/subscribe` / unsubscribe. */
  readonly subscribe?: boolean;
  /** Whether the server emits `notifications/resources/list_changed`. */
  readonly listChanged?: boolean;
}

/**
 * Options a server may declare for the `prompts` capability.
 */
export interface PromptCapabilities {
  /** Whether the server emits `notifications/prompts/list_changed`. */
  readonly listChanged?: boolean;
}

/**
 * Capabilities a client may advertise inside its `initialize` request.
 */
export interface ClientCapabilities {
  /** Root-directory management support. */
  readonly roots?: { readonly listChanged?: boolean };
  /** LLM sampling support. */
  readonly sampling?: Record<string, never>;
  /** Experimental/implementation-specific capability surface. */
  readonly experimental?: Readonly<Record<string, unknown>>;
}

/**
 * Identity information about a client or server exchanged during `initialize`.
 */
export interface Implementation {
  /** Human-readable implementation name. */
  readonly name: string;
  /** Implementation version string. */
  readonly version: string;
}

/**
 * The `initialize` request parameters sent by the client. This is the very
 * first request of every MCP session and drives version negotiation and
 * capability advertisement.
 */
export interface InitializeParams {
  /** The protocol revision the client wants to speak. */
  readonly protocolVersion: string;
  /** The capabilities the client advertises. */
  readonly capabilities: ClientCapabilities;
  /** Client identity information. */
  readonly clientInfo: Implementation;
}

/**
 * The `initialize` result returned by the server. Carries the negotiated
 * protocol version, the server's capabilities and its identity, plus optional
 * free-form usage instructions.
 */
export interface InitializeResult {
  /** The protocol revision the server agreed on. */
  readonly protocolVersion: string;
  /** The capabilities the server advertises. */
  readonly capabilities: ServerCapabilities;
  /** Server identity information. */
  readonly serverInfo: Implementation;
  /** Optional instructions the client should relay to the model. */
  readonly instructions?: string;
}

/**
 * A tool exposed by a MCP server (returned by `tools/list`, passed to
 * `tools/call`).
 */
export interface Tool {
  /** Unique tool name. */
  readonly name: string;
  /** Human-readable description of what the tool does. */
  readonly description?: string;
  /** JSON Schema describing the tool's input arguments. */
  readonly inputSchema?: ToolInputSchema;
}

/**
 * The JSON Schema document accepted by {@link Tool.inputSchema}. Kept as a
 * permissive object to avoid a hard dependency on a schema library.
 */
export type ToolInputSchema = Readonly<Record<string, unknown>>;

/**
 * A resource exposed by a MCP server (returned by `resources/list`).
 */
export interface Resource {
  /** The resource's URI (e.g. `file:///notes/a.txt`). */
  readonly uri: string;
  /** Human-readable resource name. */
  readonly name: string;
  /** Optional description of the resource. */
  readonly description?: string;
  /** Optional MIME type of the resource content. */
  readonly mimeType?: string;
}

/**
 * The contents of a resource returned by `resources/read`.
 */
export interface ResourceContent {
  /** The URI the content was read from. */
  readonly uri: string;
  /** Optional MIME type of the content. */
  readonly mimeType?: string;
  /** Textual content (one of text/uri per the spec). */
  readonly text?: string;
  /** Binary content, base64-encoded. */
  readonly blob?: string;
}

/**
 * A prompt template exposed by a MCP server (returned by `prompts/list`).
 */
export interface Prompt {
  /** Unique prompt name. */
  readonly name: string;
  /** Optional human-readable description. */
  readonly description?: string;
  /** Optional declared argument slots. */
  readonly arguments?: readonly PromptArgument[];
}

/**
 * A single argument slot declared by a {@link Prompt}.
 */
export interface PromptArgument {
  /** Argument name. */
  readonly name: string;
  /** Optional description of the argument. */
  readonly description?: string;
  /** Whether the argument is required. */
  readonly required?: boolean;
}

/**
 * The rendered messages of a prompt (`prompts/get` result).
 */
export interface PromptMessage {
  /** The speaker role. */
  readonly role: 'user' | 'assistant';
  /** The message content block. */
  readonly content: ContentBlock;
}

/**
 * A content block used inside tool-call output and prompt messages.
 */
export type ContentBlock = TextContent | ImageContent | EmbeddedResource;

/**
 * A plain-text content block.
 */
export interface TextContent {
  /** Discriminant: text block. */
  readonly type: 'text';
  /** The text payload. */
  readonly text: string;
}

/**
 * An image content block (base64-encoded data).
 */
export interface ImageContent {
  /** Discriminant: image block. */
  readonly type: 'image';
  /** Base64-encoded image data. */
  readonly data: string;
  /** The image MIME type. */
  readonly mimeType: string;
}

/**
 * An embedded resource content block.
 */
export interface EmbeddedResource {
  /** Discriminant: embedded resource block. */
  readonly type: 'resource';
  /** The embedded resource content. */
  readonly resource: ResourceContent;
}

/**
 * The structured logging levels defined by MCP's `logging/setLevel`.
 */
export type LoggingLevel =
  | 'debug'
  | 'info'
  | 'notice'
  | 'warning'
  | 'error'
  | 'critical'
  | 'alert'
  | 'emergency';

/**
 * All valid {@link LoggingLevel} values in ascending severity order.
 */
export const LOGGING_LEVELS: readonly LoggingLevel[] = [
  'debug',
  'info',
  'notice',
  'warning',
  'error',
  'critical',
  'alert',
  'emergency',
] as const;

/**
 * Compare two logging levels by severity: returns a negative number when
 * `a` is less severe than `b`, zero when equal, positive otherwise.
 *
 * @param a - first level.
 * @param b - second level.
 * @returns the severity ordering delta.
 */
export function compareLoggingLevels(a: LoggingLevel, b: LoggingLevel): number {
  return LOGGING_LEVELS.indexOf(a) - LOGGING_LEVELS.indexOf(b);
}

/**
 * Factory: build a well-formed {@link JsonRpcRequest}.
 *
 * @param id - the request id.
 * @param method - the method to invoke.
 * @param params - optional structured parameters.
 * @returns a complete JSON-RPC request object.
 */
export function createJsonRpcRequest(id: RequestId, method: string, params?: unknown): JsonRpcRequest {
  return params === undefined ? { jsonrpc: JSON_RPC_VERSION, id, method } : { jsonrpc: JSON_RPC_VERSION, id, method, params };
}

/**
 * Factory: build a well-formed {@link JsonRpcNotification}.
 *
 * @param method - the method to notify about.
 * @param params - optional structured parameters.
 * @returns a complete JSON-RPC notification object.
 */
export function createJsonRpcNotification(method: string, params?: unknown): JsonRpcNotification {
  return params === undefined ? { jsonrpc: JSON_RPC_VERSION, method } : { jsonrpc: JSON_RPC_VERSION, method, params };
}

/**
 * Factory: build a well-formed {@link JsonRpcResponse}.
 *
 * @param id - the id of the request being answered.
 * @param result - the successful result payload.
 * @returns a complete JSON-RPC response object.
 */
export function createJsonRpcResponse(id: RequestId, result?: unknown): JsonRpcResponse {
  return result === undefined ? { jsonrpc: JSON_RPC_VERSION, id } : { jsonrpc: JSON_RPC_VERSION, id, result };
}

/**
 * Factory: build a standalone {@link JsonRpcError}.
 *
 * @param code - the numeric error code.
 * @param message - a short human-readable description.
 * @param data - optional structured detail.
 * @returns a complete JSON-RPC error object.
 */
export function createJsonRpcError(code: number, message: string, data?: unknown): JsonRpcError {
  return data === undefined ? { code, message } : { code, message, data };
}

/**
 * Factory: build a well-formed {@link JsonRpcErrorResponse}.
 *
 * @param id - the id of the failed request, or `null` when unknown.
 * @param error - the structured error object.
 * @returns a complete JSON-RPC error response object.
 */
export function createJsonRpcErrorResponse(id: RequestIdOrNull, error: JsonRpcError): JsonRpcErrorResponse {
  return { jsonrpc: JSON_RPC_VERSION, id, error };
}

/**
 * Factory: wrap a JSON-RPC request into a {@link RequestMessage}.
 *
 * @param id - the request id.
 * @param method - the method to invoke.
 * @param params - optional structured parameters.
 * @returns the normalized request message.
 */
export function createRequestMessage(id: RequestId, method: string, params?: unknown): RequestMessage {
  return { type: 'request', request: createJsonRpcRequest(id, method, params) };
}

/**
 * Factory: wrap a JSON-RPC notification into a {@link NotificationMessage}.
 *
 * @param method - the method to notify about.
 * @param params - optional structured parameters.
 * @returns the normalized notification message.
 */
export function createNotificationMessage(method: string, params?: unknown): NotificationMessage {
  return { type: 'notification', notification: createJsonRpcNotification(method, params) };
}

/**
 * Factory: wrap a JSON-RPC response into a {@link ResponseMessage}.
 *
 * @param id - the id of the request being answered.
 * @param result - the successful result payload.
 * @returns the normalized response message.
 */
export function createResponseMessage(id: RequestId, result?: unknown): ResponseMessage {
  return { type: 'response', response: createJsonRpcResponse(id, result) };
}

/**
 * Factory: wrap a JSON-RPC error response into an {@link ErrorMessage}.
 *
 * @param id - the id of the failed request, or `null` when unknown.
 * @param code - the numeric error code.
 * @param message - a short human-readable description.
 * @param data - optional structured detail.
 * @returns the normalized error message.
 */
export function createErrorMessage(id: RequestIdOrNull, code: number, message: string, data?: unknown): ErrorMessage {
  return {
    type: 'error',
    error: createJsonRpcErrorResponse(id, createJsonRpcError(code, message, data)),
  };
}

/**
 * Factory: convenience wrapper over {@link createErrorMessage} that takes a
 * ready-made {@link McpProtocolError}.
 *
 * @param id - the id of the failed request, or `null` when unknown.
 * @param cause - the protocol error to serialize.
 * @returns the normalized error message.
 */
export function createErrorMessageFromError(id: RequestIdOrNull, cause: McpProtocolError): ErrorMessage {
  return {
    type: 'error',
    error: cause.toJsonRpcErrorResponse(id),
  };
}

/**
 * Factory: build a sensible default `initialize` parameter set.
 *
 * @param clientInfo - the client implementation identity.
 * @param protocolVersion - the desired protocol version (defaults to latest).
 * @param capabilities - client capabilities (defaults to `{}`).
 * @returns complete {@link InitializeParams}.
 */
export function createInitializeParams(
  clientInfo: Implementation,
  protocolVersion: string = LATEST_PROTOCOL_VERSION,
  capabilities: ClientCapabilities = {},
): InitializeParams {
  return { protocolVersion, capabilities, clientInfo };
}

/**
 * Factory: build a sensible default `initialize` result.
 *
 * @param serverInfo - the server implementation identity.
 * @param protocolVersion - the negotiated protocol version (defaults to latest).
 * @param capabilities - server capabilities (defaults to `{}`).
 * @param instructions - optional free-form usage instructions.
 * @returns complete {@link InitializeResult}.
 */
export function createInitializeResult(
  serverInfo: Implementation,
  protocolVersion: string = LATEST_PROTOCOL_VERSION,
  capabilities: ServerCapabilities = {},
  instructions?: string,
): InitializeResult {
  return instructions === undefined
    ? { protocolVersion, capabilities, serverInfo }
    : { protocolVersion, capabilities, serverInfo, instructions };
}

/**
 * Guard: reports whether `value` is a valid {@link ServerCapabilities} object.
 * Every known member, when present, must be a plain object.
 *
 * @param value - the untrusted value to validate.
 * @returns `true` when `value` looks like a server capability set.
 */
export function isServerCapabilities(value: unknown): value is ServerCapabilities {
  if (!isPlainObject(value)) {
    return false;
  }
  for (const key of ['tools', 'resources', 'prompts', 'logging', 'completion', 'experimental'] as const) {
    if (value[key] !== undefined && !isPlainObject(value[key])) {
      return false;
    }
  }
  return true;
}

/**
 * Guard: reports whether `value` is a valid {@link ClientCapabilities} object.
 *
 * @param value - the untrusted value to validate.
 * @returns `true` when `value` looks like a client capability set.
 */
export function isClientCapabilities(value: unknown): value is ClientCapabilities {
  if (!isPlainObject(value)) {
    return false;
  }
  for (const key of ['roots', 'sampling', 'experimental'] as const) {
    if (value[key] !== undefined && !isPlainObject(value[key])) {
      return false;
    }
  }
  return true;
}

/**
 * Guard: reports whether `value` is a valid {@link Implementation}.
 *
 * @param value - the untrusted value to validate.
 * @returns `true` when `value` carries `name` and `version` strings.
 */
export function isImplementation(value: unknown): value is Implementation {
  return isPlainObject(value) && typeof value['name'] === 'string' && typeof value['version'] === 'string';
}

/**
 * Guard: reports whether `value` is valid {@link InitializeParams}.
 *
 * @param value - the untrusted value to validate.
 * @returns `true` when `value` matches the initialize request shape.
 */
export function isInitializeParams(value: unknown): value is InitializeParams {
  return (
    isPlainObject(value) &&
    typeof value['protocolVersion'] === 'string' &&
    isClientCapabilities(value['capabilities']) &&
    isImplementation(value['clientInfo'])
  );
}

/**
 * Guard: reports whether `value` is a valid {@link InitializeResult}.
 *
 * @param value - the untrusted value to validate.
 * @returns `true` when `value` matches the initialize result shape.
 */
export function isInitializeResult(value: unknown): value is InitializeResult {
  return (
    isPlainObject(value) &&
    typeof value['protocolVersion'] === 'string' &&
    isServerCapabilities(value['capabilities']) &&
    isImplementation(value['serverInfo'])
  );
}

/**
 * Guard: reports whether `value` is a valid {@link McpRequest} envelope.
 * The `_result` phantom field is tolerated when present.
 *
 * @param value - the untrusted value to validate.
 * @returns `true` when `value` looks like an MCP request envelope.
 */
export function isMcpRequest(value: unknown): value is McpRequest {
  return isPlainObject(value) && typeof value['method'] === 'string' && value['method'].length > 0;
}

/**
 * Guard: reports whether `value` matches at least one shape of {@link McpResult}.
 *
 * @param value - the untrusted value to validate.
 * @returns `true` when `value` looks like an MCP result payload.
 */
export function isMcpResult(value: unknown): value is McpResult {
  return isPlainObject(value);
}

/**
 * Normalize an arbitrary request id (e.g. parsed from JSON) into a
 * {@link RequestId}, throwing a protocol error for invalid values.
 *
 * @param value - the raw id.
 * @returns the normalized id.
 * @throws {@link McpProtocolError} when the id is not a finite number or string.
 */
export function normalizeRequestId(value: unknown): RequestId {
  if (isRequestId(value)) {
    return value;
  }
  throw McpProtocolError.invalidRequest({ reason: 'invalid request id', value });
}