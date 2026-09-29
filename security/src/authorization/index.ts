/**
 * index.ts
 *
 * `PermissionIndex` — a denormalized, queryable index over the permissions of
 * every role in the authorization engine.
 *
 * Instead of scanning every role's permission array on each access check, the
 * index maintains five cross-cutting lookup tables:
 *
 * - `byKey`     — every distinct permission, keyed by its serialized form.
 * - `byAction`  — permission keys grouped by the permission's action.
 * - `byResource`— permission keys grouped by the permission's resource.
 * - `byScope`   — permission keys grouped by the permission's scope.
 * - `byRole`    — permission keys grouped by the role that owns them.
 *
 * Because {@link AccessChecker} runs in the hot path, the index trades memory
 * for speed: lookups are O(1) map reads and candidate narrowing is set
 * intersection rather than linear scans.
 *
 * The index is designed to stay consistent with a {@link RoleStore}: roles are
 * (re)indexed via {@link indexRole} after store mutations, or the whole index
 * can be rebuilt from the store in one pass with {@link rebuild}.
 *
 * @module authorization/index
 */

import {
  isRole,
  permissionKey,
  SCOPE_ANY,
  type Permission,
  type Role,
} from './types.js';

/**
 * A single indexed permission plus the set of roles that hold it.
 */
export interface IndexEntry {
  /** The indexed permission. */
  readonly permission: Permission;
  /** Role names that own this permission (mutable internal set). */
  readonly roles: Set<string>;
}

/**
 * Aggregate statistics about the index contents.
 */
export interface PermissionIndexStats {
  /** Number of distinct roles indexed. */
  roles: number;
  /** Number of distinct permission entries. */
  permissions: number;
  /** Number of distinct actions indexed. */
  actions: number;
  /** Number of distinct resources indexed. */
  resources: number;
  /** Number of distinct scopes indexed (including the wildcard bucket). */
  scopes: number;
  /** Entries whose action is the wildcard `*`. */
  wildcardActions: number;
  /** Entries whose resource is the wildcard `*`. */
  wildcardResources: number;
}

/** Options accepted by {@link PermissionIndex.findByAction} and friends. */
export interface FindOptions {
  /**
   * When `true` (default), wildcard entries (`action: *`) are included in the
   * result set for every query; when `false`, only exact matches are returned.
   */
  readonly includeWildcards?: boolean;
}

const DEFAULT_FIND_OPTIONS: Readonly<FindOptions> = Object.freeze({ includeWildcards: true });

/**
 * Normalizes a permission's scope to the wildcard marker so every entry
 * belongs to exactly one scope bucket.
 */
function scopeBucket(scope: string | undefined): string {
  return scope === undefined || scope === SCOPE_ANY ? SCOPE_ANY : scope;
}

/**
 * A queryable index over role permissions.
 *
 * @example
 * ```ts
 * const index = new PermissionIndex();
 * index.indexRole(store.getRole('admin')!);
 * const candidates = index.find('read', 'document'); // { action, resource } triple
 * ```
 */
export class PermissionIndex {
  /** Distinct permission entries keyed by serialized permission key. */
  private readonly byKey = new Map<string, IndexEntry>();
  /** action → set of permission keys. */
  private readonly byAction = new Map<string, Set<string>>();
  /** resource → set of permission keys. */
  private readonly byResource = new Map<string, Set<string>>();
  /** scope bucket → set of permission keys. */
  private readonly byScope = new Map<string, Set<string>>();
  /** role name → set of permission keys owned by the role. */
  private readonly byRole = new Map<string, Set<string>>();
  /** Distinct role names currently indexed. */
  private readonly roleNames = new Set<string>();

  /**
   * Creates an empty index, optionally pre-populated with roles.
   *
   * @param roles Roles to index immediately.
   */
  constructor(roles?: Iterable<Role>) {
    if (roles) {
      this.indexRoles(roles);
    }
  }

  /**
   * Indexes a single role: every permission it owns is added to the cross
   * tables and the role is recorded as a holder.
   *
   * @param role The role to index (validated structurally).
   * @returns The number of distinct permission entries added.
   * @throws {TypeError} when the role is structurally invalid.
   */
  indexRole(role: Role): number {
    if (!isRole(role)) {
      throw new TypeError('Cannot index an invalid Role object');
    }
    let added = 0;
    this.roleNames.add(role.name);
    let roleKeys = this.byRole.get(role.name);
    if (!roleKeys) {
      roleKeys = new Set<string>();
      this.byRole.set(role.name, roleKeys);
    }
    for (const permission of role.permissions) {
      const key = permissionKey(permission);
      let entry = this.byKey.get(key);
      if (!entry) {
        entry = { permission, roles: new Set<string>() };
        this.byKey.set(key, entry);
        this.addToBucket(this.byAction, permission.action, key);
        this.addToBucket(this.byResource, permission.resource, key);
        this.addToBucket(this.byScope, scopeBucket(permission.scope), key);
        added += 1;
      }
      entry.roles.add(role.name);
      roleKeys.add(key);
    }
    return added;
  }

  /**
   * Indexes many roles in a single pass.
   *
   * @param roles Roles to index.
   * @returns The total number of distinct permission entries added.
   */
  indexRoles(roles: Iterable<Role>): number {
    let added = 0;
    for (const role of roles) {
      added += this.indexRole(role);
    }
    return added;
  }

  /**
   * Removes a role and all of its permission ownership from the index. Empty
   * entries (permissions no longer held by any role) are pruned.
   *
   * @param roleName Role name to remove.
   * @returns The number of permission entries removed as a result.
   */
  removeRole(roleName: string): number {
    const roleKeys = this.byRole.get(roleName);
    this.byRole.delete(roleName);
    this.roleNames.delete(roleName);
    if (!roleKeys) {
      return 0;
    }
    let removed = 0;
    for (const key of roleKeys) {
      const entry = this.byKey.get(key);
      if (!entry) {
        continue;
      }
      entry.roles.delete(roleName);
      if (entry.roles.size === 0) {
        this.deleteEntry(key, entry.permission);
        removed += 1;
      }
    }
    return removed;
  }

  /**
   * Removes a single permission entry from the index entirely, regardless of
   * which roles hold it.
   *
   * @param permission The permission to remove.
   * @returns `true` when the entry existed and was removed.
   */
  removePermission(permission: Permission): boolean {
    return this.removeByKey(permissionKey(permission));
  }

  /**
   * Removes a permission entry by its serialized key.
   *
   * @param key Serialized permission key.
   * @returns `true` when the entry existed and was removed.
   */
  removeByKey(key: string): boolean {
    const entry = this.byKey.get(key);
    if (!entry) {
      return false;
    }
    for (const roleName of entry.roles) {
      this.byRole.get(roleName)?.delete(key);
    }
    this.deleteEntry(key, entry.permission);
    return true;
  }

  /**
   * Returns every distinct permission whose action matches the query. With
   * `includeWildcards` (default) the wildcard `action: *` entries are included.
   *
   * @param action Action to match.
   * @param options Whether to include wildcard entries.
   * @returns Matching permission records (defensive copy).
   */
  findByAction(action: string, options: FindOptions = DEFAULT_FIND_OPTIONS): Permission[] {
    return this.collect(this.byAction.get(action), options, 'action');
  }

  /**
   * Returns every distinct permission whose resource matches the query.
   *
   * @param resource Resource to match.
   * @param options Whether to include wildcard entries.
   * @returns Matching permission records.
   */
  findByResource(resource: string, options: FindOptions = DEFAULT_FIND_OPTIONS): Permission[] {
    return this.collect(this.byResource.get(resource), options, 'resource');
  }

  /**
   * Returns every distinct permission in the given scope bucket. Unscoped
   * permissions live in the {@link SCOPE_ANY} bucket.
   *
   * @param scope Scope to match.
   * @param options Whether to include wildcard-scope entries.
   * @returns Matching permission records.
   */
  findByScope(scope: string, options: FindOptions = DEFAULT_FIND_OPTIONS): Permission[] {
    const bucket = scopeBucket(scope);
    const keys = this.byScope.get(bucket);
    if (!keys) {
      return [];
    }
    const out: Permission[] = [];
    for (const key of keys) {
      const entry = this.byKey.get(key);
      if (!entry) {
        continue;
      }
      if (!options.includeWildcards && entry.permission.scope !== undefined && entry.permission.scope !== scope) {
        continue;
      }
      out.push(entry.permission);
    }
    return out.sort((a, b) => permissionKey(a).localeCompare(permissionKey(b)));
  }

  /**
   * Returns every distinct permission owned by a role.
   *
   * @param role Role name to query.
   * @returns The role's own permission records (not inherited ones).
   */
  findByRole(role: string): Permission[] {
    const keys = this.byRole.get(role);
    if (!keys) {
      return [];
    }
    const out: Permission[] = [];
    for (const key of keys) {
      const entry = this.byKey.get(key);
      if (entry) {
        out.push(entry.permission);
      }
    }
    return out.sort((a, b) => permissionKey(a).localeCompare(permissionKey(b)));
  }

  /**
   * Returns the set of roles holding a given permission key.
   *
   * @param key Serialized permission key.
   * @returns Role names owning the permission (defensive copy).
   */
  rolesFor(key: string): string[] {
    return Array.from(this.byKey.get(key)?.roles ?? []);
  }

  /**
   * Two-axis lookup: returns the candidate permissions relevant for a request
   * triple `(action, resource, scope)`. The result is the intersection of the
   * action bucket and the resource bucket (further narrowed by scope when a
   * scope is supplied), giving the checker a small candidate set to evaluate.
   *
   * @param action Requested action.
   * @param resource Requested resource.
   * @param scope Requested scope (optional).
   * @returns Candidate permission records for the triple.
   */
  find(action: string, resource: string, scope?: string): Permission[] {
    const actionKeys = this.byAction.get(action);
    const resourceKeys = this.byResource.get(resource);
    if (!actionKeys || !resourceKeys) {
      return [];
    }
    const scopeKeys = scope !== undefined ? this.byScope.get(scopeBucket(scope)) : undefined;
    const candidateKeys = new Set<string>();
    for (const key of actionKeys) {
      if (resourceKeys.has(key) && (scopeKeys === undefined || scopeKeys.has(key))) {
        candidateKeys.add(key);
      }
    }
    for (const key of this.byKey.keys()) {
      const entry = this.byKey.get(key);
      if (!entry) {
        continue;
      }
      const isActionWild = entry.permission.action === '*';
      const isResourceWild = entry.permission.resource === '*';
      if ((isActionWild || isResourceWild) && this.matchesTriple(entry.permission, action, resource, scope)) {
        candidateKeys.add(key);
      }
    }
    const out: Permission[] = [];
    for (const key of candidateKeys) {
      const entry = this.byKey.get(key);
      if (entry) {
        out.push(entry.permission);
      }
    }
    return out.sort((a, b) => permissionKey(a).localeCompare(permissionKey(b)));
  }

  /**
   * Returns whether the index contains a given permission entry.
   *
   * @param permission The permission to check.
   * @returns `true` when an identical key is indexed.
   */
  has(permission: Permission): boolean {
    return this.byKey.has(permissionKey(permission));
  }

  /**
   * Rebuilds the index from scratch from an iterable of roles. All current
   * entries are discarded before re-indexing.
   *
   * @param roles Roles to index.
   * @returns The total number of distinct permission entries indexed.
   */
  rebuild(roles: Iterable<Role>): number {
    this.clear();
    return this.indexRoles(roles);
  }

  /**
   * Synchronizes the index with a role's current permission set, adding new
   * permissions and removing stale ones. Roles that still exist keep their
   * ownership; permissions no longer present on the role are unlinked.
   *
   * @param role The role to synchronize.
   * @returns The net number of permission entries added.
   */
  syncRole(role: Role): number {
    if (!isRole(role)) {
      throw new TypeError('Cannot synchronize an invalid Role object');
    }
    const currentKeys = new Set(role.permissions.map((p) => permissionKey(p)));
    const existingKeys = this.byRole.get(role.name);
    if (existingKeys) {
      for (const key of existingKeys) {
        if (!currentKeys.has(key)) {
          this.byRole.get(role.name)?.delete(key);
          const entry = this.byKey.get(key);
          if (entry) {
            entry.roles.delete(role.name);
            if (entry.roles.size === 0) {
              this.deleteEntry(key, entry.permission);
            }
          }
        }
      }
    }
    return this.indexRole(role);
  }

  /**
   * Removes every entry from the index.
   */
  clear(): void {
    this.byKey.clear();
    this.byAction.clear();
    this.byResource.clear();
    this.byScope.clear();
    this.byRole.clear();
    this.roleNames.clear();
  }

  /**
   * Number of distinct permission entries in the index.
   */
  get size(): number {
    return this.byKey.size;
  }

  /**
   * Number of distinct roles currently indexed.
   */
  get roleCount(): number {
    return this.roleNames.size;
  }

  /**
   * Returns every role name currently indexed.
   *
   * @returns A defensive array of role names.
   */
  roles(): string[] {
    return Array.from(this.roleNames).sort();
  }

  /**
   * Computes aggregate statistics about the index.
   *
   * @returns A fresh {@link PermissionIndexStats}.
   */
  stats(): PermissionIndexStats {
    let wildcardActions = 0;
    let wildcardResources = 0;
    for (const entry of this.byKey.values()) {
      if (entry.permission.action === '*') wildcardActions += 1;
      if (entry.permission.resource === '*') wildcardResources += 1;
    }
    return {
      roles: this.roleNames.size,
      permissions: this.byKey.size,
      actions: this.byAction.size,
      resources: this.byResource.size,
      scopes: this.byScope.size,
      wildcardActions,
      wildcardResources,
    };
  }

  /**
   * Serializes the index into a JSON-safe structure (roles + their owned
   * permission keys). This is primarily intended for diagnostics; prefer
   * {@link rebuild} for persistence round-trips.
   *
   * @returns A plain object describing the index.
   */
  toJSON(): { roles: string[]; permissions: Record<string, string[]> } {
    const permissions: Record<string, string[]> = {};
    for (const [key, entry] of this.byKey) {
      permissions[key] = Array.from(entry.roles).sort();
    }
    return { roles: this.roles(), permissions };
  }

  /**
   * Collects permissions from a key set bucket, applying wildcard filters.
   */
  private collect(
    keys: Set<string> | undefined,
    options: FindOptions,
    dimension: 'action' | 'resource',
  ): Permission[] {
    if (!keys) {
      return [];
    }
    const out: Permission[] = [];
    for (const key of keys) {
      const entry = this.byKey.get(key);
      if (!entry) {
        continue;
      }
      const isWild = dimension === 'action'
        ? entry.permission.action === '*'
        : entry.permission.resource === '*';
      if (!options.includeWildcards && isWild) {
        continue;
      }
      out.push(entry.permission);
    }
    return out.sort((a, b) => permissionKey(a).localeCompare(permissionKey(b)));
  }

  /**
   * Evaluates a permission against a request triple for wildcard candidate
   * inclusion during {@link find}.
   */
  private matchesTriple(
    permission: Permission,
    action: string,
    resource: string,
    scope: string | undefined,
  ): boolean {
    if (permission.action !== '*' && permission.action !== action) return false;
    if (permission.resource !== '*' && permission.resource !== resource) return false;
    if (scope !== undefined) {
      const permissionScope = permission.scope === undefined ? SCOPE_ANY : permission.scope;
      if (permissionScope !== SCOPE_ANY && permissionScope !== scope) return false;
    }
    return true;
  }

  /**
   * Adds a key to a bucket map, creating the bucket on demand.
   */
  private addToBucket(bucket: Map<string, Set<string>>, label: string, key: string): void {
    let keys = bucket.get(label);
    if (!keys) {
      keys = new Set<string>();
      bucket.set(label, keys);
    }
    keys.add(key);
  }

  /**
   * Removes an entry from every cross table.
   */
  private deleteEntry(key: string, permission: Permission): void {
    this.byKey.delete(key);
    this.deleteFromBucket(this.byAction, permission.action, key);
    this.deleteFromBucket(this.byResource, permission.resource, key);
    this.deleteFromBucket(this.byScope, scopeBucket(permission.scope), key);
  }

  /**
   * Removes a key from a bucket, pruning empty buckets.
   */
  private deleteFromBucket(bucket: Map<string, Set<string>>, label: string, key: string): void {
    const keys = bucket.get(label);
    if (!keys) {
      return;
    }
    keys.delete(key);
    if (keys.size === 0) {
      bucket.delete(label);
    }
  }
}

/**
 * Convenience factory building an index over a list of roles.
 *
 * @param roles Roles to index.
 * @returns A populated {@link PermissionIndex}.
 */
export function createPermissionIndex(roles: readonly Role[] = []): PermissionIndex {
  return new PermissionIndex(roles);
}