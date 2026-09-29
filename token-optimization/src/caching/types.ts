/**
 * @file types.ts
 * @module caching/types
 *
 * Core domain types for the MAM Token Optimization **Caching** layer.
 *
 * The caching layer models *prompt-prefix and section caching*: reusable
 * fragments of a prompt — a shared system directive, a cached tool schema
 * preamble, a frozen knowledge-graph context, a user-turn prefix — that can
 * be sent once and then referenced by their stable prefix on later turns.
 * When an LLM provider keys its prompt cache on an exact prefix, re-issuing
 * the same leading bytes costs *zero* input tokens on every subsequent
 * request. This layer decides what is worth keeping around, how hot each
 * cached segment is, and how many tokens a cache hit actually saves.
 *
 * The central record is the {@link CachedSegment}: one stored fragment with
 * its text, estimated token footprint and hit accounting. Behavioural knobs
 * live in {@link CacheConfig} (capacity ceiling, TTL, promotion threshold,
 * enable switch), and the two "answers" this layer produces are
 * {@link CacheHit} (a successful reuse of a segment) and
 * {@link CacheDecision} (an advisory verdict about whether a fragment should
 * be promoted or demoted).
 *
 * This module is intentionally free of mutable logic. It defines:
 *  - the shared data shapes ({@link CachedSegment}, {@link CacheConfig},
 *    {@link CacheHit}, {@link CacheStats}, {@link CacheOptions},
 *    {@link CacheDecision});
 *  - canonical constants ({@link DEFAULT_CACHE_CONFIG},
 *    {@link TOKEN_ESTIMATE_CHARS}, {@link PROMOTION_STATUSES});
 *  - runtime type guards that let callers validate untrusted input (from
 *    JSON, from a config file, or from a plugin boundary);
 *  - pure factories that construct well-formed instances with sane defaults,
 *    plus the shared token-estimation heuristic used by the whole layer.
 *
 * @packageDocumentation
 */

/* ------------------------------------------------------------------------ *
 * Token estimation
 * ------------------------------------------------------------------------ */

/**
 * Characters per token assumed by the layer-wide token estimator.
 *
 * The de-facto industry heuristic for English prose is roughly four
 * characters per token. Keeping it a named constant means every estimate
 * produced by {@link estimateTokens} is reproducible across the codebase
 * and easy to tune in one place.
 */
export const TOKEN_ESTIMATE_CHARS = 4;

/**
 * Estimates the token footprint of `text` without a real tokenizer.
 *
 * This library has no external dependencies, so we estimate with
 * `max(wordCount, ceil(charCount / TOKEN_ESTIMATE_CHARS))`. The word term
 * keeps long unbroken identifiers from being under-counted; the character
 * term keeps punctuation-heavy prose from being under-counted.
 *
 * @param text - the text to estimate.
 * @returns a non-negative integer token estimate.
 */
export function estimateTokens(text: string): number {
  if (typeof text !== 'string' || text.length === 0) return 0;
  const words = text.split(/\s+/).filter(Boolean).length;
  const byChars = Math.ceil(text.length / TOKEN_ESTIMATE_CHARS);
  return Math.max(words, byChars);
}

/* ------------------------------------------------------------------------ *
 * Promotion vocabulary
 * ------------------------------------------------------------------------ */

/**
 * The three cache-promotion statuses a segment can carry.
 *
 * - `'cold'`:   never (or barely) reused; a candidate for eviction.
 * - `'warm'`:   reused a few times; worth keeping but not pinned.
 * - `'hot'`:    at or above the configured `minHitsForPromotion`; the
 *               segment is treated as a priority cache resident.
 */
export const PROMOTION_STATUSES = ['cold', 'warm', 'hot'] as const;

/**
 * The valid promotion statuses ({@link PROMOTION_STATUSES} as a type).
 */
export type PromotionStatus = (typeof PROMOTION_STATUSES)[number];

/* ------------------------------------------------------------------------ *
 * Data shapes
 * ------------------------------------------------------------------------ */

/**
 * A single stored prompt fragment.
 *
 * A `CachedSegment` is the atomic unit of the caching layer: one contiguous
 * block of prompt text that can be reused verbatim as a prefix or section.
 * The record is immutable-by-convention; mutating code paths (e.g.
 * {@link CacheSegmentStore.recordHit}) replace fields rather than editing
 * in place so that copies handed out to observers stay coherent.
 */
export interface CachedSegment {
  /** Stable identity used to reference the segment in maps and indexes. */
  id: string;
  /** The stored fragment text (exact bytes matter for prefix caching). */
  text: string;
  /** Estimated token footprint of `text` (>= 0). */
  tokens: number;
  /**
   * Optional model name the segment is cached under. Provider prompt caches
   * are model-specific, so segments cached for one model should not be
   * served to another unless `model` is `undefined` (model-agnostic).
   */
  model?: string;
  /** Number of times this segment has been reused (>= 0). */
  hits: number;
  /** Epoch milliseconds when the segment was first stored. */
  createdAt: number;
  /** Epoch milliseconds of the most recent access (hit or refresh). */
  lastAccessAt: number;
}

/**
 * Configuration governing cache behaviour.
 *
 * All fields are optional. Use {@link DEFAULT_CACHE_CONFIG} as a base and
 * {@link normalizeCacheConfig} to merge partial user config with the
 * defaults.
 */
export interface CacheConfig {
  /**
   * Hard ceiling on the number of stored segments. When the store exceeds
   * this cap, least-recently-accessed segments are evicted. Defaults to
   * {@link DEFAULT_MAX_SEGMENTS}.
   */
  maxSegments?: number;
  /**
   * Time-to-live in milliseconds for stored segments. Segments that have
   * not been accessed within `ttlMs` expire and are swept by the lifecycle.
   * `undefined` (or `0`) disables time-based expiry. Defaults to
   * {@link DEFAULT_TTL_MS}.
   */
  ttlMs?: number;
  /**
   * Number of hits after which a segment is promoted to `'hot'` (pinned
   * against eviction). Defaults to {@link DEFAULT_MIN_HITS_FOR_PROMOTION}.
   */
  minHitsForPromotion?: number;
  /**
   * Master switch. When `false`, {@link CacheManager.lookup} never hits and
   * {@link CacheManager.cache} becomes a no-op, letting callers disable the
   * cache at runtime without plumbing. Defaults to `true`.
   */
  enabled?: boolean;
}

/**
 * Outcome of a single cache lookup.
 *
 * `hit` is the authoritative field. When `true`, `segmentId` identifies the
 * matched segment and `savedTokens` is the number of input tokens the
 * caller no longer has to re-send. When `false`, all other fields are
 * `undefined`/`0` and the caller should send the full text.
 */
export interface CacheHit {
  /** The matched segment's id (present only on a hit). */
  segmentId?: string;
  /**
   * Tokens saved by reusing the cached prefix. For an exact hit this equals
   * the segment's own `tokens`; for a prefix hit it equals the tokens in
   * the shared leading bytes.
   */
  savedTokens: number;
  /** `true` when the text was satisfied from cache. */
  hit: boolean;
  /** Model the hit was served under (when the matched segment carried one). */
  model?: string;
  /** The matched segment's total recorded hits (present only on a hit). */
  segmentHits?: number;
}

/**
 * Aggregate statistics over the current cache state.
 *
 * Unlike a snapshot, this is a cheap derived summary recomputed on demand.
 * Token figures are estimates derived from stored `tokens` fields, not live
 * text re-scans.
 */
export interface CacheStats {
  /** Number of stored segments. */
  segments: number;
  /** Sum of every segment's estimated token footprint. */
  totalTokens: number;
  /** Sum of every segment's recorded hits. */
  totalHits: number;
  /** Number of segments promoted to `'hot'`. */
  hot: number;
  /** Number of segments still `'cold'` (never promoted). */
  cold: number;
  /** Number of segments with at least one recorded hit. */
  touched: number;
  /** Average hits per segment (`0` when empty). */
  avgHits: number;
  /** Total estimated tokens that a full reuse of every segment would save. */
  reusableTokens: number;
}

/**
 * Options accepted by lookup/cache operations in the retrieval layer.
 */
export interface CacheOptions {
  /**
   * Model name to scope the operation to. Lookups only match segments whose
   * `model` equals this value (or whose `model` is `undefined`); caching
   * stamps the segment with this model.
   */
  model?: string;
  /**
   * For lookups: when `true`, only exact-text matches count; prefix matches
   * are suppressed. Defaults to `false` (prefix matching allowed).
   */
  exactOnly?: boolean;
  /**
   * For lookups: ignore hits whose `savedTokens` fall below this threshold.
   * Lets callers avoid the bookkeeping overhead of trivially small hits.
   */
  minSavedTokens?: number;
  /**
   * For caching: time-to-live override for the newly stored segment (in
   * milliseconds), taking precedence over the config's global `ttlMs`.
   */
  ttlMs?: number;
}

/**
 * An advisory verdict about a segment's standing in the cache.
 *
 * Produced by promotion/demotion analysis. It is a *recommendation*: the
 * caller (e.g. the lifecycle) decides whether to act on it.
 */
export interface CacheDecision {
  /** The segment under consideration. */
  segment: CachedSegment;
  /** Current promotion status, see {@link PromotionStatus}. */
  status: PromotionStatus;
  /** Hits still needed to reach the next promotion tier (0 when hot). */
  hitsToPromote: number;
  /** Estimated tokens reclaimable if this segment were evicted. */
  reclaimableTokens: number;
  /** `true` when the segment should be dropped (expired or cold + large). */
  evict: boolean;
  /** Human-readable rationale for the verdict. */
  reason: string;
}

/* ------------------------------------------------------------------------ *
 * Defaults
 * ------------------------------------------------------------------------ */

/** Default ceiling on stored segments. */
export const DEFAULT_MAX_SEGMENTS = 256;

/** Default time-to-live for stored segments (10 minutes). */
export const DEFAULT_TTL_MS = 600_000;

/** Default hit count that promotes a segment to `'hot'`. */
export const DEFAULT_MIN_HITS_FOR_PROMOTION = 3;

/** Default warm-tier floor: segments with at least one hit are 'warm'. */
export const WARM_HITS = 1;

/**
 * Canonical default configuration.
 *
 * Cache is enabled, capped at {@link DEFAULT_MAX_SEGMENTS} segments, keeps
 * segments alive for {@link DEFAULT_TTL_MS}, and promotes a segment to
 * `'hot'` after {@link DEFAULT_MIN_HITS_FOR_PROMOTION} reuses.
 */
export const DEFAULT_CACHE_CONFIG: Readonly<CacheConfig> = {
  maxSegments: DEFAULT_MAX_SEGMENTS,
  ttlMs: DEFAULT_TTL_MS,
  minHitsForPromotion: DEFAULT_MIN_HITS_FOR_PROMOTION,
  enabled: true,
} as const;

/* ------------------------------------------------------------------------ *
 * Number helpers
 * ------------------------------------------------------------------------ */

/**
 * Returns `true` when `value` is a finite `number` (not NaN, not Infinity).
 */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Returns `true` when `value` is a finite, non-negative number.
 */
export function isFiniteNonNegative(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

/**
 * Returns `true` when `value` is a non-negative integer token count.
 * Fractions are rejected because token accounting is whole-number based.
 */
export function isNonNegativeInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 0;
}

/**
 * Returns `true` when `value` is a finite, strictly positive number
 * (used for TTLs and capacities, where zero has a distinct meaning).
 */
export function isPositiveNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

/* ------------------------------------------------------------------------ *
 * Domain guards
 * ------------------------------------------------------------------------ */

/**
 * Returns `true` when `id` is a non-empty string. Segment ids are opaque;
 * any non-empty string is acceptable.
 */
export function isSegmentId(id: unknown): id is string {
  return typeof id === 'string' && id.trim().length > 0;
}

/**
 * Returns `true` when `status` is one of the valid promotion statuses.
 */
export function isPromotionStatus(status: unknown): status is PromotionStatus {
  return (
    typeof status === 'string' &&
    (PROMOTION_STATUSES as readonly string[]).includes(status)
  );
}

/**
 * Returns `true` when `value` is a well-formed {@link CachedSegment}.
 */
export function isCachedSegment(value: unknown): value is CachedSegment {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!isSegmentId(v['id'])) return false;
  if (typeof v['text'] !== 'string') return false;
  if (!isNonNegativeInteger(v['tokens'])) return false;
  if (v['model'] !== undefined && typeof v['model'] !== 'string') return false;
  if (!isNonNegativeInteger(v['hits'])) return false;
  if (!isFiniteNumber(v['createdAt'])) return false;
  if (!isFiniteNumber(v['lastAccessAt'])) return false;
  return true;
}

/**
 * Returns `true` when `value` is a structurally valid {@link CacheConfig}.
 * Every field is optional and validated only when present.
 */
export function isCacheConfig(value: unknown): value is CacheConfig {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v['maxSegments'] !== undefined && !isPositiveNumber(v['maxSegments'])) {
    return false;
  }
  if (v['ttlMs'] !== undefined && !isPositiveNumber(v['ttlMs'])) {
    return false;
  }
  if (
    v['minHitsForPromotion'] !== undefined &&
    !isNonNegativeInteger(v['minHitsForPromotion'])
  ) {
    return false;
  }
  if (v['enabled'] !== undefined && typeof v['enabled'] !== 'boolean') {
    return false;
  }
  return true;
}

/**
 * Returns `true` when `value` is a well-formed {@link CacheHit}.
 */
export function isCacheHit(value: unknown): value is CacheHit {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v['hit'] !== 'boolean') return false;
  if (!isNonNegativeInteger(v['savedTokens'])) return false;
  if (v['segmentId'] !== undefined && !isSegmentId(v['segmentId'])) return false;
  if (v['model'] !== undefined && typeof v['model'] !== 'string') return false;
  if (v['segmentHits'] !== undefined && !isNonNegativeInteger(v['segmentHits'])) {
    return false;
  }
  return true;
}

/**
 * Returns `true` when `value` is a well-formed {@link CacheStats}.
 */
export function isCacheStats(value: unknown): value is CacheStats {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  for (const key of ['segments', 'totalTokens', 'totalHits', 'hot', 'cold', 'touched'] as const) {
    if (!isNonNegativeInteger(v[key])) return false;
  }
  if (typeof v['avgHits'] !== 'number' || !Number.isFinite(v['avgHits'])) return false;
  return isNonNegativeInteger(v['reusableTokens']);
}

/**
 * Returns `true` when `value` is a well-formed {@link CacheOptions}.
 */
export function isCacheOptions(value: unknown): value is CacheOptions {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v['model'] !== undefined && typeof v['model'] !== 'string') return false;
  if (v['exactOnly'] !== undefined && typeof v['exactOnly'] !== 'boolean') return false;
  if (v['minSavedTokens'] !== undefined && !isNonNegativeInteger(v['minSavedTokens'])) {
    return false;
  }
  if (v['ttlMs'] !== undefined && !isPositiveNumber(v['ttlMs'])) return false;
  return true;
}

/**
 * Returns `true` when `value` is a well-formed {@link CacheDecision}.
 */
export function isCacheDecision(value: unknown): value is CacheDecision {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!isCachedSegment(v['segment'])) return false;
  if (!isPromotionStatus(v['status'])) return false;
  if (!isNonNegativeInteger(v['hitsToPromote'])) return false;
  if (!isNonNegativeInteger(v['reclaimableTokens'])) return false;
  if (typeof v['evict'] !== 'boolean') return false;
  return typeof v['reason'] === 'string';
}

/* ------------------------------------------------------------------------ *
 * Factories
 * ------------------------------------------------------------------------ */

/**
 * Builds a {@link CachedSegment}, coercing fractional and negative fields
 * to sane values and defaulting timestamps to "now".
 */
export function createCachedSegment(
  id: string,
  text: string,
  tokens: number,
  init: Partial<Pick<CachedSegment, 'model' | 'hits' | 'createdAt' | 'lastAccessAt'>> = {},
): CachedSegment {
  if (!isSegmentId(id)) {
    throw new TypeError(`Invalid segment id: ${String(id)}`);
  }
  if (typeof text !== 'string') {
    throw new TypeError('CachedSegment text must be a string');
  }
  const now = Date.now();
  const hits = Math.max(0, Math.floor(init.hits ?? 0));
  return {
    id,
    text,
    tokens: Math.max(0, Math.floor(tokens)),
    ...(init.model !== undefined ? { model: init.model } : {}),
    hits,
    createdAt: isFiniteNumber(init.createdAt) ? Math.floor(init.createdAt) : now,
    lastAccessAt: isFiniteNumber(init.lastAccessAt)
      ? Math.floor(init.lastAccessAt)
      : init.createdAt !== undefined
        ? Math.floor(init.createdAt)
        : now,
  };
}

/**
 * Builds a "miss" {@link CacheHit}: `hit: false`, zero saved tokens.
 */
export function createCacheMiss(): CacheHit {
  return { hit: false, savedTokens: 0 };
}

/**
 * Builds a "hit" {@link CacheHit} from a matched segment, recording the
 * exact or prefix token savings.
 */
export function createCacheHit(
  segment: CachedSegment,
  savedTokens: number,
  init: Partial<Pick<CacheHit, 'model'>> = {},
): CacheHit {
  const tokens = Math.max(0, Math.floor(savedTokens));
  return {
    segmentId: segment.id,
    savedTokens: tokens,
    hit: tokens > 0,
    ...(init.model !== undefined ? { model: init.model } : {}),
    segmentHits: segment.hits,
  };
}

/**
 * Builds a zeroed {@link CacheStats}.
 */
export function createEmptyCacheStats(): CacheStats {
  return {
    segments: 0,
    totalTokens: 0,
    totalHits: 0,
    hot: 0,
    cold: 0,
    touched: 0,
    avgHits: 0,
    reusableTokens: 0,
  };
}

/* ------------------------------------------------------------------------ *
 * Config normalization
 * ------------------------------------------------------------------------ */

/**
 * Merges a partial {@link CacheConfig} with {@link DEFAULT_CACHE_CONFIG}.
 *
 * The result is a fully-populated config that is always structurally valid.
 * A `ttlMs` of `0` is honoured as "disable time-based expiry" rather than
 * being coerced to the default, because zero has domain meaning here.
 */
export function normalizeCacheConfig(input: Partial<CacheConfig> = {}): CacheConfig {
  const maxSegments =
    input.maxSegments !== undefined
      ? Math.max(1, Math.floor(input.maxSegments))
      : DEFAULT_MAX_SEGMENTS;
  const ttl =
    input.ttlMs !== undefined
      ? Math.max(0, Math.floor(input.ttlMs))
      : DEFAULT_TTL_MS;
  const minHitsForPromotion =
    input.minHitsForPromotion !== undefined
      ? Math.max(0, Math.floor(input.minHitsForPromotion))
      : DEFAULT_MIN_HITS_FOR_PROMOTION;
  return {
    maxSegments,
    ttlMs: ttl > 0 ? ttl : undefined,
    minHitsForPromotion,
    enabled: input.enabled ?? DEFAULT_CACHE_CONFIG.enabled,
  };
}

/* ------------------------------------------------------------------------ *
 * Promotion helpers
 * ------------------------------------------------------------------------ */

/**
 * Classifies a segment's promotion status from its hit count.
 *
 * - `'hot'`  when `hits >= minHitsForPromotion`;
 * - `'warm'` when `hits >= {@link WARM_HITS}` (and below hot);
 * - `'cold'` otherwise (zero hits).
 */
export function promotionStatusFor(
  hits: number,
  minHitsForPromotion: number,
): PromotionStatus {
  const safeMin = Math.max(0, Math.floor(minHitsForPromotion));
  if (hits >= safeMin && safeMin > 0) return 'hot';
  if (hits >= WARM_HITS) return 'warm';
  return 'cold';
}

/**
 * True when a segment is eligible for promotion from `'cold'`/`'warm'` to
 * `'hot'` under the given config: at least one recorded hit and at or above
 * `minHitsForPromotion`.
 */
export function shouldPromote(hits: number, minHitsForPromotion: number): boolean {
  return hits >= Math.max(1, Math.floor(minHitsForPromotion));
}

/**
 * Builds a {@link CacheDecision} for a segment.
 *
 * A segment is marked for eviction when it is `'cold'` and consumes more
 * than the module-level {@link EVICTION_COLD_TOKEN_FLOOR} tokens, or when
 * it is `'warm'` but has gone stale (never touched again after insertion).
 * The verdict is advisory; acting on it is the caller's choice.
 */
export function decideForSegment(
  segment: CachedSegment,
  config: CacheConfig = DEFAULT_CACHE_CONFIG,
): CacheDecision {
  const minHits = normalizeCacheConfig(config).minHitsForPromotion;
  const status = promotionStatusFor(segment.hits, minHits);
  const evict = status === 'cold' && segment.tokens >= EVICTION_COLD_TOKEN_FLOOR;
  return {
    segment,
    status,
    hitsToPromote: status === 'hot' ? 0 : Math.max(0, minHits - segment.hits),
    reclaimableTokens: segment.tokens,
    evict,
    reason: evict
      ? `cold segment occupying ${segment.tokens} tokens`
      : `kept (${status}, ${segment.hits} hits)`,
  };
}

/**
 * Cold segments whose footprint reaches this token floor become immediate
 * eviction candidates. Tuned to prefer dropping heavy, never-reused
 * fragments (e.g. a stale tool schema) over small shared boilerplate.
 */
export const EVICTION_COLD_TOKEN_FLOOR = 200;