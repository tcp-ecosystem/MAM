/**
 * retrieval.ts
 *
 * `AccessChecker` — the decision engine of the MAM Authorization layer.
 *
 * The checker turns an {@link AccessRequest} into an {@link AccessDecision} by
 * composing three concerns:
 *
 * 1. **Role resolution** — {@link resolveRoles} expands the request's role
 *    labels into the full set of effective roles, walking the inheritance
 *    graph (with cycle protection) so a role's ancestors contribute their
 *    permissions too.
 * 2. **Candidate discovery** — when a {@link PermissionIndex} is supplied, the
 *    checker narrows the search space to the permissions relevant for the
 *    request's action+resource+scope triple instead of scanning every role.
 * 3. **Matching** — {@link permissionAllows} is applied to each candidate and
 *    the best match wins: with the default `specific` preference an exact
 *    permission outranks a wildcarded one; role order breaks ties.
 *
 * The checker is an {@link EventEmitter}: it emits a `decision` event for
 * every evaluation (useful for audit and for the lifecycle layer, which fans
 * decisions out into `granted` / `denied` events).
 *
 * @module authorization/retrieval
 */

import { EventEmitter } from 'node:events';

import {
  createEmptyStats,
  denyDecision,
  allowDecision,
  assertAccessRequest,
  dedupeRoles,
  describeRequest,
  isWildcard,
  permissionAllows,
  permissionKey,
  resolveAuthzConfig,
  specificity,
  type AccessDecision,
  type AccessRequest,
  type AuthzConfig,
  type AuthzStats,
  type Permission,
  type Role,
} from './types.js';
import type { RoleStore } from './store.js';
import type { PermissionIndex } from './index.js';

/** Options accepted by the {@link AccessChecker} constructor. */
export interface AccessCheckerOptions {
  /** Behavioural overrides merged over {@link DEFAULT_AUTHZ_CONFIG}. */
  config?: Partial<AuthzConfig>;
  /** Clock provider (injectable for deterministic tests). */
  now?: () => number;
}

/**
 * Aggregate counters describing checker activity.
 */
export interface AccessCheckerStats extends AuthzStats {
  /** Number of decisions that allowed access. */
  allowedDecisions: number;
  /** Number of decisions that denied access. */
  deniedDecisions: number;
}

/**
 * Evaluates access requests against roles stored in a {@link RoleStore}.
 *
 * @example
 * ```ts
 * const checker = new AccessChecker(store, index);
 * const decision = checker.check({ roles: ['admin'], action: 'read', resource: 'document' });
 * if (decision.allowed) { /* … *\/ }
 * ```
 */
export class AccessChecker extends EventEmitter {
  private readonly store: RoleStore;
  private readonly index: PermissionIndex | undefined;
  private readonly config: AuthzConfig;
  private readonly now: () => number;

  /** Lifetime count of evaluated requests. */
  private checks = 0;
  /** Lifetime count of allowed decisions. */
  private allowedDecisions = 0;
  /** Lifetime count of denied decisions. */
  private deniedDecisions = 0;
  /** Epoch ms of the most recent evaluation. */
  private lastCheckAt: number | undefined;

  /**
   * Creates a checker bound to a store (and optionally an index).
   *
   * @param store The role registry to resolve roles and permissions from.
   * @param index Optional index used to narrow permission candidates.
   * @param options Configuration overrides and clock injection.
   */
  constructor(store: RoleStore, index?: PermissionIndex, options: AccessCheckerOptions = {}) {
    super();
    this.store = store;
    this.index = index;
    this.config = resolveAuthzConfig(options.config);
    this.now = options.now ?? (() => Date.now());
    // A malformed request produces a decision, never a throw.
    this.setMaxListeners(64);
  }

  /**
   * Expands a list of role labels into the full set of effective roles,
   * walking the inheritance graph breadth-first.
   *
   * The expansion is deterministic: requested roles appear first in their
   * given order, followed by each role's ancestors (in the order declared on
   * the role), with duplicates removed. Unknown roles (not present in the
   * store) are skipped because nothing can be resolved from them; callers that
   * need to detect unknowns should compare against {@link RoleStore.hasRole}.
   *
   * @param roles Requested role labels.
   * @returns The ordered, de-duplicated list of effective roles.
   */
  resolveRoles(roles: readonly string[]): string[] {
    const resolved: string[] = [];
    const seen = new Set<string>();
    const queue: string[] = dedupeRoles(roles);
    while (queue.length > 0) {
      const name = queue.shift()!;
      if (seen.has(name)) {
        continue;
      }
      seen.add(name);
      const role = this.store.getRole(name);
      if (!role) {
        continue;
      }
      resolved.push(name);
      for (const parent of role.inherited ?? []) {
        if (!seen.has(parent)) {
          queue.push(parent);
        }
      }
    }
    return resolved;
  }

  /**
   * Returns every role name that inherits from (or equals) a given role,
   * i.e. the reverse of {@link resolveRoles}. Useful for reporting "who is
   * affected by changing this role?".
   *
   * @param role The role name to find dependents of.
   * @returns Dependent role names (including the role itself).
   */
  dependentsOf(role: string): string[] {
    const dependents: string[] = [];
    const visit = (name: string, seen: Set<string>): void => {
      if (seen.has(name)) {
        return;
      }
      seen.add(name);
      dependents.push(name);
      for (const candidate of this.store.listRoleNames()) {
        const candidateRole = this.store.getRole(candidate);
        if (candidateRole && (candidateRole.inherited ?? []).includes(name)) {
          visit(candidate, seen);
        }
      }
    };
    visit(role, new Set<string>());
    return dependents;
  }

  /**
   * Returns the complete, deduplicated permission set of a single role,
   * including every permission inherited from its ancestors.
   *
   * @param role The role name to expand.
   * @returns The role's effective permission list (ordered, de-duplicated).
   */
  effectivePermissions(role: string): Permission[] {
    return this.permissionsFor([role]);
  }

  /**
   * Returns the flattened, de-duplicated set of permissions granted by a list
   * of roles (including inherited permissions).
   *
   * @param roles Role labels to expand.
   * @returns Every distinct effective permission (ordered by first encounter).
   */
  permissionsFor(roles: readonly string[]): Permission[] {
    const seen = new Set<string>();
    const out: Permission[] = [];
    for (const roleName of this.resolveRoles(roles)) {
      const role = this.store.getRole(roleName);
      if (!role) {
        continue;
      }
      for (const permission of role.permissions) {
        const key = permissionKey(permission);
        if (!seen.has(key)) {
          seen.add(key);
          out.push(permission);
        }
      }
    }
    return out;
  }

  /**
   * Evaluates a single access request and returns a decision.
   *
   * Never throws for malformed requests — they produce an `invalid-request`
   * denial. Every evaluation emits a `decision` event carrying
   * `(decision, request)`.
   *
   * @param request The request to evaluate.
   * @returns An {@link AccessDecision} describing the outcome.
   */
  check(request: AccessRequest): AccessDecision {
    const at = this.now();
    this.checks += 1;
    this.lastCheckAt = at;

    let decision: AccessDecision;
    if (!assertAccessRequestOrNull(request)) {
      decision = denyDecision('invalid-request', request, at);
    } else {
      const resolved = this.resolveRoles(request.roles);
      const known = dedupeRoles(request.roles).filter((name) => this.store.hasRole(name));
      if (known.length === 0) {
        decision = denyDecision('unknown-role', request, at);
      } else if (resolved.length === 0) {
        decision = denyDecision('no-roles', request, at);
      } else {
        decision = this.evaluate(request, resolved, at);
      }
    }

    if (decision.allowed) {
      this.allowedDecisions += 1;
    } else {
      this.deniedDecisions += 1;
    }
    this.emit('decision', decision, request);
    return decision;
  }

  /**
   * Evaluates many requests, returning a decision per request in order.
   *
   * @param requests The requests to evaluate.
   * @returns An array of decisions aligned with `requests`.
   */
  checkMany(requests: readonly AccessRequest[]): AccessDecision[] {
    return requests.map((request) => this.check(request));
  }

  /**
   * Convenience predicate: does the request evaluate to `allowed`?
   *
   * @param request The request to evaluate.
   * @returns `true` when access is permitted.
   */
  can(request: AccessRequest): boolean {
    return this.check(request).allowed;
  }

  /**
   * Returns `true` only when every request is permitted.
   *
   * @param requests The requests to evaluate.
   * @returns `true` when all decisions are allowed.
   */
  canAll(requests: readonly AccessRequest[]): boolean {
    for (const request of requests) {
      if (!this.check(request).allowed) {
        return false;
      }
    }
    return true;
  }

  /**
   * Returns `true` when at least one request is permitted.
   *
   * @param requests The requests to evaluate.
   * @returns `true` when any decision is allowed.
   */
  canAny(requests: readonly AccessRequest[]): boolean {
    for (const request of requests) {
      if (this.check(request).allowed) {
        return true;
      }
    }
    return false;
  }

  /**
   * Produces a human-readable explanation of a request's outcome, useful for
   * logging and debugging.
   *
   * @param request The request to describe.
   * @returns A one-line summary including the decision.
   */
  describe(request: AccessRequest): string {
    const decision = this.check(request);
    return `${describeRequest(request)} => ${decision.allowed ? 'ALLOW' : 'DENY'} (${decision.reason})`;
  }

  /**
   * Computes aggregate statistics about the checker.
   *
   * @returns A fresh {@link AccessCheckerStats}.
   */
  stats(): AccessCheckerStats {
    return {
      ...createEmptyStats(),
      roles: this.store.size,
      permissions: this.permissionsFor(this.store.listRoleNames()).length,
      checks: this.checks,
      grants: 0,
      revokes: 0,
      denies: this.deniedDecisions,
      lastCheckAt: this.lastCheckAt,
      allowedDecisions: this.allowedDecisions,
      deniedDecisions: this.deniedDecisions,
    };
  }

  /**
   * The index currently used for candidate narrowing (if any).
   */
  get permissionIndex(): PermissionIndex | undefined {
    return this.index;
  }

  /**
   * The store this checker reads roles from.
   */
  get roleStore(): RoleStore {
    return this.store;
  }

  /**
   * Core evaluation: resolve candidate permissions for the request, match
   * them against the effective roles, and pick the best (most specific)
   * match. Returns an {@link AccessDecision}.
   */
  private evaluate(request: AccessRequest, resolvedRoles: readonly string[], at: number): AccessDecision {
    const candidateKeys = new Set<string>();
    if (this.index) {
      for (const permission of this.index.find(request.action, request.resource, request.scope)) {
        candidateKeys.add(permissionKey(permission));
      }
    }

    let best:
      | { permission: Permission; role: string; score: number }
      | undefined;

    for (const roleName of resolvedRoles) {
      const role = this.store.getRole(roleName);
      if (!role) {
        continue;
      }
      for (const permission of role.permissions) {
        if (this.index && candidateKeys.size > 0 && !candidateKeys.has(permissionKey(permission))) {
          continue;
        }
        if (!permissionAllows(permission, request.action, request.resource, request.scope)) {
          continue;
        }
        const score = this.config.wildcardPreference === 'first' ? 0 : specificity(permission);
        if (!best || score < best.score) {
          best = { permission, role: roleName, score };
        }
      }
    }

    if (!best) {
      return denyDecision('missing-permission', request, at);
    }
    return allowDecision(best.permission, best.role, request, at);
  }
}

/**
 * Structural validation for requests without throwing.
 *
 * @param value Any value.
 * @returns `true` when the value is a valid {@link AccessRequest}.
 */
function assertAccessRequestOrNull(value: unknown): value is AccessRequest {
  try {
    assertAccessRequest(value, 'accessRequest');
    return true;
  } catch {
    return false;
  }
}

/**
 * Convenience factory building a checker over a store and optional index.
 *
 * @param store The role registry.
 * @param index Optional permission index.
 * @param options Configuration overrides.
 * @returns A configured {@link AccessChecker}.
 */
export function createAccessChecker(
  store: RoleStore,
  index?: PermissionIndex,
  options: AccessCheckerOptions = {},
): AccessChecker {
  return new AccessChecker(store, index, options);
}

/**
 * Re-export of `isWildcard` so callers composing custom policies can reuse the
 * wildcard predicate without importing `types.js` directly.
 */
export { isWildcard };

/**
 * Type-only re-exports for integration consumers.
 */
export type { AuthzConfig, AuthzStats, Permission, Role };
export type { RoleStore as RoleStoreLike };