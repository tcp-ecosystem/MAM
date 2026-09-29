/**
 * @file retrieval.ts
 * @module caching/retrieval
 *
 * {@link CacheManager}: the policy engine of the caching layer.
 *
 * Where {@link CacheSegmentStore} is a neutral registry and {@link CacheIndex}
 * is a read model, the manager decides *what actually happens* when a prompt
 * fragment is offered or requested. It owns the core verbs:
 *
 *  - {@link lookup} — try to satisfy a text from a cached segment (exact or
 *    prefix match), reporting the tokens saved by a {@link CacheHit};
 *  - {@link cache} — store (or refresh) a segment, promoting it to `'hot'`
 *    once it crosses `minHitsForPromotion`;
 *  - {@link prefixScore} — measure how much of a multi-turn sequence shares
 *    a stable prefix, and how many tokens that prefix saves;
 *  - {@link evict} — free space by dropping cold / large segments first;
 *  - {@link expire} — sweep TTL-expired segments (driven by the lifecycle's
 *    periodic timer).
 *
 * The manager composes a store (authoritative records) with an index
 * (query projections) and a promotion set (`'hot'` ids) and keeps all three
 * in sync on every mutation. It performs no I/O and holds no timers;
 * long-lived supervision lives in the {@link CachingLifecycle}
 * (`lifecycle.ts`).
 *
 * @packageDocumentation
 */

import { CacheIndex } from './index.js';
import { CacheSegmentStore } from './store.js';
import type {
  CacheConfig,
  CacheDecision,
  CacheHit,
  CacheOptions,
  CacheStats,
  CachedSegment,
  PromotionStatus,
} from './types.js';
import {
  createCacheHit,
  createCacheMiss,
  decideForSegment,
  estimateTokens,
  isCacheOptions,
  isSegmentId,
  normalizeCacheConfig,
  promotionStatusFor,
} from './types.js';

/* ------------------------------------------------------------------------ *
 * Hash & id helpers
 * ------------------------------------------------------------------------ */

/**
 * Stable, deterministic FNV-1a hash of a string, returned as a base-36
 * string. Used to derive segment ids from `(text, model)` so that the same
 * fragment always maps to the same id — which is what makes a *cache* cache
 * instead of an append-only log.
 *
 * @param input - the string to hash.
 * @returns a fixed-width lowercase base-36 digest.
 */
export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/**
 * Derives a stable segment id from a text and optional model. The model is
 * folded into the hash so the same text cached under two models does not
 * collide.
 */
export function segmentIdFor(text: string, model?: string): string {
  return fnv1a(`${model ?? '*'}\u0000${text}`);
}

/* ------------------------------------------------------------------------ *
 * Supporting types
 * ------------------------------------------------------------------------ */

/**
 * Constructor options for {@link CacheManager}.
 */
export interface CacheManagerOptions {
  /**
   * Custom segment-id factory. Defaults to {@link segmentIdFor}, which hashes
   * `(model, text)`. Provide a custom factory to use semantic ids (e.g. a
   * section name) or to control collision behaviour.
   */
  idFactory?: (text: string, model?: string) => string;
}

/**
 * Outcome of {@link CacheManager.prefixScore}.
 */
export interface PrefixScore {
  /** The longest string that is a prefix of every input text. */
  prefix: string;
  /** Estimated tokens in `prefix` (the tokens saved on every reuse). */
  sharedTokens: number;
  /**
   * Stability in `[0, 1]`: `sharedTokens / averageInputTokens`. A sequence
   * that repeats the same long prefix every turn scores near `1`; a set of
   * unrelated texts scores `0`.
   */
  stability: number;
  /** Number of input texts considered. */
  turns: number;
  /** Sum of estimated tokens across all inputs. */
  totalTokens: number;
  /** Mean estimated tokens across all inputs. */
  avgTokens: number;
}

/**
 * Options accepted by {@link CacheManager.evict}.
 */
export interface EvictOptions {
  /**
   * Free at least this many tokens. Eviction stops once `freedTokens`
   * reaches this target.
   */
  targetTokens?: number;
  /**
   * Hard cap on the number of segments removed in one call.
   */
  limit?: number;
  /**
   * When `true`, `'warm'` (but non-hot) segments are also eligible, not just
   * `'cold'` ones. Defaults to `false`.
   */
  includeWarm?: boolean;
}

/**
 * Summary returned by {@link CacheManager.evict}.
 */
export interface EvictSummary {
  /** Number of segments removed. */
  removed: number;
  /** Estimated tokens freed by the removal. */
  freedTokens: number;
  /** Number of segments remaining in the cache. */
  remaining: number;
  /** Ids of the evicted segments. */
  evicted: string[];
}

/**
 * The policy engine that serves, stores, promotes and evicts cached prompt
 * segments.
 *
 * Construct with a partial {@link CacheConfig}; the remainder is filled
 * from {@link DEFAULT_CACHE_CONFIG}. Every public mutation keeps the
 * internal store, index and promotion set consistent, so the manager is safe
 * to share across the prompt-assembly pipeline.
 */
export class CacheManager {
  /** Normalized (fully-populated) configuration. */
  private readonly _config: CacheConfig;
  /** Authoritative segment registry. */
  private readonly _store: CacheSegmentStore;
  /** Derived query index. */
  private readonly _index: CacheIndex;
  /** Segment-id factory. */
  private readonly _idFactory: (text: string, model?: string) => string;
  /** Ids promoted to `'hot'` (pinned against eviction). */
  private readonly _hot: Set<string>;
  /** Per-segment TTL overrides (id -> ms). */
  private readonly _ttlOverride: Map<string, number>;
  /** Cumulative tokens saved by every served hit. */
  private _lifetimeSavedTokens: number;
  /** Cumulative number of served hits. */
  private _lifetimeHits: number;

  /**
   * Creates a cache manager.
   *
   * @param config - partial cache config; merged over the defaults.
   * @param options - id factory and other tuning.
   */
  constructor(config: Partial<CacheConfig> = {}, options: CacheManagerOptions = {}) {
    this._config = normalizeCacheConfig(config);
    this._store = new CacheSegmentStore(this._config);
    this._index = new CacheIndex();
    this._idFactory = options.idFactory ?? segmentIdFor;
    this._hot = new Set<string>();
    this._ttlOverride = new Map<string, number>();
    this._lifetimeSavedTokens = 0;
    this._lifetimeHits = 0;
  }

  /* -------------------------------------------------------------------- *
   * Accessors
   * -------------------------------------------------------------------- */

  /**
   * The normalized configuration in force.
   */
  get config(): CacheConfig {
    return { ...this._config };
  }

  /**
   * The authoritative segment registry (read access for observability).
   */
  get store(): CacheSegmentStore {
    return this._store;
  }

  /**
   * The derived query index (read access for queries).
   */
  get index(): CacheIndex {
    return this._index;
  }

  /**
   * `true` while the cache is enabled (`config.enabled !== false`).
   */
  get enabled(): boolean {
    return this._config.enabled === true;
  }

  /**
   * Cumulative tokens saved by every served hit so far.
   */
  get lifetimeSavedTokens(): number {
    return this._lifetimeSavedTokens;
  }

  /**
   * Cumulative number of served hits so far.
   */
  get lifetimeHits(): number {
    return this._lifetimeHits;
  }

  /**
   * Ids currently promoted to `'hot'` (snapshot, insertion order).
   */
  hotIds(): string[] {
    return Array.from(this._hot);
  }

  /**
   * `true` when `id` is currently promoted to `'hot'`.
   */
  isHot(id: string): boolean {
    return isSegmentId(id) && this._hot.has(id);
  }

  /**
   * The effective TTL (ms) for `id`: the per-segment override when set,
   * otherwise the config's global TTL, otherwise `undefined` (no expiry).
   */
  segmentTtl(id: string): number | undefined {
    if (this._ttlOverride.has(id)) return this._ttlOverride.get(id);
    return this._config.ttlMs;
  }

  /**
   * Derives a stable segment id for `text`/`model` using the configured
   * id factory.
   */
  idFor(text: string, model?: string): string {
    return this._idFactory(text, model);
  }

  /* -------------------------------------------------------------------- *
   * Lookup
   * -------------------------------------------------------------------- */

  /**
   * Attempts to satisfy `text` from the cache.
   *
   * Matching strategy:
   *  - candidates are scoped to `options.model` (plus model-agnostic
   *    segments) and to segments whose token footprint cannot exceed the
   *    input's own estimate (you cannot save more tokens than you send);
   *  - among those, the *longest* segment whose text is a prefix of `text`
   *    (including an exact match) wins;
   *  - `savedTokens` is the estimated tokens in the shared leading bytes —
   *    for an exact match that is the segment's full footprint.
   *
   * A successful lookup records a hit on the store, refreshes the index and
   * updates the promotion set. Hits below `options.minSavedTokens` are not
   * recorded (the bookkeeping would cost more than the hit saves).
   *
   * @param text - the prompt text to try to satisfy from cache.
   * @param options - lookup options ({@link CacheOptions}).
   * @returns a {@link CacheHit}; `hit: false` when the cache is disabled,
   *   the text is empty, or no segment matched.
   */
  lookup(text: string, options: CacheOptions = {}): CacheHit {
    if (!this.enabled || typeof text !== 'string' || text.length === 0) {
      return createCacheMiss();
    }
    const opts = options;
    const inputTokens = estimateTokens(text);
    const floor = opts.minSavedTokens !== undefined ? Math.max(0, Math.floor(opts.minSavedTokens)) : 0;

    const candidates = this._index
      .findByModel(opts.model)
      .filter((segment) => segment.tokens <= inputTokens && text.startsWith(segment.text));

    let best: CachedSegment | undefined;
    for (const segment of candidates) {
      if (opts.exactOnly === true && segment.text !== text) continue;
      if (!best || segment.text.length > best.text.length) best = segment;
    }
    if (!best) return createCacheMiss();

    const savedTokens = estimateTokens(best.text);
    if (savedTokens < floor) return createCacheMiss();

    const updated = this._store.recordHit(best.id);
    const record = updated ?? best;
    this._index.refresh(record.id, record);
    this._maybePromote(record.id, record.hits);
    this._lifetimeSavedTokens += savedTokens;
    this._lifetimeHits += 1;
    return createCacheHit(record, savedTokens, { model: opts.model });
  }

  /* -------------------------------------------------------------------- *
   * Caching
   * -------------------------------------------------------------------- */

  /**
   * Stores (or refreshes) `text` in the cache.
   *
   * When a segment already exists for the derived id, re-caching counts as a
   * reuse: the hit counter is incremented and the segment's recency is
   * refreshed. When the segment is new it is stored with `tokens` (or an
   * estimate when omitted) and an optional per-segment TTL override.
   *
   * After caching, the segment is promoted to `'hot'` once its hit count
   * reaches `minHitsForPromotion`.
   *
   * @param text - the fragment text to cache.
   * @param tokens - its estimated token footprint; estimated when omitted.
   * @param options - cache options ({@link CacheOptions}).
   * @returns the stored segment (a copy), or `undefined` when the cache is
   *   disabled or `text` is empty.
   */
  cache(text: string, tokens?: number, options: CacheOptions = {}): CachedSegment | undefined {
    if (!this.enabled || typeof text !== 'string' || text.length === 0) {
      return undefined;
    }
    if (!isCacheOptions(options)) {
      throw new TypeError('Invalid CacheOptions');
    }
    const id = this.idFor(text, options.model);
    const footprint = tokens !== undefined ? Math.max(0, Math.floor(tokens)) : estimateTokens(text);

    if (options.ttlMs !== undefined) {
      this._ttlOverride.set(id, Math.max(1, Math.floor(options.ttlMs)));
    }

    const existing = this._store.get(id);
    let stored: CachedSegment | undefined;
    if (existing) {
      const merged = this._store.put(
        {
          ...existing,
          text,
          tokens: footprint,
          model: options.model,
          hits: existing.hits + 1,
          lastAccessAt: Date.now(),
        },
        { merge: true, model: options.model, preserveHits: false },
      );
      stored = merged;
    } else {
      stored = this._store.put(
        { id, text, tokens: footprint, model: options.model, hits: 0, createdAt: Date.now(), lastAccessAt: Date.now() },
        { merge: false, model: options.model },
      );
    }
    if (!stored) return undefined;

    this._index.indexSegment(stored);
    this._maybePromote(stored.id, stored.hits);
    return { ...stored };
  }

  /**
   * Removes a single segment (and its index/hot entries).
   *
   * @returns `true` when a segment was actually removed.
   */
  remove(id: string): boolean {
    if (!isSegmentId(id)) return false;
    const removed = this._store.delete(id);
    this._index.removeSegment(id);
    this._hot.delete(id);
    this._ttlOverride.delete(id);
    return removed;
  }

  /**
   * Clears every segment, the index and the promotion set, resetting
   * lifetime counters. Configuration is preserved.
   *
   * @returns `this` for chaining.
   */
  clear(): this {
    this._store.clear();
    this._index.clear();
    this._hot.clear();
    this._ttlOverride.clear();
    this._lifetimeSavedTokens = 0;
    this._lifetimeHits = 0;
    return this;
  }

  /* -------------------------------------------------------------------- *
   * Prefix scoring
   * -------------------------------------------------------------------- */

  /**
   * Computes how much of a multi-turn sequence shares a stable prefix.
   *
   * The longest common prefix (LCP) of all `texts` is the reusable head: if
   * the provider's prompt cache keys on exact prefixes, every turn after the
   * first would only bill for the *suffix* past `prefix`. `stability` is the
   * fraction of the average turn that the shared prefix covers — the
   * proportion of input tokens that a prefix cache would make free.
   *
   * @param texts - the sequence of turns (non-empty strings). Empty texts
   *   are ignored.
   * @returns a {@link PrefixScore}.
   */
  prefixScore(texts: readonly string[]): PrefixScore {
    const turns = Array.isArray(texts)
      ? texts.filter((text) => typeof text === 'string' && text.length > 0)
      : [];
    if (turns.length === 0) {
      return { prefix: '', sharedTokens: 0, stability: 0, turns: 0, totalTokens: 0, avgTokens: 0 };
    }

    const prefix = this._longestCommonPrefix(turns);
    const sharedTokens = estimateTokens(prefix);

    let totalTokens = 0;
    for (const text of turns) totalTokens += estimateTokens(text);
    const avgTokens = totalTokens / turns.length;
    const stability = avgTokens > 0 ? Math.min(1, sharedTokens / avgTokens) : 0;

    return { prefix, sharedTokens, stability, turns: turns.length, totalTokens, avgTokens };
  }

  /* -------------------------------------------------------------------- *
   * Eviction
   * -------------------------------------------------------------------- */

  /**
   * Frees cache space by evicting segments, preferring cold and large ones.
   *
   * Candidates are all non-hot segments. They are ordered by `(hits asc,
   * tokens desc)` so zero-reuse, heavyweight fragments go first. When
   * `options.includeWarm` is `false` (default) only `'cold'` segments
   * (`hits === 0`) are eligible.
   *
   * @param options - eviction tuning ({@link EvictOptions}). With no options
   *   all eligible cold segments are evicted.
   * @returns an {@link EvictSummary}.
   */
  evict(options: EvictOptions = {}): EvictSummary {
    const target = options.targetTokens !== undefined
      ? Math.max(0, Math.floor(options.targetTokens))
      : Infinity;
    const limit = options.limit !== undefined ? Math.max(0, Math.floor(options.limit)) : Infinity;

    const candidates = this._store
      .values()
      .filter((segment) => !this._hot.has(segment.id))
      .filter((segment) => options.includeWarm === true || segment.hits === 0)
      .sort((a, b) => (a.hits - b.hits) || (b.tokens - a.tokens));

    const evicted: string[] = [];
    let freedTokens = 0;
    let removed = 0;
    for (const segment of candidates) {
      if (removed >= limit || freedTokens >= target) break;
      this.remove(segment.id);
      evicted.push(segment.id);
      freedTokens += segment.tokens;
      removed += 1;
    }
    return { removed, freedTokens, remaining: this._store.size, evicted };
  }

  /* -------------------------------------------------------------------- *
   * Expiry
   * -------------------------------------------------------------------- */

  /**
   * Removes segments whose age exceeds their effective TTL (per-segment
   * override or the config's global TTL). Called by the lifecycle's periodic
   * sweep; also safe to call manually.
   *
   * @param at - reference timestamp (defaults to now).
   * @returns the ids removed.
   */
  expire(at = Date.now()): string[] {
    const now = Math.max(0, Math.floor(at));
    const expired: string[] = [];
    for (const segment of this._store.values()) {
      const ttl = this.segmentTtl(segment.id);
      if (ttl === undefined) continue;
      if (now - segment.lastAccessAt > ttl) expired.push(segment.id);
    }
    for (const id of expired) this.remove(id);
    return expired;
  }

  /* -------------------------------------------------------------------- *
   * Aggregates
   * -------------------------------------------------------------------- */

  /**
   * Derives {@link CacheStats} over the current state, plus hot/cold
   * accounting and the manager's effective promotion threshold.
   */
  stats(): CacheStats {
    const base = this._store.stats(this._config.minHitsForPromotion);
    const cold = this._store.values().filter((segment) => segment.hits === 0).length;
    return {
      ...base,
      hot: this._hot.size,
      cold,
      touched: this._store.values().filter((segment) => segment.hits > 0).length,
      reusableTokens: this._store.totalTokens(),
    };
  }

  /**
   * Produces an advisory {@link CacheDecision} for a stored segment.
   */
  decide(id: string): CacheDecision | undefined {
    if (!isSegmentId(id)) return undefined;
    const segment = this._store.get(id);
    if (!segment) return undefined;
    const decision = decideForSegment(segment, this._config);
    if (this._hot.has(id) && decision.status !== 'hot') {
      return { ...decision, status: 'hot', hitsToPromote: 0, evict: false, reason: 'pinned hot' };
    }
    return decision;
  }

  /**
   * Re-syncs the index from the store. Call this if the store was mutated
   * directly so query projections reflect the latest records.
   */
  reindex(): this {
    this._index.rebuild(this._store.values());
    for (const segment of this._store.values()) {
      this._maybePromote(segment.id, segment.hits);
    }
    return this;
  }

  /* -------------------------------------------------------------------- *
   * Internals
   * -------------------------------------------------------------------- */

  /**
   * Promotes `id` to `'hot'` when its hit count reaches the configured
   * threshold. Returns `true` when a new promotion happened.
   */
  private _maybePromote(id: string, hits: number): boolean {
    const threshold = Math.max(1, Math.floor(this._config.minHitsForPromotion ?? 0));
    if (hits >= threshold && !this._hot.has(id)) {
      this._hot.add(id);
      return true;
    }
    return false;
  }

  /**
   * Computes the longest string that is a prefix of every input text.
   */
  private _longestCommonPrefix(texts: readonly string[]): string {
    const first = texts[0]!;
    let end = first.length;
    for (let i = 1; i < texts.length; i += 1) {
      const other = texts[i]!;
      const max = Math.min(end, other.length);
      let j = 0;
      while (j < max && first[j] === other[j]) j += 1;
      end = j;
      if (end === 0) break;
    }
    return first.slice(0, end);
  }

  /**
   * The promotion status of `id` under the current threshold, or `undefined`
   * when the segment is not stored. Hot ids always report `'hot'` even if
   * their raw hit count would classify lower.
   */
  status(id: string): PromotionStatus | undefined {
    if (!isSegmentId(id)) return undefined;
    const segment = this._store.get(id);
    if (!segment) return undefined;
    if (this._hot.has(id)) return 'hot';
    return promotionStatusFor(segment.hits, this._config.minHitsForPromotion ?? 0);
  }
}

/**
 * Convenience factory mirroring the constructor for fluent one-liners.
 */
export function createCacheManager(
  config: Partial<CacheConfig> = {},
  options: CacheManagerOptions = {},
): CacheManager {
  return new CacheManager(config, options);
}