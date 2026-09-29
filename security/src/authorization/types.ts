/**
 * types.ts
 *
 * Canonical type definitions, constants, type guards, factories and default
 * values for the MAM Authorization layer.
 *
 * The authorization engine answers one question: *"may a principal holding a
 * set of roles perform a given action on a given resource?"* Every entity that
 * flows through the pipeline (permissions, roles, capabilities, access
 * requests, decisions, configuration and statistics) is described here so the
 * store, index, retrieval, lifecycle and integration layers share one
 * canonical shape.
 *
 * This module is deliberately dependency-free and acts as the single source of
 * truth for validation logic. Guards follow the "narrow before use"
 * philosophy: callers may rely on the returned predicates to reduce an
 * `unknown` payload to a fully typed entity without casting. Factories freeze
 * their results so stored records cannot be mutated through a shared
 * reference, and the constant defaults are frozen so a fresh engine is safe to
 * drop into any Node process.
 *
 * The matching semantics used by {@link permissionAllows} are documented next
 * to the helper itself; the {@link AccessChecker} in `retrieval.ts` composes
 * them with role resolution and inheritance expansion.
 *
 * @module authorization/types
 */

/**
 * Wildcard action marker. A permission whose `action` equals {@link ACTION_ANY}
 * grants its resource for every action.
 */
export const ACTION_ANY = '*';

/**
 * Wildcard resource marker. A permission whose `resource` equals
 * {@link RESOURCE_ANY} grants its action against every resource.
 */
export const RESOURCE_ANY = '*';

/**
 * Wildcard scope marker. A permission whose `scope` equals {@link SCOPE_ANY}
 * (or is undefined) applies regardless of the scope carried by a request.
 */
export const SCOPE_ANY = '*';

/**
 * The separator used to serialize a permission into a string key of the form
 * `action:resource:scope`. Nested scope values (e.g. `tenant:acme`) are legal
 * because keys are parsed from the left, never from the right.
 */
export const DEFAULT_KEY_SEPARATOR = ':';

/**
 * Schema version stamped into serialized role-store snapshots so future
 * formats can migrate safely.
 */
export const SNAPSHOT_VERSION = 1;

/**
 * An atomic statement of the form "this action may be performed on this
 * resource, optionally constrained to a scope".
 *
 * A `scope` is an application-defined label (tenant id, environment name,
 * workspace id) that narrows the grant. A permission without a `scope` is
 * unscoped and applies in every scope context.
 */
export interface Permission {
  /** The action being permitted (e.g. `read`, `write`, `delete`, `invoke`). */
  readonly action: string;
  /** The resource the action applies to (e.g. `document`, `bucket`, `role`). */
  readonly resource: string;
  /** Optional scope constraint; `*` and `undefined` both mean unscoped. */
  readonly scope?: string;
}

/**
 * A named bundle of permissions. Roles are the unit of coarse-grained RBAC:
 * principals hold roles, roles hold permissions, and inheritance lets a role
 * be composed from one or more parent roles.
 *
 * `inherited` is a list of parent role names. Permission lookup is
 * transitive — a role inherits every permission of its ancestors, their
 * ancestors, and so on. Cycles in the inheritance graph are tolerated by the
 * resolver and simply ignored.
 */
export interface Role {
  /** Stable, unique role name. */
  readonly name: string;
  /** Permissions owned directly by this role (not including inherited ones). */
  readonly permissions: readonly Permission[];
  /** Names of parent roles whose permissions are also granted. */
  readonly inherited?: readonly string[];
  /** Optional human-readable description of the role's purpose. */
  readonly description?: string;
  /** Free-form application metadata attached to the role. */
  readonly metadata?: Readonly<Record<string, unknown>>;
  /** Epoch ms timestamp recording when the role was created. */
  readonly createdAt: number;
}

/**
 * A named, reusable bundle of permissions that can be sprinkled onto roles.
 *
 * Capabilities differ from roles in that they are not themselves assignable to
 * principals and carry no inheritance; they are a convenience for modelling
 * libraries of permission groups (e.g. "crud" = read+write+delete on a
 * resource) that are expanded into roles at registration time.
 */
export interface Capability {
  /** Unique capability name. */
  readonly name: string;
  /** Permissions bundled under this capability. */
  readonly permissions: readonly Permission[];
  /** Optional description of what the capability covers. */
  readonly description?: string;
  /** Free-form metadata attached to the capability. */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Arbitrary, application-defined context attached to an access request.
 *
 * Context is intentionally opaque to the core engine — the matching logic
 * never reads it — but it is preserved on the resulting {@link AccessDecision}
 * so adapters and audit layers can enrich decisions with environment,
 * geolocation, request metadata or any other signal.
 */
export interface AccessContext {
  /** Context keyed by arbitrary string labels. */
  readonly [key: string]: unknown;
}

/**
 * A single authorization query: "may a principal holding `roles` perform
 * `action` on `resource`?".
 *
 * `scope` is optional on the request; when omitted, only unscoped (or
 * wildcard-scoped) permissions can match. When provided, scoped permissions
 * whose scope equals the requested scope also match.
 *
 * @see {@link permissionAllows} for the precise matching rules.
 */
export interface AccessRequest {
  /** Identity making the request (optional; used only for audit/assignment). */
  readonly identityId?: string;
  /** Role labels held by the requesting principal. May be empty. */
  readonly roles: readonly string[];
  /** The action being requested. */
  readonly action: string;
  /** The resource being acted upon. */
  readonly resource: string;
  /** Optional scope of the request (tenant, environment, workspace…). */
  readonly scope?: string;
  /** Application-defined context preserved on the decision. */
  readonly context?: AccessContext;
}

/**
 * Enumerated reasons a decision was produced. Kept as a string-literal union
 * so switch statements remain exhaustively checkable at compile time.
 */
export type DecisionReason =
  /** The request matched a granted permission. */
  | 'granted'
  /** The request carried no resolvable roles. */
  | 'no-roles'
  /** Every role on the request was unknown to the store (strict mode). */
  | 'unknown-role'
  /** Roles resolved but none granted the requested action+resource+scope. */
  | 'missing-permission'
  /** The request object failed validation. */
  | 'invalid-request'
  /** An adapter-level policy vetoed the request before evaluation. */
  | 'denied-by-policy';

/**
 * The outcome of evaluating an {@link AccessRequest}.
 *
 * Allowed decisions carry the exact {@link Permission} and the role that
 * granted it so callers can implement fine-grained audit trails and, if
 * desired, ABAC-style post-conditions on top of the matched permission.
 */
export interface AccessDecision {
  /** Whether the request is permitted. */
  readonly allowed: boolean;
  /** Why the decision was reached (always present). */
  readonly reason: DecisionReason;
  /** The permission that satisfied the request (allowed decisions only). */
  readonly permission?: Permission;
  /** The role that supplied the matched permission. */
  readonly matchedRole?: string;
  /** The original request the decision answers. */
  readonly request?: AccessRequest;
  /** Epoch ms timestamp of the decision. */
  readonly at: number;
}

/**
 * Options controlling a single {@link RoleStore.grant} / grant-many call.
 */
export interface GrantOptions {
  /**
   * When `true`, any existing permissions for the same `action:resource`
   * pair (regardless of scope) are removed before the new permission is
   * added. Defaults to `false`.
   */
  readonly replace?: boolean;
  /**
   * When `true`, duplicate permissions (same action+resource+scope key) are
   * stored rather than silently deduplicated. Defaults to `false`.
   */
  readonly allowDuplicates?: boolean;
}

/**
 * Construction and runtime tuning knobs for the authorization engine.
 *
 * Values are intentionally conservative so that a freshly constructed engine
 * is immediately usable in any Node process.
 */
export interface AuthzConfig {
  /**
   * When `true`, a request whose roles are all unknown to the store produces
   * an `unknown-role` denial; when `false` it is collapsed into a plain
   * `no-roles` denial. Defaults to `false`.
   */
  readonly strictRoles?: boolean;
  /**
   * Tie-breaking rule when several permissions match a request:
   * - `specific` (default): prefer the least wildcard-y match
   *   (exact action+resource+scope over wildcarded ones).
   * - `first`: prefer the first match in role-resolution order.
   */
  readonly wildcardPreference?: 'specific' | 'first';
  /**
   * When `true`, unknown role names referenced by a request are treated as
   * hard failures (denied with `unknown-role`) even if other roles resolve.
   * Defaults to `false`.
   */
  readonly rejectUnknownRoles?: boolean;
  /** Maximum roles an identity may hold before {@link RoleStore.assign} throws. */
  readonly maxRolesPerIdentity?: number;
  /** Default interval (ms) for periodic {@link AuthzLifecycle} syncs. */
  readonly syncIntervalMs?: number;
  /** Separator used when serializing permissions to keys. */
  readonly keySeparator?: string;
  /** Application name recorded for audit / stats purposes. */
  readonly appName?: string;
}

/**
 * Aggregate counters describing the state and activity of the authorization
 * engine. Produced by `stats()` on the store, index, checker and the composite
 * engine, and safe to serialize for metrics endpoints.
 */
export interface AuthzStats {
  /** Number of defined roles. */
  roles: number;
  /** Total distinct permission entries across all roles. */
  permissions: number;
  /** Number of identity→role assignments. */
  assignments: number;
  /** Number of distinct identities with at least one assignment. */
  identities: number;
  /** Distinct indexed actions in the permission index. */
  indexActions: number;
  /** Distinct indexed resources in the permission index. */
  indexResources: number;
  /** Lifetime count of access checks performed. */
  checks: number;
  /** Lifetime count of granted permissions. */
  grants: number;
  /** Lifetime count of revoked permissions. */
  revokes: number;
  /** Lifetime count of denied decisions. */
  denies: number;
  /** Epoch ms of the last access check (undefined before the first). */
  lastCheckAt?: number;
}

/**
 * A loose input shape accepted by {@link RoleStore.defineRole}.
 *
 * Every field except `name` is optional; the store applies sensible defaults
 * (empty permissions, no inheritance, current wall clock) and freezes the
 * resulting record.
 */
export interface RoleDefinition {
  /** Role name; must be a non-empty, non-whitespace string. */
  readonly name: string;
  /** Initial permissions; defaults to an empty array. */
  readonly permissions?: readonly Permission[];
  /** Parent role names; defaults to an empty array. */
  readonly inherited?: readonly string[];
  /** Optional description. */
  readonly description?: string;
  /** Optional metadata. */
  readonly metadata?: Readonly<Record<string, unknown>>;
  /** Creation timestamp; defaults to the current wall clock. */
  readonly createdAt?: number;
}

/**
 * Immutable default configuration. A shallow freeze prevents accidental
 * mutation of shared defaults; per-instance configs are resolved copies.
 */
export const DEFAULT_AUTHZ_CONFIG: Readonly<AuthzConfig> = Object.freeze({
  strictRoles: false,
  wildcardPreference: 'specific',
  rejectUnknownRoles: false,
  maxRolesPerIdentity: 64,
  syncIntervalMs: 30 * 1000,
  keySeparator: DEFAULT_KEY_SEPARATOR,
  appName: 'mam-authz',
});

/**
 * Factory for the zero-value statistics object used by every `stats()`.
 *
 * @returns A freshly allocated {@link AuthzStats} with all counters at zero.
 */
export function createEmptyStats(): AuthzStats {
  return {
    roles: 0,
    permissions: 0,
    assignments: 0,
    identities: 0,
    indexActions: 0,
    indexResources: 0,
    checks: 0,
    grants: 0,
    revokes: 0,
    denies: 0,
  };
}

/**
 * Merges a partial configuration over the frozen defaults and returns a
 * plain, fully-populated configuration object safe for downstream mutation.
 *
 * @param overrides Partial configuration overrides (may be empty).
 * @returns A complete, non-frozen {@link AuthzConfig}.
 */
export function resolveAuthzConfig(overrides: Partial<AuthzConfig> | undefined = {}): AuthzConfig {
  return { ...DEFAULT_AUTHZ_CONFIG, ...overrides };
}

/**
 * Returns `true` when `value` is a non-null object (not an array, not null).
 *
 * @param value Any runtime value.
 * @returns `true` when the value is a plain-ish record.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Returns `true` when `value` is an array whose every element is a non-empty
 * string.
 *
 * @param value Any runtime value.
 * @returns `true` for a usable string array.
 */
export function isStringArray(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  return value.every((item) => typeof item === 'string' && item.trim().length > 0);
}

/**
 * Runtime type guard for {@link Permission}.
 *
 * @param value Any runtime value.
 * @returns `true` when the value structurally satisfies `Permission`.
 */
export function isPermission(value: unknown): value is Permission {
  if (!isRecord(value)) return false;
  if (typeof value.action !== 'string' || value.action.length === 0) return false;
  if (typeof value.resource !== 'string' || value.resource.length === 0) return false;
  if (value.scope !== undefined && typeof value.scope !== 'string') return false;
  return true;
}

/**
 * Runtime type guard for {@link Role}.
 *
 * @param value Any runtime value.
 * @returns `true` when the value structurally satisfies `Role`.
 */
export function isRole(value: unknown): value is Role {
  if (!isRecord(value)) return false;
  if (typeof value.name !== 'string' || value.name.trim().length === 0) return false;
  if (!Array.isArray(value.permissions) || !value.permissions.every(isPermission)) return false;
  if (value.inherited !== undefined && !isStringArray(value.inherited)) return false;
  if (value.createdAt !== undefined && typeof value.createdAt !== 'number') return false;
  return true;
}

/**
 * Runtime type guard for {@link Capability}.
 *
 * @param value Any runtime value.
 * @returns `true` when the value structurally satisfies `Capability`.
 */
export function isCapability(value: unknown): value is Capability {
  if (!isRecord(value)) return false;
  if (typeof value.name !== 'string' || value.name.trim().length === 0) return false;
  if (!Array.isArray(value.permissions) || !value.permissions.every(isPermission)) return false;
  return true;
}

/**
 * Runtime type guard for {@link AccessRequest}.
 *
 * @param value Any runtime value.
 * @returns `true` when the value structurally satisfies `AccessRequest`.
 */
export function isAccessRequest(value: unknown): value is AccessRequest {
  if (!isRecord(value)) return false;
  if (typeof value.action !== 'string' || value.action.length === 0) return false;
  if (typeof value.resource !== 'string' || value.resource.length === 0) return false;
  if (!Array.isArray(value.roles)) return false;
  if (value.identityId !== undefined && typeof value.identityId !== 'string') return false;
  if (value.scope !== undefined && typeof value.scope !== 'string') return false;
  return true;
}

/**
 * Runtime type guard for {@link AccessDecision}.
 *
 * @param value Any runtime value.
 * @returns `true` when the value structurally satisfies `AccessDecision`.
 */
export function isAccessDecision(value: unknown): value is AccessDecision {
  if (!isRecord(value)) return false;
  if (typeof value.allowed !== 'boolean') return false;
  if (typeof value.reason !== 'string') return false;
  if (value.at !== undefined && typeof value.at !== 'number') return false;
  return true;
}

/**
 * Throws a descriptive {@link TypeError} unless `value` is a valid permission.
 *
 * @param value Value to validate.
 * @param label Contextual label used in the error message.
 * @returns The value re-typed as {@link Permission}.
 */
export function assertPermission(value: unknown, label = 'permission'): Permission {
  if (!isPermission(value)) {
    throw new TypeError(`${label} is not a valid Permission object`);
  }
  return value;
}

/**
 * Throws a descriptive {@link TypeError} unless `value` is a valid role.
 *
 * @param value Value to validate.
 * @param label Contextual label used in the error message.
 * @returns The value re-typed as {@link Role}.
 */
export function assertRole(value: unknown, label = 'role'): Role {
  if (!isRole(value)) {
    throw new TypeError(`${label} is not a valid Role object`);
  }
  return value;
}

/**
 * Throws a descriptive {@link TypeError} unless `value` is a valid request.
 *
 * @param value Value to validate.
 * @param label Contextual label used in the error message.
 * @returns The value re-typed as {@link AccessRequest}.
 */
export function assertAccessRequest(value: unknown, label = 'accessRequest'): AccessRequest {
  if (!isAccessRequest(value)) {
    throw new TypeError(`${label} is not a valid AccessRequest object`);
  }
  return value;
}

/**
 * Validates a candidate name (role, capability, identity). Accepts non-empty,
 * non-whitespace strings.
 *
 * @param name Candidate name.
 * @returns `true` when the name is usable as an identifier.
 */
export function isValidName(name: unknown): name is string {
  return typeof name === 'string' && name.trim().length > 0;
}

/**
 * Builds a {@link Permission} record.
 *
 * @param action The action being permitted.
 * @param resource The resource the action applies to.
 * @param scope Optional scope constraint (defaults to unscoped).
 * @returns A frozen {@link Permission}.
 */
export function createPermission(action: string, resource: string, scope?: string): Permission {
  return Object.freeze({
    action,
    resource,
    scope: scope !== undefined && scope !== SCOPE_ANY ? scope : undefined,
  });
}

/**
 * Builds a {@link Role} record from a loose description.
 *
 * @param name Role name.
 * @param permissions Initial permissions (defaults to empty).
 * @param inherited Parent role names (defaults to empty).
 * @param extra Optional description / metadata / timestamp.
 * @returns A frozen {@link Role}.
 */
export function createRole(
  name: string,
  permissions: readonly Permission[] = [],
  inherited: readonly string[] = [],
  extra: { description?: string; metadata?: Readonly<Record<string, unknown>>; createdAt?: number } = {},
): Role {
  return Object.freeze({
    name,
    permissions: permissions.map((p) => createPermission(p.action, p.resource, p.scope)),
    inherited: dedupeRoles(inherited),
    description: extra.description,
    metadata: extra.metadata ? { ...extra.metadata } : undefined,
    createdAt: extra.createdAt ?? Date.now(),
  });
}

/**
 * Builds a {@link Capability} record.
 *
 * @param name Unique capability name.
 * @param permissions Permissions bundled under the capability.
 * @param description Optional description.
 * @returns A frozen {@link Capability}.
 */
export function createCapability(
  name: string,
  permissions: readonly Permission[],
  description?: string,
): Capability {
  return Object.freeze({
    name,
    permissions: permissions.map((p) => createPermission(p.action, p.resource, p.scope)),
    description,
  });
}

/**
 * Builds an {@link AccessRequest} from a partial description, filling defaults
 * for the optional fields.
 *
 * @param request The request core (roles, action, resource) plus optional fields.
 * @returns A frozen {@link AccessRequest}.
 */
export function createAccessRequest(request: {
  roles: readonly string[];
  action: string;
  resource: string;
  identityId?: string;
  scope?: string;
  context?: AccessContext;
}): AccessRequest {
  return Object.freeze({
    identityId: request.identityId,
    roles: dedupeRoles(request.roles),
    action: request.action,
    resource: request.resource,
    scope: request.scope,
    context: request.context ? { ...request.context } : undefined,
  });
}

/**
 * Builds an allowed {@link AccessDecision}.
 *
 * @param permission The permission that satisfied the request.
 * @param matchedRole The role that supplied the permission.
 * @param request The original request (optional).
 * @param at Decision timestamp in epoch ms (defaults to now).
 * @returns A frozen allowed decision.
 */
export function allowDecision(
  permission: Permission,
  matchedRole: string,
  request?: AccessRequest,
  at: number = Date.now(),
): AccessDecision {
  return Object.freeze({
    allowed: true,
    reason: 'granted',
    permission: createPermission(permission.action, permission.resource, permission.scope),
    matchedRole,
    request,
    at,
  });
}

/**
 * Builds a denied {@link AccessDecision}.
 *
 * @param reason Why the request was denied.
 * @param request The original request (optional).
 * @param at Decision timestamp in epoch ms (defaults to now).
 * @returns A frozen denied decision.
 */
export function denyDecision(
  reason: DecisionReason,
  request?: AccessRequest,
  at: number = Date.now(),
): AccessDecision {
  return Object.freeze({
    allowed: false,
    reason,
    request,
    at,
  });
}

/**
 * Serializes a permission into a compact string key of the form
 * `action:resource:scope`. Two permissions with the same key are considered
 * equal for deduplication and indexing purposes.
 *
 * @param permission The permission to serialize.
 * @param separator Separator override (defaults to {@link DEFAULT_KEY_SEPARATOR}).
 * @returns The string key, e.g. `"read:document:tenant:acme"`.
 */
export function permissionKey(permission: Permission, separator: string = DEFAULT_KEY_SEPARATOR): string {
  const scope = permission.scope === undefined || permission.scope === SCOPE_ANY ? SCOPE_ANY : permission.scope;
  return `${permission.action}${separator}${permission.resource}${separator}${scope}`;
}

/**
 * Parses a permission key back into a {@link Permission} record.
 *
 * The key is parsed from the left: the first separator separates `action` from
 * `resource`, and everything after the second separator is the (optionally
 * nested) scope. A `*` scope is normalized back to `undefined`.
 *
 * @param key The string key produced by {@link permissionKey}.
 * @param separator Separator override (must match the key).
 * @returns The parsed permission, or `undefined` for malformed input.
 */
export function permissionFromKey(key: string, separator: string = DEFAULT_KEY_SEPARATOR): Permission | undefined {
  if (typeof key !== 'string' || key.length === 0) return undefined;
  const first = key.indexOf(separator);
  if (first <= 0) return undefined;
  const second = key.indexOf(separator, first + 1);
  const action = key.slice(0, first);
  if (action === SCOPE_ANY) return undefined;
  const resource = second === -1 ? key.slice(first + 1) : key.slice(first + 1, second);
  if (resource === SCOPE_ANY || resource.length === 0) return undefined;
  const scope = second === -1 ? undefined : key.slice(second + 1);
  return createPermission(action, resource, scope === SCOPE_ANY ? undefined : scope);
}

/**
 * Returns `true` when `value` equals the wildcard marker.
 *
 * @param value A candidate action/resource/scope value.
 * @returns `true` when the value is `*`.
 */
export function isWildcard(value: string | undefined): boolean {
  return value === undefined || value === SCOPE_ANY;
}

/**
 * Evaluates whether a permission's scope constraint accepts a requested scope.
 *
 * Rules:
 * - An unscoped permission (`undefined` or `*`) matches any request scope.
 * - A scoped permission matches a request scope only when the request scope is
 *   `*` (request unrestricted) or equals the permission scope exactly.
 * - A scoped permission never matches a request with no declared scope.
 *
 * @param permissionScope Scope declared on the permission (may be undefined).
 * @param requestScope Scope declared on the request (may be undefined).
 * @returns `true` when the scope constraint is satisfied.
 */
export function scopeAllows(permissionScope: string | undefined, requestScope: string | undefined): boolean {
  if (isWildcard(permissionScope)) return true;
  if (requestScope === undefined) return false;
  if (isWildcard(requestScope)) return true;
  return requestScope === permissionScope;
}

/**
 * Core matching predicate: does `permission` grant `action` on `resource`
 * within `scope`?
 *
 * Action and resource match when they are equal to the permission's value or
 * when the permission declares the corresponding wildcard. Scope matching is
 * delegated to {@link scopeAllows}.
 *
 * @param permission The candidate permission.
 * @param action The requested action.
 * @param resource The requested resource.
 * @param scope The requested scope (optional).
 * @returns `true` when the permission satisfies the request triple.
 */
export function permissionAllows(
  permission: Permission,
  action: string,
  resource: string,
  scope?: string,
): boolean {
  if (permission.action !== ACTION_ANY && permission.action !== action) return false;
  if (permission.resource !== RESOURCE_ANY && permission.resource !== resource) return false;
  return scopeAllows(permission.scope, scope);
}

/**
 * Returns a specificity score for a permission with respect to a request
 * triple. Lower scores mean a more specific (less wildcard-y) match; used by
 * the checker to prefer exact grants over wildcard grants.
 *
 * @param permission The matched permission.
 * @returns A number in the range 0 (fully specific) to 3 (fully wildcarded).
 */
export function specificity(permission: Permission): number {
  let score = 0;
  if (isWildcard(permission.action)) score += 1;
  if (isWildcard(permission.resource)) score += 1;
  if (isWildcard(permission.scope)) score += 1;
  return score;
}

/**
 * Deduplicates and strips empty role strings while preserving first-seen
 * order.
 *
 * @param roles Raw role list (may contain duplicates or blanks).
 * @returns A de-duplicated array of non-empty role names.
 */
export function dedupeRoles(roles: readonly string[] | undefined): string[] {
  if (!Array.isArray(roles)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const role of roles) {
    if (typeof role === 'string' && role.trim().length > 0) {
      const normalized = role.trim();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        out.push(normalized);
      }
    }
  }
  return out;
}

/**
 * Produces a compact human-readable description of an access request, useful
 * for logging and audit trails.
 *
 * @param request The request to describe.
 * @returns e.g. `"identity#u-1 read document [scope=tenant:acme] via [admin]"`.
 */
export function describeRequest(request: AccessRequest): string {
  const who = request.identityId ? `identity#${request.identityId}` : 'anonymous';
  const scope = request.scope !== undefined ? ` [scope=${request.scope}]` : '';
  const roles = request.roles.length > 0 ? ` via [${request.roles.join(', ')}]` : '';
  return `${who} ${request.action} ${request.resource}${scope}${roles}`;
}

/**
 * Compares two permissions for equality by key.
 *
 * @param a First permission.
 * @param b Second permission.
 * @returns `true` when both serialize to the same key.
 */
export function permissionsEqual(a: Permission, b: Permission): boolean {
  return permissionKey(a) === permissionKey(b);
}