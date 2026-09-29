/**
 * MAM Security
 *
 * Standalone security engine: Auth, Authorization, Policy and Audit layers.
 *
 * Every public symbol is re-exported from the individual layer files
 * (`./<layer>/types.js`, `./<layer>/store.js`, `./<layer>/index.js`,
 * `./<layer>/retrieval.js`, `./<layer>/lifecycle.js`,
 * `./<layer>/integration.js`). The per-layer `index.ts` files are the
 * *indexing* classes (`AuthIndex`, `PermissionIndex`, `PolicyIndex`,
 * `AuditIndex`), NOT barrels, so they are not re-exported here under the
 * `index` name.
 *
 * Names that collide across layers (e.g. `PruneResult`, `storeFromJSON`,
 * `indexFromJSON`, `isRecord`, `nowMs`, `createId`, `isWildcard`,
 * `FindOptions`, `auditLine`, `createEmptyStats`, `ACTION_ANY`,
 * `RESOURCE_ANY`) are aliased with a layer prefix so every name stays unique
 * at the package root.
 */

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
export {
  IDENTITY_TYPES,
  DEFAULT_AUTH_CONFIG,
  createSalt,
  isIdentityType,
  isIdentity,
  isApiKey,
  isAuthToken,
  isSession,
  isCredential,
  createIdentity,
  createApiKey,
  createAuthToken,
  createSession,
  createCredential,
  assertIdentity,
  assertAuthToken,
  normalizeRoles,
  cloneMetadata,
  hasScope,
  isExpired,
  identityUsable,
  resolveConfig,
  isRecord as isAuthRecord,
  createEmptyStats as authCreateEmptyStats,
  nowMs as authNowMs,
  createId as authCreateId,
  isValidId as authIsValidId,
} from './auth/types.js';
export type {
  IdentityType,
  HashAlgorithm,
  CredentialKind,
  Identity,
  IdentityInput,
  ApiKey,
  AuthToken,
  Session,
  Credential,
  AuthConfig,
  AuthStats,
  AuthOptions,
  AuthResult,
  AuthFailureReason,
} from './auth/types.js';
export {
  IDENTITY_STORE_SCHEMA_VERSION,
  IdentityStore,
  isIdentityStoreSnapshot,
  storeFromJSON as authStoreFromJSON,
} from './auth/store.js';
export type {
  IdentityStoreEvents,
  IdentityStoreOptions,
  IdentityStoreSnapshot,
} from './auth/store.js';
export {
  AUTH_INDEX_SCHEMA_VERSION,
  AuthIndex,
  isAuthIndexSnapshot,
  indexFromJSON as authIndexFromJSON,
} from './auth/index.js';
export type {
  AuthIndexSnapshot,
  AuthIndexStats,
} from './auth/index.js';
export {
  StoredApiKey,
  IssuedApiKey,
  CredentialVerifier,
  parseDigest,
  safeEqual,
  generateSecret,
} from './auth/retrieval.js';
export type {
  IssuedToken,
  CredentialVerifierEvents,
  HashOptions,
  ApiKeyOptions,
  TokenOptions,
  CredentialVerifierOptions,
  ParsedDigest,
} from './auth/retrieval.js';
export {
  AuthLifecycle,
} from './auth/lifecycle.js';
export type {
  PruneResult as AuthPruneResult,
  RevokeAllResult,
  AuthLifecycleEvents,
  AuthLifecycleOptions,
} from './auth/lifecycle.js';
export {
  Authenticator,
  createAuthenticator,
  AuthAdapter,
} from './auth/integration.js';
export type {
  AuthProvider,
  LoginResult,
  CurrentAuth,
  LoginOptions,
  AuthenticatorOptions,
} from './auth/integration.js';

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------
export {
  SCOPE_ANY,
  DEFAULT_KEY_SEPARATOR,
  SNAPSHOT_VERSION,
  DEFAULT_AUTHZ_CONFIG,
  resolveAuthzConfig,
  isStringArray,
  isPermission,
  isRole,
  isCapability,
  isAccessRequest,
  isAccessDecision,
  assertPermission,
  assertRole,
  assertAccessRequest,
  createPermission,
  createRole,
  createCapability,
  createAccessRequest,
  allowDecision,
  denyDecision,
  permissionKey,
  permissionFromKey,
  scopeAllows,
  permissionAllows,
  specificity,
  dedupeRoles,
  describeRequest,
  permissionsEqual,
  ACTION_ANY as AUTHZ_ACTION_ANY,
  RESOURCE_ANY as AUTHZ_RESOURCE_ANY,
  createEmptyStats as authzCreateEmptyStats,
  isRecord as isAuthzRecord,
  isValidName as authzIsValidName,
  isWildcard as authzIsWildcard,
} from './authorization/types.js';
export type {
  Permission,
  Role,
  Capability,
  AccessContext,
  AccessRequest,
  DecisionReason,
  AccessDecision,
  GrantOptions,
  AuthzConfig,
  AuthzStats,
  RoleDefinition,
} from './authorization/types.js';
export {
  RoleStore,
  createRoleStore,
  buildRole,
} from './authorization/store.js';
export type {
  RoleStoreSnapshot,
  DeleteRoleOptions,
  AssignOptions,
} from './authorization/store.js';
export {
  PermissionIndex,
  createPermissionIndex,
} from './authorization/index.js';
export type {
  IndexEntry,
  PermissionIndexStats,
  FindOptions as AuthzFindOptions,
} from './authorization/index.js';
export {
  AccessChecker,
  createAccessChecker,
} from './authorization/retrieval.js';
export type {
  AccessCheckerOptions,
  AccessCheckerStats,
} from './authorization/retrieval.js';
export {
  AUTHZ_EVENTS,
  AuthzLifecycle,
  createAuthzLifecycle,
  auditLine as authzAuditLine,
} from './authorization/lifecycle.js';
export type {
  AuthzLifecycleOptions,
} from './authorization/lifecycle.js';
export {
  Authorizer,
  createAuthorizer,
  RbacEngine,
  AuthorizationAdapter,
  createAuthorizationAdapter,
  AuthorizationError,
} from './authorization/integration.js';
export type {
  AccessControl,
  AuthorizerOptions,
  AdapterOptions,
} from './authorization/integration.js';

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------
export {
  ALLOW,
  DENY,
  SUBJECT_ANY,
  POLICY_SNAPSHOT_VERSION,
  DEFAULT_MAX_INPUT_LENGTH,
  DEFAULT_RATE_LIMIT_WINDOW_MS,
  DEFAULT_RATE_LIMIT_MAX,
  DEFAULT_GC_INTERVAL_MS,
  DEFAULT_POLICY_CONFIG,
  resolvePolicyConfig,
  isValidRuleId,
  isPolicyRequest,
  isPolicyRule,
  isPolicyDefinition,
  isPolicyResult,
  isRateLimit,
  isRateLimitState,
  isSanitizeResult,
  isDependencyValidationResult,
  assertPolicyRule,
  assertPolicyDefinition,
  assertRateLimit,
  createPolicyRequest,
  createPolicyRule,
  createAllowRule,
  createDenyRule,
  createRateLimit,
  createSanitizeResult,
  allowResult,
  denyResult,
  ruleSpecificity,
  ruleMatches,
  compareRules,
  describePolicyRequest,
  effectRank,
  ACTION_ANY as POLICY_ACTION_ANY,
  RESOURCE_ANY as POLICY_RESOURCE_ANY,
  createEmptyStats as policyCreateEmptyStats,
  isRecord as isPolicyRecord,
  isValidName as policyIsValidName,
  isWildcard as policyIsWildcard,
} from './policy/types.js';
export type {
  PolicyEffect,
  PolicyReason,
  PolicyRequest,
  PolicyCondition,
  PolicyRule,
  PolicyDefinition,
  PolicyResult,
  RateLimit,
  RateLimitState,
  RateLimitDecision,
  SanitizeOptions,
  SanitizeResult,
  DependencyValidationResult,
  PolicyConfig,
  PolicyStats,
} from './policy/types.js';
export {
  PolicyStore,
  createPolicyStore,
  rulesFromSnapshot,
  renderRule,
} from './policy/store.js';
export type {
  PolicyStoreSnapshot,
  PolicyRuleSnapshot,
  RemoveRuleOptions,
} from './policy/store.js';
export {
  PolicyIndex,
  createPolicyIndex,
} from './policy/index.js';
export type {
  PolicyIndexStats,
  FindOptions as PolicyFindOptions,
} from './policy/index.js';
export {
  PolicyEvaluator,
  createPolicyEvaluator,
  evaluateAgainst,
} from './policy/retrieval.js';
export type {
  PolicyEvaluatorOptions,
} from './policy/retrieval.js';
export {
  POLICY_EVENTS,
  PolicyLifecycle,
  createPolicyLifecycle,
  auditLine as policyAuditLine,
} from './policy/lifecycle.js';
export type {
  PolicyLifecycleOptions,
} from './policy/lifecycle.js';
export {
  SecurityPolicyEngine,
  createSecurityPolicyEngine,
  PolicyAdapter,
  createPolicyAdapter,
  createPolicyEngineFromRules,
  SecurityPolicyError,
} from './policy/integration.js';
export type {
  PolicyProvider,
  SecurityPolicyEngineOptions,
  PolicyAdapterOptions,
} from './policy/integration.js';

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------
export {
  AUDIT_TYPES,
  AUDIT_RESULTS,
  AUDIT_SEVERITIES,
  ANOMALY_RULE_KINDS,
  DEFAULT_ACTOR,
  DEFAULT_REDACT_CONFIG,
  DEFAULT_ANOMALY_RULES,
  DEFAULT_AUDIT_CONFIG,
  createEmptyAuditStats,
  isAuditType,
  isAuditResult,
  isAuditSeverity,
  isAuditEvent,
  isRedactConfig,
  isAnomalyRule,
  assertAuditEvent,
  createAuditEvent,
  resolveRedactConfig,
  resolveAuditConfig,
  severityRank,
  isSeverityAtLeast,
  isUnknownActor,
  cloneData,
  createAnomalyFlag,
  serializeEvent,
  isRecord as isAuditRecord,
  nowMs as auditNowMs,
  createId as auditCreateId,
  isValidId as auditIsValidId,
} from './audit/types.js';
export type {
  AuditType,
  AuditResult,
  AuditSeverity,
  AnomalyRuleKind,
  AuditEvent,
  AuditEventInput,
  RedactConfig,
  AnomalyRule,
  AnomalyFlag,
  SecurityReport,
  AuditConfig,
  AuditStats,
  AuditOptions,
} from './audit/types.js';
export {
  AUDIT_STORE_SCHEMA_VERSION,
  AuditStore,
  isAuditStoreSnapshot,
  storeFromJSON as auditStoreFromJSON,
} from './audit/store.js';
export type {
  AuditStorePruneReason,
  AuditStorePruneResult,
  AuditStoreEvents,
  AuditStoreOptions,
  AuditStoreSnapshot,
} from './audit/store.js';
export {
  AUDIT_INDEX_SCHEMA_VERSION,
  AuditIndex,
  isAuditIndexSnapshot,
  indexFromJSON as auditIndexFromJSON,
} from './audit/index.js';
export type {
  AuditIndexSnapshot,
  AuditIndexStats,
} from './audit/index.js';
export {
  DEFAULT_QUERY_LIMIT,
  AuditQuery,
} from './audit/retrieval.js';
export type {
  AuditCounts,
  AuditTallyRow,
  AuditSummary,
  AuditQueryOptions,
} from './audit/retrieval.js';
export {
  AuditLifecycle,
  evaluateDenialBurst,
  evaluateRule,
  detectAnomalies,
} from './audit/lifecycle.js';
export type {
  PruneResult as AuditPruneResult,
  AuditLifecycleEvents,
  AuditLifecycleOptions,
} from './audit/lifecycle.js';
export {
  Redactor,
  AuditLogger,
  SecurityReporter,
  createAuditLogger,
  createSecurityReporter,
} from './audit/integration.js';
export type {
  AuditLoggerOptions,
  ReportOptions,
  SecurityReporterOptions,
} from './audit/integration.js';