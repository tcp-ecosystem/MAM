/**
 * Content-addressed LRU cache for {@link QueryAnalysis} objects.
 *
 * {@link QueryStore} is the caching heart of the Query understanding layer. It
 * stores analyses keyed by a stable content hash of their normalised text, so
 * the *same question phrased the same way* always resolves to the *same cache
 * entry* — no separate key-management required. This makes the store trivially
 * usable as a memoisation layer in front of {@link QueryAnalyzer.analyze}.
 *
 * ## Guarantees
 *
 * - **Content addressing** — {@link QueryStore.getFor} derives the lookup key
 *   from the query text itself (`hashText(normalise(text))`), so callers never
 *   need to know analysis ids.
 * - **Bounded memory** — when a `capacity` is configured, the store behaves as
 *   an LRU cache: inserting beyond capacity evicts the least-recently-used
 *   entry first. An `onEvict` hook lets observers (metrics, lifecycle) react.
 * - **Copy-on-read/write** — analyses are deep-cloned on store and retrieve
 *   (when `clone` is enabled), so callers can never corrupt cached state.
 * - **Serialisable** — {@link QueryStore.toJSON} / {@link QueryStore.fromJSON}
 *   persist the whole cache (including LRU ordering) for durable restarts.
 *
 * ## Concurrency
 *
 * The store is synchronous and single-threaded by design. In a shared process,
 * consumers coordinate access externally; the store itself is not internally
 * synchronised.
 *
 * @packageDocumentation
 * @module query/store
 */

import {
  dedupeStrings,
  hashText,
  isQueryAnalysis,
  type AnalysisStats,
  type PutManyResult,
  type QueryAnalysis,
} from './types.js';

/**
 * Configuration for a {@link QueryStore}.
 *
 * All fields are optional; {@link DEFAULT_QUERY_STORE_CONFIG} supplies the
 * defaults. The configuration is captured at construction time and cannot be
 * changed afterwards — create a new store to apply new settings.
 */
export interface QueryStoreConfig {
  /**
   * Maximum number of analyses held. When the store exceeds this on `put`,
   * the least-recently-used entries are evicted until the store is within
   * capacity. `0` (default) disables the cap (unbounded growth).
   */
  readonly capacity?: number;

  /**
   * When `true` (default `true`), analyses are deep-cloned on store and on
   * retrieve. Disable only when analyses are treated as immutable by the
   * caller and memory pressure matters.
   */
  readonly clone?: boolean;

  /**
   * Optional clock used for `savedAt` timestamps in snapshots. Injecting a
   * clock makes the store deterministic under test.
   */
  readonly now?: () => number;

  /**
   * Optional hook invoked once per evicted analysis (before the entry is
   * dropped), giving observers a chance to e.g. notify a downstream index or
   * record a metric.
   */
  readonly onEvict?: (analysis: QueryAnalysis) => void;
}

/**
 * Default configuration applied when the caller supplies none.
 *
 * Unbounded capacity, copy-on-write enabled, wall-clock timestamps, no eviction
 * hook. Conservative defaults that favour correctness and safety over raw
 * throughput.
 */
export const DEFAULT_QUERY_STORE_CONFIG: Required<
  Pick<QueryStoreConfig, 'capacity' | 'clone'>
> = {
  capacity: 0,
  clone: true,
};

/**
 * Canonical serialisable shape produced by {@link QueryStore.toJSON}.
 *
 * Persisting as a versioned object — rather than a bare array — gives the
 * format room to grow (index caches, TTL metadata, schema revisions) without
 * breaking existing dumps. The `order` array records the LRU ordering so a
 * restored store reproduces eviction behaviour exactly.
 */
export interface QueryStoreSnapshot {
  /**
   * Format version. Bumped whenever the serialised layout changes.
   */
  readonly version: 1;

  /**
   * Capacity in effect at snapshot time (`0` means unbounded).
   */
  readonly capacity: number;

  /**
   * Analyses keyed by their content-address id.
   */
  readonly analyses: Record<string, QueryAnalysis>;

  /**
   * Analysis ids in LRU order, most-recently-used first. Entries not present
   * in `analyses` are ignored on restore.
   */
  readonly order: readonly string[];

  /**
   * Wall-clock time at which the snapshot was created.
   */
  readonly savedAt: number;
}

/**
 * Lightweight text normalisation used purely for content addressing.
 *
 * Mirrors {@link QueryAnalyzer.normalize} so that `getFor(text)` resolves the
 * same key the analyzer produced when it cached an analysis for the same
 * query: lowercase, trim, collapse internal whitespace runs.
 *
 * @param text - the raw query text
 * @returns the normalised addressing form
 */
export function normalizeForAddress(text: string): string {
  return String(text ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Derive the content-address key for a query text.
 *
 * @param text - the raw query text
 * @returns the stable hash id used as a cache key
 */
export function addressFor(text: string): string {
  return hashText(normalizeForAddress(text));
}

/**
 * Fully-capable, content-addressed LRU analysis cache.
 *
 * See the module documentation for an overview and the method documentation
 * for exact semantics. All methods are synchronous and side-effect free apart
 * from the configured `onEvict` hook.
 */
export class QueryStore {
  /**
   * Backing LRU map. Map iteration order *is* LRU order: the first key is the
   * least-recently-used, the last is the most-recently-used.
   */
  private readonly cache = new Map<string, QueryAnalysis>();

  /** Configuration captured at construction time. */
  private readonly config: Required<Pick<QueryStoreConfig, 'capacity' | 'clone'>> & {
    now: () => number;
    onEvict?: (analysis: QueryAnalysis) => void;
  };

  /** Number of successful cache lookups. */
  private hits = 0;

  /** Number of failed cache lookups. */
  private misses = 0;

  /** Number of `put` calls that stored a new analysis. */
  private puts = 0;

  /** Number of analyses evicted due to capacity pressure. */
  private evictions = 0;

  /**
   * Construct an empty query store.
   *
   * @param config - optional tuning knobs; see {@link QueryStoreConfig}
   */
  constructor(config?: QueryStoreConfig) {
    this.config = {
      capacity: config?.capacity ?? DEFAULT_QUERY_STORE_CONFIG.capacity,
      clone: config?.clone ?? DEFAULT_QUERY_STORE_CONFIG.clone,
      now: config?.now ?? (() => Date.now()),
      onEvict: config?.onEvict,
    };
    if (this.config.capacity < 0) {
      throw new Error(`QueryStore: capacity must be >= 0, got ${this.config.capacity}`);
    }
  }

  /**
   * The capacity in effect for this store.
   *
   * @returns the configured capacity (`0` = unbounded)
   */
  get capacity(): number {
    return this.config.capacity;
  }

  /**
   * The number of cache lookups that hit.
   *
   * @returns the hit count
   */
  get hitCount(): number {
    return this.hits;
  }

  /**
   * The number of cache lookups that missed.
   *
   * @returns the miss count
   */
  get missCount(): number {
    return this.misses;
  }

  /**
   * The hit ratio over all lookups so far.
   *
   * @returns `hits / (hits + misses)`, or `0` when no lookups have occurred
   */
  get hitRatio(): number {
    const total = this.hits + this.misses;
    return total === 0 ? 0 : this.hits / total;
  }

  /**
   * Store an analysis, refreshing its LRU position to most-recently-used.
   *
   * If the analysis already exists under its id, it is replaced without
   * consuming eviction budget (re-putting an existing key never evicts another
   * entry). Inserting a genuinely new key may trigger eviction when the store
   * is at capacity, evicting the least-recently-used entry first. The analysis
   * is cloned before storage when `clone` is enabled.
   *
   * @param analysis - the analysis to cache
   * @returns the stored (canonical) analysis
   * @throws {Error} when `analysis` is not structurally a {@link QueryAnalysis}
   */
  put(analysis: QueryAnalysis): QueryAnalysis {
    if (!isQueryAnalysis(analysis)) {
      throw new Error(
        `QueryStore.put: expected a QueryAnalysis, got ${JSON.stringify(analysis)?.slice(0, 80)}`,
      );
    }
    const id = analysis.id || addressFor(analysis.normalized || analysis.original);
    const exists = this.cache.has(id);
    if (this.config.capacity > 0 && !exists) {
      this.evictIfNeeded();
    }
    const stored = this.config.clone ? structuredClone(analysis) : analysis;
    this.cache.delete(id);
    this.cache.set(id, stored);
    this.puts += 1;
    return stored;
  }

  /**
   * Store several analyses in one call.
   *
   * Behaves as repeated {@link QueryStore.put} but batches the eviction check
   * and reports a {@link PutManyResult} summarising accepted and skipped ids.
   *
   * @param analyses - the analyses to store
   * @param overwrite - when `false` (default `true`), analyses whose id already
   *   exists are skipped rather than replaced
   * @returns a {@link PutManyResult} describing the outcome
   */
  putMany(analyses: readonly QueryAnalysis[], overwrite = true): PutManyResult {
    const storedIds: string[] = [];
    const skippedIds: string[] = [];
    for (const analysis of analyses) {
      const id = analysis.id || addressFor(analysis.normalized || analysis.original);
      if (!overwrite && this.cache.has(id)) {
        skippedIds.push(id);
        continue;
      }
      this.put(analysis);
      storedIds.push(id);
    }
    return {
      stored: storedIds.length,
      skipped: skippedIds.length,
      storedIds,
      skippedIds,
      size: this.cache.size,
    };
  }

  /**
   * Retrieve an analysis by its content-address id.
   *
   * A successful lookup refreshes the entry's LRU position. Returns `undefined`
   * when the id is unknown.
   *
   * @param id - the analysis id (as produced by {@link addressFor})
   * @returns the stored analysis (cloned when `clone` is enabled), or `undefined`
   */
  get(id: string): QueryAnalysis | undefined {
    const found = this.cache.get(id);
    if (found) {
      this.hits += 1;
      this.cache.delete(id);
      this.cache.set(id, found);
      return this.config.clone ? structuredClone(found) : found;
    }
    this.misses += 1;
    return undefined;
  }

  /**
   * Retrieve an analysis by its query text (content-addressed lookup).
   *
   * This is the primary lookup API: callers pass the same text they would pass
   * to {@link QueryAnalyzer.analyze} and the store resolves the key via
   * {@link addressFor}, so no id management is required.
   *
   * @param text - the raw query text
   * @returns the stored analysis, or `undefined` when not present
   */
  getFor(text: string): QueryAnalysis | undefined {
    return this.get(addressFor(text));
  }

  /**
   * Retrieve an analysis by id, throwing when it is absent.
   *
   * Useful for callers that treat a missing entry as a hard invariant
   * violation rather than a soft `undefined` case.
   *
   * @param id - the analysis id
   * @returns the stored analysis
   * @throws {Error} when no analysis with `id` exists
   */
  require(id: string): QueryAnalysis {
    const analysis = this.get(id);
    if (!analysis) {
      throw new Error(`QueryStore: unknown analysis id "${id}"`);
    }
    return analysis;
  }

  /**
   * Whether an analysis with the given id is currently cached.
   *
   * A `has` check does **not** refresh the LRU position (unlike {@link get}).
   *
   * @param id - the analysis id
   * @returns `true` when present
   */
  has(id: string): boolean {
    return this.cache.has(id);
  }

  /**
   * Whether an analysis for the given query text is currently cached.
   *
   * @param text - the raw query text
   * @returns `true` when present
   */
  hasFor(text: string): boolean {
    return this.cache.has(addressFor(text));
  }

  /**
   * Remove an analysis by id.
   *
   * @param id - the analysis id
   * @returns `true` when an entry was removed, `false` when it did not exist
   */
  delete(id: string): boolean {
    return this.cache.delete(id);
  }

  /**
   * Remove an analysis by query text (content-addressed).
   *
   * @param text - the raw query text
   * @returns `true` when an entry was removed, `false` when it did not exist
   */
  deleteFor(text: string): boolean {
    return this.cache.delete(addressFor(text));
  }

  /**
   * All currently-cached analysis ids, in LRU order (oldest first).
   *
   * @returns a fresh array of ids
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * All currently-cached analyses, in LRU order (oldest first).
   *
   * @returns a fresh array of (cloned) analyses
   */
  values(): QueryAnalysis[] {
    const values = Array.from(this.cache.values());
    return this.config.clone ? values.map((value) => structuredClone(value)) : values;
  }

  /**
   * The ids of the least-recently-used entries.
   *
   * Used by {@link QueryLifecycle.prune} to evict oldest entries without
   * disturbing the rest of the cache.
   *
   * @param count - maximum number of ids to return (`0` returns all)
   * @returns the least-recently-used ids, oldest first
   */
  oldest(count = 0): string[] {
    const ids = Array.from(this.cache.keys());
    if (count <= 0 || count >= ids.length) {
      return ids;
    }
    return ids.slice(0, count);
  }

  /**
   * Number of analyses currently cached.
   *
   * @returns the cache size
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Remove every analysis from the cache.
   *
   * Counters (hits, misses, puts, evictions) are **not** reset; they describe
   * cumulative behaviour since construction. Use {@link QueryStore.resetStats}
   * to clear them.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Reset all cumulative counters to zero.
   */
  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
    this.puts = 0;
    this.evictions = 0;
  }

  /**
   * Evict entries until the store is within capacity.
   *
   * Evicts the least-recently-used entries first, invoking `onEvict` for each.
   * No-op when the store is already within capacity or when capacity is `0`.
   *
   * @returns the number of entries evicted
   */
  evictIfNeeded(): number {
    let removed = 0;
    while (this.config.capacity > 0 && this.cache.size >= this.config.capacity) {
      const oldestKey = this.cache.keys().next().value as string | undefined;
      if (oldestKey === undefined) {
        break;
      }
      const evicted = this.cache.get(oldestKey);
      this.cache.delete(oldestKey);
      this.evictions += 1;
      removed += 1;
      if (evicted) {
        this.config.onEvict?.(evicted);
      }
    }
    return removed;
  }

  /**
   * Compute aggregate statistics over the cache contents and counters.
   *
   * Scans all entries; results are computed on demand rather than cached. The
   * returned histogram and averages are fresh snapshots, safe to log.
   *
   * @returns a fresh {@link AnalysisStats} snapshot
   */
  stats(): AnalysisStats {
    const entries = Array.from(this.cache.values());
    const intentCounts: Partial<Record<import('./types.js').QueryIntent, number>> = {};
    let classified = 0;
    let decomposed = 0;
    let totalTerms = 0;
    const distinctTerms = new Set<string>();
    let confidenceSum = 0;
    let durationSum = 0;

    for (const analysis of entries) {
      intentCounts[analysis.intent] = (intentCounts[analysis.intent] ?? 0) + 1;
      if (analysis.intent !== 'unknown') {
        classified += 1;
      }
      if (analysis.subQueries && analysis.subQueries.length > 1) {
        decomposed += 1;
      }
      totalTerms += analysis.terms.length;
      for (const term of analysis.terms) {
        distinctTerms.add(term);
      }
      confidenceSum += analysis.confidence;
      durationSum += analysis.durationMs;
    }

    return {
      analyses: entries.length,
      classified,
      decomposed,
      intentCounts,
      totalTerms,
      distinctTerms: distinctTerms.size,
      avgConfidence: entries.length === 0 ? 0 : confidenceSum / entries.length,
      avgDurationMs: entries.length === 0 ? 0 : durationSum / entries.length,
    };
  }

  /**
   * Detailed operational counters for the cache.
   *
   * Includes hit ratio, put/eviction counts and capacity utilisation, useful
   * for monitoring whether the configured capacity is well tuned.
   *
   * @returns a flat counters object
   */
  counters(): {
    hits: number;
    misses: number;
    puts: number;
    evictions: number;
    hitRatio: number;
    size: number;
    capacity: number;
  } {
    return {
      hits: this.hits,
      misses: this.misses,
      puts: this.puts,
      evictions: this.evictions,
      hitRatio: this.hitRatio,
      size: this.cache.size,
      capacity: this.config.capacity,
    };
  }

  /**
   * Serialise the entire cache to a JSON-safe snapshot.
   *
   * Includes the format version, capacity, the analyses keyed by id, the LRU
   * ordering (most-recently-used first) and a savedAt timestamp, so a dumped
   * store can be restored exactly with {@link QueryStore.fromJSON}.
   *
   * @returns a {@link QueryStoreSnapshot} suitable for `JSON.stringify`
   */
  toJSON(): QueryStoreSnapshot {
    return {
      version: 1,
      capacity: this.config.capacity,
      analyses: Object.fromEntries(this.cache),
      order: Array.from(this.cache.keys()).reverse(),
      savedAt: this.config.now(),
    };
  }

  /**
   * Restore the cache from a previously-produced snapshot.
   *
   * Existing contents are replaced wholesale. The snapshot is validated
   * minimally (version, analyses record, order array); analyses that fail the
   * structural guard are skipped and reported. LRU ordering from the snapshot
   * is honoured, so a restored store evicts in the same order as the original.
   *
   * @param snapshot - the snapshot to load (object or JSON string)
   * @returns the number of analyses restored
   * @throws {Error} when the snapshot is malformed or has an unsupported version
   */
  fromJSON(snapshot: QueryStoreSnapshot | string): number {
    const parsed: QueryStoreSnapshot =
      typeof snapshot === 'string' ? (JSON.parse(snapshot) as QueryStoreSnapshot) : snapshot;
    if (!parsed || parsed.version !== 1 || !parsed.analyses || !Array.isArray(parsed.order)) {
      throw new Error(
        `QueryStore.fromJSON: unsupported or malformed snapshot (version=${parsed?.version ?? '<missing>'})`,
      );
    }
    const restored = new Map<string, QueryAnalysis>();
    const order = dedupeStrings(parsed.order as readonly string[]).reverse();
    for (const id of order) {
      const raw = parsed.analyses[id];
      if (raw && isQueryAnalysis(raw)) {
        restored.set(id, this.config.clone ? structuredClone(raw) : raw);
      }
    }
    this.cache.clear();
    for (const [id, analysis] of restored) {
      this.cache.set(id, analysis);
    }
    return this.cache.size;
  }

  /**
   * Create a store whose contents are populated from a JSON string.
   *
   * Convenience factory equivalent to constructing an empty store and then
   * calling {@link QueryStore.fromJSON}.
   *
   * @param json - a JSON snapshot string as produced by {@link toJSON}
   * @param config - optional store configuration
   * @returns a configured, populated store
   */
  static fromJSON(json: string, config?: QueryStoreConfig): QueryStore {
    const store = new QueryStore(config);
    store.fromJSON(json);
    return store;
  }
}