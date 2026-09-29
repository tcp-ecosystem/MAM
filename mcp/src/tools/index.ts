/**
 * index.ts
 *
 * `ToolsIndex`: a fast, in-memory lookup index over registered MCP tools,
 * resources and prompts.
 *
 * While the {@link ToolsRegistry} is the authoritative store of primitive
 * *values*, it only supports direct keyed lookups (one key per map). The
 * {@link ToolsIndex} trades a little memory for near-constant-time answers to
 * the questions MCP servers actually ask:
 *
 *   - *by kind*  — all tools, or all resources, or all prompts,
 *   - *by name*  — every entry whose name matches (a tool, a prompt, and/or
 *                  a resource whose human-readable name coincides),
 *   - *by uri*   — every entry addressing a given resource URI,
 *   - *by key*   — the canonical registry key for a given kind.
 *
 * The index stores lightweight {@link ToolsIndexEntry} records (kind, name,
 * optional URI, canonical key, indexed-at timestamp) — never the full primitive
 * values — so it can stay small even when a registry holds large schema
 * documents. It is designed to stay in lock-step with a registry: the lifecycle
 * layer calls {@link ToolsIndex.indexEntry} on registration and
 * {@link ToolsIndex.removeEntry} on unregistration. When a snapshot is
 * restored, {@link ToolsIndex.rebuild} reconstructs every structure in a single
 * pass.
 *
 * This module depends only on the shared `types.ts`, keeping it embeddable in
 * servers, proxies, test harnesses and diagnostic tools alike.
 *
 * @module tools/index
 */

import {
  TOOL_KINDS,
  isPlainObject,
  isToolKind,
  type ToolKind,
} from './types.js';

/**
 * The version tag written into {@link ToolsIndexJSON} payloads. Bump this
 * whenever the serialized shape changes so older snapshots can be migrated.
 */
export const INDEX_JSON_VERSION = 1 as const;

/**
 * A lightweight entry in the tools index.
 *
 * The entry intentionally references the canonical key and names only; the
 * full primitive value lives in the registry and is resolved by the caller
 * through that key.
 */
export interface ToolsIndexEntry {
  /** The kind of the indexed primitive. */
  readonly kind: ToolKind;
  /** The human-readable name (tool/prompt name, or the resource name). */
  readonly name: string;
  /** The resource URI, present only for resource entries. */
  readonly uri?: string;
  /** The canonical registry key (name for tools/prompts, URI for resources). */
  readonly key: string;
  /** Epoch ms at which the entry was indexed. */
  readonly indexedAt: number;
}

/**
 * Serializable snapshot of an index, produced by {@link ToolsIndex.toJSON} and
 * consumed by {@link ToolsIndex.fromJSON}.
 */
export interface ToolsIndexJSON {
  /** Schema version of this snapshot. */
  readonly version: typeof INDEX_JSON_VERSION;
  /** The indexed entries, keyed by canonical key. */
  readonly entries: Readonly<Record<string, ToolsIndexEntry>>;
}

/**
 * Aggregate statistics describing the current contents of an index.
 */
export interface ToolsIndexStats {
  /** Total number of indexed entries. */
  readonly total: number;
  /** Number of indexed tool entries. */
  readonly tools: number;
  /** Number of indexed resource entries. */
  readonly resources: number;
  /** Number of indexed prompt entries. */
  readonly prompts: number;
  /** Number of distinct names present in the index. */
  readonly uniqueNames: number;
  /** Number of distinct resource URIs present in the index. */
  readonly uniqueUris: number;
  /** Per-kind entry counts. */
  readonly byKind: Readonly<Record<ToolKind, number>>;
  /** Epoch ms of the most recent index mutation, or `undefined` when empty. */
  readonly lastIndexedAt?: number;
}

/**
 * Build a {@link ToolsIndexEntry} for a primitive descriptor.
 *
 * @param kind - the kind of the primitive.
 * @param name - the human-readable name.
 * @param uri - the resource URI (resources only).
 * @param now - the timestamp to stamp (defaults to `Date.now()`).
 * @returns a complete index entry.
 */
export function toToolsIndexEntry(
  kind: ToolKind,
  name: string,
  uri?: string,
  now: number = Date.now(),
): ToolsIndexEntry {
  return { kind, name, uri, key: kind === 'resource' && uri !== undefined ? uri : name, indexedAt: now };
}

/**
 * Fast lookup index over registered MCP primitives.
 *
 * Internally every inverted structure maps a key to a `Set<string>` of
 * canonical registry keys. All query methods return entries in the order their
 * canonical keys were first indexed, so results stay deterministic.
 */
export class ToolsIndex {
  /** Canonical key -> entry. The authoritative record for every indexed item. */
  private readonly _byKey = new Map<string, ToolsIndexEntry>();
  /** Kind -> canonical keys of entries of that kind. */
  private readonly _byKind = new Map<ToolKind, Set<string>>();
  /** Name -> canonical keys of entries carrying that name. */
  private readonly _byName = new Map<string, Set<string>>();
  /** Resource URI -> canonical keys of entries addressing that URI. */
  private readonly _byUri = new Map<string, Set<string>>();

  /**
   * Create an empty index, optionally seeding it from existing entries or a
   * previous snapshot.
   *
   * @param initial - either an iterable of index entries or a full
   *   {@link ToolsIndexJSON} snapshot. When omitted the index starts empty.
   */
  constructor(initial?: Iterable<ToolsIndexEntry> | ToolsIndexJSON) {
    if (initial === undefined) {
      return;
    }
    if (isToolsIndexJSON(initial)) {
      this.rebuild(Object.values(initial.entries));
      return;
    }
    this.rebuild(initial);
  }

  /**
   * Index a single entry under its canonical key. Any previous entry for the
   * same key is replaced (all inverted maps are cleaned up first).
   *
   * @param entry - the entry to index.
   * @returns `this` for chaining.
   * @throws {@link TypeError} when the entry is malformed.
   */
  indexEntry(entry: ToolsIndexEntry): this {
    if (!isToolsIndexEntry(entry)) {
      throw new TypeError('ToolsIndex: indexEntry requires a well-formed ToolsIndexEntry');
    }
    if (this._byKey.has(entry.key)) {
      this._removeKey(entry.key);
    }
    this._byKey.set(entry.key, entry);
    this._addToSet(this._byKind, entry.kind, entry.key);
    this._addToSet(this._byName, entry.name, entry.key);
    if (entry.uri !== undefined) {
      this._addToSet(this._byUri, entry.uri, entry.key);
    }
    return this;
  }

  /**
   * Remove the entry indexed under a canonical key for the given kind. The
   * kind is used as a consistency hint; when the key is not indexed at all,
   * `false` is returned.
   *
   * @param kind - the expected kind of the entry (unused for lookup, kept for
   *   an explicit API).
   * @param key - the canonical key to evict.
   * @returns `true` when an entry was actually removed.
   */
  removeEntry(kind: ToolKind, key: string): boolean {
    void kind;
    return this._removeKey(key);
  }

  /**
   * Remove an entry by canonical key alone, regardless of kind.
   *
   * @param key - the canonical key to evict.
   * @returns `true` when an entry was actually removed.
   */
  removeByKey(key: string): boolean {
    return this._removeKey(key);
  }

  /**
   * Remove every entry of one kind.
   *
   * @param kind - the kind to evict.
   * @returns the number of removed entries.
   */
  removeByKind(kind: ToolKind): number {
    if (!isToolKind(kind)) {
      throw new TypeError(`ToolsIndex: unknown kind "${String(kind)}"`);
    }
    const keys = this._byKind.get(kind);
    if (keys === undefined) {
      return 0;
    }
    let removed = 0;
    for (const key of [...keys]) {
      if (this._removeKey(key)) {
        removed += 1;
      }
    }
    return removed;
  }

  /**
   * Look up the entry indexed under a canonical key.
   *
   * @param key - the canonical registry key.
   * @returns the indexed entry, or `undefined` when absent.
   */
  get(key: string): ToolsIndexEntry | undefined {
    return this._byKey.get(key);
  }

  /**
   * Look up an entry by kind and canonical key.
   *
   * @param kind - the expected kind.
   * @param key - the canonical registry key.
   * @returns the indexed entry, or `undefined` when absent.
   */
  getByKind(kind: ToolKind, key: string): ToolsIndexEntry | undefined {
    const entry = this._byKey.get(key);
    return entry !== undefined && entry.kind === kind ? entry : undefined;
  }

  /**
   * Whether a canonical key is currently indexed.
   *
   * @param key - the canonical registry key.
   * @returns `true` when the key is present.
   */
  hasKey(key: string): boolean {
    return this._byKey.has(key);
  }

  /**
   * Whether an entry of the given kind and canonical key is indexed.
   *
   * @param kind - the kind to check.
   * @param key - the canonical registry key.
   * @returns `true` when a matching entry is present.
   */
  has(kind: ToolKind, key: string): boolean {
    const entry = this._byKey.get(key);
    return entry !== undefined && entry.kind === kind;
  }

  /**
   * Return every entry of a given kind, in first-indexed order.
   *
   * @param kind - the {@link ToolKind} to filter by.
   * @returns matching entries.
   * @throws {@link TypeError} for an unknown kind.
   */
  findByKind(kind: ToolKind): ToolsIndexEntry[] {
    if (!isToolKind(kind)) {
      throw new TypeError(`ToolsIndex: unknown kind "${String(kind)}"`);
    }
    const keys = this._byKind.get(kind);
    return this._entriesForKeys(keys);
  }

  /**
   * Return every entry whose name matches, in first-indexed order. A name can
   * match across kinds (a tool, a prompt, and a resource sharing the name).
   *
   * @param name - the name to search for.
   * @returns matching entries.
   */
  findByName(name: string): ToolsIndexEntry[] {
    const keys = this._byName.get(name);
    return this._entriesForKeys(keys);
  }

  /**
   * Return every entry addressing a given resource URI, in first-indexed order.
   * Non-resource entries never appear here.
   *
   * @param uri - the resource URI to search for.
   * @returns matching resource entries.
   */
  findByUri(uri: string): ToolsIndexEntry[] {
    const keys = this._byUri.get(uri);
    return this._entriesForKeys(keys);
  }

  /**
   * Convenience: every indexed tool entry.
   *
   * @returns tool entries, first-indexed first.
   */
  findTools(): ToolsIndexEntry[] {
    return this.findByKind('tool');
  }

  /**
   * Convenience: every indexed resource entry.
   *
   * @returns resource entries, first-indexed first.
   */
  findResources(): ToolsIndexEntry[] {
    return this.findByKind('resource');
  }

  /**
   * Convenience: every indexed prompt entry.
   *
   * @returns prompt entries, first-indexed first.
   */
  findPrompts(): ToolsIndexEntry[] {
    return this.findByKind('prompt');
  }

  /**
   * Find the *first* indexed tool entry with the given name. Convenience for
   * the common "is there a tool called X?" query.
   *
   * @param name - the tool name.
   * @returns the first matching tool entry, or `undefined`.
   */
  findToolByName(name: string): ToolsIndexEntry | undefined {
    return this.findByName(name).find((entry) => entry.kind === 'tool');
  }

  /**
   * Find the *first* indexed resource entry with the given URI.
   *
   * @param uri - the resource URI.
   * @returns the first matching resource entry, or `undefined`.
   */
  findResourceByUri(uri: string): ToolsIndexEntry | undefined {
    return this.findByUri(uri).find((entry) => entry.kind === 'resource');
  }

  /**
   * Find the *first* indexed prompt entry with the given name.
   *
   * @param name - the prompt name.
   * @returns the first matching prompt entry, or `undefined`.
   */
  findPromptByName(name: string): ToolsIndexEntry | undefined {
    return this.findByName(name).find((entry) => entry.kind === 'prompt');
  }

  /**
   * Rebuild the whole index from an iterable of entries, discarding whatever
   * was indexed before. This is the O(n) restore path used after a registry
   * snapshot is loaded or a prune rewinds the registrations.
   *
   * @param entries - the entries to index, in any order.
   * @returns `this` for chaining.
   */
  rebuild(entries: Iterable<ToolsIndexEntry>): this {
    this.clear();
    for (const entry of entries) {
      this.indexEntry(entry);
    }
    return this;
  }

  /**
   * Drop every indexed entry.
   */
  clear(): void {
    this._byKey.clear();
    this._byKind.clear();
    this._byName.clear();
    this._byUri.clear();
  }

  /**
   * Number of currently indexed entries.
   *
   * @returns the index size.
   */
  size(): number {
    return this._byKey.size;
  }

  /**
   * Number of currently indexed entries of one kind.
   *
   * @param kind - the kind to count.
   * @returns the count for that kind.
   */
  sizeByKind(kind: ToolKind): number {
    return this._byKind.get(kind)?.size ?? 0;
  }

  /**
   * All canonical keys currently indexed, optionally restricted to one kind.
   *
   * @param kind - optional kind to restrict to.
   * @returns an array of canonical keys in first-indexed order.
   */
  keys(kind?: ToolKind): string[] {
    if (kind !== undefined && !isToolKind(kind)) {
      throw new TypeError(`ToolsIndex: unknown kind "${String(kind)}"`);
    }
    if (kind !== undefined) {
      const keys = this._byKind.get(kind);
      return keys === undefined ? [] : [...keys];
    }
    return [...this._byKey.keys()];
  }

  /**
   * Every distinct name present in the index.
   *
   * @returns an array of names.
   */
  names(): string[] {
    return [...this._byName.keys()];
  }

  /**
   * Every distinct resource URI present in the index.
   *
   * @returns an array of URIs.
   */
  uris(): string[] {
    return [...this._byUri.keys()];
  }

  /**
   * Compute aggregate statistics about the index contents.
   *
   * @returns a {@link ToolsIndexStats} snapshot.
   */
  stats(): ToolsIndexStats {
    let lastIndexedAt: number | undefined;
    for (const entry of this._byKey.values()) {
      if (lastIndexedAt === undefined || entry.indexedAt > lastIndexedAt) {
        lastIndexedAt = entry.indexedAt;
      }
    }
    return {
      total: this._byKey.size,
      tools: this.sizeByKind('tool'),
      resources: this.sizeByKind('resource'),
      prompts: this.sizeByKind('prompt'),
      uniqueNames: this._byName.size,
      uniqueUris: this._byUri.size,
      byKind: {
        tool: this.sizeByKind('tool'),
        resource: this.sizeByKind('resource'),
        prompt: this.sizeByKind('prompt'),
      },
      lastIndexedAt,
    };
  }

  /**
   * Serialize the index into a plain, JSON-serializable snapshot.
   *
   * @returns a snapshot with the indexed entries, keyed by canonical key.
   */
  toJSON(): ToolsIndexJSON {
    const entries: Record<string, ToolsIndexEntry> = {};
    for (const [key, entry] of this._byKey.entries()) {
      entries[key] = entry;
    }
    return { version: INDEX_JSON_VERSION, entries };
  }

  /**
   * Reconstruct an index from a snapshot produced by {@link ToolsIndex.toJSON}.
   *
   * @param snapshot - the snapshot to restore.
   * @returns a new index seeded with the snapshot's entries.
   */
  static fromJSON(snapshot: ToolsIndexJSON): ToolsIndex {
    return new ToolsIndex(snapshot);
  }

  /**
   * Reconstruct an index from a JSON string snapshot.
   *
   * @param text - the serialized snapshot.
   * @returns a new index seeded with the snapshot's entries.
   * @throws {@link TypeError} on invalid JSON or a malformed snapshot shape.
   */
  static fromJSONString(text: string): ToolsIndex {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new TypeError(`ToolsIndex: invalid snapshot JSON: ${(err as Error).message}`);
    }
    if (!isToolsIndexJSON(parsed)) {
      throw new TypeError('ToolsIndex: snapshot does not match the expected shape');
    }
    return new ToolsIndex(parsed);
  }

  /**
   * Serialize the index to a compact JSON string (see {@link ToolsIndex.toJSON}).
   *
   * @returns the serialized snapshot string.
   */
  toString(): string {
    return JSON.stringify(this.toJSON());
  }

  /**
   * Create an iterable view over all entries, first-indexed order.
   *
   * @returns an iterator over the indexed entries.
   */
  [Symbol.iterator](): Iterator<ToolsIndexEntry> {
    return this._byKey.values();
  }

  /**
   * Internal helper: resolve a `Set<string>` of canonical keys into ordered
   * entries, honouring first-indexed order.
   *
   * @param keys - the key set, or `undefined` when the lookup key is absent.
   * @returns matching entries.
   */
  private _entriesForKeys(keys: Set<string> | undefined): ToolsIndexEntry[] {
    if (keys === undefined || keys.size === 0) {
      return [];
    }
    const out: ToolsIndexEntry[] = [];
    for (const key of keys) {
      const entry = this._byKey.get(key);
      if (entry !== undefined) {
        out.push(entry);
      }
    }
    return out;
  }

  /**
   * Internal helper: insert a canonical key into a keyed set, creating the set
   * on first use.
   *
   * @param map - the inverted map to mutate.
   * @param key - the lookup key.
   * @param value - the canonical key to insert.
   */
  private _addToSet<K>(map: Map<K, Set<string>>, key: K, value: string): void {
    let set = map.get(key);
    if (set === undefined) {
      set = new Set<string>();
      map.set(key, set);
    }
    set.add(value);
  }

  /**
   * Internal helper: remove a canonical key from every inverted map and from
   * the authoritative map. Shared by `removeEntry` and `indexEntry` (upsert).
   *
   * @param key - the canonical key to evict.
   * @returns `true` when the key was present.
   */
  private _removeKey(key: string): boolean {
    const entry = this._byKey.get(key);
    if (entry === undefined) {
      return false;
    }
    this._removeFromSet(this._byKind, entry.kind, key);
    this._removeFromSet(this._byName, entry.name, key);
    if (entry.uri !== undefined) {
      this._removeFromSet(this._byUri, entry.uri, key);
    }
    this._byKey.delete(key);
    return true;
  }

  /**
   * Internal helper: remove a canonical key from a keyed set, dropping the set
   * when it becomes empty.
   *
   * @param map - the inverted map to mutate.
   * @param key - the lookup key.
   * @param value - the canonical key to remove.
   */
  private _removeFromSet<K>(map: Map<K, Set<string>>, key: K, value: string): void {
    const set = map.get(key);
    if (set === undefined) {
      return;
    }
    set.delete(value);
    if (set.size === 0) {
      map.delete(key);
    }
  }
}

/**
 * Validate a kind string against the known {@link ToolKind} set. Useful for
 * parsing index statistics payloads.
 *
 * @param value - the value to inspect.
 * @returns `true` when `value` is a valid tool kind.
 */
export function isValidToolKind(value: unknown): value is ToolKind {
  return isToolKind(value);
}

/**
 * Internal guard: does `value` satisfy the {@link ToolsIndexEntry} shape?
 *
 * @param value - the untrusted value to validate.
 * @returns `true` when the value looks like an index entry.
 */
function isToolsIndexEntry(value: unknown): value is ToolsIndexEntry {
  if (!isPlainObject(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (!isToolKind(record['kind'])) {
    return false;
  }
  if (typeof record['name'] !== 'string') {
    return false;
  }
  if (record['uri'] !== undefined && typeof record['uri'] !== 'string') {
    return false;
  }
  if (typeof record['key'] !== 'string') {
    return false;
  }
  if (typeof record['indexedAt'] !== 'number') {
    return false;
  }
  return true;
}

/**
 * Internal guard: does `value` satisfy the {@link ToolsIndexJSON} shape?
 *
 * @param value - the untrusted value to validate.
 * @returns `true` when the value looks like an index snapshot.
 */
function isToolsIndexJSON(value: unknown): value is ToolsIndexJSON {
  if (!isPlainObject(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record['version'] === INDEX_JSON_VERSION && isPlainObject(record['entries']);
}

/**
 * Compute the per-kind counts of an index without materializing a full
 * {@link ToolsIndexStats} object. Convenience for lightweight reporting.
 *
 * @param index - the index to inspect.
 * @returns a plain `kind -> count` map.
 */
export function countIndexedByKind(index: ToolsIndex): Record<ToolKind, number> {
  return { ...index.stats().byKind };
}

/**
 * Derive an iterable of {@link ToolsIndexEntry} records from a flat list of
 * primitives. Convenience for seeding an index directly from a registry's
 * {@link ToolsRegistry.list} output without manual construction.
 *
 * @param primitives - the primitives to describe (objects exposing `kind`,
 *   `name` and optionally `uri`).
 * @returns an array of index entries.
 */
export function entriesFromDescriptors(
  primitives: Iterable<{ readonly kind: ToolKind; readonly name: string; readonly uri?: string }>,
): ToolsIndexEntry[] {
  const now = Date.now();
  const out: ToolsIndexEntry[] = [];
  for (const descriptor of primitives) {
    out.push(toToolsIndexEntry(descriptor.kind, descriptor.name, descriptor.uri, now));
  }
  return out;
}

/**
 * The complete set of known index kinds. Re-exported here so index consumers do
 * not need to import from `types.ts` just to iterate kinds.
 */
export const INDEX_KINDS: readonly ToolKind[] = TOOL_KINDS;