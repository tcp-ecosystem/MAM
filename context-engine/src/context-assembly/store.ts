/**
 * ContextAssemblyStore — an in-memory, insertion-ordered part registry for
 * the Context Assembly layer of the standalone MAM Context Engine.
 *
 * The {@link ContextAssembler} (see `retrieval.ts`), the {@link AssemblyIndex}
 * (see `index.ts`) and the {@link ContextPipeline} (see `integration.ts`) all
 * need a reliable place to keep {@link ContextPart}s between assembly passes.
 * This module provides that place without any external storage dependency:
 *
 * - `add` / `get` / `has` / `delete` / `keys` / `clear` / `size` give the
 *   full map-like CRUD surface a caller expects from an in-memory store.
 * - `addMany` is the bulk operation that dominates real ingestion flows —
 *   persisting a whole batch of memory, knowledge or tool-result parts in one
 *   call.
 * - `byRole`, `bySource` and `findByTags` support the role/source/tag-narrowed
 *   lookups that the index and the pipeline rely on, so a store alone is
 *   enough for simple callers that do not need a separate index.
 * - `update` merges a partial patch into an existing part without disturbing
 *   its neighbours.
 * - `toJSON` / `fromJSON` make the entire registry serialisable to a plain
 *   JSON snapshot and restorable later — used by persistence layers,
 *   hot-reload tooling and test fixtures.
 *
 * The store deliberately keeps **no ordering or budgeting intelligence**: it
 * is a dumb, reliable holder of {@link ContextPart} values. Ordering and token
 * budgeting happen in the {@link ContextAssembler}; the store stays simple
 * enough to audit and swap for a database-backed implementation without
 * disturbing the rest of the layer.
 *
 * {@link ContextPart} values are stored immutable (the interface is read-only)
 * so a part handed out by `get`/`all` can never be corrupted behind the
 * store's back. `add` copies the caller's input into a canonical
 * {@link ContextPart} via {@link ContextAssemblyStore.toPart}.
 *
 * @packageDocumentation
 * @module context-assembly/store
 */

import { createPart, estimateTokens, isContextPart, normalizeRole } from './types.js';
import type {
  ContextPart,
  ContextRole,
  PartId,
  PartInput,
  TagMode,
  Timestamp,
} from './types.js';

/**
 * Version tag written into {@link StoreSnapshot} values so future migrations
 * can detect incompatible snapshots produced by older releases.
 */
export const STORE_SNAPSHOT_VERSION = 1;

/**
 * A predicate-based narrowing description for {@link ContextAssemblyStore.find}.
 *
 * An empty filter (all fields undefined) matches every part. When `roles`,
 * `sources` and `tags` are all present they combine with an implicit AND;
 * tags themselves combine according to {@link StoreFilter.tagMode}.
 */
export interface StoreFilter {
  /**
   * Keep only parts whose `role` is one of these values.
   */
  readonly roles?: readonly ContextRole[];

  /**
   * Keep only parts whose `source` is one of these values.
   */
  readonly sources?: readonly string[];

  /**
   * Keep only parts carrying the given tags (see {@link StoreFilter.tagMode}).
   */
  readonly tags?: readonly string[];

  /**
   * `'all'` (default) requires every tag to be present; `'any'` accepts a
   * part that carries at least one of them.
   */
  readonly tagMode?: TagMode;

  /**
   * Keep only parts whose estimated tokens are `>=` this value.
   */
  readonly minTokens?: number;

  /**
   * Keep only parts whose estimated tokens are `<=` this value.
   */
  readonly maxTokens?: number;
}

/**
 * A JSON-serialisable snapshot of the whole store, as produced by
 * {@link ContextAssemblyStore.toJSON} and consumed by
 * {@link ContextAssemblyStore.fromJSON}.
 */
export interface StoreSnapshot {
  /**
   * Snapshot format version ({@link STORE_SNAPSHOT_VERSION}).
   */
  readonly version: number;

  /**
   * Epoch-ms time the snapshot was taken.
   */
  readonly createdAt: Timestamp;

  /**
   * All parts currently held by the store, in insertion order.
   */
  readonly parts: readonly ContextPart[];
}

/**
 * Aggregate, on-demand statistics describing a store's current contents.
 */
export interface StoreStats {
  /**
   * Number of parts currently held.
   */
  readonly parts: number;

  /**
   * Number of distinct roles represented by the held parts.
   */
  readonly roles: number;

  /**
   * Number of distinct source labels observed across all parts.
   */
  readonly sources: number;

  /**
   * Number of distinct tags observed across all parts.
   */
  readonly tags: number;

  /**
   * Total estimated tokens across all held parts.
   */
  readonly totalTokens: number;

  /**
   * Mean estimated tokens per part (`0` for an empty store).
   */
  readonly averageTokens: number;

  /**
   * Total length in code units of every part's content.
   */
  readonly totalContentLength: number;

  /**
   * Epoch-ms time the store was constructed.
   */
  readonly createdAt: Timestamp;
}

/**
 * A part predicate used by {@link ContextAssemblyStore.find}.
 */
export type PartPredicate = (part: ContextPart) => boolean;

/**
 * The canonical in-memory part registry.
 *
 * Backed by an insertion-ordered `Map`, so `keys()` and `all()` return parts
 * in the order they were added unless the caller reorders them. The store is
 * safe to use from a single thread and makes no network or file-system calls.
 *
 * @example
 * ```ts
 * const store = new ContextAssemblyStore();
 * store.add({ id: 'sys-1', role: 'system', content: 'Be concise.' });
 * store.addMany([
 *   { id: 'usr-1', role: 'user', content: 'Explain tokens.', tags: ['llm'] },
 * ]);
 * store.byRole('user').length; // 1
 * store.toJSON(); // { version: 1, createdAt: ..., parts: [...] }
 * ```
 */
export class ContextAssemblyStore {
  /**
   * Insertion-ordered backing map: partId → part.
   */
  private readonly registry = new Map<PartId, ContextPart>();

  /**
   * Wall-clock time the store was constructed (or the injected clock).
   */
  private readonly createdAt: Timestamp;

  /**
   * Clock used for all timestamps; injectable for deterministic tests.
   */
  private readonly now: () => Timestamp;

  /**
   * Construct a store, optionally seeding it from an iterable of inputs.
   *
   * @param initial - optional iterable of part inputs (or already-shaped
   *   {@link ContextPart}s) to seed the store with.
   * @param config - optional construction options; currently only the clock.
   */
  constructor(
    initial?: Iterable<PartInput | ContextPart>,
    config: { readonly now?: () => Timestamp } = {},
  ) {
    this.now = config.now ?? (() => Date.now());
    this.createdAt = this.now();
    if (initial) {
      for (const entry of initial) {
        this.add(entry);
      }
    }
  }

  /**
   * Structural type guard for part inputs.
   *
   * Checks only the three required fields so it tolerates partial records and
   * fully-formed {@link ContextPart}s alike.
   *
   * @param value - the value to test
   * @returns `true` when the value can be coerced to a part input
   */
  static isPartInput(value: unknown): value is PartInput | ContextPart {
    if (typeof value !== 'object' || value === null) {
      return false;
    }
    const record = value as Partial<PartInput>;
    return (
      typeof record.id === 'string' &&
      typeof record.content === 'string' &&
      typeof record.role === 'string'
    );
  }

  /**
   * Coerce a part input (or an already-shaped part) into a canonical
   * {@link ContextPart}.
   *
   * Fully-formed {@link ContextPart}s are returned as-is (they are already
   * canonical); raw inputs are canonicalised via {@link createPart}.
   *
   * @param input - the value to coerce
   * @returns a new, immutable {@link ContextPart}
   */
  static toPart(input: PartInput | ContextPart): ContextPart {
    if (isContextPart(input)) {
      return input;
    }
    return createPart(input as PartInput);
  }

  /**
   * Insert (or replace) a part in the store.
   *
   * @param input - the part to store; a new canonical part is derived from it,
   *   so later mutation of `input` cannot affect the store.
   * @returns the canonical part that was stored
   */
  add(input: PartInput | ContextPart): ContextPart {
    const part = ContextAssemblyStore.toPart(input);
    this.registry.set(part.id, part);
    return part;
  }

  /**
   * Insert (or replace) many parts in a single call.
   *
   * @param inputs - iterable of part inputs
   * @returns the number of parts stored
   */
  addMany(inputs: Iterable<PartInput | ContextPart>): number {
    let count = 0;
    for (const input of inputs) {
      this.add(input);
      count += 1;
    }
    return count;
  }

  /**
   * Fetch a part by id.
   *
   * @param partId - the part's unique identifier
   * @returns the stored part, or `undefined` when absent
   */
  get(partId: PartId): ContextPart | undefined {
    return this.registry.get(partId);
  }

  /**
   * Remove a part by id.
   *
   * @param partId - the part's unique identifier
   * @returns `true` when a part was removed, `false` when it was absent
   */
  delete(partId: PartId): boolean {
    return this.registry.delete(partId);
  }

  /**
   * Test whether a part id is present.
   *
   * @param partId - the part's unique identifier
   * @returns `true` when the store holds a part with this id
   */
  has(partId: PartId): boolean {
    return this.registry.has(partId);
  }

  /**
   * Return all part ids, in insertion order.
   *
   * @returns a fresh array of part ids
   */
  keys(): PartId[] {
    return [...this.registry.keys()];
  }

  /**
   * Remove every part from the store.
   */
  clear(): void {
    this.registry.clear();
  }

  /**
   * Number of parts currently held.
   */
  get size(): number {
    return this.registry.size;
  }

  /**
   * A store is empty when it holds no parts.
   *
   * @returns `true` when `size === 0`
   */
  get isEmpty(): boolean {
    return this.registry.size === 0;
  }

  /**
   * All parts, in insertion order, as a fresh array.
   *
   * @returns a shallow copy of the store's contents
   */
  all(): ContextPart[] {
    return [...this.registry.values()];
  }

  /**
   * Fetch every part with a given role, in insertion order.
   *
   * @param role - the role to match
   * @returns matching parts (possibly empty)
   */
  byRole(role: ContextRole): ContextPart[] {
    const matches: ContextPart[] = [];
    for (const part of this.registry.values()) {
      if (part.role === role) {
        matches.push(part);
      }
    }
    return matches;
  }

  /**
   * Fetch every part with a given source label, in insertion order.
   *
   * @param source - the source label to match (e.g. a file or tool name)
   * @returns matching parts (possibly empty)
   */
  bySource(source: string): ContextPart[] {
    const matches: ContextPart[] = [];
    for (const part of this.registry.values()) {
      if (part.source === source) {
        matches.push(part);
      }
    }
    return matches;
  }

  /**
   * Return every part carrying a specific tag.
   *
   * @param tag - the tag to search for
   * @returns matching parts
   */
  findByTag(tag: string): ContextPart[] {
    const matches: ContextPart[] = [];
    for (const part of this.registry.values()) {
      if (part.tags?.includes(tag)) {
        matches.push(part);
      }
    }
    return matches;
  }

  /**
   * Return every part carrying the given tags, in insertion order.
   *
   * @param tags - the tags to match
   * @param mode - `'all'` (default) requires every tag; `'any'` accepts one
   * @returns matching parts (possibly empty)
   */
  findByTags(tags: readonly string[], mode: TagMode = 'all'): ContextPart[] {
    if (tags.length === 0) {
      return [];
    }
    const wanted = new Set(tags);
    const matches: ContextPart[] = [];
    for (const part of this.registry.values()) {
      const partTags = new Set(part.tags ?? []);
      const matched =
        mode === 'all'
          ? [...wanted].every((tag) => partTags.has(tag))
          : [...wanted].some((tag) => partTags.has(tag));
      if (matched) {
        matches.push(part);
      }
    }
    return matches;
  }

  /**
   * Return parts satisfying an arbitrary predicate, in insertion order.
   *
   * @param predicate - a per-part test
   * @returns the matching parts
   */
  find(predicate: PartPredicate): ContextPart[] {
    const matches: ContextPart[] = [];
    for (const part of this.registry.values()) {
      if (predicate(part)) {
        matches.push(part);
      }
    }
    return matches;
  }

  /**
   * Narrow the store's contents by {@link StoreFilter}.
   *
   * `roles`, `sources`, `tags` and the token bounds combine with an implicit
   * AND. An empty filter returns every part.
   *
   * @param filter - the narrowing description (all fields optional)
   * @returns the matching parts, in insertion order
   */
  filter(filter: StoreFilter = {}): ContextPart[] {
    const tagMode = filter.tagMode ?? 'all';
    const tagSet =
      filter.tags && filter.tags.length > 0 ? new Set(filter.tags) : null;
    const roleSet = filter.roles && filter.roles.length > 0 ? new Set(filter.roles) : null;
    const sourceSet =
      filter.sources && filter.sources.length > 0 ? new Set(filter.sources) : null;
    const matches: ContextPart[] = [];
    for (const part of this.registry.values()) {
      if (roleSet && !roleSet.has(part.role)) {
        continue;
      }
      if (sourceSet && (part.source === undefined || !sourceSet.has(part.source))) {
        continue;
      }
      if (filter.minTokens !== undefined && (part.tokens ?? 0) < filter.minTokens) {
        continue;
      }
      if (filter.maxTokens !== undefined && (part.tokens ?? 0) > filter.maxTokens) {
        continue;
      }
      if (tagSet) {
        const partTags = new Set(part.tags ?? []);
        const matched =
          tagMode === 'all'
            ? [...tagSet].every((tag) => partTags.has(tag))
            : [...tagSet].some((tag) => partTags.has(tag));
        if (!matched) {
          continue;
        }
      }
      matches.push(part);
    }
    return matches;
  }

  /**
   * Merge a partial update into an existing part.
   *
   * Only the fields present on `patch` are replaced; the rest are preserved.
   * The role is normalised via {@link normalizeRole}; `tokens` and `order` are
   * passed through as numbers.
   *
   * @param partId - the part to update
   * @param patch - the fields to overwrite
   * @returns the updated part, or `undefined` when the id is unknown
   */
  update(
    partId: PartId,
    patch: Partial<Omit<PartInput, 'id' | 'role'>>,
  ): ContextPart | undefined {
    const current = this.registry.get(partId);
    if (!current) {
      return undefined;
    }
    const content = patch.content ?? current.content;
    const tokens =
      patch.tokens ??
      (patch.content !== undefined ? estimateTokens(content) : current.tokens);
    const updated: ContextPart = {
      id: current.id,
      role: current.role,
      content,
      tokens,
      source: patch.source !== undefined ? patch.source : current.source,
      tags: patch.tags !== undefined ? [...patch.tags] : current.tags,
      order: patch.order !== undefined ? patch.order : current.order,
      metadata:
        patch.metadata !== undefined ? { ...patch.metadata } : current.metadata,
    };
    this.registry.set(partId, updated);
    return updated;
  }

  /**
   * Iterate every part in insertion order.
   *
   * @param callback - invoked once per part
   */
  forEach(callback: (part: ContextPart, partId: PartId) => void): void {
    for (const [partId, part] of this.registry) {
      callback(part, partId);
    }
  }

  /**
   * Compute on-demand statistics about the store's current contents.
   *
   * @returns a {@link StoreStats} summary
   */
  stats(): StoreStats {
    const roles = new Set<ContextRole>();
    const sources = new Set<string>();
    const tags = new Set<string>();
    let totalTokens = 0;
    let totalContentLength = 0;
    for (const part of this.registry.values()) {
      roles.add(part.role);
      if (part.source !== undefined) {
        sources.add(part.source);
      }
      for (const tag of part.tags ?? []) {
        tags.add(tag);
      }
      totalTokens += part.tokens ?? 0;
      totalContentLength += part.content.length;
    }
    const count = this.registry.size;
    return {
      parts: count,
      roles: roles.size,
      sources: sources.size,
      tags: tags.size,
      totalTokens,
      averageTokens: count > 0 ? totalTokens / count : 0,
      totalContentLength,
      createdAt: this.createdAt,
    };
  }

  /**
   * Serialise the store into a plain JSON-safe {@link StoreSnapshot}.
   *
   * The snapshot contains a copy of every part, so it can be persisted and
   * later restored with {@link ContextAssemblyStore.fromJSON}.
   *
   * @returns the store's snapshot
   */
  toJSON(): StoreSnapshot {
    return {
      version: STORE_SNAPSHOT_VERSION,
      createdAt: this.createdAt,
      parts: this.all(),
    };
  }

  /**
   * Restore a store from a {@link StoreSnapshot}.
   *
   * @param snapshot - a snapshot produced by {@link ContextAssemblyStore.toJSON}
   *   (or shaped identically)
   * @param config - optional construction options (e.g. a custom clock)
   * @returns a new store populated with the snapshot's parts
   */
  static fromJSON(
    snapshot: StoreSnapshot,
    config: { readonly now?: () => Timestamp } = {},
  ): ContextAssemblyStore {
    const store = new ContextAssemblyStore(undefined, config);
    for (const part of snapshot.parts) {
      store.add(part);
    }
    return store;
  }

  /**
   * Convenience factory: build a store from an iterable of part inputs.
   *
   * Equivalent to `new ContextAssemblyStore(inputs)`.
   *
   * @param inputs - iterable of part inputs
   * @param config - optional construction options
   * @returns the seeded store
   */
  static from(
    inputs: Iterable<PartInput | ContextPart>,
    config: { readonly now?: () => Timestamp } = {},
  ): ContextAssemblyStore {
    return new ContextAssemblyStore(inputs, config);
  }

  /**
   * Human-readable summary of the store's contents, for logging.
   *
   * @returns e.g. `"ContextAssemblyStore(parts=12, roles=4)"`
   */
  inspect(): string {
    const stats = this.stats();
    return `ContextAssemblyStore(parts=${stats.parts}, roles=${stats.roles}, sources=${stats.sources})`;
  }
}