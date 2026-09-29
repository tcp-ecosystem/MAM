/**
 * store.ts
 *
 * `RoleStore` — the in-memory role registry for the MAM Authorization layer.
 *
 * The store owns two kinds of state:
 *
 * 1. **Roles**: a name-keyed registry of {@link Role} records. Each role holds
 *    a set of {@link Permission}s plus an optional inheritance list.
 * 2. **Assignments**: an identity→roles mapping that answers "which roles does
 *    this principal hold?" independently of the authentication layer.
 *
 * The store is deliberately free of decision-making logic — matching and
 * inheritance expansion live in `retrieval.ts` — but it provides the complete
 * mutation surface: define, inspect, grant, revoke, assign, serialize and
 * deserialize. All persisted records are frozen and all returned collections
 * are defensive copies, so callers cannot corrupt internal state through a
 * shared reference.
 *
 * The store is serializable to a versioned JSON snapshot via {@link toJSON}
 * and {@link fromJSON}, making it suitable for persistence, migrations and
 * test fixtures.
 *
 * @module authorization/store
 */

import {
  assertPermission,
  assertRole,
  createEmptyStats,
  createRole,
  dedupeRoles,
  isRecord,
  isRole,
  isStringArray,
  isValidName,
  permissionKey,
  type AccessRequest,
  type AuthzConfig,
  type AuthzStats,
  type GrantOptions,
  type Permission,
  type Role,
  type RoleDefinition,
  SNAPSHOT_VERSION,
} from './types.js';

/**
 * The serialized shape of a {@link RoleStore}, versioned so future formats can
 * be migrated safely.
 */
export interface RoleStoreSnapshot {
  /** Schema version of the snapshot (see {@link SNAPSHOT_VERSION}). */
  readonly version: number;
  /** Every role in the store. */
  readonly roles: readonly Role[];
  /** identityId → ordered list of role names. */
  readonly assignments: Readonly<Record<string, readonly string[]>>;
}

/** Options accepted by {@link RoleStore.deleteRole}. */
export interface DeleteRoleOptions {
  /**
   * When `true`, the role's name is also stripped from every other role's
   * `inherited` list and from all identity assignments. Defaults to `true`.
   */
  readonly cascade?: boolean;
}

/** Options accepted by {@link RoleStore.assign}. */
export interface AssignOptions {
  /**
   * When `true`, the supplied roles are appended to the identity's existing
   * roles; when `false` the existing set is replaced. Defaults to `false`.
   */
  readonly append?: boolean;
}

/**
 * Default options for mutations that accept an options bag.
 */
const DEFAULT_DELETE_OPTIONS: Readonly<DeleteRoleOptions> = Object.freeze({ cascade: true });

/**
 * Validates a plain role-like object, fills defaults and returns a frozen
 * {@link Role}. Throws a descriptive error for structurally invalid input.
 */
function normalizeRoleDefinition(input: RoleDefinition): Role {
  if (!isValidName(input.name)) {
    throw new TypeError('Role name must be a non-empty, non-whitespace string');
  }
  return createRole(input.name, input.permissions ?? [], input.inherited ?? [], {
    description: input.description,
    metadata: input.metadata,
    createdAt: input.createdAt,
  });
}

/**
 * The role registry for the authorization engine.
 *
 * @example
 * ```ts
 * const store = new RoleStore();
 * store.defineRole({ name: 'editor', permissions: [{ action: 'write', resource: 'document' }] });
 * store.grant('admin', { action: '*', resource: '*' });
 * store.assign('u-1', ['editor', 'admin']);
 * const snapshot = store.toJSON();
 * ```
 */
export class RoleStore {
  private readonly roles = new Map<string, Role>();
  private readonly assignments = new Map<string, string[]>();

  /** Lifetime count of grant operations that mutated state. */
  private grants = 0;
  /** Lifetime count of revoked permissions. */
  private revokes = 0;
  /** Epoch ms of the last mutation (create/update/delete/assign). */
  private lastMutationAt: number | undefined;

  /**
   * Creates an empty store, optionally pre-loaded with roles and assignments.
   *
   * @param roles Initial roles to define (validated on load).
   * @param assignments Initial identity→roles assignments.
   */
  constructor(roles?: Iterable<Role>, assignments?: Readonly<Record<string, readonly string[]>>) {
    if (roles) {
      for (const role of roles) {
        this.defineRole(role);
      }
    }
    if (assignments) {
      for (const [identityId, roleList] of Object.entries(assignments)) {
        this.assign(identityId, roleList);
      }
    }
  }

  /**
   * Defines a role in the registry. If the role name already exists, the
   * existing record is returned unchanged (idempotent). The supplied
   * definition is validated, normalized and frozen before storage.
   *
   * @param definition Role definition or an already-frozen {@link Role}.
   * @returns The stored {@link Role}.
   * @throws {TypeError} when the name is invalid or the definition malformed.
   */
  defineRole(definition: RoleDefinition | Role): Role {
    const role = isRole(definition) ? definition : normalizeRoleDefinition(definition);
    assertRole(role, 'role definition');
    const existing = this.roles.get(role.name);
    if (existing) {
      return existing;
    }
    const stored = createRole(role.name, role.permissions, role.inherited ?? [], {
      description: role.description,
      metadata: role.metadata,
      createdAt: role.createdAt,
    });
    this.roles.set(stored.name, stored);
    this.touch();
    return stored;
  }

  /**
   * Looks up a role by name.
   *
   * @param name Role name to resolve.
   * @returns The stored role, or `undefined` when absent.
   */
  getRole(name: string): Role | undefined {
    return this.roles.get(name);
  }

  /**
   * Returns whether a role with the given name exists.
   *
   * @param name Role name to check.
   * @returns `true` when the role is registered.
   */
  hasRole(name: string): boolean {
    return this.roles.has(name);
  }

  /**
   * Returns every registered role, sorted by name for stable iteration.
   *
   * @returns A defensive array of all roles.
   */
  listRoles(): Role[] {
    return Array.from(this.roles.values()).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  /**
   * Returns every registered role name, sorted lexically.
   *
   * @returns A defensive array of role names.
   */
  listRoleNames(): string[] {
    return this.listRoles().map((role) => role.name);
  }

  /**
   * Deletes a role from the registry.
   *
   * When `cascade` is enabled (default) the role name is removed from every
   * other role's inheritance list and from every identity assignment, so no
   * dangling references survive the deletion.
   *
   * @param name Role name to delete.
   * @param options Cascade behaviour (defaults to cascading).
   * @returns `true` when a role was removed, `false` when it did not exist.
   */
  deleteRole(name: string, options: DeleteRoleOptions = DEFAULT_DELETE_OPTIONS): boolean {
    if (!this.roles.delete(name)) {
      return false;
    }
    if (options.cascade !== false) {
      for (const role of this.roles.values()) {
        const inherited = dedupeRoles(role.inherited);
        if (inherited.includes(name)) {
          const updated = createRole(role.name, role.permissions, inherited.filter((parent) => parent !== name), {
            description: role.description,
            metadata: role.metadata,
            createdAt: role.createdAt,
          });
          this.roles.set(updated.name, updated);
        }
      }
      for (const [identityId, roleList] of this.assignments) {
        if (roleList.includes(name)) {
          this.assignments.set(identityId, roleList.filter((role) => role !== name));
        }
      }
    }
    this.touch();
    return true;
  }

  /**
   * Removes every role and every assignment from the store.
   */
  clear(): void {
    this.roles.clear();
    this.assignments.clear();
    this.touch();
  }

  /**
   * Number of roles currently registered.
   */
  get size(): number {
    return this.roles.size;
  }

  /**
   * Number of distinct identities with at least one role assignment.
   */
  get identityCount(): number {
    return this.assignments.size;
  }

  /**
   * Grants a permission to a role. Duplicate permissions (same
   * action+resource+scope key) are silently ignored unless
   * `allowDuplicates` is set.
   *
   * @param roleName Role to grant to.
   * @param permission The permission to grant.
   * @param options Grant behaviour (`replace`, `allowDuplicates`).
   * @returns `true` when the store changed as a result.
   * @throws {ReferenceError} when the role does not exist.
   */
  grant(roleName: string, permission: Permission, options: GrantOptions = {}): boolean {
    const role = this.requireRole(roleName);
    assertPermission(permission, 'granted permission');
    const key = permissionKey(permission);
    const current = new Map(this.roles.get(role.name)!.permissions.map((p) => [permissionKey(p), p]));

    if (options.replace) {
      for (const existing of Array.from(current.values())) {
        if (existing.action === permission.action && existing.resource === permission.resource) {
          current.delete(permissionKey(existing));
        }
      }
    } else if (current.has(key) && options.allowDuplicates !== true) {
      return false;
    }

    current.set(key, permission);
    this.updateRolePermissions(role.name, Array.from(current.values()));
    this.grants += 1;
    this.touch();
    return true;
  }

  /**
   * Grants many permissions to a role in one call, returning how many of them
   * changed the store.
   *
   * @param roleName Role to grant to.
   * @param permissions Permissions to grant.
   * @param options Grant behaviour forwarded to {@link grant}.
   * @returns The number of permissions actually added.
   */
  grantMany(roleName: string, permissions: readonly Permission[], options: GrantOptions = {}): number {
    let added = 0;
    for (const permission of permissions) {
      if (this.grant(roleName, permission, options)) {
        added += 1;
      }
    }
    return added;
  }

  /**
   * Revokes every permission matching the given `action` + `resource` pair on
   * a role, regardless of scope.
   *
   * @param roleName Role to revoke from.
   * @param action Action to match (wildcards are matched literally).
   * @param resource Resource to match (wildcards are matched literally).
   * @returns The number of permissions removed.
   * @throws {ReferenceError} when the role does not exist.
   */
  revoke(roleName: string, action: string, resource: string): number {
    const role = this.requireRole(roleName);
    const remaining = role.permissions.filter(
      (permission) => !(permission.action === action && permission.resource === resource),
    );
    const removed = role.permissions.length - remaining.length;
    if (removed > 0) {
      this.updateRolePermissions(roleName, remaining);
      this.revokes += removed;
      this.touch();
    }
    return removed;
  }

  /**
   * Revokes the exact permission (matching action+resource+scope key) from a
   * role.
   *
   * @param roleName Role to revoke from.
   * @param permission The permission to revoke.
   * @returns `true` when the permission was present and removed.
   */
  revokeExact(roleName: string, permission: Permission): boolean {
    const role = this.requireRole(roleName);
    const key = permissionKey(permission);
    const remaining = role.permissions.filter((existing) => permissionKey(existing) !== key);
    if (remaining.length === role.permissions.length) {
      return false;
    }
    this.updateRolePermissions(roleName, remaining);
    this.revokes += 1;
    this.touch();
    return true;
  }

  /**
   * Removes every permission from a role, returning how many were removed.
   *
   * @param roleName Role to clear permissions on.
   * @returns The number of permissions removed.
   */
  clearPermissions(roleName: string): number {
    const role = this.requireRole(roleName);
    const removed = role.permissions.length;
    if (removed > 0) {
      this.updateRolePermissions(roleName, []);
      this.revokes += removed;
      this.touch();
    }
    return removed;
  }

  /**
   * Assigns roles to an identity. By default the assignment replaces any prior
   * set; pass `{ append: true }` to merge instead.
   *
   * @param identityId Identity to assign roles to.
   * @param roles Role names to assign.
   * @param options Assignment behaviour (`append`).
   * @returns The number of role names recorded for the identity.
   * @throws {ReferenceError} when a role does not exist in the registry.
   */
  assign(identityId: string, roles: readonly string[], options: AssignOptions = {}): number {
    if (!isValidName(identityId)) {
      throw new TypeError('identityId must be a non-empty string');
    }
    const normalized = dedupeRoles(roles);
    for (const role of normalized) {
      if (!this.roles.has(role)) {
        throw new ReferenceError(`Cannot assign unknown role "${role}"`);
      }
    }
    const previous = this.assignments.get(identityId) ?? [];
    const merged = options.append ? dedupeRoles([...previous, ...normalized]) : normalized;
    this.assignments.set(identityId, merged);
    this.touch();
    return merged.length;
  }

  /**
   * Returns the ordered role names assigned to an identity.
   *
   * @param identityId Identity to look up.
   * @returns A defensive copy of the role list (empty when unassigned).
   */
  getRolesForIdentity(identityId: string): string[] {
    return Array.from(this.assignments.get(identityId) ?? []);
  }

  /**
   * Returns whether an identity has at least one role assignment.
   *
   * @param identityId Identity to check.
   * @returns `true` when the identity is known to the store.
   */
  hasIdentity(identityId: string): boolean {
    return this.assignments.has(identityId);
  }

  /**
   * Removes every role assignment for an identity.
   *
   * @param identityId Identity to unassign.
   * @returns `true` when an assignment was removed.
   */
  unassign(identityId: string): boolean {
    if (!this.assignments.delete(identityId)) {
      return false;
    }
    this.touch();
    return true;
  }

  /**
   * Returns the identities currently holding a given role.
   *
   * @param role Role name to search for.
   * @returns A defensive array of identity ids.
   */
  identitiesWithRole(role: string): string[] {
    const out: string[] = [];
    for (const [identityId, roleList] of this.assignments) {
      if (roleList.includes(role)) {
        out.push(identityId);
      }
    }
    return out;
  }

  /**
   * Returns every identity→roles assignment as a plain record.
   *
   * @returns A defensive copy of the assignment map.
   */
  assignmentsToRecord(): Record<string, readonly string[]> {
    const out: Record<string, readonly string[]> = {};
    for (const [identityId, roleList] of this.assignments) {
      out[identityId] = Array.from(roleList);
    }
    return out;
  }

  /**
   * Computes aggregate statistics about the store.
   *
   * @param extra Optional fields to merge over the computed counters.
   * @returns A fresh {@link AuthzStats} reflecting current state.
   */
  stats(extra: Partial<AuthzStats> = {}): AuthzStats {
    const base = createEmptyStats();
    let permissions = 0;
    for (const role of this.roles.values()) {
      permissions += role.permissions.length;
    }
    return {
      ...base,
      roles: this.roles.size,
      permissions,
      assignments: Array.from(this.assignments.values()).reduce((sum, list) => sum + list.length, 0),
      identities: this.assignments.size,
      grants: this.grants,
      revokes: this.revokes,
      lastCheckAt: this.lastMutationAt,
      ...extra,
    };
  }

  /**
   * Serializes the store into a versioned, JSON-safe snapshot.
   *
   * @returns The snapshot object (safe to `JSON.stringify`).
   */
  toJSON(): RoleStoreSnapshot {
    return {
      version: SNAPSHOT_VERSION,
      roles: this.listRoles(),
      assignments: this.assignmentsToRecord(),
    };
  }

  /**
   * Replaces the entire store state from a snapshot. The current state is
   * discarded after the snapshot validates successfully.
   *
   * @param snapshot Snapshot produced by {@link toJSON} (or hand-built).
   * @throws {TypeError} when the snapshot is structurally invalid.
   */
  fromJSON(snapshot: unknown): void {
    if (!isRecord(snapshot)) {
      throw new TypeError('RoleStore snapshot must be an object');
    }
    if (snapshot.version !== undefined && snapshot.version !== SNAPSHOT_VERSION) {
      throw new TypeError(`Unsupported RoleStore snapshot version "${snapshot.version}"`);
    }
    if (!Array.isArray(snapshot.roles)) {
      throw new TypeError('RoleStore snapshot is missing a roles array');
    }
    for (const role of snapshot.roles) {
      if (!isRole(role)) {
        throw new TypeError('RoleStore snapshot contains an invalid role');
      }
    }
    if (snapshot.assignments !== undefined && !isRecord(snapshot.assignments)) {
      throw new TypeError('RoleStore snapshot assignments must be a record');
    }
    const assignments = snapshot.assignments as Record<string, unknown> | undefined;
    for (const [identityId, roleList] of Object.entries(assignments ?? {})) {
      if (!isStringArray(roleList)) {
        throw new TypeError(`RoleStore snapshot assignments for "${identityId}" must be a string array`);
      }
    }

    this.roles.clear();
    this.assignments.clear();
    for (const role of snapshot.roles as Role[]) {
      this.roles.set(role.name, createRole(role.name, role.permissions, role.inherited ?? [], {
        description: role.description,
        metadata: role.metadata,
        createdAt: role.createdAt,
      }));
    }
    for (const [identityId, roleList] of Object.entries(assignments ?? {})) {
      this.assignments.set(identityId, dedupeRoles(roleList as string[]));
    }
    this.touch();
  }

  /**
   * Reconstructs a store from a snapshot in a single call.
   *
   * @param snapshot Snapshot produced by {@link toJSON}.
   * @returns A fully-populated {@link RoleStore}.
   */
  static fromJSON(snapshot: unknown): RoleStore {
    const store = new RoleStore();
    store.fromJSON(snapshot);
    return store;
  }

  /**
   * Reconstructs a store from a JSON string.
   *
   * @param json The serialized snapshot text.
   * @returns A fully-populated {@link RoleStore}.
   */
  static fromJSONString(json: string): RoleStore {
    return RoleStore.fromJSON(JSON.parse(json) as unknown);
  }

  /**
   * Internal helper: fetches a role or throws a descriptive reference error.
   */
  private requireRole(roleName: string): Role {
    const role = this.roles.get(roleName);
    if (!role) {
      throw new ReferenceError(`Unknown role "${roleName}"`);
    }
    return role;
  }

  /**
   * Internal helper: replaces a role's permission set with a frozen record.
   */
  private updateRolePermissions(roleName: string, permissions: readonly Permission[]): void {
    const role = this.requireRole(roleName);
    const updated = createRole(role.name, permissions, role.inherited ?? [], {
      description: role.description,
      metadata: role.metadata,
      createdAt: role.createdAt,
    });
    this.roles.set(updated.name, updated);
  }

  /**
   * Records that the store was mutated, refreshing the mutation timestamp.
   */
  private touch(): void {
    this.lastMutationAt = Date.now();
  }
}

/**
 * Convenience factory that builds a {@link RoleStore} pre-populated from a
 * list of role definitions.
 *
 * @param definitions Role definitions to define.
 * @returns A store containing every supplied role.
 */
export function createRoleStore(definitions: readonly RoleDefinition[] = []): RoleStore {
  const store = new RoleStore();
  for (const definition of definitions) {
    store.defineRole(definition);
  }
  return store;
}

/**
 * Builds a role bundle (an array of permissions plus inheritance) suitable for
 * seeding a store, from a capability-like description.
 *
 * @param name Role name.
 * @param permissions Permissions the role owns.
 * @param inherited Parent role names.
 * @param description Optional description.
 * @returns A frozen {@link Role} ready for {@link RoleStore.defineRole}.
 */
export function buildRole(
  name: string,
  permissions: readonly Permission[],
  inherited: readonly string[] = [],
  description?: string,
): Role {
  return createRole(name, permissions, inherited, { description });
}

/**
 * Type-only re-export convenience so integration layers can refer to the
 * request type without importing `types.js` directly.
 */
export type { AccessRequest, AuthzConfig, AuthzStats, GrantOptions, Permission, Role, RoleDefinition };