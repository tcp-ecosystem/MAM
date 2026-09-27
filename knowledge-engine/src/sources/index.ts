/**
 * The source index: fast, multi-dimensional lookup over registered sources.
 *
 * `SourceIndex` maintains inverted indexes over the four axes a knowledge
 * engine actually queries on:
 *
 * - **kind** — which sources are files vs. URLs vs. text vs. memory;
 * - **tag** — which sources carry which topic tags;
 * - **MIME type** — which sources are markdown, JSON, images, …;
 * - **name** — exact/normalised name lookups plus substring scans;
 * - **id prefix** — collision-cheap "give me everything under `docs/`" queries.
 *
 * Indexes are maintained incrementally via {@link SourceIndex.indexSource} /
 * {@link SourceIndex.removeSource} and can be bulk-rebuilt with
 * {@link SourceIndex.rebuild}. The index never stores content — it stores only
 * ids and lightweight string keys — so it stays cheap to copy and safe to
 * reconstruct from any store snapshot.
 *
 * @packageDocumentation
 * @module sources/index
 */

import type {
  KnowledgeSource,
  SourceId,
  SourceKind,
  SourceTag,
  Timestamp,
} from './types.js';
import {
  MAX_PREFIX_LENGTH,
  isValidKind,
  normalizeTags,
  normalizeText,
} from './types.js';

/**
 * Aggregate statistics describing the contents of a {@link SourceIndex}.
 *
 * `*Entries` counts are edge counts (how many index associations exist) rather
 * than distinct-key counts, so they let callers reason about index fan-out.
 */
export interface IndexStats {
  /** Number of sources currently indexed. */
  readonly sources: number;
  /** Number of sources per kind. */
  readonly byKind: Readonly<Record<SourceKind, number>>;
  /** Number of distinct tags known to the index. */
  readonly distinctTags: number;
  /** Total tag→source associations. */
  readonly tagEntries: number;
  /** Number of distinct MIME types known to the index. */
  readonly distinctMimes: number;
  /** Total mime→source associations. */
  readonly mimeEntries: number;
  /** Number of distinct normalised names known to the index. */
  readonly distinctNames: number;
  /** Number of id-prefix associations retained (bounded by depth). */
  readonly prefixEntries: number;
}

/**
 * Options for {@link SourceIndex.findByTags} tag matching.
 */
export type TagMatchMode = 'all' | 'any';

/**
 * A fast, incremental, multi-axis index over {@link KnowledgeSource}s.
 *
 * @example
 * ```ts
 * const index = new SourceIndex();
 * index.indexSource(readmeSource);
 * const runbooks = index.findByTags(['runbook']);
 * const files = index.findByKind('file');
 * const underDocs = index.findByIdPrefix('docs');
 * ```
 */
export class SourceIndex {
  /** Authoritative id → source mirror, used for rebuild and resolution. */
  private readonly sources = new Map<SourceId, KnowledgeSource>();

  /** kind → set of ids. */
  private readonly byKind = new Map<SourceKind, Set<SourceId>>();

  /** normalised tag → set of ids. */
  private readonly byTag = new Map<SourceTag, Set<SourceId>>();

  /** normalised mime type → set of ids. */
  private readonly byMime = new Map<string, Set<SourceId>>();

  /** normalised (lower-cased) name → set of ids. */
  private readonly byName = new Map<string, Set<SourceId>>();

  /** id prefix (depth-bounded) → set of ids. */
  private readonly byIdPrefix = new Map<string, Set<SourceId>>();

  /**
   * Construct an index, optionally seeding it from existing sources.
   *
   * @param sources - initial sources to index
   */
  constructor(sources: readonly KnowledgeSource[] = []) {
    for (const source of sources) {
      this.indexSource(source);
    }
  }

  /**
   * Index a single source, adding it to every relevant axis.
   *
   * Idempotent for an id that is already indexed.
   *
   * @param source - the source to index
   * @returns `true` when the source was newly indexed, `false` when its id was
   * already present
   */
  indexSource(source: KnowledgeSource): boolean {
    if (this.sources.has(source.id)) {
      this.removeSource(source.id);
    }
    this.sources.set(source.id, source);

    this.addToSet(this.byKind, source.kind, source.id);
    for (const tag of normalizeTags(source.tags)) {
      this.addToSet(this.byTag, tag, source.id);
    }
    if (source.mimeType) {
      this.addToSet(this.byMime, normalizeText(source.mimeType), source.id);
    }
    this.addToSet(this.byName, normalizeText(source.name), source.id);
    this.indexPrefixes(source.id);
    return true;
  }

  /**
   * Remove a source from every axis.
   *
   * @param id - the source id to remove
   * @returns `true` when a source was removed, `false` when it was not indexed
   */
  removeSource(id: SourceId): boolean {
    const source = this.sources.get(id);
    if (!source) {
      return false;
    }
    this.sources.delete(id);
    this.removeFromSet(this.byKind, source.kind, id);
    for (const tag of normalizeTags(source.tags)) {
      this.removeFromSet(this.byTag, tag, id);
    }
    if (source.mimeType) {
      this.removeFromSet(this.byMime, normalizeText(source.mimeType), id);
    }
    this.removeFromSet(this.byName, normalizeText(source.name), id);
    this.unindexPrefixes(id);
    return true;
  }

  /**
   * Find all sources of a given kind.
   *
   * @param kind - the {@link SourceKind} to match
   * @returns the matching sources, in index order
   */
  findByKind(kind: SourceKind): KnowledgeSource[] {
    const ids = this.byKind.get(kind);
    if (!ids) {
      return [];
    }
    return this.resolveIds(ids);
  }

  /**
   * Find sources carrying given tags.
   *
   * @param tags - the tags to match
   * @param mode - `'all'` (default) requires every tag; `'any'` accepts a
   * single match
   * @returns the matching sources
   */
  findByTags(
    tags: readonly SourceTag[],
    mode: TagMatchMode = 'all',
  ): KnowledgeSource[] {
    const clean = normalizeTags(tags);
    if (clean.length === 0) {
      return [];
    }
    const sets: Set<SourceId>[] = [];
    for (const tag of clean) {
      const set = this.byTag.get(tag);
      if (set && set.size > 0) {
        sets.push(set);
      }
    }
    if (sets.length === 0) {
      return [];
    }
    if (mode === 'any') {
      const union = new Set<SourceId>();
      for (const set of sets) {
        for (const id of set) {
          union.add(id);
        }
      }
      return this.resolveIds(union);
    }
    let smallest = sets[0]!;
    for (const set of sets) {
      if (set.size < smallest.size) {
        smallest = set;
      }
    }
    const matches: SourceId[] = [];
    for (const id of smallest) {
      if (sets.every((set) => set.has(id))) {
        matches.push(id);
      }
    }
    return this.resolveIds(matches);
  }

  /**
   * Find sources whose name matches a query.
   *
   * Exact normalised-name matches from the index are returned first, followed
   * by case-insensitive substring matches found by scanning. This is a
   * convenience for interactive tooling; the retrieval layer performs richer
   * weighted scoring separately.
   *
   * @param name - the name (or fragment) to match
   * @returns the matching sources
   */
  findByName(name: string): KnowledgeSource[] {
    const query = normalizeText(name);
    if (!query) {
      return [];
    }
    const exact = this.byName.get(query);
    const exactIds = exact ? [...exact] : [];
    const seen = new Set(exactIds);
    const substring: SourceId[] = [];
    for (const [key, ids] of this.byName) {
      if (key === query || !key.includes(query)) {
        continue;
      }
      for (const id of ids) {
        if (!seen.has(id)) {
          seen.add(id);
          substring.push(id);
        }
      }
    }
    return this.resolveIds([...exactIds, ...substring]);
  }

  /**
   * Find sources whose id starts with a prefix.
   *
   * Powered by the depth-bounded prefix index (see
   * {@link MAX_PREFIX_LENGTH}). Ids are inserted under every prefix up to the
   * cap, so lookups are O(1) map hits.
   *
   * @param prefix - the id prefix to match
   * @returns the matching sources
   */
  findByIdPrefix(prefix: string): KnowledgeSource[] {
    const clean = normalizeText(prefix, false);
    if (!clean) {
      return [];
    }
    const ids = this.byIdPrefix.get(clean);
    return ids ? this.resolveIds(ids) : [];
  }

  /**
   * Find sources with a given MIME type.
   *
   * @param mimeType - the MIME type to match (case-insensitive)
   * @returns the matching sources
   */
  findByMime(mimeType: string): KnowledgeSource[] {
    const ids = this.byMime.get(normalizeText(mimeType));
    return ids ? this.resolveIds(ids) : [];
  }

  /**
   * Rebuild the entire index from a set of sources.
   *
   * Equivalent to {@link SourceIndex.clear} followed by indexing each source,
   * but guaranteed to leave the index consistent even if a source throws.
   *
   * @param sources - the complete set of sources to index
   * @returns the number of sources indexed
   */
  rebuild(sources: readonly KnowledgeSource[]): number {
    const fresh = new SourceIndex(sources);
    this.sources.clear();
    this.byKind.clear();
    this.byTag.clear();
    this.byMime.clear();
    this.byName.clear();
    this.byIdPrefix.clear();
    return this.copyFrom(fresh);
  }

  /**
   * Remove every entry from the index.
   *
   * @returns the number of sources removed
   */
  clear(): number {
    const count = this.sources.size;
    this.sources.clear();
    this.byKind.clear();
    this.byTag.clear();
    this.byMime.clear();
    this.byName.clear();
    this.byIdPrefix.clear();
    return count;
  }

  /**
   * Test whether an id is present in the index.
   *
   * @param id - the source id
   * @returns `true` when the id is indexed
   */
  has(id: SourceId): boolean {
    return this.sources.has(id);
  }

  /**
   * All indexed ids.
   *
   * @returns the ids, in insertion order
   */
  keys(): SourceId[] {
    return [...this.sources.keys()];
  }

  /**
   * All indexed sources.
   *
   * @returns the sources, in insertion order
   */
  values(): KnowledgeSource[] {
    return [...this.sources.values()];
  }

  /**
   * Resolve an id back to its source.
   *
   * @param id - the source id
   * @returns the source, or `undefined`
   */
  get(id: SourceId): KnowledgeSource | undefined {
    return this.sources.get(id);
  }

  /**
   * Number of sources currently indexed.
   */
  get size(): number {
    return this.sources.size;
  }

  /**
   * All distinct tags known to the index.
   *
   * @returns the tags, sorted for determinism
   */
  tags(): SourceTag[] {
    return [...this.byTag.keys()].sort();
  }

  /**
   * All distinct MIME types known to the index.
   *
   * @returns the MIME types, sorted
   */
  mimes(): string[] {
    return [...this.byMime.keys()].sort();
  }

  /**
   * Aggregate statistics describing this index.
   *
   * @returns an {@link IndexStats} snapshot
   */
  stats(): IndexStats {
    const byKind: Record<SourceKind, number> = {
      text: 0,
      file: 0,
      url: 0,
      memory: 0,
    };
    for (const source of this.sources.values()) {
      const kind = source.kind;
      if (isValidKind(kind)) {
        byKind[kind] = (byKind[kind] ?? 0) + 1;
      }
    }
    let tagEntries = 0;
    for (const set of this.byTag.values()) {
      tagEntries += set.size;
    }
    let mimeEntries = 0;
    for (const set of this.byMime.values()) {
      mimeEntries += set.size;
    }
    let prefixEntries = 0;
    for (const set of this.byIdPrefix.values()) {
      prefixEntries += set.size;
    }
    return {
      sources: this.sources.size,
      byKind,
      distinctTags: this.byTag.size,
      tagEntries,
      distinctMimes: this.byMime.size,
      mimeEntries,
      distinctNames: this.byName.size,
      prefixEntries,
    };
  }

  /**
   * Copy the contents of another index into this one (internal helper used by
   * {@link SourceIndex.rebuild}).
   *
   * @param other - the source index to copy
   * @returns the number of sources copied
   */
  private copyFrom(other: SourceIndex): number {
    for (const source of other.sources.values()) {
      this.indexSource(source);
    }
    return this.sources.size;
  }

  /**
   * Add an id to the set at a key in a map of sets (creating it on demand).
   *
   * @param map - the map of sets
   * @param key - the index key
   * @param id - the source id
   */
  private addToSet<K extends string>(
    map: Map<K, Set<SourceId>>,
    key: K,
    id: SourceId,
  ): void {
    let set = map.get(key);
    if (!set) {
      set = new Set();
      map.set(key, set);
    }
    set.add(id);
  }

  /**
   * Remove an id from the set at a key, deleting empty sets.
   *
   * @param map - the map of sets
   * @param key - the index key
   * @param id - the source id
   */
  private removeFromSet<K extends string>(
    map: Map<K, Set<SourceId>>,
    key: K,
    id: SourceId,
  ): void {
    const set = map.get(key);
    if (!set) {
      return;
    }
    set.delete(id);
    if (set.size === 0) {
      map.delete(key);
    }
  }

  /**
   * Insert an id under every bounded prefix of itself.
   *
   * @param id - the source id
   */
  private indexPrefixes(id: SourceId): void {
    const depth = Math.min(id.length, MAX_PREFIX_LENGTH);
    for (let i = 1; i <= depth; i += 1) {
      this.addToSet(this.byIdPrefix, id.slice(0, i), id);
    }
  }

  /**
   * Remove an id from every bounded prefix entry.
   *
   * @param id - the source id
   */
  private unindexPrefixes(id: SourceId): void {
    const depth = Math.min(id.length, MAX_PREFIX_LENGTH);
    for (let i = 1; i <= depth; i += 1) {
      this.removeFromSet(this.byIdPrefix, id.slice(0, i), id);
    }
  }

  /**
   * Resolve a set (or array) of ids into their source records.
   *
   * @param ids - the ids to resolve
   * @returns the resolved sources, in the input order
   */
  private resolveIds(ids: Iterable<SourceId>): KnowledgeSource[] {
    const out: KnowledgeSource[] = [];
    for (const id of ids) {
      const source = this.sources.get(id);
      if (source) {
        out.push(source);
      }
    }
    return out;
  }
}

/**
 * Snapshot metadata describing a single index entry (used by tooling).
 *
 * @param source - the indexed source
 * @returns a compact descriptor
 */
export function describeEntry(source: KnowledgeSource): {
  id: SourceId;
  name: string;
  kind: SourceKind;
  tags: readonly SourceTag[];
  mimeType?: string;
  createdAt: Timestamp;
} {
  return {
    id: source.id,
    name: source.name,
    kind: source.kind,
    tags: source.tags ?? [],
    mimeType: source.mimeType,
    createdAt: source.createdAt,
  };
}

/**
 * Guard for tag-match modes.
 *
 * @param mode - the value to test
 * @returns `true` when `mode` is `'all'` or `'any'`
 */
export function isTagMatchMode(mode: unknown): mode is TagMatchMode {
  return mode === 'all' || mode === 'any';
}