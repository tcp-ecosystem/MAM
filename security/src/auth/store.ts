/**
 * store.ts
 *
 * `IdentityStore` — the in-memory registry that owns the canonical set of
 * known identities. It provides CRUD operations, role/type filtered views,
 * activity toggling, `stats()` snapshots and lossless
 * `toJSON` / `fromJSON` round-tripping for persistence.
 *
 * The store is intentionally synchronous and dependency-free (only
 * `node:events` for change notifications). It never throws on ordinary lookup
 * misses: `get`/`has`/`remove` return neutral values so callers can compose
 * them freely. Invalid input, however, is rejected loudly via the guards from
 * `types.ts`.
 *
 * @module auth/store
 */

import { EventEmitter } from 'node:events';
import {
  type AuthStats,
  type Identity,
  type IdentityInput,
  type IdentityType,
  createEmptyStats,
  createIdentity,
  isIdentity,
  isIdentityType,
  isValidId,
  normalizeRoles,
  cloneMetadata,
  assertIdentity,
  nowMs,
} from './types.js';

/** Version tag embedded in {@link IdentityStore.toJSON} output. */
export const IDENTITY_STORE_SCHEMA_VERSION = 1;

/** Events emitted by {@link IdentityStore}: `register`, `unregister`, `update`. */
export interface IdentityStoreEvents {
  /** Emitted when an identity is (re)registered; payload is the stored identity. */
  register: Identity;
  /** Emitted when an identity is removed; payload is the removed identity. */
  unregister: Identity;
  /** Emitted after any mutation to an existing identity; payload is the new state. */
  update: Identity;
}

/**
 * Options accepted by the {@link IdentityStore} constructor.
 */
export interface IdentityStoreOptions {
  /** Initial identities to seed the registry with. */
  initial?: readonly Identity[];
  /** Clock provider (injectable for deterministic tests). */
  now?: () => number;
}

/** Serialized shape produced by {@link IdentityStore.toJSON}. */
export interface IdentityStoreSnapshot {
  schemaVersion: number;
  identities: Identity[];
}

/**
 * An in-memory registry of {@link Identity} records.
 *
 * Responsibilities:
 *  - register / unregister identities under a stable id
 *  - point lookup (`get`, `has`) and enumeration (`keys`, `values`, `entries`)
 *  - filtered views (`listByRole`, `listByType`, `findByName`)
 *  - liveness management (`activate`, `deactivate`)
 *  - statistics (`size`, `stats`)
 *  - persistence round-trip (`toJSON`, `fromJSON`)
 *
 * Change notifications are delivered through an {@link EventEmitter} so that
 * indexes and lifecycle components can stay in sync without polling.
 */
export class IdentityStore {
  private readonly identities: Map<string, Identity> = new Map();
  private readonly events: EventEmitter;
  private readonly now: () => number;
  private registered: number;
  private removed: number;

  /**
   * @param options Initialization options (seed data, clock).
   */
  constructor(options: IdentityStoreOptions = {}) {
    this.events = new EventEmitter();
    this.events.setMaxListeners(0);
    this.now = options.now ?? nowMs;
    this.registered = 0;
    this.removed = 0;
    if (options.initial) {
      for (const identity of options.initial) {
        this.registerIdentity(identity);
      }
    }
  }

  /**
   * Subscribes to a store event. Returns an unsubscribe function for easy
   * cleanup with event-driven indexes.
   *
   * @param event Event name (`register`, `unregister` or `update`).
   * @param listener Callback invoked with the affected identity.
   * @returns A function that removes the listener when called.
   */
  on(event: keyof IdentityStoreEvents, listener: (identity: Identity) => void): () => void {
    this.events.on(event, listener);
    return () => {
      this.events.off(event, listener);
    };
  }

  /**
   * Registers an identity, replacing any previous record with the same id.
   * Emits `register` on first insertion and `update` on replacement.
   *
   * @param input A full identity or a partial input to be normalized.
   * @returns The stored, frozen identity.
   */
  registerIdentity(input: Identity | IdentityInput): Identity {
    const identity = isIdentity(input) ? input : createIdentity(input);
    if (!isValidId(identity.id)) {
      throw new TypeError('Identity id must be a non-empty string');
    }
    const existing = this.identities.get(identity.id);
    const normalized: Identity = Object.freeze({
      ...identity,
      roles: normalizeRoles(identity.roles),
      metadata: cloneMetadata(identity.metadata),
    });
    this.identities.set(identity.id, normalized);
    if (existing) {
      this.registered += 1;
      this.events.emit('update', normalized);
    } else {
      this.registered += 1;
      this.events.emit('register', normalized);
    }
    return normalized;
  }

  /**
   * Alias for {@link IdentityStore.registerIdentity} kept for ergonomics with
   * the generic "register" vocabulary used across the auth engine.
   *
   * @param input Identity or input to register.
   * @returns The stored identity.
   */
  register(input: Identity | IdentityInput): Identity {
    return this.registerIdentity(input);
  }

  /**
   * Removes an identity by id. Missing ids are a no-op returning `false`.
   * Emits `unregister` with the removed record when one existed.
   *
   * @param id Identity id to remove.
   * @returns `true` when an identity was actually removed.
   */
  removeIdentity(id: string): boolean {
    if (!isValidId(id)) return false;
    const existing = this.identities.get(id);
    if (!existing) return false;
    this.identities.delete(id);
    this.removed += 1;
    this.events.emit('unregister', existing);
    return true;
  }

  /** Alias for {@link IdentityStore.removeIdentity}. */
  unregister(id: string): boolean {
    return this.removeIdentity(id);
  }

  /** Alias for {@link IdentityStore.removeIdentity}. */
  unregisterIdentity(id: string): boolean {
    return this.removeIdentity(id);
  }

  /**
   * Fetches an identity by id.
   *
   * @param id Identity id.
   * @returns The stored identity, or `undefined` when absent.
   */
  get(id: string): Identity | undefined {
    if (!isValidId(id)) return undefined;
    return this.identities.get(id);
  }

  /**
   * Returns whether an identity id is present.
   *
   * @param id Identity id.
   * @returns `true` when the registry contains the id.
   */
  has(id: string): boolean {
    return this.get(id) !== undefined;
  }

  /**
   * Returns all identity ids currently registered (order not guaranteed).
   *
   * @returns An array of identity ids.
   */
  keys(): string[] {
    return Array.from(this.identities.keys());
  }

  /**
   * Returns all stored identity records.
   *
   * @returns An array of stored identities.
   */
  values(): Identity[] {
    return Array.from(this.identities.values());
  }

  /**
   * Returns `[id, identity]` tuples for every registered identity.
   *
   * @returns An array of id/identity entry pairs.
   */
  entries(): Array<[string, Identity]> {
    return Array.from(this.identities.entries());
  }

  /**
   * Returns the number of registered identities.
   *
   * @returns Registry cardinality.
   */
  size(): number {
    return this.identities.size;
  }

  /**
   * Clears every identity from the registry, emitting `unregister` for each.
   *
   * @returns The number of identities removed.
   */
  clear(): number {
    const removed = this.identities.size;
    for (const identity of this.identities.values()) {
      this.removed += 1;
      this.events.emit('unregister', identity);
    }
    this.identities.clear();
    return removed;
  }

  /**
   * Lists every identity carrying the given role.
   *
   * @param role Role label to match (exact match, trimmed).
   * @returns Array of matching identities (empty when none).
   */
  listByRole(role: string): Identity[] {
    const normalized = typeof role === 'string' ? role.trim() : '';
    if (normalized.length === 0) return [];
    const out: Identity[] = [];
    for (const identity of this.identities.values()) {
      if (identity.roles.includes(normalized)) out.push(identity);
    }
    return out;
  }

  /**
   * Lists every identity of the given type.
   *
   * @param type Identity type to filter by.
   * @returns Array of matching identities (empty when none).
   */
  listByType(type: IdentityType): Identity[] {
    if (!isIdentityType(type)) return [];
    const out: Identity[] = [];
    for (const identity of this.identities.values()) {
      if (identity.type === type) out.push(identity);
    }
    return out;
  }

  /**
   * Finds an identity by exact display name.
   *
   * @param name Display name to match (case-sensitive).
   * @returns The first matching identity, or `undefined`.
   */
  findByName(name: string): Identity | undefined {
    if (typeof name !== 'string') return undefined;
    for (const identity of this.identities.values()) {
      if (identity.name === name) return identity;
    }
    return undefined;
  }

  /**
   * Lists identities currently flagged active.
   *
   * @returns Array of active identities.
   */
  listActive(): Identity[] {
    const out: Identity[] = [];
    for (const identity of this.identities.values()) {
      if (identity.active !== false) out.push(identity);
    }
    return out;
  }

  /**
   * Lists identities currently flagged inactive.
   *
   * @returns Array of inactive identities.
   */
  listInactive(): Identity[] {
    const out: Identity[] = [];
    for (const identity of this.identities.values()) {
      if (identity.active === false) out.push(identity);
    }
    return out;
  }

  /**
   * Applies a partial patch to an existing identity, preserving all unpatched
   * fields. Roles are normalized and metadata is cloned on write.
   *
   * @param id Identity id to patch.
   * @param patch Partial identity fields to merge.
   * @returns The updated identity, or `undefined` when the id is absent.
   */
  updateIdentity(id: string, patch: Partial<Omit<Identity, 'id' | 'createdAt'>>): Identity | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    const next: Identity = Object.freeze({
      ...existing,
      ...patch,
      id: existing.id,
      createdAt: existing.createdAt,
      roles: patch.roles !== undefined ? normalizeRoles(patch.roles) : existing.roles,
      metadata: patch.metadata !== undefined ? cloneMetadata(patch.metadata) : existing.metadata,
      active: patch.active !== undefined ? patch.active : existing.active,
    });
    this.identities.set(id, next);
    this.registered += 1;
    this.events.emit('update', next);
    return next;
  }

  /**
   * Marks an identity active (usable). No-op when the id is absent.
   *
   * @param id Identity id.
   * @returns The updated identity, or `undefined` when absent.
   */
  activate(id: string): Identity | undefined {
    return this.updateIdentity(id, { active: true });
  }

  /**
   * Marks an identity inactive (suspended). No-op when the id is absent.
   *
   * @param id Identity id.
   * @returns The updated identity, or `undefined` when absent.
   */
  deactivate(id: string): Identity | undefined {
    return this.updateIdentity(id, { active: false });
  }

  /**
   * Grants one or more roles to an identity (deduplicated).
   *
   * @param id Identity id.
   * @param roles Roles to add.
   * @returns The updated identity, or `undefined` when absent.
   */
  addRoles(id: string, roles: readonly string[]): Identity | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    const merged = Array.from(new Set([...existing.roles, ...normalizeRoles(roles)]));
    return this.updateIdentity(id, { roles: merged });
  }

  /**
   * Removes one or more roles from an identity.
   *
   * @param id Identity id.
   * @param roles Roles to remove.
   * @returns The updated identity, or `undefined` when absent.
   */
  removeRoles(id: string, roles: readonly string[]): Identity | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    const removed = new Set(roles);
    const kept = existing.roles.filter((role) => !removed.has(role));
    return this.updateIdentity(id, { roles: kept });
  }

  /**
   * Computes a snapshot of registry health useful for metrics and dashboards.
   *
   * @param base Optional starting stats to merge into.
   * @returns A fresh {@link AuthStats} object describing this store.
   */
  stats(base: AuthStats = createEmptyStats()): AuthStats {
    let active = 0;
    for (const identity of this.identities.values()) {
      if (identity.active !== false) active += 1;
    }
    return {
      ...base,
      identities: this.identities.size,
      activeIdentities: active,
    };
  }

  /**
   * Serializes the full registry to a versioned, JSON-safe snapshot. Identity
   * records are written as plain objects (frozen wrappers are stripped).
   *
   * @returns A plain snapshot object safe for `JSON.stringify`.
   */
  toJSON(): IdentityStoreSnapshot {
    return {
      schemaVersion: IDENTITY_STORE_SCHEMA_VERSION,
      identities: Array.from(this.identities.values()).map((identity) => ({
        id: identity.id,
        name: identity.name,
        type: identity.type,
        roles: Array.from(identity.roles),
        active: identity.active,
        metadata: cloneMetadata(identity.metadata),
        createdAt: identity.createdAt,
      })),
    };
  }

  /**
   * Replaces the entire registry with the contents of a snapshot produced by
   * {@link IdentityStore.toJSON} (or any structurally compatible object).
   *
   * @param snapshot Serialized registry data.
   * @returns The number of identities loaded.
   */
  fromJSON(snapshot: unknown): number {
    if (!isIdentityStoreSnapshot(snapshot)) {
      throw new TypeError('Invalid identity store snapshot');
    }
    this.clear();
    let count = 0;
    for (const identity of snapshot.identities) {
      const validated = assertIdentity(identity, 'snapshot identity');
      const normalized = createIdentity(validated);
      this.identities.set(normalized.id, normalized);
      this.registered += 1;
      this.events.emit('register', normalized);
      count += 1;
    }
    return count;
  }

  /**
   * Performs a linear scan of the registry applying `predicate`; returns the
   * first match. Useful for ad-hoc queries not covered by the named accessors.
   *
   * @param predicate Predicate over identity records.
   * @returns The first matching identity, or `undefined`.
   */
  find(predicate: (identity: Identity) => boolean): Identity | undefined {
    for (const identity of this.identities.values()) {
      if (predicate(identity)) return identity;
    }
    return undefined;
  }

  /**
   * Returns an iterable of all identities for `for...of` consumption.
   *
   * @returns An iterator over stored identities.
   */
  [Symbol.iterator](): IterableIterator<Identity> {
    return this.identities.values();
  }

  /**
   * Lifetime counters exposed for audit: number of register/update writes and
   * number of removals since construction (or the last {@link clear}).
   *
   * @returns An object of write counters.
   */
  counters(): { registered: number; removed: number } {
    return { registered: this.registered, removed: this.removed };
  }
}

/**
 * Structural guard for {@link IdentityStoreSnapshot}.
 *
 * @param value Any runtime value.
 * @returns `true` when the value looks like a serialized identity registry.
 */
export function isIdentityStoreSnapshot(value: unknown): value is IdentityStoreSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== IDENTITY_STORE_SCHEMA_VERSION) return false;
  if (!Array.isArray(candidate.identities)) return false;
  return candidate.identities.every((entry) => assertIdentity(entry, 'snapshot entry') !== undefined);
}

/**
 * Convenience factory for a store pre-seeded from a snapshot.
 *
 * @param snapshot Serialized registry data.
 * @returns A configured {@link IdentityStore}.
 */
export function storeFromJSON(snapshot: unknown): IdentityStore {
  const store = new IdentityStore();
  store.fromJSON(snapshot);
  return store;
}