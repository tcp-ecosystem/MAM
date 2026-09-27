/**
 * In-memory implementation of the semantic store for the MAM Memory Engine.
 *
 * {@link SemanticStore} is the persistence heart of the semantic subsystem. It
 * owns a `Map<SemanticEntryId, SemanticEntry>` and provides the full lifecycle
 * for facts and knowledge:
 *
 * - **Store** a fact with {@link SemanticStore.put}, accepting a plain string
 *   plus an optional {@link SemanticEntryOptions} bag.
 * - **Read** entries with {@link SemanticStore.get}, {@link SemanticStore.getAll}
 *   and {@link SemanticStore.requireEntry}.
 * - **Mutate** a stored fact with {@link SemanticStore.update}.
 * - **Remove** entries with {@link SemanticStore.delete} and
 *   {@link SemanticStore.clear}.
 * - **Bulk-load** many facts at once with {@link SemanticStore.putMany}.
 * - **Inspect** the whole collection with {@link SemanticStore.size},
 *   {@link SemanticStore.keys} and {@link SemanticStore.stats}.
 * - **Persist / restore** the entire collection with
 *   {@link SemanticStore.toJSON} and {@link SemanticStore.fromJSON}.
 *
 * The store is a *plain in-memory* implementation: it imposes no filesystem,
 * network or database dependency, which keeps the semantic layer embeddable in
 * any Node process. For durability across restarts, callers periodically
 * serialise with {@link SemanticStore.toJSON} and restore with
 * {@link SemanticStore.fromJSON}.
 *
 * ## Normalisation guarantees
 *
 * - `fact` must be non-empty; whitespace is trimmed but otherwise preserved.
 * - Tags are lower-cased and deduplicated at record time when
 *   {@link SemanticConfig.normalizeTags} is enabled (the default).
 * - Confidence is clamped into `[0, 1]` and defaults to `1`.
 * - `createdAt`/`updatedAt` default to the store clock.
 * - Entries are stored as deep clones when {@link SemanticConfig.cloneEntries}
 *   is enabled (the default), so caller mutation cannot corrupt state.
 *
 * The store is deliberately *unaware* of the TF-IDF index: indexing is a
 * separate concern owned by {@link SemanticIndex}. Callers that want a fully
 * wired store should prefer {@link createSemanticAdapter} or
 * {@link KnowledgeBase}, which keep store and index consistent automatically.
 *
 * @packageDocumentation
 * @module semantic/store
 */

import type {
  Confidence,
  MutableSemanticEntry,
  SemanticConfig,
  SemanticEntry,
  SemanticEntryId,
  SemanticEntryOptions,
  SemanticMetadata,
  SemanticPatch,
  SemanticSnapshot,
  SemanticStats,
  Timestamp,
} from './types.js';

/**
 * Default configuration applied when the caller supplies none.
 *
 * These values are deliberately conservative: tagging is normalised, entries
 * are cloned to prevent external mutation, no size cap is imposed and the
 * default retrieval limit is 20.
 */
export const DEFAULT_SEMANTIC_CONFIG: Required<
  Pick<SemanticConfig, 'maxEntries' | 'vectorDim' | 'similarityThreshold' | 'normalizeTags' | 'cloneEntries' | 'defaultLimit'>
> = {
  maxEntries: 0,
  vectorDim: 0,
  similarityThreshold: 0.1,
  normalizeTags: true,
  cloneEntries: true,
  defaultLimit: 20,
};

/**
 * Monotonic counter backing {@link generateId}.
 *
 * The counter is combined with the current timestamp to produce identifiers
 * that are unique within a single process even when two calls happen within
 * the same millisecond.
 */
let idCounter = 0;

/**
 * Generate a reasonably unique entry id.
 *
 * The id embeds the current epoch-millisecond time, a monotonic counter and a
 * short random suffix. It is not guaranteed to be globally unique, but it is
 * collision-free within a single process, which is the guarantee the in-memory
 * store requires.
 *
 * @returns a string id of the form `sem-<time>-<counter>-<rand>`
 */
export function generateId(): SemanticEntryId {
  idCounter = (idCounter + 1) % 0xffffffff;
  const random = Math.floor(Math.random() * 0xffff)
    .toString(16)
    .padStart(4, '0');
  return `sem-${Date.now().toString(36)}-${idCounter.toString(36)}-${random}`;
}

/**
 * Deep-clone a plain JSON-serialisable value.
 *
 * Used internally to enforce the store's copy-on-write guarantee. Because all
 * entry fields are JSON-serialisable (fact strings, number arrays, tag
 * strings, metadata records), a JSON round-trip is sufficient and avoids any
 * dependency on `structuredClone`.
 *
 * @param value - the value to clone
 * @returns a structurally identical, independent copy
 */
export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Normalise a list of raw tags.
 *
 * Lower-cases each tag, trims surrounding whitespace, drops empty entries and
 * removes duplicates while preserving first-seen order.
 *
 * @param raw - the raw tags to normalise (may be `undefined`)
 * @param normalize - when `false`, tags are deduplicated but left verbatim
 * @returns a fresh, ordered array of distinct tags
 */
export function normalizeTags(raw: readonly string[] | undefined, normalize: boolean): string[] {
  if (!raw || raw.length === 0) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of raw) {
    const cleaned = String(tag).trim();
    const key = normalize ? cleaned.toLowerCase() : cleaned;
    if (key.length > 0 && !seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

/**
 * Clamp a raw confidence value into the `[0, 1]` range.
 *
 * Values outside the range are clamped; `undefined` defaults to `1` (a fresh
 * fact is treated as certainly true until evidence says otherwise).
 *
 * @param value - the raw confidence to normalise
 * @returns a confidence in `[0, 1]`
 */
export function normalizeConfidence(value: Confidence | undefined): Confidence {
  if (value === undefined) {
    return 1;
  }
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.min(1, Math.max(0, value));
}

/**
 * Canonical serialisable shape used by {@link SemanticStore.toJSON}.
 *
 * Persisting the store as a single object — rather than an array of entries —
 * gives the format room to grow (e.g. versioning) without breaking existing
 * dumps.
 */
export interface SemanticStoreSnapshot extends SemanticSnapshot {
  /** The entries held by the store, keyed by entry id. */
  readonly entries: Record<SemanticEntryId, SemanticEntry>;
}

/**
 * Fully-capable in-memory semantic store.
 *
 * See the module documentation for a high-level overview and the method
 * documentation for exact semantics. All methods are synchronous, so the store
 * is trivially embeddable; asynchronous durability is the caller's concern.
 */
export class SemanticStore {
  /** Backing map from entry id to the stored (cloned) entry. */
  private readonly entries = new Map<SemanticEntryId, SemanticEntry>();

  /** Configuration controlling normalisation, cloning and defaults. */
  private readonly config: Required<
    Pick<SemanticConfig, 'maxEntries' | 'vectorDim' | 'similarityThreshold' | 'normalizeTags' | 'cloneEntries' | 'defaultLimit'>
  > & Pick<SemanticConfig, 'now'>;

  /**
   * Construct an empty semantic store.
   *
   * @param config - optional tuning knobs; see {@link SemanticConfig}
   */
  constructor(config?: SemanticConfig) {
    this.config = {
      maxEntries: config?.maxEntries ?? DEFAULT_SEMANTIC_CONFIG.maxEntries,
      vectorDim: config?.vectorDim ?? DEFAULT_SEMANTIC_CONFIG.vectorDim,
      similarityThreshold:
        config?.similarityThreshold ?? DEFAULT_SEMANTIC_CONFIG.similarityThreshold,
      normalizeTags: config?.normalizeTags ?? DEFAULT_SEMANTIC_CONFIG.normalizeTags,
      cloneEntries: config?.cloneEntries ?? DEFAULT_SEMANTIC_CONFIG.cloneEntries,
      defaultLimit: config?.defaultLimit ?? DEFAULT_SEMANTIC_CONFIG.defaultLimit,
      now: config?.now ?? (() => Date.now()),
    };
  }

  /**
   * Return the configuration in effect for this store.
   *
   * The returned object is a plain, read-only projection of the internal
   * configuration so callers can inspect behaviour without mutating it.
   */
  get configSnapshot(): Readonly<SemanticConfig> {
    return { ...this.config };
  }

  /**
   * Coerce a raw entry (or builder view) into the canonical immutable form.
   *
   * Applies, in order: fact trimming with a non-empty guard; tag
   * normalisation; confidence clamping; timestamp defaulting to the store
   * clock; and optional deep cloning.
   *
   * @param entry - the raw entry to normalise
   * @returns the canonical entry ready for storage
   * @throws {Error} when `fact` is empty after trimming
   */
  normalizeEntry(entry: MutableSemanticEntry): SemanticEntry {
    const fact = String(entry.fact ?? '').trim();
    if (fact.length === 0) {
      throw new Error('SemanticStore: cannot store an entry with an empty fact');
    }
    const clock = this.config.now();
    const tags = normalizeTags(entry.tags, this.config.normalizeTags);
    const canonical: SemanticEntry = {
      id: entry.id,
      fact,
      subject: entry.subject,
      predicate: entry.predicate,
      object: entry.object,
      embedding: entry.embedding ? [...entry.embedding] : undefined,
      tags,
      source: entry.source,
      confidence: normalizeConfidence(entry.confidence),
      createdAt: entry.createdAt ?? clock,
      updatedAt: entry.updatedAt ?? clock,
    };
    return this.config.cloneEntries ? deepClone(canonical) : canonical;
  }

  /**
   * Store a fact, overwriting any existing entry with the same id.
   *
   * The fact text may be accompanied by an {@link SemanticEntryOptions} bag
   * that supplies the id, triple fields, embedding, tags, source, confidence
   * and timestamps. When no id is supplied one is generated with
   * {@link generateId}.
   *
   * @param fact - the fact text to store (must be non-empty)
   * @param opts - optional metadata, triple and id fields
   * @returns the canonical, stored {@link SemanticEntry}
   * @throws {Error} when `fact` is empty after trimming
   * @throws {Error} when the store is at `maxEntries` and `fact` is new
   */
  put(fact: string, opts?: SemanticEntryOptions): SemanticEntry {
    const id = opts?.id ?? generateId();
    const exists = this.entries.has(id);
    if (!exists && this.config.maxEntries > 0 && this.entries.size >= this.config.maxEntries) {
      throw new Error(
        `SemanticStore.put: store is at maxEntries=${this.config.maxEntries}; prune before adding more`,
      );
    }
    const entry = this.normalizeEntry({
      id,
      fact,
      subject: opts?.subject,
      predicate: opts?.predicate,
      object: opts?.object,
      embedding: opts?.embedding,
      tags: opts?.tags ? [...opts.tags] : undefined,
      source: opts?.source,
      confidence: opts?.confidence,
      createdAt: opts?.createdAt,
      updatedAt: opts?.updatedAt,
    });
    this.entries.set(entry.id, entry);
    return entry;
  }

  /**
   * Store a pre-built entry (or builder view), normalising it on the way in.
   *
   * Unlike {@link SemanticStore.put} this accepts a full entry object, which
   * is convenient when round-tripping persisted snapshots or merging records.
   * The caller-supplied id is always respected.
   *
   * @param entry - the entry to store
   * @returns the canonical, stored {@link SemanticEntry}
   * @throws {Error} when `entry.fact` is empty after trimming
   */
  putEntry(entry: MutableSemanticEntry | SemanticEntry): SemanticEntry {
    const stored = this.normalizeEntry(entry);
    this.entries.set(stored.id, stored);
    return stored;
  }

  /**
   * Store several facts in one call.
   *
   * Each element may be a plain fact string or a partial entry object. The
   * call is atomic with respect to validation: if any element fails
   * normalisation, nothing is stored.
   *
   * @param entries - the facts (or partial entries) to store
   * @returns the canonical, stored {@link SemanticEntry}s, in input order
   * @throws {Error} when any element's fact is empty after trimming
   */
  putMany(
    entries: ReadonlyArray<string | (Partial<MutableSemanticEntry> & { fact: string })>,
  ): SemanticEntry[] {
    const normalised: SemanticEntry[] = [];
    for (const raw of entries) {
      if (typeof raw === 'string') {
        normalised.push(this.normalizeEntry({ id: generateId(), fact: raw }));
      } else {
        normalised.push(
          this.normalizeEntry({
            id: raw.id ?? generateId(),
            fact: raw.fact,
            subject: raw.subject,
            predicate: raw.predicate,
            object: raw.object,
            embedding: raw.embedding,
            tags: raw.tags,
            source: raw.source,
            confidence: raw.confidence,
            createdAt: raw.createdAt,
            updatedAt: raw.updatedAt,
          }),
        );
      }
    }
    for (const entry of normalised) {
      this.entries.set(entry.id, entry);
    }
    return normalised;
  }

  /**
   * Retrieve the stored entry with the given id.
   *
   * @param id - the entry id to look up
   * @returns the stored {@link SemanticEntry}, or `undefined` when absent
   */
  get(id: SemanticEntryId): SemanticEntry | undefined {
    return this.entries.get(id);
  }

  /**
   * Retrieve the stored entry, throwing when it does not exist.
   *
   * Useful for callers that treat a missing entry as a hard invariant
   * violation rather than a soft `undefined` case.
   *
   * @param id - the entry id to look up
   * @returns the stored {@link SemanticEntry}
   * @throws {Error} when no entry with `id` exists
   */
  requireEntry(id: SemanticEntryId): SemanticEntry {
    const entry = this.entries.get(id);
    if (!entry) {
      throw new Error(`SemanticStore: unknown entry id "${id}"`);
    }
    return entry;
  }

  /**
   * Remove an entry from the store.
   *
   * @param id - the entry id to delete
   * @returns `true` when an entry was removed, `false` when it did not exist
   */
  delete(id: SemanticEntryId): boolean {
    return this.entries.delete(id);
  }

  /**
   * Whether an entry with the given id is currently stored.
   *
   * @param id - the entry id to test
   * @returns `true` when present
   */
  has(id: SemanticEntryId): boolean {
    return this.entries.has(id);
  }

  /**
   * All entry ids currently stored, in insertion order.
   *
   * The returned array is a fresh copy; mutating it does not affect the store.
   *
   * @returns an array of entry ids
   */
  keys(): SemanticEntryId[] {
    return Array.from(this.entries.keys());
  }

  /**
   * All entries currently stored, in insertion order.
   *
   * The returned array is a fresh copy; mutating it does not affect the store.
   * Each element is the live stored reference (read-only by convention).
   *
   * @returns an array of stored entries
   */
  getAll(): SemanticEntry[] {
    return Array.from(this.entries.values());
  }

  /**
   * Number of entries currently stored.
   *
   * @returns the entry count
   */
  size(): number {
    return this.entries.size;
  }

  /**
   * Remove every entry from the store.
   */
  clear(): void {
    this.entries.clear();
  }

  /**
   * Apply a partial update to a stored entry and persist the result.
   *
   * Only the fields present in the patch are changed; absent fields keep their
   * stored values. Tags are re-normalised through {@link normalizeTags}, the
   * fact is re-trimmed, and `updatedAt` is bumped to the store clock unless the
   * patch carries an explicit `updatedAt`. An `embedding` of `[]` clears the
   * stored embedding.
   *
   * @param id - the entry id to update
   * @param patch - partial fields to apply
   * @returns the updated entry
   * @throws {Error} when the entry does not exist or the patch empties `fact`
   */
  update(id: SemanticEntryId, patch: SemanticPatch): SemanticEntry {
    const entry = this.requireEntry(id);
    const merged: MutableSemanticEntry = {
      id: entry.id,
      fact: patch.fact !== undefined ? patch.fact : entry.fact,
      subject: patch.subject !== undefined ? patch.subject : entry.subject,
      predicate: patch.predicate !== undefined ? patch.predicate : entry.predicate,
      object: patch.object !== undefined ? patch.object : entry.object,
      embedding: patch.embedding !== undefined ? patch.embedding : entry.embedding,
      tags: patch.tags !== undefined ? [...patch.tags] : entry.tags ? [...entry.tags] : undefined,
      source: patch.source !== undefined ? patch.source : entry.source,
      confidence: patch.confidence !== undefined ? patch.confidence : entry.confidence,
      createdAt: entry.createdAt,
      updatedAt: patch.updatedAt !== undefined ? patch.updatedAt : this.config.now(),
    };
    const stored = this.normalizeEntry(merged);
    this.entries.set(id, stored);
    return stored;
  }

  /**
   * Compute aggregate statistics over the current store contents.
   *
   * The scan is O(n) over all entries; results are computed on demand rather
   * than cached. See {@link SemanticStats} for the shape.
   *
   * @returns a fresh {@link SemanticStats} snapshot
   */
  stats(): SemanticStats {
    const all = Array.from(this.entries.values());
    let taggedEntries = 0;
    let embedded = 0;
    const distinctTags = new Set<string>();
    const distinctSubjects = new Set<string>();
    const distinctPredicates = new Set<string>();
    const distinctObjects = new Set<string>();
    let confidenceSum = 0;
    let oldestAt: Timestamp | null = null;
    let newestAt: Timestamp | null = null;

    for (const entry of all) {
      if (entry.tags && entry.tags.length > 0) {
        taggedEntries += 1;
        for (const tag of entry.tags) {
          distinctTags.add(tag);
        }
      }
      if (entry.embedding && entry.embedding.length > 0) {
        embedded += 1;
      }
      if (entry.subject !== undefined) {
        distinctSubjects.add(entry.subject);
      }
      if (entry.predicate !== undefined) {
        distinctPredicates.add(entry.predicate);
      }
      if (entry.object !== undefined) {
        distinctObjects.add(entry.object);
      }
      confidenceSum += entry.confidence ?? 0;
      if (oldestAt === null || entry.createdAt < oldestAt) {
        oldestAt = entry.createdAt;
      }
      if (newestAt === null || entry.createdAt > newestAt) {
        newestAt = entry.createdAt;
      }
    }

    return {
      entries: all.length,
      taggedEntries,
      distinctTags: distinctTags.size,
      distinctSubjects: distinctSubjects.size,
      distinctPredicates: distinctPredicates.size,
      distinctObjects: distinctObjects.size,
      embedded,
      averageConfidence: all.length === 0 ? null : confidenceSum / all.length,
      oldestAt,
      newestAt,
    };
  }

  /**
   * Serialise the entire store to a plain JSON-safe object.
   *
   * The snapshot includes a format version and the entries keyed by id, so a
   * dumped store can be restored exactly with {@link SemanticStore.fromJSON}.
   *
   * @returns a {@link SemanticSnapshot} suitable for `JSON.stringify`
   */
  toJSON(): SemanticSnapshot {
    return {
      version: 1,
      entries: Object.fromEntries(this.entries),
      savedAt: this.config.now(),
    };
  }

  /**
   * Restore the store contents from a previously-produced snapshot.
   *
   * Existing contents are replaced wholesale. The snapshot is validated
   * minimally: it must carry `version: 1` and a non-null entries record.
   * Entries are re-normalised through {@link SemanticStore.normalizeEntry} so
   * that config changes between save and restore are honoured.
   *
   * @param snapshot - the snapshot to load (as produced by `toJSON`)
   * @returns the number of entries restored
   * @throws {Error} when the snapshot is malformed or has an unsupported version
   */
  fromJSON(snapshot: SemanticSnapshot | string): number {
    const parsed: SemanticSnapshot =
      typeof snapshot === 'string' ? (JSON.parse(snapshot) as SemanticSnapshot) : snapshot;
    if (!parsed || parsed.version !== 1 || !parsed.entries) {
      throw new Error(
        `SemanticStore.fromJSON: unsupported or malformed snapshot (version=${parsed?.version ?? '<missing>'})`,
      );
    }
    this.entries.clear();
    for (const [id, raw] of Object.entries(parsed.entries)) {
      this.entries.set(id, this.normalizeEntry({ ...raw, id }));
    }
    return this.entries.size;
  }

  /**
   * Create a store whose contents are populated from a JSON snapshot.
   *
   * Convenience factory equivalent to constructing an empty store and then
   * calling {@link SemanticStore.fromJSON}.
   *
   * @param snapshot - a snapshot object or JSON string as produced by `toJSON`
   * @param config - optional store configuration
   * @returns a configured, populated store
   */
  static fromJSON(snapshot: SemanticSnapshot | string, config?: SemanticConfig): SemanticStore {
    const store = new SemanticStore(config);
    store.fromJSON(snapshot);
    return store;
  }
}

/**
 * Convenience factory: build an empty, configured semantic store.
 *
 * @param config - optional store configuration
 * @returns a configured, empty store
 */
export function createStore(config?: SemanticConfig): SemanticStore {
  return new SemanticStore(config);
}

/**
 * Coerce an arbitrary value into metadata for the runtime adapter.
 *
 * Used by {@link SemanticRuntimeAdapter.set} to turn the optional metadata bag
 * passed through the {@link RuntimeMemory} contract into entry options.
 *
 * @param metadata - the raw metadata value
 * @returns a plain record safe to read tags/source/confidence from
 */
export function toSemanticMetadata(metadata: unknown): SemanticMetadata {
  if (!metadata || typeof metadata !== 'object') {
    return {};
  }
  return { ...(metadata as SemanticMetadata) };
}