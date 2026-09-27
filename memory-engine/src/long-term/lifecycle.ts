/**
 * @fileOverview Lifecycle management for the long-term memory layer.
 *
 * {@link LongTermLifecycle} owns the temporal and durability concerns that a
 * raw store does not: it schedules periodic auto-persistence, performs eviction
 * (`prune`), age-based soft deletion (`archiveOld`), duplicate consolidation
 * (`consolidate`), and full resets (`reset`), while keeping the companion
 * {@link LongTermIndex} in sync.
 *
 * The class extends an internal {@link EventEmitter} and exposes typed `on` /
 * `off` / `once` methods so consumers can react to lifecycle moments:
 *
 *   - `persist`    after every successful disk write
 *   - `prune`      after an eviction pass
 *   - `archive`    after an age-based archiving pass
 *   - `consolidate`after a merge pass
 *   - `load`, `start`, `stop`, `error`
 *
 * All maintenance methods are idempotent and safe to call concurrently; a
 * guarded in-flight lock prevents overlapping persistence writes.
 */

import { EventEmitter } from 'node:events';

import {
  LongTermConfig,
  LongTermEntry,
  normalizeImportance,
  sortByNewest,
  unionTags,
  valuesEqual,
  formatDuration,
} from './types.js';

import { LongTermStore } from './store.js';
import { LongTermIndex } from './index.js';

/** Event payload types published by {@link LongTermLifecycle}. */
export interface LongTermLifecycleEvents {
  persist: { timestamp: number; count: number; durationMs: number; path?: string };
  load: { timestamp: number; count: number; durationMs: number; path?: string };
  prune: { timestamp: number; removed: LongTermEntry[]; retained: number };
  archive: { timestamp: number; archived: LongTermEntry[] };
  consolidate: {
    timestamp: number;
    merged: Array<{ keptId: string; removedIds: string[] }>;
    before: number;
    after: number;
  };
  start: { timestamp: number; intervalMs: number };
  stop: { timestamp: number };
  reset: { timestamp: number; removed: number };
  error: { error: unknown };
}

/** Union of every event name the lifecycle can emit. */
export type LongTermLifecycleEventName = keyof LongTermLifecycleEvents;

/** Options accepted by {@link LongTermLifecycle.prune}. */
export interface PruneOptions {
  /** Override the configured max entry count for this pass. */
  maxEntries?: number;
  /**
   * When true, archived entries are evicted first before any live entry is
   * considered (default true).
   */
  dropArchivedFirst?: boolean;
  /**
   * When true, entries at or below the configured importance threshold are
   * treated as the first eviction candidates regardless of age.
   */
  importanceAware?: boolean;
}

/** Options accepted by {@link LongTermLifecycle.archiveOld}. */
export interface ArchiveOldOptions {
  /**
   * Age, in milliseconds, beyond which a live entry is archived.  Defaults to
   * 90 days.
   */
  olderThanMs?: number;
  /**
   * Only archive entries whose importance is at or below this threshold,
   * protecting precious memories from age-based archiving.
   */
  maxImportance?: number;
}

/** Options accepted by {@link LongTermLifecycle.consolidate}. */
export interface ConsolidateOptions {
  /**
   * When true, entries are considered duplicates only when their values are
   * deeply equal AND their tag sets overlap (default true).
   */
  requireTagOverlap?: boolean;
  /**
   * When true, the surviving entry absorbs the union of all tags and the
   * highest importance; metadata objects are shallow-merged.
   */
  mergeMetadata?: boolean;
}

/** Return value of {@link LongTermLifecycle.consolidate}. */
export interface ConsolidateResult {
  merged: Array<{ keptId: string; removedIds: string[] }>;
  before: number;
  after: number;
}

/** Default age (in ms) for {@link LongTermLifecycle.archiveOld}: 90 days. */
const DEFAULT_ARCHIVE_AGE_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Orchestrates persistence, pruning, consolidation, and eventing around a
 * {@link LongTermStore} and an optional {@link LongTermIndex}.
 *
 * @example
 * ```ts
 * const lifecycle = new LongTermLifecycle(store, {
 *   index,
 *   autoStart: true,
 *   intervalMs: 30_000,
 * });
 * lifecycle.on('prune', ({ removed }) => console.log(`pruned ${removed.length}`));
 * lifecycle.stop();
 * ```
 */
export class LongTermLifecycle {
  private readonly store: LongTermStore;
  private readonly index?: LongTermIndex;
  private readonly emitter = new EventEmitter();
  private timer: NodeJS.Timeout | null = null;
  private intervalMs: number;
  private running = false;
  private persisting = false;

  /**
   * Creates a lifecycle manager.  When `options.autoStart` is true (default),
   * the periodic auto-persist timer starts immediately.
   */
  constructor(
    store: LongTermStore,
    options: {
      index?: LongTermIndex;
      intervalMs?: number;
      autoStart?: boolean;
    } = {},
  ) {
    this.store = store;
    this.index = options.index;
    const configured = store.getConfig().persistIntervalMs;
    this.intervalMs = options.intervalMs ?? configured ?? 60_000;
    if (options.autoStart !== false) {
      this.start();
    }
  }

  /* ------------------------------------------------------------------ *
   * Timer control
   * ------------------------------------------------------------------ */

  /**
   * Starts the periodic auto-persist timer.  Each tick calls `persist()` if
   * the store is dirty and has a persistence path configured.  Starting an
   * already-running lifecycle is a no-op.
   *
   * @returns `this` for chaining.
   */
  start(): this {
    if (this.running) {
      return this;
    }
    this.running = true;
    this.timer = setInterval(() => {
      void this.autoPersistTick();
    }, this.intervalMs);
    this.timer.unref?.();
    this.emit('start', { timestamp: Date.now(), intervalMs: this.intervalMs });
    return this;
  }

  /**
   * Stops the periodic auto-persist timer.  Pending in-flight persistence is
   * allowed to finish; no new ticks are scheduled.
   *
   * @returns `this` for chaining.
   */
  stop(): this {
    if (!this.running) {
      return this;
    }
    this.running = false;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.emit('stop', { timestamp: Date.now() });
    return this;
  }

  /** Returns `true` while the periodic timer is active. */
  isRunning(): boolean {
    return this.running;
  }

  /** Returns the interval (in ms) at which auto-persist ticks fire. */
  getIntervalMs(): number {
    return this.intervalMs;
  }

  /**
   * Changes the tick interval.  When the lifecycle is running the timer is
   * restarted with the new interval.
   */
  setIntervalMs(intervalMs: number): this {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new TypeError(`intervalMs must be a positive number; got ${intervalMs}`);
    }
    this.intervalMs = intervalMs;
    if (this.running) {
      this.stop();
      this.start();
    }
    return this;
  }

  /* ------------------------------------------------------------------ *
   * Persistence
   * ------------------------------------------------------------------ */

  /**
   * Writes the current store contents to disk.  Runs at most one write at a
   * time; concurrent callers await the in-flight write.  A no-op when no
   * persistence path is configured.
   *
   * @returns the number of entries persisted.
   */
  async persist(): Promise<number> {
    if (this.persisting) {
      return 0;
    }
    this.persisting = true;
    const started = Date.now();
    try {
      const count = await this.store.persist();
      this.emit('persist', {
        timestamp: started,
        count,
        durationMs: Date.now() - started,
        path: this.store.getConfig().persistPath,
      });
      return count;
    } catch (error) {
      this.emit('error', { error });
      throw error;
    } finally {
      this.persisting = false;
    }
  }

  /**
   * Loads the on-disk snapshot into the store and re-syncs the index.
   *
   * @returns the number of entries loaded.
   */
  async load(options?: { replace?: boolean }): Promise<number> {
    const started = Date.now();
    const count = await this.store.load({ replace: options?.replace ?? true });
    this.syncIndex();
    this.emit('load', {
      timestamp: started,
      count,
      durationMs: Date.now() - started,
      path: this.store.getConfig().persistPath,
    });
    return count;
  }

  /** Internal tick guard used by the timer. */
  private async autoPersistTick(): Promise<void> {
    if (!this.store.getConfig().persistPath) {
      return;
    }
    if (!this.store.isDirty()) {
      return;
    }
    try {
      await this.persist();
    } catch (error) {
      this.emit('error', { error });
    }
  }

  /* ------------------------------------------------------------------ *
   * Maintenance passes
   * ------------------------------------------------------------------ */

  /**
   * Evicts entries until the store is at or below `maxEntries`.
   *
   * Eviction order, from most-to-least disposable:
   *
   *   1. archived entries (when `dropArchivedFirst`),
   *   2. low-importance live entries (when `importanceAware`), oldest first,
   *   3. otherwise the oldest live entries.
   *
   * Evicted entries are deleted permanently (they are returned in the result
   * so callers can archive them elsewhere if desired).
   *
   * @returns the entries that were evicted.
   */
  prune(options?: PruneOptions): LongTermEntry[] {
    const maxEntries = options?.maxEntries ?? this.store.getConfig().maxEntries;
    if (maxEntries < 0) {
      throw new TypeError(`maxEntries must be >= 0; got ${maxEntries}`);
    }
    if (maxEntries === 0) {
      const removed = this.store.getAll({ includeArchived: true });
      const count = this.store.clear();
      this.syncIndex();
      this.emit('prune', {
        timestamp: Date.now(),
        removed,
        retained: 0,
      });
      return removed;
    }
    let all = this.store.getAll({ includeArchived: true });
    if (all.length <= maxEntries) {
      return [];
    }
    let remainingExcess = all.length - maxEntries;
    const removed: LongTermEntry[] = [];

    if (options?.dropArchivedFirst !== false) {
      const { live, archived } = this.splitArchived(all);
      for (const entry of archived) {
        if (remainingExcess <= 0) {
          break;
        }
        this.store.delete(entry.id);
        removed.push(entry);
        remainingExcess -= 1;
      }
      all = live;
    }

    if (remainingExcess > 0) {
      const ranked = options?.importanceAware !== false
        ? this.rankForEviction(all)
        : [...all].sort((a, b) => a.createdAt - b.createdAt);
      for (const entry of ranked) {
        if (remainingExcess <= 0) {
          break;
        }
        this.store.delete(entry.id);
        removed.push(entry);
        remainingExcess -= 1;
      }
    }

    this.syncIndex();
    this.emit('prune', {
      timestamp: Date.now(),
      removed,
      retained: this.store.size(),
    });
    return removed;
  }

  /**
   * Archives live entries whose age exceeds `olderThanMs` (and whose
   * importance is at or below `maxImportance` when supplied).  Archived
   * entries stay on disk but drop out of normal retrieval.
   *
   * @returns the entries that were archived.
   */
  archiveOld(options?: ArchiveOldOptions): LongTermEntry[] {
    const olderThanMs = options?.olderThanMs ?? DEFAULT_ARCHIVE_AGE_MS;
    const now = Date.now();
    const archived: LongTermEntry[] = [];
    for (const entry of this.store.getAll()) {
      const age = now - (entry.updatedAt ?? entry.createdAt);
      if (age < olderThanMs) {
        continue;
      }
      if (
        options?.maxImportance !== undefined &&
        normalizeImportance(entry.importance) > normalizeImportance(options.maxImportance)
      ) {
        continue;
      }
      if (this.store.archive(entry.id)) {
        archived.push(entry);
      }
    }
    if (archived.length > 0) {
      this.syncIndex();
      this.emit('archive', { timestamp: now, archived });
    }
    return archived;
  }

  /**
   * Merges duplicate-ish entries: records whose values are deeply equal (and,
   * optionally, whose tag sets overlap) are collapsed into a single survivor.
   *
   * The survivor keeps the oldest `createdAt`, the union of all tags, the
   * highest importance, the most recent `updatedAt`, and (when
   * `mergeMetadata`) a shallow merge of every metadata object.  Sources are
   * concatenated with a separator when they differ.
   *
   * @returns a {@link ConsolidateResult} describing the merge.
   */
  consolidate(options?: ConsolidateOptions): ConsolidateResult {
    const before = this.store.size();
    const all = this.store.getAll({ includeArchived: true });
    const merged: Array<{ keptId: string; removedIds: string[] }> = [];
    const survivors = new Map<string, LongTermEntry>();
    const consumed = new Set<string>();

    for (let i = 0; i < all.length; i += 1) {
      const entry = all[i];
      if (entry === undefined || consumed.has(entry.id)) {
        continue;
      }
      const group = [entry];
      consumed.add(entry.id);
      for (let j = i + 1; j < all.length; j += 1) {
        const other = all[j];
        if (other === undefined || consumed.has(other.id)) {
          continue;
        }
        if (!valuesEqual(entry.value, other.value)) {
          continue;
        }
        if (
          options?.requireTagOverlap !== false &&
          !this.tagsOverlap(entry, other)
        ) {
          continue;
        }
        group.push(other);
        consumed.add(other.id);
      }
      if (group.length === 1) {
        survivors.set(entry.id, entry);
        continue;
      }
      const survivor = this.mergeGroup(group, options);
      survivors.set(survivor.id, survivor);
      merged.push({
        keptId: survivor.id,
        removedIds: group
          .filter((member) => member.id !== survivor.id)
          .map((member) => member.id),
      });
    }

    for (const [id, survivor] of survivors) {
      this.store.put(survivor);
    }
    const retainedIds = new Set(survivors.keys());
    for (const entry of all) {
      if (!retainedIds.has(entry.id)) {
        this.store.delete(entry.id);
      }
    }
    this.syncIndex();
    const after = this.store.size();
    if (merged.length > 0) {
      this.emit('consolidate', {
        timestamp: Date.now(),
        merged,
        before,
        after,
      });
    }
    return { merged, before, after };
  }

  /**
   * Destroys every entry in the store (and empties the index).  The store is
   * left empty but configured exactly as before.
   *
   * @returns the number of entries removed.
   */
  reset(): number {
    const removed = this.store.clear();
    this.index?.clear();
    this.emit('reset', { timestamp: Date.now(), removed });
    return removed;
  }

  /* ------------------------------------------------------------------ *
   * Eventing
   * ------------------------------------------------------------------ */

  /**
   * Subscribes to a lifecycle event.  Returns an unsubscribe function, so it
   * can be used with `useEffect`-style teardown in frameworks.
   */
  on<K extends LongTermLifecycleEventName>(
    event: K,
    listener: (payload: LongTermLifecycleEvents[K]) => void,
  ): () => void {
    this.emitter.on(event, listener);
    return () => this.emitter.off(event, listener);
  }

  /** Removes a previously registered event listener. */
  off<K extends LongTermLifecycleEventName>(
    event: K,
    listener: (payload: LongTermLifecycleEvents[K]) => void,
  ): this {
    this.emitter.off(event, listener);
    return this;
  }

  /** Subscribes to a lifecycle event for exactly one emission. */
  once<K extends LongTermLifecycleEventName>(
    event: K,
    listener: (payload: LongTermLifecycleEvents[K]) => void,
  ): this {
    this.emitter.once(event, listener);
    return this;
  }

  /** Returns the number of listeners subscribed to a given event. */
  listenerCount(event: LongTermLifecycleEventName): number {
    return this.emitter.listenerCount(event);
  }

  /* ------------------------------------------------------------------ *
   * Accessors
   * ------------------------------------------------------------------ */

  /** Returns the store this lifecycle manages. */
  getStore(): LongTermStore {
    return this.store;
  }

  /** Returns the companion index, if one was supplied. */
  getIndex(): LongTermIndex | undefined {
    return this.index;
  }

  /**
   * Rebuilds the companion index from the current store contents.  Call this
   * after mutating the store directly (bypassing the lifecycle) to resync the
   * index.
   */
  syncIndex(): number {
    if (this.index === undefined) {
      return 0;
    }
    return this.index.rebuild(this.store.getAll({ includeArchived: true }));
  }

  /* ------------------------------------------------------------------ *
   * Internal helpers
   * ------------------------------------------------------------------ */

  /** Emits a typed lifecycle event. */
  private emit<K extends LongTermLifecycleEventName>(
    event: K,
    payload: LongTermLifecycleEvents[K],
  ): void {
    this.emitter.emit(event, payload);
  }

  /** Splits entries into live / archived buckets. */
  private splitArchived(
    entries: LongTermEntry[],
  ): { live: LongTermEntry[]; archived: LongTermEntry[] } {
    const live: LongTermEntry[] = [];
    const archived: LongTermEntry[] = [];
    for (const entry of entries) {
      (entry.archived === true ? archived : live).push(entry);
    }
    return { live, archived };
  }

  /**
   * Ranks entries for eviction: low importance first (oldest within a
   * tier), high importance last.
   */
  private rankForEviction(entries: LongTermEntry[]): LongTermEntry[] {
    const threshold = this.store.getImportanceThreshold();
    const low: LongTermEntry[] = [];
    const high: LongTermEntry[] = [];
    for (const entry of entries) {
      const importance = normalizeImportance(entry.importance);
      (importance <= threshold ? low : high).push(entry);
    }
    low.sort((a, b) => a.createdAt - b.createdAt);
    high.sort((a, b) => a.createdAt - b.createdAt);
    return [...low, ...high];
  }

  /** Returns true when two entries share at least one tag. */
  private tagsOverlap(a: LongTermEntry, b: LongTermEntry): boolean {
    const aTags = new Set(a.tags ?? []);
    for (const tag of b.tags ?? []) {
      if (aTags.has(tag)) {
        return true;
      }
    }
    return false;
  }

  /** Merges a group of duplicate entries into one survivor entry. */
  private mergeGroup(
    group: LongTermEntry[],
    options?: ConsolidateOptions,
  ): LongTermEntry {
    const sorted = sortByNewest(group);
    const oldest = [...group].sort((a, b) => a.createdAt - b.createdAt)[0];
    const survivorId = oldest?.id ?? group[0]?.id ?? 'merged';
    const importance = Math.max(
      ...group.map((entry) => normalizeImportance(entry.importance)),
    );
    const tags = unionTags(group);
    const sources = [...new Set(group.map((entry) => entry.source).filter((s): s is string => !!s))];
    const latestUpdated = sorted[0]?.updatedAt ?? sorted[0]?.createdAt;
    const survivor: LongTermEntry = {
      id: survivorId,
      value: group[0]?.value,
      createdAt: oldest?.createdAt ?? Date.now(),
      updatedAt: Math.max(latestUpdated ?? 0, Date.now()),
      importance,
      tags,
      source: sources.length > 1 ? sources.join(' | ') : sources[0],
      archived: group.every((entry) => entry.archived === true) ? true : undefined,
    };
    if (options?.mergeMetadata !== false) {
      const metadata: Record<string, unknown> = {};
      for (const entry of group) {
        Object.assign(metadata, entry.metadata ?? {});
      }
      survivor.metadata = metadata;
    }
    return survivor;
  }
}

/**
 * Factory that builds a store, an index, and a lifecycle in one call.
 *
 * @example
 * ```ts
 * const { store, index, lifecycle } = createLongTermLifecycle({
 *   persistPath: './memories.json',
 *   maxEntries: 5000,
 * });
 * ```
 */
export function createLongTermLifecycle(
  config?: Partial<LongTermConfig>,
): {
  store: LongTermStore;
  index: LongTermIndex;
  lifecycle: LongTermLifecycle;
} {
  const store = new LongTermStore(config);
  const index = new LongTermIndex();
  index.rebuild(store.getAll({ includeArchived: true }));
  const lifecycle = new LongTermLifecycle(store, {
    index,
    intervalMs: config?.persistIntervalMs,
  });
  return { store, index, lifecycle };
}

/** Convenience logging helper used by demo / debugging code. */
export function summarizeLifecycle(
  store: LongTermStore,
  stats: {
    pruned: number;
    archived: number;
    lastPersistMs?: number;
  },
): string {
  const persist = stats.lastPersistMs === undefined
    ? 'never'
    : formatDuration(stats.lastPersistMs);
  return (
    `store=${store.size()} entries ` +
    `(pruned=${stats.pruned}, archived=${stats.archived}, last persist ${persist})`
  );
}