/**
 * Tag/scope/text index for short-term memory entries.
 *
 * {@link ShortTermIndex} provides fast, denormalised lookups over a
 * {@link ShortTermStore} that would otherwise require a linear scan:
 *
 * - **Tag index** — every entry's tags are inverted into `tag → Set<id>` so
 *   {@link ShortTermIndex.findByTag} can answer "which entries carry at least
 *   one of these tags" in O(matched), not O(n).
 * - **Scope index** — every entry's scope is inverted into `scope → Set<id>`
 *   so {@link ShortTermIndex.findByScope} can isolate one logical partition
 *   without scanning the whole store.
 * - **Text index** — string values (and string metadata values) are
 *   normalised and stored per id so {@link ShortTermIndex.findByText} can do
 *   case-insensitive substring matching over all indexed payloads.
 *
 * ## Keeping the index in sync
 *
 * The index is a *denormalised view* of the store: it caches a reference to
 * each indexed {@link ShortTermEntry} and does not observe the store's
 * mutations by itself. Callers must keep it faithful:
 *
 * - after {@link ShortTermStore.put} / {@link ShortTermStore.update}, call
 *   {@link ShortTermIndex.indexEntry} with the returned entry;
 * - after {@link ShortTermStore.delete}, call {@link ShortTermIndex.removeEntry};
 * - after a prune or eviction that removes entries, call
 *   {@link ShortTermIndex.removeEntry} for each removed id (or
 *   {@link ShortTermIndex.rebuild} with the surviving entries).
 *
 * The runtime adapter in `integration.ts` and the lifecycle in `lifecycle.ts`
 * perform this synchronisation for you. Because the cache holds live entry
 * references, a full `rebuild` after a bulk prune is the cheapest way to
 * resynchronise at scale.
 *
 * @packageDocumentation
 * @module short-term/index
 */

import type {
  ShortTermEntry,
  ShortTermId,
  ShortTermIndexStats,
  ShortTermMetadata,
  ShortTermScope,
} from './types.js';

/**
 * Extract the searchable text from an entry's payload.
 *
 * Only plain strings are indexed: a string `value` is indexed verbatim, and
 * any metadata value that is itself a string is indexed as well. Non-string
 * values (objects, numbers, booleans, arrays) are deliberately excluded so
 * that indexing is cheap and deterministic; callers that want structured
 * payloads searchable must pass a text form as the value.
 *
 * @param value - the entry's value
 * @param metadata - the entry's metadata (optional)
 * @returns the concatenated, lower-cased searchable text, or `''` when nothing
 *   string-like is present
 */
export function extractText(value: unknown, metadata?: ShortTermMetadata): string {
  const parts: string[] = [];
  if (typeof value === 'string') {
    parts.push(value);
  }
  if (metadata) {
    for (const entry of Object.values(metadata)) {
      if (typeof entry === 'string') {
        parts.push(entry);
      }
    }
  }
  return parts.join('\n').toLowerCase();
}

/**
 * Normalise a search term for case-insensitive comparison.
 *
 * @param term - the raw term to normalise
 * @returns the lower-cased, trimmed term
 */
export function normalizeTerm(term: string): string {
  return term.trim().toLowerCase();
}

/**
 * Fully-capable tag/scope/text index.
 *
 * See the module documentation for the data model and the sync contract.
 * All methods are synchronous and side-effect free on the store.
 */
export class ShortTermIndex {
  /** Live entry cache, keyed by entry id. */
  private readonly cache = new Map<ShortTermId, ShortTermEntry>();

  /** Inverted tag index: tag → set of entry ids carrying that tag. */
  private readonly tags = new Map<string, Set<ShortTermId>>();

  /** Inverted scope index: scope → set of entry ids in that scope. */
  private readonly scopes = new Map<string, Set<ShortTermId>>();

  /** Text index: entry id → lower-cased searchable text. */
  private readonly text = new Map<ShortTermId, string>();

  /**
   * Construct an empty index.
   *
   * The index starts empty; populate it with {@link ShortTermIndex.indexEntry}
   * or {@link ShortTermIndex.rebuild}.
   */
  constructor() {}

  /**
   * Index a single entry under all of its tags, scope and text.
   *
   * The entry is cached by reference and every tag it carries is added to the
   * inverted tag index. Re-indexing an id that is already indexed replaces the
   * cached entry and refreshes its tag/scope/text membership, so callers can
   * call this after every put/update without first removing the old record.
   *
   * @param entry - the entry to index
   * @returns `true` when the entry was accepted, `false` when it carried
   *   nothing indexable (no tags, no scope, no text)
   */
  indexEntry(entry: ShortTermEntry): boolean {
    this.cache.set(entry.id, entry);
    let indexed = false;
    if (entry.tags) {
      for (const tag of entry.tags) {
        const bucket = this.tags.get(tag) ?? new Set<ShortTermId>();
        bucket.add(entry.id);
        this.tags.set(tag, bucket);
        indexed = true;
      }
    }
    if (entry.scope) {
      const bucket = this.scopes.get(entry.scope) ?? new Set<ShortTermId>();
      bucket.add(entry.id);
      this.scopes.set(entry.scope, bucket);
      indexed = true;
    }
    const text = extractText(entry.value, entry.metadata);
    if (text.length > 0) {
      this.text.set(entry.id, text);
      indexed = true;
    }
    return indexed;
  }

  /**
   * Remove an entry from every index structure.
   *
   * The entry is dropped from the cache, all tag buckets it belonged to, its
   * scope bucket and the text index. Empty buckets are removed eagerly so the
   * inverted indexes do not accumulate dead keys.
   *
   * @param id - the entry id to remove
   * @returns `true` when the entry was indexed (and was therefore removed)
   */
  removeEntry(id: ShortTermId): boolean {
    const entry = this.cache.get(id);
    if (!entry) {
      return false;
    }
    this.cache.delete(id);
    if (entry.tags) {
      for (const tag of entry.tags) {
        const bucket = this.tags.get(tag);
        if (!bucket) {
          continue;
        }
        bucket.delete(id);
        if (bucket.size === 0) {
          this.tags.delete(tag);
        }
      }
    }
    if (entry.scope) {
      const bucket = this.scopes.get(entry.scope);
      if (bucket) {
        bucket.delete(id);
        if (bucket.size === 0) {
          this.scopes.delete(entry.scope);
        }
      }
    }
    this.text.delete(id);
    return true;
  }

  /**
   * All entries carrying at least one of the given tags.
   *
   * Tags are normalised (lower-cased) before matching, mirroring the store's
   * tag normalisation. Matching is a **union**: an entry matches when it
   * carries *any* of the supplied tags. Results are in index (insertion)
   * order.
   *
   * @param tags - the tags to match against
   * @returns the matching entries (each returned once, even with overlaps)
   */
  findByTag(tags: readonly string[]): ShortTermEntry[] {
    const ids = new Set<ShortTermId>();
    for (const raw of tags) {
      const tag = raw.trim().toLowerCase();
      if (!tag) {
        continue;
      }
      const bucket = this.tags.get(tag);
      if (bucket) {
        for (const id of bucket) {
          ids.add(id);
        }
      }
    }
    return this.resolve(ids);
  }

  /**
   * All entries belonging to a given scope.
   *
   * @param scope - the scope to match (normalised to its stored form)
   * @returns the entries in that scope, in index order
   */
  findByScope(scope: ShortTermScope): ShortTermEntry[] {
    const bucket = this.scopes.get(scope);
    if (!bucket) {
      return [];
    }
    return this.resolve(bucket);
  }

  /**
   * All entries whose searchable text contains the given term.
   *
   * Matching is a case-insensitive substring test over the concatenation of
   * the entry's string value and string metadata values. Results are returned
   * in index order; no relevance ranking is performed here — use
   * {@link ShortTermRetriever.hybrid} for scored text search.
   *
   * @param term - the substring to search for (case-insensitive)
   * @returns the matching entries
   */
  findByText(term: string): ShortTermEntry[] {
    const needle = normalizeTerm(term);
    if (!needle) {
      return [];
    }
    const ids: ShortTermId[] = [];
    for (const [id, text] of this.text) {
      if (text.includes(needle)) {
        ids.push(id);
      }
    }
    return this.resolve(new Set(ids));
  }

  /**
   * The indexed searchable text for an entry id.
   *
   * Returns the lower-cased concatenation of the entry's string value and
   * string metadata values as recorded by the last
   * {@link ShortTermIndex.indexEntry}. Entries without indexable text (or
   * unknown ids) yield `''`. Useful for callers that want to perform their own
   * matching against the same normalised text the index uses.
   *
   * @param id - the entry id to look up
   * @returns the indexed text, or `''` when absent
   */
  textFor(id: ShortTermId): string {
    return this.text.get(id) ?? '';
  }

  /**
   * The entry ids carrying a given tag.
   *
   * Lower-level accessor that avoids materialising entry objects; useful for
   * callers that only need the id set (e.g. for cross-referencing another
   * index).
   *
   * @param tag - the tag to look up (case-insensitive)
   * @returns the set of entry ids carrying the tag
   */
  idsForTag(tag: string): ReadonlySet<ShortTermId> {
    return this.tags.get(normalizeTerm(tag)) ?? new Set<ShortTermId>();
  }

  /**
   * The entry ids belonging to a given scope.
   *
   * @param scope - the scope to look up
   * @returns the set of entry ids in the scope
   */
  idsForScope(scope: ShortTermScope): ReadonlySet<ShortTermId> {
    return this.scopes.get(scope) ?? new Set<ShortTermId>();
  }

  /**
   * The number of entries currently indexed.
   *
   * @returns the index size
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Whether an id is currently indexed.
   *
   * @param id - the entry id to test
   * @returns `true` when the id is present in the index
   */
  has(id: ShortTermId): boolean {
    return this.cache.has(id);
  }

  /**
   * The number of distinct tags currently indexed.
   *
   * @returns the distinct tag count
   */
  tagCount(): number {
    return this.tags.size;
  }

  /**
   * The number of entries that carry a given tag.
   *
   * @param tag - the tag to count (case-insensitive)
   * @returns how many entries carry the tag, `0` when none
   */
  frequencyOfTag(tag: string): number {
    return this.idsForTag(tag).size;
  }

  /**
   * Compute aggregate statistics over the index contents.
   *
   * All counts are derived on demand. See {@link ShortTermIndexStats} for the
   * shape. `tagFrequency` and `scopeFrequency` are plain objects so they
   * serialise cleanly.
   *
   * @returns a fresh {@link ShortTermIndexStats} snapshot
   */
  stats(): ShortTermIndexStats {
    const tagFrequency: Record<string, number> = {};
    let sharedTags = 0;
    for (const [tag, ids] of this.tags) {
      tagFrequency[tag] = ids.size;
      if (ids.size >= 2) {
        sharedTags += 1;
      }
    }
    const scopeFrequency: Record<string, number> = {};
    for (const [scope, ids] of this.scopes) {
      scopeFrequency[scope] = ids.size;
    }
    return {
      totalEntries: this.cache.size,
      distinctTags: this.tags.size,
      distinctScopes: this.scopes.size,
      textIndexed: this.text.size,
      sharedTags,
      tagFrequency,
      scopeFrequency,
    };
  }

  /**
   * Replace the entire index contents with a fresh set of entries.
   *
   * This is the cheapest way to resynchronise the index after a bulk prune,
   * a store restore, or a config change that altered scoping. The current
   * contents are discarded wholesale and every supplied entry is indexed.
   *
   * @param entries - the entries to index
   * @returns the number of entries indexed
   */
  rebuild(entries: Iterable<ShortTermEntry>): number {
    this.clear();
    let count = 0;
    for (const entry of entries) {
      this.indexEntry(entry);
      count += 1;
    }
    return count;
  }

  /**
   * Remove every entry and every index structure.
   *
   * Leaves the instance reusable; {@link ShortTermIndex.rebuild} or
   * {@link ShortTermIndex.indexEntry} can repopulate it immediately.
   */
  clear(): void {
    this.cache.clear();
    this.tags.clear();
    this.scopes.clear();
    this.text.clear();
  }

  /**
   * Resolve a set of ids into a deduplicated, insertion-ordered entry array.
   *
   * @param ids - the ids to resolve (order is not preserved)
   * @returns the live cached entries for the known ids
   */
  private resolve(ids: ReadonlySet<ShortTermId>): ShortTermEntry[] {
    const out: ShortTermEntry[] = [];
    for (const id of ids) {
      const entry = this.cache.get(id);
      if (entry) {
        out.push(entry);
      }
    }
    return out;
  }
}