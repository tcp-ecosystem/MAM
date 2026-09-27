/**
 * In-memory implementation of the short-term store for the MAM Memory Engine.
 *
 * {@link ShortTermStore} is the persistence heart of the short-term subsystem.
 * It owns a `Map<ShortTermId, ShortTermEntry>` and provides the complete
 * lifecycle for ephemeral working-memory entries:
 *
 * - **Write** entries with {@link ShortTermStore.put} and bulk-write with
 *   {@link ShortTermStore.putMany}.
 * - **Read** with {@link ShortTermStore.get} (which counts as an access and
 *   refreshes sliding TTLs), non-mutating {@link ShortTermStore.peek}, and
 *   bulk-read with {@link ShortTermStore.getMany}.
 * - **Mutate** access tracking with {@link ShortTermStore.touch} and content
 *   with {@link ShortTermStore.update}.
 * - **Query** with {@link ShortTermStore.has}, {@link ShortTermStore.keys},
 *   {@link ShortTermStore.entries} and {@link ShortTermStore.size}.
 * - **Remove** with {@link ShortTermStore.delete} and {@link ShortTermStore.clear}.
 * - **Govern** memory with {@link ShortTermStore.prune} (TTL expiry + bound
 *   enforcement) and {@link ShortTermStore.evict} (forced shrink).
 * - **Inspect** with {@link ShortTermStore.stats}.
 * - **Persist / restore** with {@link ShortTermStore.toJSON} and
 *   {@link ShortTermStore.fromJSON}.
 * - **Reconfigure** at runtime with {@link ShortTermStore.setConfig} and
 *   {@link ShortTermStore.getConfig}.
 *
 * ## Semantics worth knowing
 *
 * - **TTL** is measured per {@link RetentionPolicy}: `'fixed'` TTLs are
 *   counted from `createdAt` and never extended; `'sliding'` (default) TTLs
 *   are counted from the most recent activity (`updatedAt`) and are refreshed
 *   by every read or touch; `'persistent'` entries never expire on their own.
 * - **Access tracking** is LRU-style: `get` and `touch` bump `accessCount`
 *   and `lastAccessAt`, which feeds both frequency ranking and eviction order.
 * - **Eviction** is lazy and mandatory: writes never fail; instead, when the
 *   store exceeds `maxEntries`, the least-recently-accessed entries are evicted
 *   until the bound is satisfied.
 * - **Expiry** is lazy on reads: `get`/`has`/`keys`/`getMany` treat expired
 *   entries as absent and remove them opportunistically. `size()` and
 *   `stats().totalEntries` reflect the backing map and may still include
 *   expired-but-unpruned entries until {@link ShortTermStore.prune} (or the
 *   lifecycle's timer) reclaims them.
 *
 * @packageDocumentation
 * @module short-term/store
 */

import type {
  PruneResult,
  RetentionPolicy,
  ShortTermConfig,
  ShortTermEntry,
  ShortTermEntryInput,
  ShortTermEntryOptions,
  ShortTermId,
  ShortTermSnapshot,
  ShortTermStats,
  ShortTermValue,
  Timestamp,
} from './types.js';

/**
 * Default configuration applied when the caller supplies none.
 *
 * The defaults are deliberately safe: the store is bounded to 1000 entries,
 * entries do not expire by default, sliding-window retention is used when a
 * TTL *is* supplied, tags are normalised, and no automatic pruning interval is
 * scheduled (the lifecycle layer is responsible for that).
 */
export const DEFAULT_SHORT_TERM_CONFIG: Required<
  Pick<
    ShortTermConfig,
    'maxEntries' | 'defaultTtlMs' | 'pruneIntervalMs' | 'retention' | 'normalizeTags'
  >
> & { scope: ShortTermConfig['scope']; now: ShortTermConfig['now'] } = {
  maxEntries: 1000,
  defaultTtlMs: 0,
  pruneIntervalMs: 0,
  retention: 'sliding',
  normalizeTags: true,
  scope: undefined,
  now: undefined,
};

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
 * Deep-clone a stored value to enforce the store's copy-on-write guarantee.
 *
 * Uses `structuredClone` when available and falls back to JSON round-tripping
 * otherwise, so values must be serialisable to benefit fully. Values that
 * cannot be cloned (functions, circular structures, exotic objects) are
 * returned by reference; callers that mutate such values in place accept the
 * risk of shared mutation.
 *
 * @param value - the value to clone
 * @returns an independent copy when possible, otherwise the original reference
 */
export function cloneValue<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  try {
    if (typeof structuredClone === 'function') {
      return structuredClone(value) as T;
    }
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

/**
 * Coerce a raw TTL into a canonical value.
 *
 * `undefined` and non-positive numbers both mean "no expiry" and collapse to
 * `undefined`; any other value is rounded to a positive integer number of
 * milliseconds.
 *
 * @param ttlMs - the raw TTL to normalise
 * @returns the canonical TTL, or `undefined` when the entry should not expire
 */
export function normalizeTtl(ttlMs: number | undefined): number | undefined {
  if (ttlMs === undefined || !Number.isFinite(ttlMs) || ttlMs <= 0) {
    return undefined;
  }
  return Math.floor(ttlMs);
}

/**
 * Patch shape accepted by {@link ShortTermStore.update}.
 *
 * Any field present in the patch replaces the stored value; absent fields keep
 * their stored values. `value`, `ttlMs`, `tags`, `metadata` and `scope` update
 * the entry contents, while `retention` swaps the entry's expiry behaviour
 * without touching the payload.
 */
export interface ShortTermUpdate {
  readonly value?: ShortTermValue;
  readonly ttlMs?: number;
  readonly tags?: readonly string[];
  readonly metadata?: ShortTermEntryOptions['metadata'];
  readonly scope?: ShortTermEntryOptions['scope'];
  readonly retention?: RetentionPolicy;
}

/**
 * Fully-capable in-memory short-term store.
 *
 * See the module documentation for a high-level overview and each method's
 * documentation for exact semantics. All methods are synchronous, so the store
 * is trivially embeddable; asynchronous durability is the caller's concern.
 */
export class ShortTermStore {
  /** Backing map from entry id to the stored entry. */
  private readonly map = new Map<ShortTermId, ShortTermEntry>();

  /**
   * Per-entry retention policies, keyed by entry id.
   *
   * Kept separate from the entry so the public entry shape stays clean while
   * the store can still honour per-entry expiry semantics. Entries missing
   * from this map use the store's default retention.
   */
  private readonly policies = new Map<ShortTermId, RetentionPolicy>();

  /** Effective configuration (defaults merged with caller overrides). */
  private config: Required<
    Pick<
      ShortTermConfig,
      'maxEntries' | 'defaultTtlMs' | 'pruneIntervalMs' | 'retention' | 'normalizeTags'
    >
  > & Pick<ShortTermConfig, 'scope' | 'now'>;

  /** Cumulative lookup counters used by {@link ShortTermStore.stats}. */
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private ttlExpirations = 0;

  /**
   * Construct an empty short-term store.
   *
   * @param config - optional tuning knobs; see {@link ShortTermConfig}
   */
  constructor(config?: ShortTermConfig) {
    this.config = {
      maxEntries: config?.maxEntries ?? DEFAULT_SHORT_TERM_CONFIG.maxEntries,
      defaultTtlMs: config?.defaultTtlMs ?? DEFAULT_SHORT_TERM_CONFIG.defaultTtlMs,
      pruneIntervalMs: config?.pruneIntervalMs ?? DEFAULT_SHORT_TERM_CONFIG.pruneIntervalMs,
      retention: config?.retention ?? DEFAULT_SHORT_TERM_CONFIG.retention,
      normalizeTags: config?.normalizeTags ?? DEFAULT_SHORT_TERM_CONFIG.normalizeTags,
      scope: config?.scope,
      now: config?.now ?? (() => Date.now()),
    };
  }

  /**
   * Return the configuration currently in effect.
   *
   * The returned object is a fresh, read-only projection so callers can
   * inspect behaviour without mutating the live store.
   *
   * @returns the effective configuration
   */
  getConfig(): Readonly<ShortTermConfig> {
    return { ...this.config, scope: this.config.scope, now: this.config.now };
  }

  /**
   * Merge a partial configuration into the live store.
   *
   * `undefined` fields are ignored, so callers can update a single knob
   * without clobbering the rest. After merging, the store immediately enforces
   * the (possibly reduced) `maxEntries` bound, evicting LRU entries as needed.
   *
   * @param partial - the fields to change
   * @returns the merged configuration now in effect
   */
  setConfig(partial: Partial<ShortTermConfig>): Readonly<ShortTermConfig> {
    const next: ShortTermConfig = { ...this.config, ...partial };
    const maxEntries =
      next.maxEntries === undefined || next.maxEntries <= 0
        ? DEFAULT_SHORT_TERM_CONFIG.maxEntries
        : Math.floor(next.maxEntries);
    this.config = {
      maxEntries,
      defaultTtlMs: next.defaultTtlMs ?? DEFAULT_SHORT_TERM_CONFIG.defaultTtlMs,
      pruneIntervalMs: next.pruneIntervalMs ?? DEFAULT_SHORT_TERM_CONFIG.pruneIntervalMs,
      retention: next.retention ?? DEFAULT_SHORT_TERM_CONFIG.retention,
      normalizeTags: next.normalizeTags ?? DEFAULT_SHORT_TERM_CONFIG.normalizeTags,
      scope: next.scope,
      now: next.now ?? (() => Date.now()),
    };
    this.enforceMaxEntries();
    return this.getConfig();
  }

  /**
   * The retention policy in effect for a stored entry.
   *
   * @param id - the entry id to look up
   * @returns the per-entry policy, or the store default when none was set
   */
  private retentionOf(id: ShortTermId): RetentionPolicy {
    return this.policies.get(id) ?? this.config.retention;
  }

  /**
   * Decide whether an entry is expired at a given instant.
   *
   * An entry without a positive TTL never expires. For `'fixed'` retention the
   * deadline is `createdAt + ttlMs`; for `'sliding'` retention it is
   * `updatedAt + ttlMs` (so activity pushes the deadline forward). `'persistent'`
   * entries never expire regardless of any TTL present.
   *
   * @param entry - the entry to test
   * @param policy - the entry's retention policy
   * @param now - the clock instant to test against
   * @returns `true` when the entry should be treated as expired
   */
  private isExpired(entry: ShortTermEntry, policy: RetentionPolicy, now: Timestamp): boolean {
    if (policy === 'persistent' || !entry.ttlMs) {
      return false;
    }
    const base = policy === 'fixed' ? entry.createdAt : entry.updatedAt ?? entry.createdAt;
    return base + entry.ttlMs <= now;
  }

  /**
   * Lazily remove a stored entry when its TTL has elapsed.
   *
   * This is the single funnel through which expired entries leave the store:
   * it increments the TTL-expiration counter and keeps the policy map in sync.
   *
   * @param id - the entry id to test
   * @returns `true` when the entry was present and expired (and was removed)
   */
  private expireIfStale(id: ShortTermId): boolean {
    const entry = this.map.get(id);
    if (!entry) {
      return false;
    }
    const now = this.config.now();
    if (this.isExpired(entry, this.retentionOf(id), now)) {
      this.map.delete(id);
      this.policies.delete(id);
      this.ttlExpirations += 1;
      return true;
    }
    return false;
  }

  /**
   * Enforce the `maxEntries` bound by evicting the least-recently-accessed
   * entries.
   *
   * When `maxEntries` is non-positive the bound is disabled and this is a
   * no-op. Otherwise the store repeatedly removes the entry with the smallest
   * `lastAccessAt` (falling back to `createdAt` for never-accessed entries)
   * until the count is within bounds. Each eviction increments the eviction
   * counter.
   */
  private enforceMaxEntries(): void {
    if (this.config.maxEntries <= 0) {
      return;
    }
    while (this.map.size > this.config.maxEntries) {
      let victimId: ShortTermId | undefined;
      let victimKey = Number.POSITIVE_INFINITY;
      for (const [id, entry] of this.map) {
        const key = entry.lastAccessAt ?? entry.createdAt;
        if (key < victimKey) {
          victimKey = key;
          victimId = id;
        }
      }
      if (victimId === undefined) {
        break;
      }
      this.map.delete(victimId);
      this.policies.delete(victimId);
      this.evictions += 1;
    }
  }

  /**
   * Persist an entry, overwriting any existing entry with the same id.
   *
   * The stored form is produced by resolving the per-write options against the
   * configured defaults: TTL (with the default), retention policy (default
   * `'sliding'`), scope (default store scope) and normalised tags. A fresh
   * access record starts at `accessCount: 0` with no access timestamp.
   *
   * Writes never fail because of capacity: when the store is at `maxEntries`,
   * least-recently-accessed entries are evicted to make room.
   *
   * @param input - the id, value and optional per-write options
   * @returns the canonical stored {@link ShortTermEntry}
   */
  put(input: ShortTermEntryInput): ShortTermEntry {
    const now = this.config.now();
    const options = input.options ?? {};
    const policy = options.retention ?? this.config.retention;
    const tags = normalizeTags(options.tags, this.config.normalizeTags);
    const ttl = normalizeTtl(
      options.ttlMs !== undefined ? options.ttlMs : this.config.defaultTtlMs,
    );
    const entry: ShortTermEntry = {
      id: input.id,
      value: cloneValue(input.value),
      createdAt: now,
      updatedAt: now,
      ttlMs: ttl,
      accessCount: 0,
      tags,
      metadata: options.metadata ? cloneValue(options.metadata) : undefined,
      scope: options.scope ?? this.config.scope,
    };
    this.map.set(entry.id, entry);
    this.policies.set(entry.id, policy);
    this.enforceMaxEntries();
    return entry;
  }

  /**
   * Persist several entries in one call.
   *
   * Behaves as repeated {@link ShortTermStore.put} but performs the work in a
   * single pass. If multiple inputs share an id, the last one wins.
   *
   * @param inputs - the entries to persist
   * @returns the number of entries stored
   */
  putMany(inputs: readonly ShortTermEntryInput[]): number {
    for (const input of inputs) {
      this.put(input);
    }
    return inputs.length;
  }

  /**
   * Retrieve the value stored under an id, counting the read as an access.
   *
   * On a hit the entry's `accessCount` and `lastAccessAt` are bumped, and for
   * `'sliding'` retention the `updatedAt` (and therefore the TTL deadline) is
   * refreshed. Expired entries are removed lazily and reported as a miss.
   *
   * @param id - the entry id to read
   * @returns the stored value, or `undefined` when absent or expired
   */
  get(id: ShortTermId): ShortTermValue {
    if (this.expireIfStale(id)) {
      this.misses += 1;
      return undefined;
    }
    const entry = this.map.get(id);
    if (!entry) {
      this.misses += 1;
      return undefined;
    }
    this.touchEntry(id, entry);
    this.hits += 1;
    return entry.value;
  }

  /**
   * Retrieve several entries by id, in the requested order.
   *
   * Each id is read exactly as {@link ShortTermStore.get} would read it —
   * hits are touched and misses (absent or expired) are skipped. Only found
   * entries appear in the result.
   *
   * @param ids - the entry ids to read
   * @returns the found entries, in the order of the requested ids
   */
  getMany(ids: readonly ShortTermId[]): ShortTermEntry[] {
    const found: ShortTermEntry[] = [];
    for (const id of ids) {
      if (this.expireIfStale(id)) {
        this.misses += 1;
        continue;
      }
      const entry = this.map.get(id);
      if (!entry) {
        this.misses += 1;
        continue;
      }
      this.touchEntry(id, entry);
      this.hits += 1;
      found.push(entry);
    }
    return found;
  }

  /**
   * Inspect an entry without recording an access.
   *
   * Unlike {@link ShortTermStore.get}, `peek` never mutates the store: it does
   * not bump `accessCount`/`lastAccessAt`, does not refresh a sliding TTL, and
   * does not even remove an expired entry (that is left to the next `get` or
   * {@link ShortTermStore.prune}). Expired entries simply read as `undefined`.
   *
   * @param id - the entry id to inspect
   * @returns the stored entry, or `undefined` when absent or expired
   */
  peek(id: ShortTermId): ShortTermEntry | undefined {
    const entry = this.map.get(id);
    if (!entry) {
      return undefined;
    }
    if (this.isExpired(entry, this.retentionOf(id), this.config.now())) {
      return undefined;
    }
    return entry;
  }

  /**
   * Record an access against an entry without reading its value.
   *
   * Useful when an entry is "used" by an external system that should not
   * consume the payload through the store, or when the caller wants to keep a
   * sliding TTL alive explicitly.
   *
   * @param id - the entry id to touch
   * @returns the touched entry, or `undefined` when absent or expired
   */
  touch(id: ShortTermId): ShortTermEntry | undefined {
    if (this.expireIfStale(id)) {
      return undefined;
    }
    const entry = this.map.get(id);
    if (!entry) {
      return undefined;
    }
    this.touchEntry(id, entry);
    return entry;
  }

  /**
   * Internal access bookkeeping shared by `get`, `getMany` and `touch`.
   *
   * Always bumps `accessCount` and `lastAccessAt`; additionally refreshes
   * `updatedAt` (sliding the TTL deadline) when the entry's retention policy
   * is `'sliding'`.
   *
   * @param id - the entry id (used for the policy lookup)
   * @param entry - the entry being accessed
   */
  private touchEntry(id: ShortTermId, entry: ShortTermEntry): void {
    const now = this.config.now();
    const refreshed: ShortTermEntry = {
      ...entry,
      accessCount: entry.accessCount + 1,
      lastAccessAt: now,
      updatedAt: this.retentionOf(id) === 'sliding' ? now : entry.updatedAt,
    };
    this.map.set(id, refreshed);
  }

  /**
   * Whether an id currently holds a live (non-expired) entry.
   *
   * Expired entries are removed lazily, mirroring {@link ShortTermStore.get}
   * semantics so `has` never reports a value that a subsequent `get` would
   * miss.
   *
   * @param id - the entry id to test
   * @returns `true` when a live entry exists
   */
  has(id: ShortTermId): boolean {
    if (this.expireIfStale(id)) {
      return false;
    }
    return this.map.has(id);
  }

  /**
   * Remove an entry from the store.
   *
   * @param id - the entry id to delete
   * @returns `true` when an entry was removed, `false` when it did not exist
   */
  delete(id: ShortTermId): boolean {
    const existed = this.map.delete(id);
    this.policies.delete(id);
    return existed;
  }

  /**
   * All live entry ids currently stored, in insertion order.
   *
   * Expired entries are removed lazily so the result only contains ids that a
   * subsequent {@link ShortTermStore.get} would return.
   *
   * @returns an array of live entry ids
   */
  keys(): ShortTermId[] {
    for (const id of Array.from(this.map.keys())) {
      this.expireIfStale(id);
    }
    return Array.from(this.map.keys());
  }

  /**
   * All entries currently stored, in insertion order.
   *
   * The returned array is a fresh copy; mutating it does not affect the store.
   * Each element is the live stored reference (read-only by convention).
   *
   * @returns an array of stored entries
   */
  entries(): ShortTermEntry[] {
    for (const id of Array.from(this.map.keys())) {
      this.expireIfStale(id);
    }
    return Array.from(this.map.values());
  }

  /**
   * Number of entries currently stored.
   *
   * Counts the backing map, which may include expired-but-unpruned entries;
   * call {@link ShortTermStore.prune} (or rely on the lifecycle timer) to
   * reclaim them.
   *
   * @returns the entry count
   */
  size(): number {
    return this.map.size;
  }

  /**
   * Remove every entry from the store.
   *
   * Resets the entry map and the policy map but leaves the cumulative access
   * counters and configuration intact, so `stats()` remains comparable across
   * a clear.
   */
  clear(): void {
    this.map.clear();
    this.policies.clear();
  }

  /**
   * Apply a partial update to a stored entry and persist the result.
   *
   * Only fields present in the patch are changed. Updating `value` clones the
   * new payload and stamps `updatedAt`; updating `ttlMs` re-normalises the TTL
   * (a non-positive value disables expiry); `tags` are re-normalised;
   * `retention` swaps the expiry behaviour without touching the payload.
   * Access tracking (`accessCount`, `lastAccessAt`) is preserved.
   *
   * @param id - the entry id to update
   * @param patch - the fields to apply
   * @returns the updated {@link ShortTermEntry}
   * @throws {Error} when no entry with `id` exists
   */
  update(id: ShortTermId, patch: ShortTermUpdate): ShortTermEntry {
    const existing = this.map.get(id);
    if (!existing) {
      throw new Error(`ShortTermStore.update: unknown entry id "${id}"`);
    }
    const now = this.config.now();
    const ttl =
      patch.ttlMs !== undefined
        ? normalizeTtl(patch.ttlMs)
        : existing.ttlMs;
    const updated: ShortTermEntry = {
      ...existing,
      value: patch.value !== undefined ? cloneValue(patch.value) : existing.value,
      ttlMs: ttl,
      tags:
        patch.tags !== undefined
          ? normalizeTags(patch.tags, this.config.normalizeTags)
          : existing.tags,
      metadata: patch.metadata !== undefined ? cloneValue(patch.metadata) : existing.metadata,
      scope: patch.scope !== undefined ? patch.scope : existing.scope,
      updatedAt: now,
    };
    if (patch.retention !== undefined) {
      this.policies.set(id, patch.retention);
    }
    this.map.set(id, updated);
    return updated;
  }

  /**
   * Remove expired entries and enforce the maximum-entry bound in one pass.
   *
   * First every stored entry is tested against its TTL and expired entries are
   * removed (counting toward `expired` and the TTL-expiration counter). Then
   * the `maxEntries` bound is enforced, evicting the least-recently-accessed
   * survivors (counting toward `evicted` and the eviction counter). The result
   * reports removed ids so an external index can be synchronised.
   *
   * @returns a {@link PruneResult} describing the pass
   */
  prune(): PruneResult {
    const now = this.config.now();
    const removedIds: ShortTermId[] = [];
    for (const id of Array.from(this.map.keys())) {
      const entry = this.map.get(id);
      if (entry && this.isExpired(entry, this.retentionOf(id), now)) {
        this.map.delete(id);
        this.policies.delete(id);
        this.ttlExpirations += 1;
        removedIds.push(id);
      }
    }
    const expired = removedIds.length;
    const before = this.map.size;
    const beforeEvictions = this.evictions;
    this.enforceMaxEntries();
    const evicted = this.evictions - beforeEvictions;
    return {
      expired,
      evicted,
      removed: expired + evicted,
      remaining: this.map.size,
      removedIds,
      timestamp: now,
    };
  }

  /**
   * Remove expired entries without touching the maximum-entry bound.
   *
   * This is the TTL-only variant of {@link ShortTermStore.prune}: entries
   * whose TTL has elapsed are removed (counting toward the TTL-expiration
   * counter) but no LRU eviction is performed, so it is safe to call when the
   * store is intentionally over its bound and the caller does not want to
   * lose least-recently-used entries yet.
   *
   * @returns a {@link PruneResult} describing the pass (with `evicted: 0`)
   */
  pruneExpired(): PruneResult {
    const now = this.config.now();
    const removedIds: ShortTermId[] = [];
    for (const id of Array.from(this.map.keys())) {
      const entry = this.map.get(id);
      if (entry && this.isExpired(entry, this.retentionOf(id), now)) {
        this.map.delete(id);
        this.policies.delete(id);
        this.ttlExpirations += 1;
        removedIds.push(id);
      }
    }
    return {
      expired: removedIds.length,
      evicted: 0,
      removed: removedIds.length,
      remaining: this.map.size,
      removedIds,
      timestamp: now,
    };
  }

  /**
   * Force the store down to at most `maxEntries` entries.
   *
   * Removes the least-recently-accessed entries until the count is within
   * bounds, without touching TTL-expired entries that are not yet pruned.
   * Passing a value larger than the current size is a harmless no-op.
   *
   * @param maxEntries - the maximum number of entries to keep (must be > 0)
   * @returns a {@link PruneResult} describing the eviction
   */
  evict(maxEntries: number): PruneResult {
    const now = this.config.now();
    const limit = Math.floor(maxEntries);
    const removedIds: ShortTermId[] = [];
    const before = this.evictions;
    if (limit > 0) {
      while (this.map.size > limit) {
        let victimId: ShortTermId | undefined;
        let victimKey = Number.POSITIVE_INFINITY;
        for (const [id, entry] of this.map) {
          const key = entry.lastAccessAt ?? entry.createdAt;
          if (key < victimKey) {
            victimKey = key;
            victimId = id;
          }
        }
        if (victimId === undefined) {
          break;
        }
        this.map.delete(victimId);
        this.policies.delete(victimId);
        this.evictions += 1;
        removedIds.push(victimId);
      }
    }
    const evicted = this.evictions - before;
    return {
      expired: 0,
      evicted,
      removed: evicted,
      remaining: this.map.size,
      removedIds,
      timestamp: now,
    };
  }

  /**
   * Estimate the memory footprint of a stored entry in bytes.
   *
   * Sums the UTF-8 byte lengths of the serialised value and metadata, falling
   * back to a nominal estimate based on the id and the stringified value when
   * serialisation fails (e.g. circular structures).
   *
   * @param entry - the entry to size
   * @returns an approximate byte count
   */
  private estimateBytes(entry: ShortTermEntry): number {
    let total = Buffer.byteLength(entry.id, 'utf8');
    const parts: unknown[] = [entry.value, entry.metadata];
    for (const part of parts) {
      if (part === undefined || part === null) {
        continue;
      }
      try {
        total += Buffer.byteLength(JSON.stringify(part), 'utf8');
      } catch {
        total += 32;
      }
    }
    return total;
  }

  /**
   * Compute aggregate statistics over the current store contents.
   *
   * `totalEntries` and `oldestTs`/`newestTs` reflect the backing map (which
   * may include expired-but-unpruned entries); `hitRate`, `evictions` and
   * `ttlExpirations` are cumulative since construction or the last
   * {@link ShortTermStore.fromJSON}. See {@link ShortTermStats}.
   *
   * @returns a fresh {@link ShortTermStats} snapshot
   */
  stats(): ShortTermStats {
    let totalBytesEstimate = 0;
    let oldestTs: Timestamp | null = null;
    let newestTs: Timestamp | null = null;
    for (const entry of this.map.values()) {
      totalBytesEstimate += this.estimateBytes(entry);
      if (oldestTs === null || entry.createdAt < oldestTs) {
        oldestTs = entry.createdAt;
      }
      if (newestTs === null || entry.createdAt > newestTs) {
        newestTs = entry.createdAt;
      }
    }
    const lookups = this.hits + this.misses;
    const hitRate = lookups === 0 ? 1 : this.hits / lookups;
    return {
      totalEntries: this.map.size,
      totalBytesEstimate,
      hitRate,
      evictions: this.evictions,
      oldestTs,
      newestTs,
      hits: this.hits,
      misses: this.misses,
      ttlExpirations: this.ttlExpirations,
    };
  }

  /**
   * Serialise the entire store to a plain JSON-safe snapshot.
   *
   * The snapshot carries the effective config, the entries in insertion order,
   * per-entry retention policies and the cumulative counters, so a dumped
   * store can be restored exactly with {@link ShortTermStore.fromJSON}.
   *
   * @returns a {@link ShortTermSnapshot} suitable for `JSON.stringify`
   */
  toJSON(): ShortTermSnapshot {
    return {
      version: 1,
      config: this.getConfig(),
      entries: Array.from(this.map.values()),
      policies: Object.fromEntries(this.policies),
      counters: {
        hits: this.hits,
        misses: this.misses,
        evictions: this.evictions,
        ttlExpirations: this.ttlExpirations,
      },
      savedAt: this.config.now(),
    };
  }

  /**
   * Restore the store contents from a previously-produced snapshot.
   *
   * Existing contents are replaced wholesale. The snapshot is validated
   * minimally: it must carry `version: 1`, a config record and an entries
   * array. Config fields absent from the snapshot keep the store's current
   * values, and policies absent from the snapshot map use the store default.
   * Entries are re-cloned through the same path as {@link ShortTermStore.put}.
   *
   * @param snapshot - the snapshot to load (as produced by {@link toJSON})
   * @returns the number of entries restored
   * @throws {Error} when the snapshot is malformed or has an unsupported version
   */
  fromJSON(snapshot: ShortTermSnapshot | string): number {
    const parsed: ShortTermSnapshot =
      typeof snapshot === 'string' ? (JSON.parse(snapshot) as ShortTermSnapshot) : snapshot;
    if (!parsed || parsed.version !== 1 || !parsed.entries || !parsed.config) {
      throw new Error(
        `ShortTermStore.fromJSON: unsupported or malformed snapshot (version=${parsed?.version ?? '<missing>'})`,
      );
    }
    const saved = parsed.config;
    this.config = {
      maxEntries: saved.maxEntries ?? this.config.maxEntries,
      defaultTtlMs: saved.defaultTtlMs ?? this.config.defaultTtlMs,
      pruneIntervalMs: saved.pruneIntervalMs ?? this.config.pruneIntervalMs,
      retention: saved.retention ?? this.config.retention,
      normalizeTags: saved.normalizeTags ?? this.config.normalizeTags,
      scope: saved.scope ?? this.config.scope,
      now: this.config.now,
    };
    this.map.clear();
    this.policies.clear();
    for (const raw of parsed.entries) {
      const entry: ShortTermEntry = {
        id: raw.id,
        value: cloneValue(raw.value),
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
        ttlMs: raw.ttlMs,
        lastAccessAt: raw.lastAccessAt,
        accessCount: raw.accessCount,
        tags: raw.tags ? normalizeTags(raw.tags, this.config.normalizeTags) : undefined,
        metadata: raw.metadata ? cloneValue(raw.metadata) : undefined,
        scope: raw.scope,
      };
      this.map.set(entry.id, entry);
      this.policies.set(entry.id, parsed.policies?.[entry.id] ?? this.config.retention);
    }
    const counters: ShortTermSnapshot['counters'] = parsed.counters ?? {
      hits: 0,
      misses: 0,
      evictions: 0,
      ttlExpirations: 0,
    };
    this.hits = counters.hits;
    this.misses = counters.misses;
    this.evictions = counters.evictions;
    this.ttlExpirations = counters.ttlExpirations;
    this.enforceMaxEntries();
    return this.map.size;
  }

  /**
   * Create a store whose contents are populated from a JSON snapshot.
   *
   * Convenience factory equivalent to constructing an empty store and then
   * calling {@link ShortTermStore.fromJSON}.
   *
   * @param snapshot - a snapshot object or JSON string as produced by {@link toJSON}
   * @param config - optional store configuration used for fields the snapshot omits
   * @returns a configured, populated store
   */
  static fromJSON(snapshot: ShortTermSnapshot | string, config?: ShortTermConfig): ShortTermStore {
    const store = new ShortTermStore(config);
    store.fromJSON(snapshot);
    return store;
  }
}