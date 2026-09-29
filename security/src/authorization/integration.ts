/**
 * integration.ts
 *
 * High-level composition layer for the MAM Authorization engine.
 *
 * While `types.ts`, `store.ts`, `index.ts`, `retrieval.ts` and `lifecycle.ts`
 * each solve one problem, application code typically wants a single entry
 * point. This module provides three increasingly capable facades:
 *
 * 1. **{@link Authorizer}** — a hand-friendly API over a {@link RoleStore} and
 *    an {@link AccessChecker}: register roles, grant permissions, assign roles
 *    to identities, and answer `check` / `can` / `authorize` (the latter
 *    throwing {@link AuthorizationError} on denial).
 * 2. **{@link RbacEngine}** — the fully wired engine: store + index + checker
 *    + lifecycle, exposing {@link enforce} for the hot path, event
 *    subscription, periodic sync and lifecycle maintenance in one object.
 * 3. **{@link AuthorizationAdapter}** — a `AccessControl`-conforming adapter
 *    that composes an underlying authorizer with optional request
 *    normalization and a policy predicate, giving you an ABAC-style pre-filter
 *    in front of pure RBAC.
 *
 * All three are built with the same validated building blocks and emit
 * decisions that can be consumed directly or fed into audit pipelines.
 *
 * @module authorization/integration
 */

import {
  assertAccessRequest,
  createEmptyStats,
  createPermission,
  denyDecision,
  describeRequest,
  resolveAuthzConfig,
  type AccessDecision,
  type AccessRequest,
  type AuthzConfig,
  type AuthzStats,
  type GrantOptions,
  type Permission,
  type Role,
  type RoleDefinition,
} from './types.js';
import { RoleStore } from './store.js';
import { PermissionIndex } from './index.js';
import { AccessChecker } from './retrieval.js';
import { AuthzLifecycle } from './lifecycle.js';

/**
 * The minimal contract an authorization facade must satisfy. Implemented by
 * {@link Authorizer}, {@link RbacEngine} and {@link AuthorizationAdapter} so
 * they can be swapped behind a single type.
 */
export interface AccessControl {
  /**
   * Evaluates a request and returns its decision (never throws).
   *
   * @param request The request to evaluate.
   * @returns The resulting {@link AccessDecision}.
   */
  check(request: AccessRequest): AccessDecision;

  /**
   * Convenience boolean form of {@link check}.
   *
   * @param request The request to evaluate.
   * @returns `true` when the request is permitted.
   */
  can(request: AccessRequest): boolean;

  /**
   * Evaluates a request and throws {@link AuthorizationError} on denial.
   *
   * @param request The request to evaluate.
   * @returns The allowed decision.
   * @throws {AuthorizationError} when the request is denied.
   */
  authorize(request: AccessRequest): AccessDecision;
}

/**
 * Thrown by {@link authorize} and {@link AccessControl.authorize} when a
 * request is denied. Carries the full {@link AccessDecision} so callers can
 * inspect the reason, matched role and permission at the catch site.
 */
export class AuthorizationError extends Error {
  /** The decision that produced the denial. */
  readonly decision: AccessDecision;
  /** The request that was denied. */
  readonly request: AccessRequest;

  /**
   * Creates an authorization error.
   *
   * @param decision The denied decision.
   * @param request The request that was denied.
   */
  constructor(decision: AccessDecision, request: AccessRequest) {
    super(`Access denied: ${describeRequest(request)} (reason: ${decision.reason})`);
    this.name = 'AuthorizationError';
    this.decision = decision;
    this.request = request;
    Error.captureStackTrace?.(this, AuthorizationError);
  }
}

/** Options accepted by the {@link Authorizer} constructor. */
export interface AuthorizerOptions {
  /** Behavioural configuration overrides. */
  config?: Partial<AuthzConfig>;
  /** Clock provider (injectable for deterministic tests). */
  now?: () => number;
}

/**
 * A hand-friendly, high-level authorization facade over a role store and an
 * access checker.
 *
 * @example
 * ```ts
 * const authz = createAuthorizer();
 * authz.registerRole({ name: 'editor', permissions: [{ action: 'write', resource: 'document' }] });
 * authz.grant('admin', { action: '*', resource: '*' });
 * authz.assign('u-1', ['admin']);
 * if (authz.can({ identityId: 'u-1', roles: ['admin'], action: 'read', resource: 'document' })) { … }
 * authz.authorize({ roles: ['admin'], action: 'delete', resource: 'document' });
 * ```
 */
export class Authorizer implements AccessControl {
  protected readonly store: RoleStore;
  protected readonly checker: AccessChecker;
  protected readonly config: AuthzConfig;

  /**
   * Creates an authorizer over an explicit store and checker. Prefer
   * {@link createAuthorizer} for a fully-wired instance.
   *
   * @param store The role registry.
   * @param checker The access checker.
   * @param options Configuration overrides.
   */
  constructor(store: RoleStore, checker: AccessChecker, options: AuthorizerOptions = {}) {
    this.store = store;
    this.checker = checker;
    this.config = resolveAuthzConfig(options.config);
  }

  /**
   * Registers a role, returning the stored record. Idempotent: re-defining an
   * existing role returns the existing record unchanged.
   *
   * @param definition The role to define.
   * @returns The stored {@link Role}.
   */
  registerRole(definition: RoleDefinition | Role): Role {
    return this.store.defineRole(definition);
  }

  /**
   * Registers many roles at once.
   *
   * @param definitions The roles to define.
   * @returns The number of roles defined.
   */
  registerRoles(definitions: readonly (RoleDefinition | Role)[]): number {
    let count = 0;
    for (const definition of definitions) {
      this.registerRole(definition);
      count += 1;
    }
    return count;
  }

  /**
   * Grants a permission to a role.
   *
   * @param roleName Role to grant to.
   * @param permission The permission to grant.
   * @param options Grant behaviour.
   * @returns `true` when the store changed.
   */
  grant(roleName: string, permission: Permission, options: GrantOptions = {}): boolean {
    return this.store.grant(roleName, permission, options);
  }

  /**
   * Grants a permission built from raw `action`, `resource` and optional
   * `scope` strings, so callers rarely need to construct permission objects.
   *
   * @param roleName Role to grant to.
   * @param action The action to permit.
   * @param resource The resource to permit on.
   * @param scope Optional scope constraint.
   * @returns `true` when the store changed.
   */
  grantAction(roleName: string, action: string, resource: string, scope?: string): boolean {
    return this.grant(roleName, createPermission(action, resource, scope));
  }

  /**
   * Revokes every permission matching the action+resource pair from a role.
   *
   * @param roleName Role to revoke from.
   * @param action Action to match.
   * @param resource Resource to match.
   * @returns The number of permissions removed.
   */
  revoke(roleName: string, action: string, resource: string): number {
    return this.store.revoke(roleName, action, resource);
  }

  /**
   * Assigns roles to an identity.
   *
   * @param identityId Identity to assign.
   * @param roles Role names to assign.
   * @param options Assignment behaviour (`append`).
   * @returns The number of roles recorded for the identity.
   */
  assign(identityId: string, roles: readonly string[], options?: { append?: boolean }): number {
    return this.store.assign(identityId, roles, options);
  }

  /**
   * Returns the roles currently assigned to an identity.
   *
   * @param identityId Identity to look up.
   * @returns The identity's role names.
   */
  rolesFor(identityId: string): string[] {
    return this.store.getRolesForIdentity(identityId);
  }

  /**
   * Returns every registered role, sorted by name.
   *
   * @returns All roles in the store.
   */
  listRoles(): Role[] {
    return this.store.listRoles();
  }

  /**
   * Evaluates a request (never throws).
   *
   * @param request The request to evaluate.
   * @returns The decision.
   */
  check(request: AccessRequest): AccessDecision {
    return this.checker.check(request);
  }

  /**
   * Convenience boolean form of {@link check}.
   *
   * @param request The request to evaluate.
   * @returns `true` when permitted.
   */
  can(request: AccessRequest): boolean {
    return this.checker.can(request);
  }

  /**
   * Evaluates a request and throws on denial.
   *
   * @param request The request to evaluate.
   * @returns The allowed decision.
   * @throws {AuthorizationError} when denied.
   */
  authorize(request: AccessRequest): AccessDecision {
    const decision = this.checker.check(request);
    if (!decision.allowed) {
      throw new AuthorizationError(decision, request);
    }
    return decision;
  }

  /**
   * Returns the flattened effective permission set for a list of roles
   * (including inherited permissions).
   *
   * @param roles Role labels.
   * @returns Every distinct effective permission.
   */
  permissionsFor(roles: readonly string[]): Permission[] {
    return this.checker.permissionsFor(roles);
  }

  /**
   * Expands role labels into the full effective role list (inheritance-aware).
   *
   * @param roles Requested role labels.
   * @returns The resolved role names.
   */
  resolveRoles(roles: readonly string[]): string[] {
    return this.checker.resolveRoles(roles);
  }

  /**
   * Computes aggregate statistics.
   *
   * @returns A fresh {@link AuthzStats}.
   */
  stats(): AuthzStats {
    const base = createEmptyStats();
    const storeStats = this.store.stats();
    const checkerStats = this.checker.stats();
    return {
      ...base,
      roles: storeStats.roles,
      permissions: storeStats.permissions,
      assignments: storeStats.assignments,
      identities: storeStats.identities,
      checks: checkerStats.checks,
      denies: checkerStats.deniedDecisions,
      grants: storeStats.grants,
      revokes: storeStats.revokes,
      lastCheckAt: checkerStats.lastCheckAt,
    };
  }

  /**
   * Serializes the backing store (roles + assignments).
   *
   * @returns A JSON-safe snapshot.
   */
  toJSON(): ReturnType<RoleStore['toJSON']> {
    return this.store.toJSON();
  }

  /**
   * Replaces the entire authorizer state from a snapshot.
   *
   * @param snapshot A snapshot produced by {@link toJSON}.
   */
  fromJSON(snapshot: unknown): void {
    this.store.fromJSON(snapshot);
  }

  /**
   * The backing role store (exposed for advanced composition).
   */
  get roleStore(): RoleStore {
    return this.store;
  }

  /**
   * The backing access checker (exposed for advanced composition).
   */
  get accessChecker(): AccessChecker {
    return this.checker;
  }
}

/**
 * Builds a fully-wired, standalone authorizer: a fresh store, a fresh index
 * and a checker over both.
 *
 * @param config Optional configuration overrides.
 * @returns A ready-to-use {@link Authorizer}.
 */
export function createAuthorizer(config?: Partial<AuthzConfig>): Authorizer {
  const store = new RoleStore();
  const index = new PermissionIndex();
  const checker = new AccessChecker(store, index, { config });
  return new Authorizer(store, checker, { config });
}

/**
 * The fully wired authorization engine: role store + permission index +
 * access checker + lifecycle, all composed into one object.
 *
 * `enforce` is the hot-path entry point; lifecycle maintenance (`start`,
 * `stop`, `prune`, `reset`) and event subscription are forwarded to the
 * embedded lifecycle.
 *
 * @example
 * ```ts
 * const engine = new RbacEngine({ config: { syncIntervalMs: 10_000 } });
 * engine.defineRole(createRole('admin', [{ action: '*', resource: '*' }]));
 * engine.start();
 * const decision = engine.enforce({ roles: ['admin'], action: 'read', resource: 'db' });
 * ```
 */
export class RbacEngine implements AccessControl {
  private readonly store: RoleStore;
  private readonly index: PermissionIndex;
  private readonly checker: AccessChecker;
  private readonly lifecycle: AuthzLifecycle;
  private readonly config: AuthzConfig;

  /**
   * Creates an engine. By default all four collaborators are constructed
   * fresh; explicit collaborators may be injected for shared-state scenarios.
   *
   * @param options Optional config and collaborator injection.
   */
  constructor(
    options: {
      config?: Partial<AuthzConfig>;
      store?: RoleStore;
      index?: PermissionIndex;
      checker?: AccessChecker;
      lifecycle?: AuthzLifecycle;
    } = {},
  ) {
    this.config = resolveAuthzConfig(options.config);
    this.store = options.store ?? new RoleStore();
    this.index = options.index ?? new PermissionIndex();
    this.checker = options.checker ?? new AccessChecker(this.store, this.index, { config: this.config });
    this.lifecycle = options.lifecycle ?? new AuthzLifecycle(this.store, this.index, this.checker, { config: this.config });
  }

  /**
   * Defines a role and keeps the index consistent.
   *
   * @param role The role to define.
   * @returns The stored role.
   */
  defineRole(role: Role): Role {
    return this.lifecycle.defineRole(role);
  }

  /**
   * Registers a role from a loose definition.
   *
   * @param definition The role to define.
   * @returns The stored role.
   */
  registerRole(definition: RoleDefinition | Role): Role {
    const stored = this.store.defineRole(definition);
    this.index.syncRole(stored);
    return stored;
  }

  /**
   * Grants a permission to a role, keeping the index consistent.
   *
   * @param roleName Role to grant to.
   * @param permission The permission to grant.
   * @returns `true` when the store changed.
   */
  grant(roleName: string, permission: Permission): boolean {
    const changed = this.store.grant(roleName, permission);
    const role = this.store.getRole(roleName);
    if (role) {
      this.index.syncRole(role);
    }
    return changed;
  }

  /**
   * Revokes permissions from a role, keeping the index consistent.
   *
   * @param roleName Role to revoke from.
   * @param action Action to match.
   * @param resource Resource to match.
   * @returns The number of permissions removed.
   */
  revoke(roleName: string, action: string, resource: string): number {
    const removed = this.store.revoke(roleName, action, resource);
    const role = this.store.getRole(roleName);
    if (role) {
      this.index.syncRole(role);
    }
    return removed;
  }

  /**
   * Assigns roles to an identity.
   *
   * @param identityId Identity to assign.
   * @param roles Role names to assign.
   * @returns The number of roles recorded.
   */
  assign(identityId: string, roles: readonly string[]): number {
    return this.store.assign(identityId, roles);
  }

  /**
   * The hot-path entry point: evaluates a request and returns its decision.
   *
   * @param request The request to evaluate.
   * @returns The decision (also fanned out through lifecycle events).
   */
  enforce(request: AccessRequest): AccessDecision {
    return this.checker.check(request);
  }

  /**
   * Evaluates a request (alias of {@link enforce}, satisfying
   * {@link AccessControl}).
   *
   * @param request The request to evaluate.
   * @returns The decision.
   */
  check(request: AccessRequest): AccessDecision {
    return this.enforce(request);
  }

  /**
   * Convenience boolean form of {@link enforce}.
   *
   * @param request The request to evaluate.
   * @returns `true` when permitted.
   */
  can(request: AccessRequest): boolean {
    return this.checker.can(request);
  }

  /**
   * Evaluates a request and throws on denial.
   *
   * @param request The request to evaluate.
   * @returns The allowed decision.
   * @throws {AuthorizationError} when denied.
   */
  authorize(request: AccessRequest): AccessDecision {
    const decision = this.enforce(request);
    if (!decision.allowed) {
      throw new AuthorizationError(decision, request);
    }
    return decision;
  }

  /**
   * Expands role labels into the full effective role set.
   *
   * @param roles Requested role labels.
   * @returns The resolved role names.
   */
  resolveRoles(roles: readonly string[]): string[] {
    return this.checker.resolveRoles(roles);
  }

  /**
   * Returns the flattened effective permissions for a list of roles.
   *
   * @param roles Role labels.
   * @returns Every distinct effective permission.
   */
  permissionsFor(roles: readonly string[]): Permission[] {
    return this.checker.permissionsFor(roles);
  }

  /**
   * Prunes roles (explicit or orphaned).
   *
   * @param roleNames Optional explicit role names to prune.
   * @returns The removed role names.
   */
  prune(roleNames?: readonly string[]): string[] {
    return this.lifecycle.prune(roleNames);
  }

  /**
   * Revokes every permission from a role.
   *
   * @param roleName Role to strip.
   * @returns The number of permissions removed.
   */
  revokeRole(roleName: string): number {
    return this.lifecycle.revokeRole(roleName);
  }

  /**
   * Resets the engine (store + index).
   *
   * @returns The post-reset statistics.
   */
  reset(): AuthzStats {
    return this.lifecycle.reset();
  }

  /**
   * Starts the periodic sync timer.
   *
   * @param intervalMs Sync interval in milliseconds.
   * @returns `true` when started.
   */
  start(intervalMs?: number): boolean {
    return this.lifecycle.start(intervalMs);
  }

  /**
   * Stops the periodic sync timer.
   *
   * @returns `true` when a running timer was stopped.
   */
  stop(): boolean {
    return this.lifecycle.stop();
  }

  /**
   * Runs a single synchronization pass.
   *
   * @returns Post-sync statistics.
   */
  sync(): AuthzStats {
    return this.lifecycle.sync();
  }

  /**
   * Returns whether the periodic timer is active.
   */
  get isRunning(): boolean {
    return this.lifecycle.isRunning;
  }

  /**
   * Subscribes to a lifecycle event (see {@link AuthzLifecycle} event names).
   *
   * @param event Event name.
   * @param listener Event listener.
   * @returns This engine (for chaining).
   */
  on(event: string, listener: (...args: unknown[]) => void): this {
    this.lifecycle.on(event, listener);
    return this;
  }

  /**
   * Computes aggregate engine statistics.
   *
   * @returns A merged {@link AuthzStats}.
   */
  stats(): AuthzStats {
    return this.lifecycle.stats();
  }

  /**
   * The embedded lifecycle (exposed for advanced event wiring).
   */
  get lifecycleHandle(): AuthzLifecycle {
    return this.lifecycle;
  }

  /**
   * The embedded checker (exposed for advanced composition).
   */
  get checkerHandle(): AccessChecker {
    return this.checker;
  }
}

/** Options accepted by the {@link AuthorizationAdapter} constructor. */
export interface AdapterOptions {
  /**
   * Optional request normalizer: transforms an incoming request before it is
   * evaluated (e.g. filling default roles, canonicalizing resource names).
   */
  normalize?: (request: AccessRequest) => AccessRequest;
  /**
   * Optional policy predicate evaluated *before* the authorizer. Returning
   * `false` produces an immediate `denied-by-policy` decision. This is where
   * ABAC-style environment conditions belong.
   */
  policy?: (request: AccessRequest) => boolean;
  /**
   * Optional observer called with every final decision (for audit).
   */
  onDecision?: (decision: AccessDecision) => void;
}

/**
 * An {@link AccessControl}-conforming adapter that layers request
 * normalization and a policy predicate over any underlying authorizer.
 *
 * The policy hook makes the adapter a convenient place to add ABAC-style
 * conditions ("only during business hours", "only from this region") without
 * changing the RBAC core.
 *
 * @example
 * ```ts
 * const adapter = new AuthorizationAdapter(authorizer, {
 *   policy: (req) => req.context?.environment !== 'production' || req.scope === 'prod-ro',
 *   onDecision: (d) => console.log(auditLine(d)),
 * });
 * ```
 */
export class AuthorizationAdapter implements AccessControl {
  private readonly authorizer: AccessControl;
  private readonly normalize: NonNullable<AdapterOptions['normalize']>;
  private readonly policy: NonNullable<AdapterOptions['policy']>;
  private readonly onDecision: NonNullable<AdapterOptions['onDecision']>;

  /**
   * Creates an adapter over an underlying authorizer.
   *
   * @param authorizer The authorizer to delegate to.
   * @param options Normalizer, policy and decision observer hooks.
   */
  constructor(authorizer: AccessControl, options: AdapterOptions = {}) {
    this.authorizer = authorizer;
    this.normalize = options.normalize ?? ((request) => request);
    this.policy = options.policy ?? (() => true);
    this.onDecision = options.onDecision ?? (() => undefined);
  }

  /**
   * Evaluates a request: normalize → policy check → delegate. Never throws.
   *
   * @param request The incoming request.
   * @returns The final decision.
   */
  check(request: AccessRequest): AccessDecision {
    assertAccessRequest(request, 'adapter request');
    const normalized = this.normalize(request);
    let decision: AccessDecision;
    if (!this.policy(normalized)) {
      decision = denyDecision('denied-by-policy', normalized);
    } else {
      decision = this.authorizer.check(normalized);
    }
    this.onDecision(decision);
    return decision;
  }

  /**
   * Convenience boolean form of {@link check}.
   *
   * @param request The request to evaluate.
   * @returns `true` when permitted.
   */
  can(request: AccessRequest): boolean {
    return this.check(request).allowed;
  }

  /**
   * Evaluates a request and throws on denial.
   *
   * @param request The request to evaluate.
   * @returns The allowed decision.
   * @throws {AuthorizationError} when denied.
   */
  authorize(request: AccessRequest): AccessDecision {
    const decision = this.check(request);
    if (!decision.allowed) {
      throw new AuthorizationError(decision, request);
    }
    return decision;
  }

  /**
   * The underlying authorizer.
   */
  get delegate(): AccessControl {
    return this.authorizer;
  }
}

/**
 * Convenience factory building an adapter around a freshly created authorizer.
 *
 * @param adapterOptions Adapter hooks (normalize / policy / observer).
 * @param config Authorizer configuration overrides.
 * @returns A fully wired {@link AuthorizationAdapter}.
 */
export function createAuthorizationAdapter(
  adapterOptions: AdapterOptions = {},
  config?: Partial<AuthzConfig>,
): AuthorizationAdapter {
  return new AuthorizationAdapter(createAuthorizer(config), adapterOptions);
}