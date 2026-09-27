/**
 * The source lifecycle: refresh, prune and periodic maintenance for sources.
 *
 * `SourceLifecycle` is the operational layer of the Sources subsystem. It owns
 * the two maintenance duties a long-running knowledge engine cannot avoid:
 *
 * - **Refresh** — re-hydrate sources from their backing artifacts. File sources
 *   are re-read from disk and URL sources are best-effort re-fetched; when the
 *   content changed, the store is updated and a `'refresh'` event fires.
 * - **Prune** — evict sources that have not been touched within a staleness
 *   window, so the store stays bounded and relevant.
 *
 * It also exposes an ingest convenience surface (which emits `'ingest'`), a
 * `markUpdated` touch, a full `reset`, and an optional periodic timer
 * (`start`/`stop`) that runs refreshes on an interval. All events are emitted
 * through a typed {@link SourceLifecycleEvents} map on an `EventEmitter` base.
 *
 * @packageDocumentation
 * @module sources/lifecycle
 */

import { EventEmitter } from 'node:events';

import type {
  KnowledgeSource,
  SourceId,
  SourceConfig,
  TextIngestOptions,
  FileIngestOptions,
  UrlIngestOptions,
  IngestResult,
  Timestamp,
} from './types.js';
import { DEFAULT_REFRESH_INTERVAL_MS, DEFAULT_TTL_MS } from './types.js';
import { KnowledgeSourceStore } from './store.js';

/**
 * Typed event map for {@link SourceLifecycle}.
 *
 * Each key maps to the argument tuple passed to listeners. Events are emitted
 * after the corresponding operation completes.
 */
export interface SourceLifecycleEvents {
  /** Fired after one or more sources are re-hydrated. Args: `(ids, at)`. */
  refresh: [ids: readonly SourceId[], at: Timestamp];
  /** Fired after stale sources are pruned. Args: `(removed, at)`. */
  prune: [removed: readonly KnowledgeSource[], at: Timestamp];
  /** Fired after a source is ingested through the lifecycle. Args: `(result, at)`. */
  ingest: [result: IngestResult, at: Timestamp];
  /** Fired after the store is cleared. Args: `(count, at)`. */
  reset: [count: number, at: Timestamp];
  /** Fired when the periodic timer starts. Args: `(at)`. */
  start: [at: Timestamp];
  /** Fired when the periodic timer stops. Args: `(at)`. */
  stop: [at: Timestamp];
}

/**
 * Construction options for {@link SourceLifecycle}.
 */
export interface SourceLifecycleOptions {
  /**
   * Interval in milliseconds between periodic refreshes. Defaults to
   * {@link DEFAULT_REFRESH_INTERVAL_MS}.
   */
  readonly refreshIntervalMs?: number;

  /**
   * When `true`, the periodic timer is started immediately on construction.
   * Defaults to `false`.
   */
  readonly autoStart?: boolean;

  /**
   * Default staleness window in milliseconds used by {@link SourceLifecycle.prune}
   * when the caller omits one. Defaults to {@link DEFAULT_TTL_MS}.
   */
  readonly defaultTtlMs?: number;

  /**
   * Store configuration forwarded when the lifecycle builds its own store.
   * Ignored when `store` is supplied.
   */
  readonly storeConfig?: SourceConfig;

  /**
   * Optional clock used instead of `Date.now()`.
   */
  readonly now?: () => Timestamp;
}

/**
 * Aggregate statistics about lifecycle behaviour.
 */
export interface LifecycleStats {
  /** Number of refresh passes completed since construction. */
  readonly refreshes: number;
  /** Total sources re-hydrated by refreshes. */
  readonly refreshedSources: number;
  /** Number of prune passes completed. */
  readonly prunes: number;
  /** Total sources evicted by prunes. */
  readonly prunedSources: number;
  /** Number of sources ingested through the lifecycle. */
  readonly ingests: number;
  /** Whether the periodic timer is running. */
  readonly running: boolean;
  /** Epoch-millisecond time of the last refresh, or `null`. */
  readonly lastRefreshAt: Timestamp | null;
  /** Epoch-millisecond time of the last prune, or `null`. */
  readonly lastPruneAt: Timestamp | null;
  /** Epoch-millisecond time of the last ingest, or `null`. */
  readonly lastIngestAt: Timestamp | null;
  /** Epoch-millisecond construction time. */
  readonly createdAt: Timestamp;
}

/**
 * Drives refresh, prune, ingest and periodic maintenance for a source store,
 * emitting typed lifecycle events.
 *
 * @example
 * ```ts
 * const store = new KnowledgeSourceStore();
 * const lifecycle = new SourceLifecycle(store, { autoStart: true });
 * lifecycle.on('refresh', (ids) => console.log('refreshed', ids));
 * lifecycle.on('prune', (removed) => console.log('pruned', removed.length));
 * await lifecycle.ingestFile('readme', './README.md');
 * lifecycle.start(30_000); // refresh every 30s
 * // later…
 * lifecycle.stop();
 * ```
 */
export class SourceLifecycle extends EventEmitter {
  /** The store this lifecycle manages. */
  private readonly store: KnowledgeSourceStore;

  /** Resolved options. */
  private readonly options: {
    refreshIntervalMs: number;
    defaultTtlMs: number;
    now: () => Timestamp;
  };

  /** Periodic refresh timer handle, or `null` when not running. */
  private timer: ReturnType<typeof setInterval> | null = null;

  /** Behaviour counters. */
  private counters = {
    refreshes: 0,
    refreshedSources: 0,
    prunes: 0,
    prunedSources: 0,
    ingests: 0,
  };

  /** Epoch-millisecond time of the last refresh, or `null`. */
  private lastRefreshAt: Timestamp | null = null;

  /** Epoch-millisecond time of the last prune, or `null`. */
  private lastPruneAt: Timestamp | null = null;

  /** Epoch-millisecond time of the last ingest, or `null`. */
  private lastIngestAt: Timestamp | null = null;

  /** Epoch-millisecond construction time. */
  private readonly createdAt: Timestamp;

  /**
   * Construct a lifecycle.
   *
   * @param store - the store to manage (defaults to a fresh store)
   * @param options - construction options
   */
  constructor(
    store?: KnowledgeSourceStore,
    options: SourceLifecycleOptions = {},
  ) {
    super();
    const now = options.now ?? (() => Date.now());
    this.store = store ?? new KnowledgeSourceStore(options.storeConfig);
    this.options = {
      refreshIntervalMs: Math.max(
        1,
        options.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS,
      ),
      defaultTtlMs: options.defaultTtlMs ?? DEFAULT_TTL_MS,
      now,
    };
    this.createdAt = now();
    if (options.autoStart) {
      this.start();
    }
  }

  /** @returns the store this lifecycle manages. */
  get storeRef(): KnowledgeSourceStore {
    return this.store;
  }

  /** @returns `true` when the periodic timer is running. */
  get running(): boolean {
    return this.timer !== null;
  }

  /** @returns the epoch-millisecond time of the last refresh, or `null`. */
  get lastRefresh(): Timestamp | null {
    return this.lastRefreshAt;
  }

  /**
   * Type-safe `on` for {@link SourceLifecycleEvents}.
   *
   * @param event - the event name
   * @param listener - the listener
   * @returns `this` for chaining
   */
  override on<K extends keyof SourceLifecycleEvents>(
    event: K,
    listener: (...args: SourceLifecycleEvents[K]) => void,
  ): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  /**
   * Type-safe `once` for {@link SourceLifecycleEvents}.
   *
   * @param event - the event name
   * @param listener - the listener
   * @returns `this` for chaining
   */
  override once<K extends keyof SourceLifecycleEvents>(
    event: K,
    listener: (...args: SourceLifecycleEvents[K]) => void,
  ): this {
    return super.once(event, listener as (...args: unknown[]) => void);
  }

  /**
   * Type-safe `emit` for {@link SourceLifecycleEvents}.
   *
   * @param event - the event name
   * @param args - the event payload
   * @returns `true` when any listener handled the event
   */
  override emit<K extends keyof SourceLifecycleEvents>(
    event: K,
    ...args: SourceLifecycleEvents[K]
  ): boolean {
    return super.emit(event, ...args);
  }

  /**
   * Refresh a single source from its backing artifact.
   *
   * For `'file'` sources the path is re-read from disk; for `'url'` sources the
   * body is best-effort re-fetched. When the content differs from what is
   * stored, the source is updated and a `'refresh'` event fires. Text/memory
   * sources have no external backing, so they are merely touched.
   *
   * @param id - the source id to refresh
   * @returns the refreshed source, or `undefined` when not registered
   */
  async refresh(id: SourceId): Promise<KnowledgeSource | undefined> {
    const source = this.store.get(id);
    if (!source) {
      return undefined;
    }
    const now = this.options.now();

    if (source.kind === 'file' && source.path) {
      await this.refreshFile(source);
    } else if (source.kind === 'url' && source.url) {
      await this.refreshUrl(source);
    } else {
      this.store.update(id, { updatedAt: now });
    }

    this.counters.refreshes += 1;
    this.counters.refreshedSources += 1;
    this.lastRefreshAt = now;
    this.emit('refresh', [id], now);
    return this.store.get(id);
  }

  /**
   * Refresh every registered source.
   *
   * Individual failures are collected and reported; a failing refresh never
   * aborts the pass.
   *
   * @returns the number of sources successfully refreshed
   */
  async refreshAll(): Promise<number> {
    const ids = this.store.keys();
    const now = this.options.now();
    let ok = 0;
    for (const id of ids) {
      try {
        await this.refresh(id);
        ok += 1;
      } catch {
        // A failed refresh for one source must not abort the pass.
      }
    }
    this.counters.refreshes += 1;
    this.lastRefreshAt = now;
    return ok;
  }

  /**
   * Prune sources not touched within a staleness window.
   *
   * A source's "touch time" is `updatedAt ?? createdAt`. Sources whose touch
   * time is older than `now - olderThanMs` are removed.
   *
   * @param olderThanMs - staleness window in milliseconds; defaults to the
   * configured {@link SourceLifecycleOptions.defaultTtlMs}
   * @returns the removed sources
   */
  prune(olderThanMs?: number): KnowledgeSource[] {
    const windowMs = olderThanMs ?? this.options.defaultTtlMs;
    const cutoff = this.options.now() - windowMs;
    const removed: KnowledgeSource[] = [];
    for (const id of this.store.keys()) {
      const source = this.store.get(id);
      if (!source) {
        continue;
      }
      const touch = source.updatedAt ?? source.createdAt;
      if (touch < cutoff) {
        if (this.store.unregister(id)) {
          removed.push(source);
        }
      }
    }
    if (removed.length > 0) {
      this.counters.prunes += 1;
      this.counters.prunedSources += removed.length;
      this.lastPruneAt = this.options.now();
      this.emit('prune', removed, this.lastPruneAt);
    }
    return removed;
  }

  /**
   * Mark a source as updated (a "touch") without changing its content.
   *
   * @param id - the source id
   * @returns `true` when the source was touched
   */
  markUpdated(id: SourceId): boolean {
    return this.store.update(id, {}) !== undefined;
  }

  /**
   * Remove every source from the store and emit `'reset'`.
   *
   * @returns the number of sources removed
   */
  reset(): number {
    const count = this.store.clear();
    const now = this.options.now();
    this.lastRefreshAt = null;
    this.lastPruneAt = null;
    this.emit('reset', count, now);
    return count;
  }

  /**
   * Ingest free text through the lifecycle, emitting `'ingest'`.
   *
   * @param id - the source id
   * @param text - the text content
   * @param opts - per-call options
   * @returns the ingestion result
   */
  async ingestText(
    id: SourceId,
    text: string,
    opts: TextIngestOptions = {},
  ): Promise<IngestResult> {
    const result = await this.store.ingestText(id, text, opts);
    this.counters.ingests += 1;
    this.lastIngestAt = this.options.now();
    this.emit('ingest', result, this.lastIngestAt);
    return result;
  }

  /**
   * Ingest a file through the lifecycle, emitting `'ingest'`.
   *
   * @param id - the source id
   * @param path - the file path
   * @param opts - per-call options
   * @returns the ingestion result
   */
  async ingestFile(
    id: SourceId,
    path: string,
    opts: FileIngestOptions = {},
  ): Promise<IngestResult> {
    const result = await this.store.ingestFile(id, path, opts);
    this.counters.ingests += 1;
    this.lastIngestAt = this.options.now();
    this.emit('ingest', result, this.lastIngestAt);
    return result;
  }

  /**
   * Ingest a URL through the lifecycle, emitting `'ingest'`.
   *
   * @param id - the source id
   * @param url - the remote location
   * @param opts - per-call options
   * @returns the ingestion result
   */
  async ingestUrl(
    id: SourceId,
    url: string,
    opts: UrlIngestOptions = {},
  ): Promise<IngestResult> {
    const result = await this.store.ingestUrl(id, url, opts);
    this.counters.ingests += 1;
    this.lastIngestAt = this.options.now();
    this.emit('ingest', result, this.lastIngestAt);
    return result;
  }

  /**
   * Start the periodic refresh timer.
   *
   * If the timer is already running this is a no-op. A refresh pass runs
   * immediately, then again every `intervalMs`. The timer is `unref`'d so it
   * never keeps the process alive on its own.
   *
   * @param intervalMs - override the configured refresh interval
   */
  start(intervalMs?: number): void {
    if (this.running) {
      return;
    }
    const interval = Math.max(
      1,
      intervalMs ?? this.options.refreshIntervalMs,
    );
    this.emit('start', this.options.now());
    void this.refreshAll();
    this.timer = setInterval(() => {
      void this.refreshAll();
    }, interval);
    this.timer.unref();
  }

  /**
   * Stop the periodic refresh timer.
   */
  stop(): void {
    if (!this.timer) {
      return;
    }
    clearInterval(this.timer);
    this.timer = null;
    this.emit('stop', this.options.now());
  }

  /**
   * Aggregate statistics about lifecycle behaviour.
   *
   * @returns a {@link LifecycleStats} snapshot
   */
  stats(): LifecycleStats {
    return {
      refreshes: this.counters.refreshes,
      refreshedSources: this.counters.refreshedSources,
      prunes: this.counters.prunes,
      prunedSources: this.counters.prunedSources,
      ingests: this.counters.ingests,
      running: this.running,
      lastRefreshAt: this.lastRefreshAt,
      lastPruneAt: this.lastPruneAt,
      lastIngestAt: this.lastIngestAt,
      createdAt: this.createdAt,
    };
  }

  /**
   * Re-hydrate a file source from disk.
   *
   * @param source - the file source to refresh
   */
  private async refreshFile(source: KnowledgeSource): Promise<void> {
    if (!source.path) {
      return;
    }
    const { readFile } = await import('node:fs/promises');
    const fresh = await readFile(source.path, 'utf8');
    if (fresh !== source.content) {
      this.store.update(source.id, {
        content: fresh,
        updatedAt: this.options.now(),
      });
    } else {
      this.store.update(source.id, { updatedAt: this.options.now() });
    }
  }

  /**
   * Re-hydrate a URL source with a best-effort fetch.
   *
   * A network failure leaves the existing content in place and touches the
   * source so it survives the next prune window.
   *
   * @param source - the URL source to refresh
   */
  private async refreshUrl(source: KnowledgeSource): Promise<void> {
    if (!source.url) {
      return;
    }
    try {
      const httpsModule = await import('node:https');
      const httpModule = await import('node:http');
      const parsed = new URL(source.url);
      const get = parsed.protocol === 'https:' ? httpsModule.get : httpModule.get;
      const content = await new Promise<string>((resolvePromise, rejectPromise) => {
        const request = get(source.url as string, (response) => {
          const status = response.statusCode ?? 0;
          if (status < 200 || status >= 300) {
            response.resume();
            rejectPromise(new Error(`HTTP ${status}`));
            return;
          }
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => {
            resolvePromise(Buffer.concat(chunks).toString('utf8'));
          });
          response.on('error', rejectPromise);
        });
        request.on('error', rejectPromise);
      });
      if (content !== source.content) {
        this.store.update(source.id, {
          content,
          updatedAt: this.options.now(),
        });
      } else {
        this.store.update(source.id, { updatedAt: this.options.now() });
      }
    } catch {
      this.store.update(source.id, { updatedAt: this.options.now() });
    }
  }
}

/**
 * Helper: compute a source's effective touch time.
 *
 * @param source - the source
 * @returns `updatedAt ?? createdAt`
 */
export function touchTime(source: KnowledgeSource): Timestamp {
  return source.updatedAt ?? source.createdAt;
}

/**
 * Helper: test whether a source is stale relative to a cutoff.
 *
 * @param source - the source
 * @param cutoff - the epoch-millisecond cutoff
 * @returns `true` when the source has not been touched since the cutoff
 */
export function isStale(source: KnowledgeSource, cutoff: Timestamp): boolean {
  return touchTime(source) < cutoff;
}

/**
 * Helper: build a {@link SourceLifecycle} owning a fresh store.
 *
 * @param options - lifecycle options
 * @returns the constructed lifecycle
 */
export function createLifecycle(
  options: SourceLifecycleOptions = {},
): SourceLifecycle {
  return new SourceLifecycle(new KnowledgeSourceStore(options.storeConfig), options);
}