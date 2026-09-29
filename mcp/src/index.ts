/**
 * MAM MCP Engine
 *
 * Standalone MCP (Model Context Protocol) engine: Protocol, Server, Client and
 * Tools layers.
 *
 * Every public symbol is re-exported from the individual layer files
 * (`./<layer>/types.js`, `./<layer>/store.js`, `./<layer>/index.js`,
 * `./<layer>/retrieval.js`, `./<layer>/lifecycle.js`). The per-layer `index.ts`
 * files are the *indexing* classes (`MethodIndex`, `SessionIndex`,
 * `ConnectionIndex`, `ToolsIndex`), NOT barrels, so they are re-exported under
 * their class names only.
 *
 * Names that collide across layers are aliased with a layer prefix so every
 * name stays unique at the package root:
 *
 *   - Protocol  -> `Protocol*`  (e.g. `ProtocolJsonRpcRequest`,
 *                    `ProtocolLatestProtocolVersion`, `ProtocolRequestId`)
 *   - Server    -> `Server*`    (e.g. `ServerJsonRpcRequest`, `ServerToolListing`)
 *   - Client    -> `Client*`    (e.g. `ClientJsonRpcRequest`, `ClientToolListing`,
 *                    `ClientRequestId`)
 *   - Tools     -> `Tools*`     (e.g. `ToolsIsPlainObject`)
 *
 * Names that exist in exactly one layer are exported unchanged (e.g.
 * `ProtocolCodec`, `McpServer`, `McpClient`, `SchemaConverter`).
 */

// ---------------------------------------------------------------------------
// Protocol layer
// ---------------------------------------------------------------------------

// protocol/types.ts
export {
  JSON_RPC_VERSION,
  LATEST_PROTOCOL_VERSION as ProtocolLatestProtocolVersion,
  SUPPORTED_PROTOCOL_VERSIONS as ProtocolSupportedProtocolVersions,
  DEFAULT_PROTOCOL_VERSION,
  MESSAGE_TYPES,
  DIRECTIONS,
  ErrorCodes,
  LOGGING_LEVELS,
  McpProtocolError,
  isPlainObject as ProtocolIsPlainObject,
  isRequestId,
  messageMethod,
  messageId,
  isPendingMessage,
  isJsonRpcRequest as ProtocolIsJsonRpcRequest,
  isJsonRpcNotification as ProtocolIsJsonRpcNotification,
  isJsonRpcResponse as ProtocolIsJsonRpcResponse,
  isJsonRpcError,
  isJsonRpcErrorResponse,
  isRequest,
  isResponse,
  isError,
  isNotification,
  isErrorResponse,
  isProtocolMessage,
  describeErrorCode,
  compareLoggingLevels,
  createJsonRpcRequest,
  createJsonRpcNotification,
  createJsonRpcResponse,
  createJsonRpcError,
  createJsonRpcErrorResponse,
  createRequestMessage,
  createNotificationMessage,
  createResponseMessage,
  createErrorMessage,
  createErrorMessageFromError,
  createInitializeParams,
  createInitializeResult,
  isServerCapabilities as ProtocolIsServerCapabilities,
  isClientCapabilities,
  isImplementation as ProtocolIsImplementation,
  isInitializeParams,
  isInitializeResult as ProtocolIsInitializeResult,
  isMcpRequest,
  isMcpResult,
  normalizeRequestId,
} from './protocol/types.js';
export type {
  JsonRpcVersion,
  MessageType,
  Direction,
  RequestId as ProtocolRequestId,
  RequestIdOrNull,
  JsonRpcRequest as ProtocolJsonRpcRequest,
  JsonRpcResponse as ProtocolJsonRpcResponse,
  JsonRpcError,
  JsonRpcErrorResponse as ProtocolJsonRpcErrorResponse,
  JsonRpcNotification as ProtocolJsonRpcNotification,
  RequestMessage,
  ResponseMessage,
  ErrorMessage,
  NotificationMessage,
  ProtocolMessage,
  McpRequest,
  McpResult,
  ServerCapabilities as ProtocolServerCapabilities,
  ToolCapabilities,
  ResourceCapabilities,
  PromptCapabilities,
  ClientCapabilities as ProtocolClientCapabilities,
  Implementation as ProtocolImplementation,
  InitializeParams,
  InitializeResult as ProtocolInitializeResult,
  Tool,
  ToolInputSchema,
  Resource,
  ResourceContent,
  Prompt,
  PromptArgument as ProtocolPromptArgument,
  PromptMessage as ProtocolPromptMessage,
  ContentBlock as ProtocolContentBlock,
  TextContent,
  ImageContent,
  EmbeddedResource,
  LoggingLevel,
  ErrorCode,
} from './protocol/types.js';

// protocol/retrieval.ts
export {
  MCP_METHODS,
  MCP_METHOD_LIST,
  isMcpMethod,
  serializeMessage,
  ProtocolCodec,
  createCodec,
  continueCodec,
  describeMessage,
} from './protocol/retrieval.js';
export type {
  McpMethodName as ProtocolMcpMethodName,
  DecodedFrame,
  DecodeOptions,
} from './protocol/retrieval.js';

// protocol/store.ts
export {
  STORE_JSON_VERSION,
  toStoredMessage,
  estimateStoredMessageBytes,
  MessageStore,
} from './protocol/store.js';
export type {
  StoredMessage,
  MessageStoreStats,
  MessageStoreJSON,
} from './protocol/store.js';

// protocol/index.ts
export {
  toIndexedEntry,
  isMessageType,
  countByMethod,
  MethodIndex,
} from './protocol/index.js';
export type {
  IndexedEntry,
  MethodIndexStats,
} from './protocol/index.js';

// protocol/lifecycle.ts
export {
  isLifecycleEvent,
  isValidMessageType,
  ProtocolLifecycle,
} from './protocol/lifecycle.js';
export type {
  ProtocolLifecycleEvent,
  ProtocolLifecycleOptions,
  ProtocolLifecycleStats,
} from './protocol/lifecycle.js';

// ---------------------------------------------------------------------------
// Server layer
// ---------------------------------------------------------------------------

// server/types.ts
export {
  JSONRPC_VERSION as ServerJsonRpcVersion,
  PROTOCOL_VERSION_2024_11_05 as ServerProtocolVersion2024_11_05,
  PROTOCOL_VERSION_2025_03_26 as ServerProtocolVersion2025_03_26,
  LATEST_PROTOCOL_VERSION as ServerLatestProtocolVersion,
  SUPPORTED_PROTOCOL_VERSIONS as ServerSupportedProtocolVersions,
  MCP_METHOD as ServerMcpMethod,
  DEFAULT_SERVER_CONFIG,
  DEFAULT_SESSION_CONFIG,
  JsonRpcErrorCode as ServerJsonRpcErrorCode,
  McpRequestError,
  isJsonRpcRequest as ServerIsJsonRpcRequest,
  isJsonRpcNotification as ServerIsJsonRpcNotification,
  isParsedMessage as ServerIsParsedMessage,
  isJsonRpcResponse as ServerIsJsonRpcResponse,
  isJsonRpcErrorObject as ServerIsJsonRpcErrorObject,
  isImplementation as ServerIsImplementation,
  isMcpSession,
  isServerCapabilities as ServerIsServerCapabilities,
  isContentBlock as ServerIsContentBlock,
  createServerConfig,
  createSessionConfig,
  createServerStats,
  createImplementation as ServerCreateImplementation,
  createSessionRecord,
  mergeCapabilities as ServerMergeCapabilities,
} from './server/types.js';
export type {
  ProtocolVersion as ServerProtocolVersion,
  McpMethodName as ServerMcpMethodName,
  JsonRpcRequest as ServerJsonRpcRequest,
  JsonRpcNotification as ServerJsonRpcNotification,
  ParsedMessage as ServerParsedMessage,
  ParsedBatch as ServerParsedBatch,
  JsonRpcErrorObject as ServerJsonRpcErrorObject,
  JsonRpcSuccessResponse as ServerJsonRpcSuccessResponse,
  JsonRpcErrorResponse as ServerJsonRpcErrorResponse,
  JsonRpcResponse as ServerJsonRpcResponse,
  DispatchOutput,
  JsonRpcCodec,
  Implementation as ServerImplementation,
  ServerCapabilities as ServerServerCapabilities,
  ClientCapabilities as ServerClientCapabilities,
  McpSession,
  SessionConfig,
  ServerConfig,
  ServerOptions,
  ServerStats,
  DispatchResult,
  HandlerResult,
  ToolListing as ServerToolListing,
  ContentBlock as ServerContentBlock,
  TextContentBlock as ServerTextContentBlock,
  ImageContentBlock as ServerImageContentBlock,
  EmbeddedResourceBlock as ServerEmbeddedResourceBlock,
  CallToolResult as ServerCallToolResult,
  ListToolsResult as ServerListToolsResult,
  ResourceListing as ServerResourceListing,
  ResourceContents as ServerResourceContents,
  ListResourcesResult as ServerListResourcesResult,
  ReadResourceResult as ServerReadResourceResult,
  PromptArgument as ServerPromptArgument,
  PromptListing as ServerPromptListing,
  ListPromptsResult as ServerListPromptsResult,
  PromptMessage as ServerPromptMessage,
  GetPromptResult as ServerGetPromptResult,
  InitializeRequestParams as ServerInitializeRequestParams,
  InitializeResult as ServerInitializeResult,
  PingResult as ServerPingResult,
} from './server/types.js';

// server/store.ts
export {
  SessionStore,
  createSessionStore,
} from './server/store.js';
export type {
  SessionStoreEvents,
  SessionStoreListener,
  SessionStoreStats,
  CreateSessionOptions,
  PruneOptions as ServerPruneOptions,
  SessionStoreSnapshot,
} from './server/store.js';

// server/index.ts
export {
  SessionIndex,
  createSessionIndex,
} from './server/index.js';
export type {
  SessionIndexStats,
} from './server/index.js';

// server/retrieval.ts
export {
  RequestDispatcher,
  createRequestDispatcher,
} from './server/retrieval.js';
export type {
  HandlerFn,
  HandlerRegistry,
  DispatcherAccessors,
  DispatchContext,
  DispatcherOptions,
} from './server/retrieval.js';

// server/lifecycle.ts
export {
  McpServer,
  createMcpServer,
  SERVER_PROTOCOL_VERSIONS,
  SERVER_LATEST_PROTOCOL_VERSION,
  isSuccessResponse as ServerIsSuccessResponse,
} from './server/lifecycle.js';
export type {
  McpServerEvents,
  McpServerListener,
} from './server/lifecycle.js';

// ---------------------------------------------------------------------------
// Client layer
// ---------------------------------------------------------------------------

// client/types.ts
export {
  JSONRPC_VERSION as ClientJsonRpcVersion,
  PROTOCOL_VERSION_2024_11_05 as ClientProtocolVersion2024_11_05,
  PROTOCOL_VERSION_2025_03_26 as ClientProtocolVersion2025_03_26,
  LATEST_PROTOCOL_VERSION as ClientLatestProtocolVersion,
  SUPPORTED_PROTOCOL_VERSIONS as ClientSupportedProtocolVersions,
  MCP_METHOD as ClientMcpMethod,
  CONNECTION_STATUSES,
  DEFAULT_CLIENT_CONFIG,
  JsonRpcErrorCode as ClientJsonRpcErrorCode,
  McpClientError,
  isJsonRpcRequest as ClientIsJsonRpcRequest,
  isJsonRpcNotification as ClientIsJsonRpcNotification,
  isParsedMessage as ClientIsParsedMessage,
  isJsonRpcResponse as ClientIsJsonRpcResponse,
  isJsonRpcErrorObject as ClientIsJsonRpcErrorObject,
  isImplementation as ClientIsImplementation,
  isConnectionStatus,
  isMcpConnection,
  isCallResult,
  isToolCall,
  isResourceRequest,
  isPromptRequest,
  isServerCapabilities as ClientIsServerCapabilities,
  isContentBlock as ClientIsContentBlock,
  createClientConfig,
  createConnectionRecord,
  createCallResultSuccess,
  createCallResultError,
  createClientStats,
  createToolCall,
  createResourceRequest,
  createPromptRequest,
  createImplementation as ClientCreateImplementation,
  mergeCapabilities as ClientMergeCapabilities,
  callResultText,
} from './client/types.js';
export type {
  ProtocolVersion as ClientProtocolVersion,
  McpMethodName as ClientMcpMethodName,
  ConnectionStatus,
  JsonRpcRequest as ClientJsonRpcRequest,
  JsonRpcNotification as ClientJsonRpcNotification,
  ParsedMessage as ClientParsedMessage,
  ParsedBatch as ClientParsedBatch,
  JsonRpcErrorObject as ClientJsonRpcErrorObject,
  JsonRpcSuccessResponse as ClientJsonRpcSuccessResponse,
  JsonRpcErrorResponse as ClientJsonRpcErrorResponse,
  JsonRpcResponse as ClientJsonRpcResponse,
  Implementation as ClientImplementation,
  ClientCapabilities as ClientClientCapabilities,
  ServerCapabilities as ClientServerCapabilities,
  McpConnection,
  ClientConfig,
  ClientOptions,
  CallResult,
  ToolCall,
  ResourceRequest,
  PromptRequest,
  ClientStats,
  ToolListing as ClientToolListing,
  ContentBlock as ClientContentBlock,
  TextContentBlock as ClientTextContentBlock,
  ImageContentBlock as ClientImageContentBlock,
  EmbeddedResourceBlock as ClientEmbeddedResourceBlock,
  CallToolResult as ClientCallToolResult,
  ListToolsResult as ClientListToolsResult,
  ResourceListing as ClientResourceListing,
  ResourceContents as ClientResourceContents,
  ListResourcesResult as ClientListResourcesResult,
  ReadResourceResult as ClientReadResourceResult,
  PromptArgument as ClientPromptArgument,
  PromptListing as ClientPromptListing,
  ListPromptsResult as ClientListPromptsResult,
  PromptMessage as ClientPromptMessage,
  GetPromptResult as ClientGetPromptResult,
  InitializeRequestParams as ClientInitializeRequestParams,
  InitializeResult as ClientInitializeResult,
  PingResult as ClientPingResult,
  McpTransport,
} from './client/types.js';

// client/store.ts
export {
  ConnectionStore,
  createConnectionStore,
} from './client/store.js';
export type {
  ConnectionStoreEvents,
  ConnectionStoreListener,
  ConnectionStoreStats,
  CreateConnectionOptions,
  PruneOptions as ClientPruneOptions,
  ConnectionStoreSnapshot,
} from './client/store.js';

// client/index.ts
export {
  ConnectionIndex,
  createConnectionIndex,
} from './client/index.js';
export type {
  ConnectionIndexStats,
} from './client/index.js';

// client/retrieval.ts
export {
  RequestCorrelator,
  createRequestCorrelator,
} from './client/retrieval.js';
export type {
  RequestId as ClientRequestId,
  PendingRequest,
  PendingEntry,
  PendingEntryView,
  RequestCorrelatorStats,
} from './client/retrieval.js';

// client/lifecycle.ts
export {
  McpClient,
  MemoryTransport,
  createMemoryTransportPair,
  createMcpClient,
  CLIENT_PROTOCOL_VERSIONS,
  CLIENT_LATEST_PROTOCOL_VERSION,
  isSuccessResponse as ClientIsSuccessResponse,
} from './client/lifecycle.js';
export type {
  McpClientEvents,
  McpClientListener,
} from './client/lifecycle.js';

// ---------------------------------------------------------------------------
// Tools layer
// ---------------------------------------------------------------------------

// tools/types.ts
export {
  TOOL_KINDS,
  JSON_SCHEMA_TYPES,
  DEFAULT_TOOLS_CONFIG,
  DEFAULT_REGISTER_OPTIONS,
  isToolKind,
  isJsonSchemaType,
  isJsonSchema,
  isMcpToolAnnotations,
  canonicalKey,
  toolKey,
  resourceKey,
  promptKey,
  keyOf,
  kindOf,
  isMcpTool,
  isMcpResource,
  isMcpResourceContents,
  isMcpPromptArgument,
  isMcpPrompt,
  isMcpRegistrable,
  createToolsConfig,
  isToolsConfig,
  createRegisterOptions,
  isRegisterOptions,
  createToolsStats,
  createTool,
  createResource,
  createResourceContents,
  createPromptArgument,
  createPrompt,
  createJsonSchema,
  estimateRegistrableBytes,
  isPlainObject as ToolsIsPlainObject,
  isValidName,
  isValidUri,
} from './tools/types.js';
export type {
  ToolKind,
  JsonSchemaType,
  JsonSchema,
  McpToolAnnotations,
  McpTool,
  McpResource,
  McpResourceContents,
  McpPromptArgument,
  McpPrompt,
  McpRegistrable,
  ToolsConfig,
  RegisterOptions,
  ToolsStats,
} from './tools/types.js';

// tools/store.ts
export {
  REGISTRY_JSON_VERSION,
  toRegisteredEntry,
  ToolsRegistry,
  DuplicateKeyError,
  countByKind,
  allValues,
} from './tools/store.js';
export type {
  RegisteredEntry,
  ToolsRegistryJSON,
  ToolsRegistryStats,
} from './tools/store.js';

// tools/index.ts
export {
  INDEX_JSON_VERSION,
  toToolsIndexEntry,
  isValidToolKind,
  countIndexedByKind,
  entriesFromDescriptors,
  INDEX_KINDS,
  ToolsIndex,
} from './tools/index.js';
export type {
  ToolsIndexEntry,
  ToolsIndexJSON,
  ToolsIndexStats,
} from './tools/index.js';

// tools/retrieval.ts
export {
  PARAMETER_TYPE_NAMES,
  toValidationResult,
  defaultTypeOf,
  joinPath,
  deepEqual,
  missingFieldIssue,
  SchemaConverter,
} from './tools/retrieval.js';
export type {
  ParameterTypeName,
  ToolParameter,
  ToolFromDefinitionOptions,
  ResourceFromUriOptions,
  PromptFromNameOptions,
  ValidationIssueCode,
  ValidationIssue,
  ValidationResult,
} from './tools/retrieval.js';

// tools/lifecycle.ts
export {
  TOOLS_LIFECYCLE_EVENTS,
  LIFECYCLE_KINDS,
  createToolsLifecycle,
  isToolsLifecycleEvent,
  toRegisteredPayload,
  issuesToResult,
  ToolsLifecycle,
} from './tools/lifecycle.js';
export type {
  ToolsLifecycleEvent,
  ToolsLifecycleOptions,
  ToolsLifecycleStats,
} from './tools/lifecycle.js';