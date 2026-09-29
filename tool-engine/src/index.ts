/**
 * MAM Tool Engine
 *
 * Standalone tool engine: Discovery, Permissions, Invocation and Validation
 * layers.
 *
 * Every public symbol is re-exported from the individual layer files
 * (`./<layer>/types.js`, `./<layer>/store.js`, `./<layer>/index.js`,
 * `./<layer>/retrieval.js`, `./<layer>/lifecycle.js`,
 * `./<layer>/integration.js`). The per-layer `index.ts` files are the
 * *indexing* classes (`ToolIndex`, `PermissionIndex`, `InvocationIndex`,
 * `ValidationIndex`), NOT barrels, so they are re-exported under their class
 * names only.
 *
 * Names that collide across layers (e.g. `ToolDefinition`, `ToolParameter`,
 * `isToolDefinition`, `isToolParameter`, `isStringArray`, `createIndex`) are
 * aliased with a layer prefix so every name stays unique at the package root.
 * `ToolExecutor` is exported as the class (from `retrieval.js`); its sibling
 * interface in `types.js` is structurally identical, so exporting both under
 * the same name is not possible and the class is the canonical root name.
 */

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------
export {
  isToolParameter as isDiscoveryToolParameter,
  isStringArray as isDiscoveryStringArray,
  isToolDefinition as isDiscoveryToolDefinition,
  isToolDefinitionMap,
  normalizeToolDefinition,
  createToolDefinition,
  toToolSchema,
  DEFAULT_DISCOVERY_CONFIG,
  resolveDiscoveryConfig,
  normalizeToken,
  tokenizeText,
  uniqueStrings,
  overlapCount,
} from './discovery/types.js';
export type {
  ToolParameter as DiscoveryToolParameter,
  ToolDefinition as DiscoveryToolDefinition,
  ToolSchema,
  ToolCapability,
  DiscoveryConfig,
  SearchOptions,
  DiscoveryOptions,
  DiscoveryStats,
  DiscoveryEventPayload,
  DiscoveryEmitter,
} from './discovery/types.js';
export {
  ToolRegistry,
} from './discovery/store.js';
export {
  ToolIndex,
  createIndex as createDiscoveryIndex,
} from './discovery/index.js';
export {
  scoreTool,
  ToolSearcher,
} from './discovery/retrieval.js';
export type {
  SearchResult,
} from './discovery/retrieval.js';
export {
  LIFECYCLE_EVENTS,
  DiscoveryLifecycle,
} from './discovery/lifecycle.js';
export type {
  LifecycleEventPayload,
} from './discovery/lifecycle.js';
export {
  ToolDiscovery,
  DiscoveryAdapter,
  createToolDiscovery,
} from './discovery/integration.js';
export type {
  ToolCatalog,
} from './discovery/integration.js';

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------
export {
  isPermissionEffect,
  isPermissionRule,
  isPermissionRequest,
  isPermissionDecision,
  isCapabilityMapping,
  isPermissionConfig,
  DEFAULT_PERMISSION_CONFIG,
  DEFAULT_RULE_PRIORITY,
  WILDCARD,
  CAPABILITY_SEPARATOR,
  createRule,
  allowRule,
  denyRule,
  allowDecision,
  denyDecision,
  createRequest,
  createEmptyStats,
  resolveConfig,
  randomId,
  normalizeRole,
  parseCapability,
  capabilityCovers,
  ruleSpecificity,
  cloneRule,
} from './permissions/types.js';
export type {
  PermissionEffect,
  RoleName,
  CapabilityName,
  ToolName,
  RequestContext,
  RequestParams,
  RequestIdentity,
  PermissionRule,
  PermissionRequest,
  PermissionDecision,
  PermissionConfig,
  PermissionStats,
  GrantOptions,
  CapabilityMapping,
  NormalizedRole,
  ParsedCapability,
} from './permissions/types.js';
export {
  PermissionStore,
  createPermissionStore,
} from './permissions/store.js';
export type {
  StoreEvents,
  SerializedPermissionStore,
} from './permissions/store.js';
export {
  PermissionIndex,
  createPermissionIndex,
} from './permissions/index.js';
export type {
  PermissionIndexMap,
  PermissionIndexStats,
} from './permissions/index.js';
export {
  PermissionChecker,
  ArrayRuleSource,
  ArrayCapabilitySource,
  createPermissionChecker,
} from './permissions/retrieval.js';
export type {
  PermissionRuleSource,
  CapabilitySource,
  ToolDefinition as PermissionToolDefinition,
  ExtractionOptions,
  ExtractionResult,
  GatherResult,
} from './permissions/retrieval.js';
export {
  PermissionLifecycle,
  createPermissionLifecycle,
} from './permissions/lifecycle.js';
export type {
  RuleSyncSource,
  LifecycleEventHandler,
  LifecycleEvents,
  PermissionLifecycleOptions,
} from './permissions/lifecycle.js';
export {
  PermissionDeniedError,
  IndexedRuleSource,
  ToolAuthorizer,
  createToolAuthorizer,
  PermissionsAdapter,
  createAllowAllProvider,
  createDenyAllProvider,
  defaultConfig,
} from './permissions/integration.js';
export type {
  ToolPermissionProvider,
  ToolAuthorizerConfig,
} from './permissions/integration.js';

// ---------------------------------------------------------------------------
// Invocation
// ---------------------------------------------------------------------------
export {
  InvocationError,
  TimeoutError,
  isRecord,
  isErrorObject,
  isAbortError,
  isRetryPolicy,
  isInvocationConfig,
  isInvocationRequest,
  isInvocationResult,
  isExecutionRecord,
  normalizeRetryPolicy,
  normalizeInvocationConfig,
  DEFAULT_RETRY_POLICY,
  DEFAULT_INVOCATION_CONFIG,
  MAX_BACKOFF_MS,
  resolveRetryPolicy,
  resolveInvocationConfig,
  resolveInvokeOptions,
  createEmptyToolStats,
  createToolStats,
  createInvocationResult,
  createExecutionRecord,
  errorMessage,
  newTraceId,
  stableStringify,
  cacheKeyFor,
  computeBackoffMs,
} from './invocation/types.js';
export type {
  ToolHandler,
  InvocationContext,
  InvocationRequest,
  InvocationResult,
  ExecutionRecord,
  RetryPolicy,
  InvocationConfig,
  InvokeOptions,
  ToolStats,
  InvocationStats,
  ToolCounts,
  InvocationIndexStats,
  ResultCache,
  InvocationEmitter,
} from './invocation/types.js';
export {
  InvocationStore,
} from './invocation/store.js';
export type {
  InvocationStoreSnapshot,
} from './invocation/store.js';
export {
  InvocationIndex,
  createIndex as createInvocationIndex,
} from './invocation/index.js';
export {
  ToolExecutor,
} from './invocation/retrieval.js';
export type {
  ToolExecutorOptions,
} from './invocation/retrieval.js';
export {
  INVOCATION_EVENTS,
  InvocationLifecycle,
} from './invocation/lifecycle.js';
export type {
  InvocationEventPayload,
} from './invocation/lifecycle.js';
export {
  ToolInvoker,
  InvocationAdapter,
  createToolInvoker,
} from './invocation/integration.js';
export type {
  ToolInvokerOptions,
} from './invocation/integration.js';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
export {
  KNOWN_TYPE_NAMES,
  isKnownType,
  DEFAULT_VALIDATION_CONFIG,
  resolveValidationConfig,
  DEFAULT_VALIDATE_OPTIONS,
  resolveValidateOptions,
  isTypeName,
  isToolParameter as isValidationToolParameter,
  isToolDefinition as isValidationToolDefinition,
  isStringArray as isValidationStringArray,
  isValidationSchema,
  isValidationIssue,
  isValidationResult,
  isValidationConfig,
  createValidationIssue,
  emptyValidationResult,
  createValidationResult,
  validationResult,
  mergeValidationResults,
  hasIssueCode,
  issueCodes,
  cloneToolParameter,
  normalizeParameters,
  cloneUnknown,
} from './validation/types.js';
export type {
  TypeName,
  ToolParameter as ValidationToolParameter,
  ToolDefinition as ValidationToolDefinition,
  ValidationSchema,
  ValidationIssueCode,
  ValidationIssue,
  ValidationResult,
  ValidationConfig,
  ValidateOptions,
  ValidationStats,
  ValidationEventPayload,
  ValidationEmitter,
} from './validation/types.js';
export {
  ValidationStore,
} from './validation/store.js';
export type {
  SerializedSchema,
} from './validation/store.js';
export {
  ValidationIndex,
  createValidationIndex,
} from './validation/index.js';
export {
  typeMatches,
  inEnum,
  describeType,
  coerce,
  validateParams,
  ParamValidator,
} from './validation/retrieval.js';
export type {
  CoercionResult,
} from './validation/retrieval.js';
export {
  VALIDATION_EVENTS,
  ValidationLifecycle,
} from './validation/lifecycle.js';
export type {
  ValidationLifecycleOptions,
} from './validation/lifecycle.js';
export {
  ToolValidator,
  ValidationAdapter,
  createToolValidator,
} from './validation/integration.js';
export type {
  Validator,
  ValidationOptions,
} from './validation/integration.js';