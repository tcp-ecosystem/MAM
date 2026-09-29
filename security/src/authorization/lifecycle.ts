/**
 * lifecycle.ts
 *
 * `AuthzLifecycle` — the operational spine of the MAM Authorization layer.
 *
 * The lifecycle layer owns everything that is not a single access decision:
 *
 * - **Pruning** — {@link prune} removes roles that are no longer wanted,
 *   either explicitly named or automatically when they become orphans (no
 *   permissions, no assignees, no dependents).
 * - **Revocation** — {@link revokeRole} strips every permission from a role in
 *   one operation so "deactivate this role" is a single, auditable call.
 * - **Resets** — {@link reset} clears the store and the index together so
 *   re-seeding from a snapshot is an all-or-nothing operation.
 * - **Periodic sync** — {@link start} / {@link stop} drive a timer that
 *   re-synchronizes the index from the store and emits a `synced` event, so
 *   long-lived processes converge even if a role was mutated directly on the
 *   store without going through the index.
 * - **Events** — the lifecycle re-emits checker decisions as `granted` /
 *   `denied` events and broadcasts every structural mutation (`role-defined`,
 *   `role-deleted`, `revoked`, `pruned`, `reset`, `error`), giving adapters
 *   and audit pipelines a single subscription point.
 *
 * The lifecycle extends Node's {@link EventEmitter} and keeps typed
 * subscription helpers (`onGranted`, `onDenied`, …) that return unsubscribe
 * functions for easy teardown.
 *
 * @module authorization/lifecycle
 */

import { EventEmitter } from 'node:events';

import {
  createEmptyStats,
  describeRequest,
  resolveAuthzConfig,
  type AccessDecision,
  type AccessRequest,
  type AuthzConfig,
  type AuthzStats,
  type Role,
} from './types.js';
import type { RoleStore } from './store.js';
import type { PermissionIndex } from './index.js';
import type { AccessChecker } from './retrieval.js';

/**
 * Canonical event names emitted by {@link AuthzLifecycle}. Using the constants
 * keeps listeners safe from typos.
 */
export const AUTHZ_EVENTS = {
  /** A checker decision allowed a request. Payload: `(decision, request)`. */
  GRANTED: 'granted',
  /** A checker decision denied a request. Payload: `(decision, request)`. */
  DENIED: 'denied',
  /** A role was defined. Payload: `(role)`. */
  ROLE_DEFINED: 'role-defined',
  /** A role was deleted. Payload: `(roleName, removed: boolean)`. */
  ROLE_DELETED: 'role-deleted',
  /** Permissions were revoked from a role. Payload: `(roleName, count)`. */
  REVOKED: 'revoked',
  /** Roles were pruned. Payload: `(removed: string[])`. */
  PRUNED: 'pruned',
  /** A periodic sync completed. Payload: `(stats)`. */
  SYNCED: 'synced',
  /** The lifecycle started / stopped its timer. Payload: `(running: boolean)`. */
  RUNNING: 'running',
  /** The engine was reset. Payload: `(stats)`. */
  RESET: 'reset',
  /** A lifecycle operation failed. Payload: `(error)`. */
  ERROR: 'error',
} as const;

/** Options accepted by the {@link AuthzLifecycle} constructor. */
export interface AuthzLifecycleOptions {
  /** Behavioural overrides merged over the defaults. */
  config?: Partial<AuthzConfig>;
}

/**
 * The operational spine of the authorization engine: pruning, revocation,
 * resets, periodic sync and event fan-out.
 *
 * @example
 * ```ts
 * const lifecycle = new AuthzLifecycle(store, index, checker);
 * lifecycle.onGranted((decision) => audit.track(decision));
 * lifecycle.start(5_000);
 * ```
 */
export class AuthzLifecycle extends EventEmitter {
  private readonly store: RoleStore;
  private readonly index: PermissionIndex;
  private readonly checker: AccessChecker;
  private readonly config: AuthzConfig;

  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private syncCount = 0;
  private lastSyncAt: number | undefined;
  private errorCount = 0;
  private lastGrantedAt: number | undefined;
  private lastDeniedAt: number | undefined;

  /**
   * Creates a lifecycle bound to the three core collaborators.
   *
   * The constructor wires the checker's `decision` events into `granted` /
   * `denied` fan-out, so callers never subscribe to the checker directly.
   *
   * @param store The role registry.
   * @param index The permission index (kept in sync by the lifecycle).
   * @param checker The access checker producing decisions.
   * @param options Configuration overrides.
   */
  constructor(
    store: RoleStore,
    index: PermissionIndex,
    checker: AccessChecker,
    options: AuthzLifecycleOptions = {},
  ) {
    super();
    this.store = store;
    this.index = index;
    this.checker = checker;
    this.config = resolveAuthzConfig(options.config);
    this.setMaxListeners(64);

    this.checker.on('decision', (decision: AccessDecision, request: AccessRequest) => {
      if (decision.allowed) {
        this.lastGrantedAt = decision.at;
        this.emit(AUTHZ_EVENTS.GRANTED, decision, request);
      } else {
        this.lastDeniedAt = decision.at;
        this.emit(AUTHZ_EVENTS.DENIED, decision, request);
      }
    });
  }

  /**
   * Prunes roles. With an explicit list, exactly those role names are
   * deleted (cascading). Without a list, orphaned roles — no permissions, no
   * identity assignments and no dependents — are deleted automatically.
   *
   * @param roleNames Optional explicit role names to prune.
   * @returns The names of roles that were actually removed.
   */
  prune(roleNames?: readonly string[]): string[] {
    const targets = roleNames !== undefined ? Array.from(roleNames) : this.findOrphans();
    const removed: string[] = [];
    for (const name of targets) {
      if (this.store.deleteRole(name)) {
        this.index.removeRole(name);
        removed.push(name);
        this.emit(AUTHZ_EVENTS.ROLE_DELETED, name, true);
      }
    }
    if (removed.length > 0) {
      this.emit(AUTHZ_EVENTS.PRUNED, removed);
    }
    return removed;
  }

  /**
   * Revokes every permission from a role. The role itself remains registered,
   * so identities keep their membership but lose all grants.
   *
   * @param roleName Role to strip.
   * @returns The number of permissions removed.
   * @throws {ReferenceError} when the role does not exist.
   */
  revokeRole(roleName: string): number {
    const removed = this.store.clearPermissions(roleName);
    const role = this.store.getRole(roleName);
    if (role) {
      this.index.syncRole(role);
    }
    if (removed > 0) {
      this.emit(AUTHZ_EVENTS.REVOKED, roleName, removed);
    }
    return removed;
  }

  /**
   * Removes a single permission from a role (matching the exact
   * action+resource+scope key) and keeps the index consistent.
   *
   * @param roleName Role to revoke from.
   * @param action Permission action to revoke.
   * @param resource Permission resource to revoke.
   * @returns The number of permissions removed (0 or 1 for exact match).
   */
  revokePermission(roleName: string, action: string, resource: string): number {
    const removed = this.store.revoke(roleName, action, resource);
    const role = this.store.getRole(roleName);
    if (role) {
      this.index.syncRole(role);
    }
    if (removed > 0) {
      this.emit(AUTHZ_EVENTS.REVOKED, roleName, removed);
    }
    return removed;
  }

  /**
   * Registers a role and indexes it. Thin, event-emitting wrapper over the
   * store's `defineRole`.
   *
   * @param role The role to define.
   * @returns The stored role.
   */
  defineRole(role: Role): Role {
    const stored = this.store.defineRole(role);
    this.index.syncRole(stored);
    this.emit(AUTHZ_EVENTS.ROLE_DEFINED, stored);
    return stored;
  }

  /**
   * Resets the engine: the store and the index are cleared together and a
   * `reset` event is emitted with the post-reset statistics.
   *
   * @returns The empty statistics snapshot.
   */
  reset(): AuthzStats {
    this.store.clear();
    this.index.clear();
    const stats = this.stats();
    this.emit(AUTHZ_EVENTS.RESET, stats);
    return stats;
  }

  /**
   * Starts the periodic sync timer. Idempotent: calling again while running is
   * a no-op.
   *
   * @param intervalMs Sync interval in milliseconds (defaults to
   *   `config.syncIntervalMs`).
   * @returns `true` when the timer was started, `false` if already running.
   */
  start(intervalMs?: number): boolean {
    if (this.running) {
      return false;
    }
    const interval = intervalMs ?? this.config.syncIntervalMs ?? 30_000;
    this.timer = setInterval(() => {
      this.sync();
    }, interval);
    if (this.timer.unref) {
      this.timer.unref();
    }
    this.running = true;
    this.emit(AUTHZ_EVENTS.RUNNING, true);
    return true;
  }

  /**
   * Stops the periodic sync timer. Idempotent.
   *
   * @returns `true` when a running timer was stopped.
   */
  stop(): boolean {
    if (!this.running || this.timer === null) {
      return false;
    }
    clearInterval(this.timer);
    this.timer = null;
    this.running = false;
    this.emit(AUTHZ_EVENTS.RUNNING, false);
    return true;
  }

  /**
   * Returns whether the periodic sync timer is active.
   */
  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Runs a single synchronization pass: the index is rebuilt from the current
   * store contents so any out-of-band store mutations are reflected, and a
   * `synced` event is emitted with the resulting statistics.
   *
   * @returns The post-sync statistics snapshot.
   */
  sync(): AuthzStats {
    const rebuilt = this.index.rebuild(this.store.listRoles());
    this.syncCount += 1;
    this.lastSyncAt = Date.now();
    const stats = this.stats();
    this.emit(AUTHZ_EVENTS.SYNCED, stats, rebuilt);
    return stats;
  }

  /**
   * Subscribes a listener to granted decisions. Returns an unsubscribe
   * function.
   *
   * @param listener Callback invoked with `(decision, request)` for allows.
   * @returns A function that removes the listener.
   */
  onGranted(listener: (decision: AccessDecision, request: AccessRequest) => void): () => void {
    this.on(AUTHZ_EVENTS.GRANTED, listener);
    return () => this.off(AUTHZ_EVENTS.GRANTED, listener);
  }

  /**
   * Subscribes a listener to denied decisions. Returns an unsubscribe
   * function.
   *
   * @param listener Callback invoked with `(decision, request)` for denies.
   * @returns A function that removes the listener.
   */
  onDenied(listener: (decision: AccessDecision, request: AccessRequest) => void): () => void {
    this.on(AUTHZ_EVENTS.DENIED, listener);
    return () => this.off(AUTHZ_EVENTS.DENIED, listener);
  }

  /**
   * Subscribes a listener to revocation events.
   *
   * @param listener Callback invoked with `(roleName, count)`.
   * @returns An unsubscribe function.
   */
  onRevoked(listener: (roleName: string, count: number) => void): () => void {
    this.on(AUTHZ_EVENTS.REVOKED, listener);
    return () => this.off(AUTHZ_EVENTS.REVOKED, listener);
  }

  /**
   * Subscribes a listener to prune events.
   *
   * @param listener Callback invoked with the removed role names.
   * @returns An unsubscribe function.
   */
  onPruned(listener: (removed: string[]) => void): () => void {
    this.on(AUTHZ_EVENTS.PRUNED, listener);
    return () => this.off(AUTHZ_EVENTS.PRUNED, listener);
  }

  /**
   * Subscribes a listener to error events emitted by lifecycle operations.
   *
   * @param listener Callback invoked with the error.
   * @returns An unsubscribe function.
   */
  onError(listener: (error: Error) => void): () => void {
    this.on(AUTHZ_EVENTS.ERROR, listener);
    return () => this.off(AUTHZ_EVENTS.ERROR, listener);
  }

  /**
   * Safely performs a lifecycle operation, emitting an `error` event (and
   * re-throwing only when no listener is attached) instead of crashing the
   * process.
   *
   * @param operation The operation to attempt.
   * @returns The operation's result, or `undefined` when it threw.
   */
  attempt<T>(operation: () => T): T | undefined {
    try {
      return operation();
    } catch (error) {
      this.errorCount += 1;
      this.emit(AUTHZ_EVENTS.ERROR, error instanceof Error ? error : new Error(String(error)));
      return undefined;
    }
  }

  /**
   * Computes aggregate statistics across the store, index and checker.
   *
   * @returns A merged {@link AuthzStats}.
   */
  stats(): AuthzStats {
    const base = createEmptyStats();
    const storeStats = this.store.stats();
    const indexStats = this.index.stats();
    const checkerStats = this.checker.stats();
    return {
      ...base,
      roles: storeStats.roles,
      permissions: storeStats.permissions,
      assignments: storeStats.assignments,
      identities: storeStats.identities,
      indexActions: indexStats.actions,
      indexResources: indexStats.resources,
      checks: checkerStats.checks,
      denies: checkerStats.deniedDecisions,
      grants: storeStats.grants,
      revokes: storeStats.revokes,
      lastCheckAt: checkerStats.lastCheckAt,
    };
  }

  /**
   * Reports the lifecycle's operational state.
   *
   * @returns A plain snapshot of timers, counts and the running flag.
   */
  status(): {
    running: boolean;
    syncCount: number;
    lastSyncAt: number | undefined;
    errorCount: number;
    lastGrantedAt: number | undefined;
    lastDeniedAt: number | undefined;
  } {
    return {
      running: this.running,
      syncCount: this.syncCount,
      lastSyncAt: this.lastSyncAt,
      errorCount: this.errorCount,
      lastGrantedAt: this.lastGrantedAt,
      lastDeniedAt: this.lastDeniedAt,
    };
  }

  /**
   * Finds orphaned roles: roles with no permissions, no identity assignments
   * and no dependent roles inheriting from them.
   *
   * @returns A defensive array of orphaned role names.
   */
  private findOrphans(): string[] {
    const orphans: string[] = [];
    for (const role of this.store.listRoles()) {
      const assigned = this.store.identitiesWithRole(role.name).length > 0;
      const dependent = this.checker.dependentsOf(role.name).some(
        (candidate) => candidate !== role.name,
      );
      if (role.permissions.length === 0 && !assigned && !dependent) {
        orphans.push(role.name);
      }
    }
    return orphans;
  }
}

/**
 * Convenience factory building a fully-wired lifecycle.
 *
 * @param store The role registry.
 * @param index The permission index.
 * @param checker The access checker.
 * @param options Configuration overrides.
 * @returns A configured {@link AuthzLifecycle}.
 */
export function createAuthzLifecycle(
  store: RoleStore,
  index: PermissionIndex,
  checker: AccessChecker,
  options: AuthzLifecycleOptions = {},
): AuthzLifecycle {
  return new AuthzLifecycle(store, index, checker, options);
}

/**
 * Utility that renders a decision for an audit log line.
 *
 * @param decision The decision to render.
 * @returns A single-line audit string.
 */
export function auditLine(decision: AccessDecision): string {
  const request = decision.request;
  const subject = request ? describeRequest(request) : 'anonymous';
  const role = decision.matchedRole ? ` via "${decision.matchedRole}"` : '';
  return `[authz] ${decision.allowed ? 'GRANTED' : 'DENIED'} ${subject} (${decision.reason})${role}`;
}