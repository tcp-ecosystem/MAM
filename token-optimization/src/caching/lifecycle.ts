/**
 * @file lifecycle.ts
 * @module caching/lifecycle
 *
 * {@link CachingLifecycle}: the supervisory shell around the caching engine.
 *
 * The {@link CacheManager} (`retrieval.ts`) is a pure, stateless-at-rest
 * policy engine: it serves, stores, promotes and evicts on demand. The
 * lifecycle adds the operational concerns a long-lived service needs:
 *
 *  - **Events** — `cached`, `hit`, `promoted`, `evicted`, `pruned`,
 *    `expired`, `cleared` and `reset`, delivered on a typed
 *    {@link EventEmitter}.
 *  - **Periodic TTL sweep** — {@link start}/{@link stop} run a timer that
 *    expires stale segments, enforces the capacity cap and emits the
 *    `pruned`/`expired` events with a summary.
 *  - **Housekeeping** — {@link prune} caps the cache at a target segment
 *    count, {@link expire} drops TTL-expired segments, {@link clear} empties
 *    the cache, {@link reset} stops the timer and fully resets.
 *
 * The lifecycle is the only caching entry point that should be constructed
 * once and shared process-wide.
 *
 * @packageDocumentation
 */

import { EventEmitter } from 'node:events';

import { CacheManager, type CacheManagerOptions, type EvictSummary } from './retrieval.js';
import type {
  CacheConfig,
  CacheDecision,
  CacheHit,
  CacheOptions,
  CacheStats,
  CachedSegment,
} from './types.js';
import { isSegmentId, normalizeCacheConfig } from './types.js';

/* ------------------------------------------------------------------------ *
 * Constants
 * ------------------------------------------------------------------------ */

/**
 * Event names emitted by {@link CachingLifecycle}. Import this object to
 * subscribe without string literals.
 */
export const CACHE_EVENTS = {
  /** Emitted after a segment was stored (or merged) via {@link cache}. */
  cached: 'cached',
  /** Emitted after a successful {@link lookup} served a segment. */
  hit: 'hit',
  /** Emitted when a segment crosses the promotion threshold. */
  promoted: 'promoted',
  /** Emitted after {@link evict} removed segments. */
  evicted: 'evicted',
  /** Emitted after {@link prune} (or a periodic sweep) capped the cache. */
  pruned: 'pruned',
  /** Emitted after {@link expire} (or a periodic sweep) dropped stale ids. */
  expired: 'expired',
  /** Emitted after {@link clear} emptied the cache. */
  cleared: 'cleared',
  /** Emitted after {@link reset}. */
  reset: 'reset',
} as const;

/**
 * Default periodic TTL-sweep interval (milliseconds).
 */
export const DEFAULT_SWEEP_INTERVAL_MS = 5_000;

/**
 * Minimum allowed sweep interval; protects against pathological configs
 * that would spin the event loop.
 */
export const MIN_SWEEP_INTERVAL_MS = 50;

/* ------------------------------------------------------------------------ *
 * Typed event map
 * ------------------------------------------------------------------------ */

/**
 * Typed event payloads. Each key maps to the argument tuple emitted for that
 * event, giving subscribers full type-safety via `on(...)`.
 */
export interface CachingLifecycleEvents {
  /** The segment that was just stored or refreshed. */
  cached: [segment: CachedSegment];
  /** The {@link CacheHit} that was just served. */
  hit: [hit: CacheHit];
  /** The freshly promoted segment id and its hit count. */
  promoted: [id: string, hits: number];
  /** Summary returned by the eviction that ran. */
  evicted: [summary: EvictSummary];
  /** Summary returned by the prune that ran. */
  pruned: [summary: PruneLifecycleSummary];
  /** Ids dropped by the TTL sweep. */
  expired: [ids: string[]];
  /** Number of segments that were cleared. */
  cleared: [removed: number];
  /** The (now empty) manager instance after a full reset. */
  reset: [manager: CacheManager];
}

/**
 * Result of a {@link CachingLifecycle.prune} run.
 */
export interface PruneLifecycleSummary {
  /** Number of segments removed. */
  removed: number;
  /** Number of segments remaining afterwards. */
  remaining: number;
  /** Estimated tokens reclaimed (present when `detail` is set). */
  freedTokens?: number;
}

/**
 * Constructor options for {@link CachingLifecycle}.
 */
export interface CachingLifecycleOptions extends CacheManagerOptions {
  /** Optional initial periodic sweep interval. */
  sweepIntervalMs?: number;
  /** When `true`, the periodic timer starts immediately in the constructor. */
  autoStart?: boolean;
}

/* ------------------------------------------------------------------------ *
 * Lifecycle
 * ------------------------------------------------------------------------ */

/**
 * Supervisory shell that wraps a {@link CacheManager} with events, a
 * periodic TTL sweep and housekeeping.
 *
 * Usage:
 * ```ts
 * const lifecycle = new CachingLifecycle({ minHitsForPromotion: 3 });
 * lifecycle.on('hit', (hit) => metrics.observe('cache.savedTokens', hit.savedTokens));
 * lifecycle.cache('You are a helpful assistant.', 8);
 * lifecycle.start(10_000); // TTL sweep every 10s
 * ```
 */
export class CachingLifecycle extends EventEmitter {
  /** The underlying policy engine. */
  private readonly _manager: CacheManager;
  /** Periodic TTL-sweep timer handle (`null` when stopped). */
  private _timer: NodeJS.Timeout | null;
  /** Sweep interval in milliseconds. */
  private _intervalMs: number;
  /** Capacity ceiling used by {@link prune} when no cap is passed. */
  private _maxSegments: number;

  /**
   * Creates a lifecycle.
   *
   * @param config - partial cache config for the underlying manager.
   * @param options - lifecycle tuning ({@link CachingLifecycleOptions}).
   */
  constructor(config: Partial<CacheConfig> = {}, options: CachingLifecycleOptions = {}) {
    super();
    const normalized = normalizeCacheConfig(config);
    this._manager = new CacheManager(normalized, {
      idFactory: options.idFactory,
    });
    this._timer = null;
    this._intervalMs = Math.max(
      MIN_SWEEP_INTERVAL_MS,
      Math.floor(options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS),
    );
    this._maxSegments = normalized.maxSegments;
    if (options.autoStart === true) this.start();
  }

  /* -------------------------------------------------------------------- *
   * Accessors
   * -------------------------------------------------------------------- */

  /**
   * The underlying cache manager, exposed for advanced callers.
   */
  get manager(): CacheManager {
    return this._manager;
  }

  /**
   * `true` while the periodic TTL-sweep timer is running.
   */
  get running(): boolean {
    return this._timer !== null;
  }

  /**
   * The current sweep interval in milliseconds.
   */
  get sweepIntervalMs(): number {
    return this._intervalMs;
  }

  /**
   * The capacity ceiling used by {@link prune} by default.
   */
  get maxSegments(): number {
    return this._maxSegments;
  }

  /* -------------------------------------------------------------------- *
   * Retrieval delegation (with events)
   * -------------------------------------------------------------------- */

  /**
   * Delegates to {@link CacheManager.lookup}; emits `hit` on success.
   */
  lookup(text: string, options: CacheOptions = {}): CacheHit {
    const hit = this._manager.lookup(text, options);
    if (hit.hit) this.emit(CACHE_EVENTS.hit, hit);
    return hit;
  }

  /**
   * Delegates to {@link CacheManager.cache}; emits `cached` when a segment
   * was stored and `promoted` when it crossed the promotion threshold.
   */
  cache(text: string, tokens?: number, options: CacheOptions = {}): CachedSegment | undefined {
    const before = this._manager.store.get(this._manager.idFor(text, options.model));
    const beforeHits = before?.hits ?? 0;
    const segment = this._manager.cache(text, tokens, options);
    if (segment) {
      this.emit(CACHE_EVENTS.cached, { ...segment });
      const threshold = Math.max(1, Math.floor(this._manager.config.minHitsForPromotion ?? 0));
      if (segment.hits >= threshold && beforeHits < threshold) {
        this.emit(CACHE_EVENTS.promoted, segment.id, segment.hits);
      }
    }
    return segment;
  }

  /**
   * Delegates to {@link CacheManager.prefixScore}.
   */
  prefixScore(texts: readonly string[]): ReturnType<CacheManager['prefixScore']> {
    return this._manager.prefixScore(texts);
  }

  /**
   * Delegates to {@link CacheManager.evict}; emits `evicted` when segments
   * were removed.
   */
  evict(options: Parameters<CacheManager['evict']>[0] = {}): EvictSummary {
    const summary = this._manager.evict(options);
    if (summary.removed > 0) this.emit(CACHE_EVENTS.evicted, summary);
    return summary;
  }

  /**
   * Delegates to {@link CacheManager.remove}.
   */
  remove(id: string): boolean {
    return this._manager.remove(id);
  }

  /**
   * Delegates to {@link CacheManager.decide}.
   */
  decide(id: string): CacheDecision | undefined {
    return this._manager.decide(id);
  }

  /**
   * Delegates to {@link CacheManager.stats}.
   */
  stats(): CacheStats {
    return this._manager.stats();
  }

  /**
   * Delegates to {@link CacheManager.expire}; emits `expired` when ids were
   * dropped.
   */
  expire(at = Date.now()): string[] {
    const ids = this._manager.expire(at);
    if (ids.length > 0) this.emit(CACHE_EVENTS.expired, ids);
    return ids;
  }

  /* -------------------------------------------------------------------- *
   * Housekeeping
   * -------------------------------------------------------------------- */

  /**
   * Expires stale segments and caps the cache at `maxSegments` (defaults to
   * the configured ceiling). Emits `expired` and `pruned`.
   *
   * @param maxSegments - target cap for this run.
   * @returns a {@link PruneLifecycleSummary}.
   */
  prune(maxSegments?: number): PruneLifecycleSummary {
    const expired = this._manager.expire(Date.now());
    if (expired.length > 0) this.emit(CACHE_EVENTS.expired, expired);

    const target = Math.max(1, Math.floor(maxSegments ?? this._maxSegments));
    let removed = 0;
    let freedTokens = 0;
    while (this._manager.store.size > target) {
      const candidates = this._manager.store
        .values()
        .filter((segment) => !this._manager.isHot(segment.id))
        .sort((a, b) => (a.hits - b.hits) || (b.tokens - a.tokens));
      const victim = candidates[0];
      if (!victim) break;
      if (this._manager.remove(victim.id)) {
        removed += 1;
        freedTokens += victim.tokens;
      } else {
        break;
      }
    }

    this._manager.reindex();
    const summary: PruneLifecycleSummary = {
      removed,
      remaining: this._manager.store.size,
    };
    if (removed > 0) summary.freedTokens = freedTokens;
    this.emit(CACHE_EVENTS.pruned, summary);
    return summary;
  }

  /**
   * Empties the cache. The manager's lifetime counters are reset; the
   * periodic timer (if running) keeps running. Emits `cleared`.
   *
   * @returns `this` for chaining.
   */
  clear(): this {
    const removed = this._manager.store.size;
    this._manager.clear();
    this.emit(CACHE_EVENTS.cleared, removed);
    return this;
  }

  /**
   * Fully resets the lifecycle: stops the timer, empties the cache and
   * resets counters. Configuration is preserved. Emits `reset`.
   *
   * @returns `this` for chaining.
   */
  reset(): this {
    this.stop();
    this._manager.clear();
    this.emit(CACHE_EVENTS.reset, this._manager);
    return this;
  }

  /* -------------------------------------------------------------------- *
   * Periodic TTL sweep
   * -------------------------------------------------------------------- */

  /**
   * Starts (or restarts) the periodic TTL sweep.
   *
   * Every `intervalMs` milliseconds the lifecycle expires stale segments
   * and enforces the capacity cap, emitting `expired`/`pruned` when
   * something was dropped. The timer is unref'd so it never keeps the Node
   * process alive on its own.
   *
   * @param intervalMs - sweep cadence; defaults to the constructor value.
   * @returns `this` for chaining.
   */
  start(intervalMs?: number): this {
    if (intervalMs !== undefined) {
      this._intervalMs = Math.max(MIN_SWEEP_INTERVAL_MS, Math.floor(intervalMs));
    }
    this.stop();
    this._timer = setInterval(() => this._sweep(), this._intervalMs);
    if (typeof (this._timer as NodeJS.Timeout).unref === 'function') {
      (this._timer as NodeJS.Timeout).unref();
    }
    return this;
  }

  /**
   * Stops the periodic TTL sweep (if running).
   *
   * @returns `this` for chaining.
   */
  stop(): this {
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }
    return this;
  }

  /* -------------------------------------------------------------------- *
   * Typed emitter overrides
   * -------------------------------------------------------------------- */

  /**
   * Typed `on` that narrows the payload per event name.
   */
  override on<K extends keyof CachingLifecycleEvents>(
    event: K,
    listener: (...args: CachingLifecycleEvents[K]) => void,
  ): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  /**
   * Typed `once` that narrows the payload per event name.
   */
  override once<K extends keyof CachingLifecycleEvents>(
    event: K,
    listener: (...args: CachingLifecycleEvents[K]) => void,
  ): this {
    return super.once(event, listener as (...args: unknown[]) => void);
  }

  /**
   * Typed `off` that narrows the payload per event name.
   */
  override off<K extends keyof CachingLifecycleEvents>(
    event: K,
    listener: (...args: CachingLifecycleEvents[K]) => void,
  ): this {
    return super.off(event, listener as (...args: unknown[]) => void);
  }

  /**
   * Typed `emit` that narrows the payload per event name.
   */
  override emit<K extends keyof CachingLifecycleEvents>(
    event: K,
    ...args: CachingLifecycleEvents[K]
  ): boolean {
    return super.emit(event, ...args);
  }

  /* -------------------------------------------------------------------- *
   * Internals
   * -------------------------------------------------------------------- */

  /**
   * One sweep tick: expire stale segments, cap the cache, then re-sync the
   * index. Used by the periodic timer.
   */
  private _sweep(): void {
    const expired = this._manager.expire(Date.now());
    if (expired.length > 0) this.emit(CACHE_EVENTS.expired, expired);

    const summary = this.prune(this._maxSegments);
    if (summary.removed > 0) {
      this.emit(CACHE_EVENTS.pruned, summary);
    }
  }
}

/**
 * Convenience factory mirroring the constructor for fluent one-liners.
 */
export function createCachingLifecycle(
  config: Partial<CacheConfig> = {},
  options: CachingLifecycleOptions = {},
): CachingLifecycle {
  return new CachingLifecycle(config, options);
}

/**
 * `true` when `value` is a non-empty string that looks like a cache segment
 * id. Re-exported so lifecycle consumers can validate event payloads without
 * importing from `types.js` directly.
 */
export function isValidSegmentId(value: unknown): value is string {
  return isSegmentId(value);
}