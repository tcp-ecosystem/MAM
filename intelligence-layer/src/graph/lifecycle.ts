/**
 * @fileoverview
 * Lifecycle management for the Knowledge graph layer.
 *
 * A knowledge graph in production has two lifecycle concerns that the store,
 * index, and engine deliberately do not own:
 *
 *   1. **Bounded memory.**  Graphs grow without bound as the engine ingests
 *      text.  Stale facts — entities and relations extracted from documents
 *      that have since been retracted or superseded — silently pollute later
 *      traversal and grounding.  The lifecycle owns retention policy.
 *
 *   2. **Observation.**  Consumers want to know when entities and relations
 *      were added, when they were pruned, and how the graph is shaped, so
 *      they can feed dashboards, trigger re-extraction, or cap memory.
 *
 * {@link GraphLifecycle} wraps a {@link GraphStore} (and optionally a
 * {@link GraphIndex}) and provides:
 *
 *   - `addEntity` / `addRelation` — write-through wrappers that emit
 *     `entityAdded` / `relationAdded`;
 *   - `prune`   — evict the least-connected entities down to a hard size
 *     bound (leaves first), emitting `pruned`;
 *   - `clearEntity` — remove one entity and its cascade of relations,
 *     emitting `entityRemoved` and one `relationRemoved` per edge;
 *   - `clear` / `reset` — drop data (keeping or zeroing counters);
 *   - `start` / `stop` / `gcNow` — a periodic garbage collector that evicts
 *     entities idle past a TTL and keeps the graph under a soft capacity.
 *
 * Events are delivered through a standard `node:events` {@link EventEmitter}
 * and can be consumed with `on`/`once`/`off` or awaited with `once(...)`.
 * Typed convenience listeners (`onEntityAdded`, `onPruned`, ...) are provided
 * so callers get payload types without casts.
 *
 * @packageDocumentation
 */

import { EventEmitter } from 'node:events';
import { type GraphEntity, type GraphRelation } from './types.js';
import { GraphStore } from './store.js';
import { GraphIndex } from './index.js';

/**
 * Configuration for the lifecycle manager and its periodic garbage collector.
 */
export interface LifecycleOptions {
  /**
   * Interval between automatic GC passes, in milliseconds.  Must be at least
   * {@link MIN_GC_INTERVAL_MS}.  Defaults to {@link DEFAULT_GC_INTERVAL_MS}.
   */
  readonly gcIntervalMs?: number;

  /**
   * An entity is considered stale (and evicted by GC) when it was created
   * more than this many milliseconds ago.  Defaults to
   * {@link DEFAULT_IDLE_TTL_MS} (one hour).  Pass `Infinity` to disable
   * time-based eviction.
   */
  readonly idleTtlMs?: number;

  /**
   * Soft entity capacity: when the graph grows past this many entities the GC
   * prunes it down to `pruneTarget`.  Defaults to
   * {@link DEFAULT_PRUNE_THRESHOLD}.
   */
  readonly pruneThreshold?: number;

  /**
   * The entity count the GC prunes the graph down to when `pruneThreshold` is
   * exceeded.  Defaults to `pruneThreshold * 0.8`.
   */
  readonly pruneTarget?: number;

  /**
   * Whether to start the periodic GC immediately in the constructor.
   * Defaults to `false` — callers should `start()` explicitly so the timer is
   * created only when the process is actually ready for it.
   */
  readonly autoStart?: boolean;
}

/**
 * The report returned by {@link GraphLifecycle.gcNow} describing a single
 * garbage-collection pass.
 */
export interface GcReport {
  /** Resident entity/relation counts before this pass. */
  readonly before: { readonly entities: number; readonly relations: number };
  /** Entities evicted because they were stale past the TTL. */
  readonly staleRemoved: number;
  /** Entities evicted to enforce the soft capacity. */
  readonly capacityRemoved: number;
  /** Total entities removed this pass. */
  readonly removed: number;
  /** Resident entity/relation counts after this pass. */
  readonly after: { readonly entities: number; readonly relations: number };
  /** Unix epoch milliseconds at which the pass ran. */
  readonly at: number;
}

/**
 * Lifetime counters reported by {@link GraphLifecycle.stats}.
 */
export interface LifecycleStats {
  /** Total entities added via `addEntity`. */
  readonly addedEntities: number;
  /** Total relations added via `addRelation`. */
  readonly addedRelations: number;
  /** Total entities removed (via `clearEntity`, `prune`, and GC). */
  readonly removedEntities: number;
  /** Total relations removed (as part of entity removals). */
  readonly removedRelations: number;
  /** Total entities pruned by capacity policy. */
  readonly pruned: number;
  /** Number of GC passes run. */
  readonly gcRuns: number;
  /** Whether the periodic GC is currently running. */
  readonly running: boolean;
  /** Current entity count. */
  readonly entities: number;
  /** Current relation count. */
  readonly relations: number;
}

/**
 * The payload emitted with the `entityAdded` event.
 */
export interface EntityAddedPayload {
  /** The entity that was added. */
  readonly entity: GraphEntity;
  /** Unix epoch milliseconds of the event. */
  readonly at: number;
}

/**
 * The payload emitted with the `relationAdded` event.
 */
export interface RelationAddedPayload {
  /** The relation that was added. */
  readonly relation: GraphRelation;
  /** Unix epoch milliseconds of the event. */
  readonly at: number;
}

/**
 * The payload emitted with the `entityRemoved` event.
 */
export interface EntityRemovedPayload {
  /** The id of the removed entity. */
  readonly entityId: string;
  /** Unix epoch milliseconds of the event. */
  readonly at: number;
}

/**
 * The payload emitted with the `relationRemoved` event.
 */
export interface RelationRemovedPayload {
  /** The id of the removed relation. */
  readonly relationId: string;
  /** Unix epoch milliseconds of the event. */
  readonly at: number;
}

/**
 * The payload emitted with the `pruned` event.
 */
export interface PrunedPayload {
  /** Number of entities removed. */
  readonly count: number;
  /** The reason: `"capacity"` (size bound), `"stale"` (TTL), or `"manual"`. */
  readonly reason: 'capacity' | 'stale' | 'manual';
  /** The ids of the removed entities. */
  readonly entityIds: readonly string[];
  /** Number of entities remaining after pruning. */
  readonly remaining: number;
  /** Unix epoch milliseconds of the event. */
  readonly at: number;
}

/** The default GC interval (one minute). */
export const DEFAULT_GC_INTERVAL_MS = 60_000;

/** The default idle TTL (one hour). */
export const DEFAULT_IDLE_TTL_MS = 3_600_000;

/** The default soft entity capacity. */
export const DEFAULT_PRUNE_THRESHOLD = 1_000;

/** Interval cap so a misconfigured lifecycle cannot spin at sub-second rate. */
export const MIN_GC_INTERVAL_MS = 1_000;

/**
 * Owns retention policy, periodic garbage collection, and lifecycle events
 * for a {@link GraphStore}.
 *
 * The class is an {@link EventEmitter}; valid event names are:
 *
 *   - `'entityAdded'`   — fired after {@link addEntity} inserts an entity.
 *   - `'relationAdded'` — fired after {@link addRelation} inserts a relation.
 *   - `'entityRemoved'` — fired by `clearEntity`, `prune`, and GC.
 *   - `'relationRemoved'` — fired once per relation cascaded by an entity
 *     removal.
 *   - `'pruned'`        — fired whenever entities are removed by `prune` or
 *     GC.
 *   - `'cleared'`       — fired after `clear`.
 *   - `'reset'`         — fired after `reset`.
 *   - `'started'` / `'stopped'` — fired on GC start/stop.
 *   - `'tick'`          — fired after every GC pass with its {@link GcReport}.
 */
export class GraphLifecycle extends EventEmitter {
  private readonly storeInternal: GraphStore;
  private readonly index: GraphIndex | null;

  private readonly gcIntervalMs: number;
  private readonly idleTtlMs: number;
  private readonly pruneThreshold: number;
  private readonly pruneTarget: number;

  private timer: ReturnType<typeof setInterval> | null = null;

  private addedEntities = 0;
  private addedRelations = 0;
  private removedEntitiesTotal = 0;
  private removedRelationsTotal = 0;
  private prunedTotal = 0;
  private gcRuns = 0;

  /**
   * Creates a lifecycle manager.
   *
   * @param store - The store to manage.  When omitted, a store is created
   *   with default settings.  The store's data is never pre-indexed; pass an
   *   index and call `rebuildFromStore` (or re-add through this class) to
   *   sync it.
   * @param index - An optional index kept in sync with removals.  When
   *   omitted, the index is skipped entirely.
   * @param options - Lifecycle and GC tuning; normalized immediately.
   */
  constructor(
    store: GraphStore = new GraphStore(),
    index: GraphIndex | null = null,
    options: LifecycleOptions = {},
  ) {
    super();
    this.storeInternal = store;
    this.index = index;

    this.gcIntervalMs = GraphLifecycle.normalizePositive(
      options.gcIntervalMs ?? DEFAULT_GC_INTERVAL_MS,
      MIN_GC_INTERVAL_MS,
      'gcIntervalMs',
    );
    this.idleTtlMs =
      options.idleTtlMs === undefined
        ? DEFAULT_IDLE_TTL_MS
        : options.idleTtlMs === Infinity
          ? Infinity
          : GraphLifecycle.normalizePositive(options.idleTtlMs, 0, 'idleTtlMs');
    this.pruneThreshold = GraphLifecycle.normalizePositive(
      options.pruneThreshold ?? DEFAULT_PRUNE_THRESHOLD,
      1,
      'pruneThreshold',
    );
    this.pruneTarget =
      options.pruneTarget ??
      Math.max(1, Math.floor(this.pruneThreshold * 0.8));
    GraphLifecycle.normalizePositive(this.pruneTarget, 1, 'pruneTarget');

    if (options.autoStart === true) this.start();
  }

  /** Returns the managed store. */
  get store(): GraphStore {
    return this.storeInternal;
  }

  /** Returns the managed index, or `null` when none was provided. */
  get indexRef(): GraphIndex | null {
    return this.index;
  }

  /** Returns whether the periodic GC is currently armed. */
  get running(): boolean {
    return this.timer !== null;
  }

  /**
   * Adds an entity through the lifecycle, emitting `entityAdded` when it is
   * newly inserted.
   *
   * @returns `true` when the entity was newly inserted, `false` when an
   *   entity with the same id was already resident (no event is emitted).
   */
  addEntity(entity: GraphEntity): boolean {
    const added = this.storeInternal.addEntity(entity);
    if (added) {
      this.addedEntities += 1;
      this.emit('entityAdded', {
        entity,
        at: Date.now(),
      } satisfies EntityAddedPayload);
    }
    return added;
  }

  /**
   * Adds a relation through the lifecycle, emitting `relationAdded` when it
   * is newly inserted.  Endpoint existence is enforced by the store.
   *
   * @returns `true` when the relation was newly inserted, `false` when a
   *   relation with the same id was already resident.
   */
  addRelation(relation: GraphRelation): boolean {
    const added = this.storeInternal.addRelation(relation);
    if (added) {
      this.addedRelations += 1;
      this.emit('relationAdded', {
        relation,
        at: Date.now(),
      } satisfies RelationAddedPayload);
    }
    return added;
  }

  /**
   * Evicts entities until the graph holds at most `maxEntities`, preferring
   * the least-connected (and then oldest) entities first.
   *
   * Removing an entity also removes its relations, so the effective entity
   * count is recomputed after each removal rather than assumed.
   *
   * @param maxEntities - Hard target entity count.  Must be a positive
   *   integer.  When it is at or above the current count this is a no-op
   *   returning `0`.
   * @returns The number of entities evicted.
   */
  prune(maxEntities: number): number {
    GraphLifecycle.normalizePositive(maxEntities, 1, 'maxEntities');
    const current = this.storeInternal.entityCount;
    if (current <= maxEntities) return 0;
    return this.pruneToSize(maxEntities, 'manual');
  }

  /**
   * Removes a single entity and every relation that touches it.
   *
   * Emits `entityRemoved` for the entity and `relationRemoved` for each
   * cascaded relation, and keeps the index (when attached) in sync.
   *
   * @returns `true` when the entity was resident and has been removed.
   */
  clearEntity(id: string): boolean {
    if (!this.storeInternal.hasEntity(id)) return false;
    const relations = this.storeInternal.relationsFor(id);

    this.storeInternal.removeEntity(id);
    this.index?.removeEntity(id);
    for (const relation of relations) {
      this.index?.removeRelation(relation.id);
    }

    this.removedEntitiesTotal += 1;
    this.emit('entityRemoved', { entityId: id, at: Date.now() } satisfies EntityRemovedPayload);
    for (const relation of relations) {
      this.removedRelationsTotal += 1;
      this.emit('relationRemoved', {
        relationId: relation.id,
        at: Date.now(),
      } satisfies RelationRemovedPayload);
    }
    return true;
  }

  /**
   * Drops all graph data and index contents but keeps lifetime counters and
   * the GC timer state.  Use {@link reset} for a full teardown.
   */
  clear(): void {
    this.storeInternal.clear();
    this.index?.clear();
    this.emit('cleared', { at: Date.now() });
  }

  /**
   * Fully reinitializes the manager: stops the GC, clears all data and index
   * contents, and zeroes every lifetime counter.  Listeners are preserved.
   */
  reset(): void {
    this.stop();
    this.storeInternal.clear();
    this.index?.clear();
    this.addedEntities = 0;
    this.addedRelations = 0;
    this.removedEntitiesTotal = 0;
    this.removedRelationsTotal = 0;
    this.prunedTotal = 0;
    this.gcRuns = 0;
    this.emit('reset', { at: Date.now() });
  }

  /**
   * Arms the periodic garbage collector.  Idempotent: calling `start` on an
   * already-running lifecycle does nothing.
   *
   * @returns `true` when the timer was newly created, `false` when it was
   *   already running.
   */
  start(): boolean {
    if (this.timer !== null) return false;
    this.timer = setInterval(() => {
      this.gcNow();
    }, this.gcIntervalMs);
    this.timer.unref?.();
    this.emit('started', { intervalMs: this.gcIntervalMs, at: Date.now() });
    return true;
  }

  /**
   * Disarms the periodic garbage collector.  Idempotent.
   *
   * @returns `true` when a running timer was stopped, `false` when none was
   *   armed.
   */
  stop(): boolean {
    if (this.timer === null) return false;
    clearInterval(this.timer);
    this.timer = null;
    this.emit('stopped', { at: Date.now() });
    return true;
  }

  /**
   * Runs a single garbage-collection pass immediately and returns the report.
   *
   * The pass has two phases:
   *   1. **Stale eviction** — entities created before the TTL cutoff are
   *      removed (skipped when the TTL is `Infinity`).
   *   2. **Capacity enforcement** — when the graph still exceeds
   *      `pruneThreshold`, the least-connected entities are pruned down to
   *      `pruneTarget`.
   *
   * A `pruned` event fires for each phase that removed entities, and a `tick`
   * event always fires with the report.
   */
  gcNow(): GcReport {
    this.gcRuns += 1;
    const before = this.storeInternal.size();
    let staleRemoved = 0;
    const staleIds: string[] = [];

    if (this.idleTtlMs !== Infinity) {
      const cutoff = Date.now() - this.idleTtlMs;
      const ids = this.storeInternal.entityIds();
      for (const id of ids) {
        const entity = this.storeInternal.getEntity(id);
        if (entity !== undefined && entity.createdAt < cutoff) {
          if (this.clearEntity(id)) {
            staleRemoved += 1;
            staleIds.push(id);
          }
        }
      }
      if (staleRemoved > 0) {
        this.prunedTotal += staleRemoved;
        this.emit('pruned', {
          count: staleRemoved,
          reason: 'stale',
          entityIds: staleIds,
          remaining: this.storeInternal.entityCount,
          at: Date.now(),
        } satisfies PrunedPayload);
      }
    }

    let capacityRemoved = 0;
    const afterStale = this.storeInternal.entityCount;
    if (afterStale > this.pruneThreshold) {
      const target = Math.min(this.pruneTarget, afterStale - 1);
      capacityRemoved = this.pruneToSize(target, 'capacity');
    }

    const report: GcReport = {
      before,
      staleRemoved,
      capacityRemoved,
      removed: staleRemoved + capacityRemoved,
      after: this.storeInternal.size(),
      at: Date.now(),
    };
    this.emit('tick', report);
    return report;
  }

  /**
   * Returns lifetime counters plus the current graph shape.
   */
  stats(): LifecycleStats {
    const size = this.storeInternal.size();
    return {
      addedEntities: this.addedEntities,
      addedRelations: this.addedRelations,
      removedEntities: this.removedEntitiesTotal,
      removedRelations: this.removedRelationsTotal,
      pruned: this.prunedTotal,
      gcRuns: this.gcRuns,
      running: this.running,
      entities: size.entities,
      relations: size.relations,
    };
  }

  /**
   * Stops the GC and removes every event listener.  Call in shutdown paths to
   * let the event loop drain cleanly.
   */
  dispose(): void {
    this.stop();
    this.removeAllListeners();
  }

  /**
   * Typed convenience listener for the `entityAdded` event.
   */
  onEntityAdded(listener: (payload: EntityAddedPayload) => void): this {
    this.on('entityAdded', listener as (...args: unknown[]) => void);
    return this;
  }

  /**
   * Typed convenience listener for the `relationAdded` event.
   */
  onRelationAdded(listener: (payload: RelationAddedPayload) => void): this {
    this.on('relationAdded', listener as (...args: unknown[]) => void);
    return this;
  }

  /**
   * Typed convenience listener for the `entityRemoved` event.
   */
  onEntityRemoved(listener: (payload: EntityRemovedPayload) => void): this {
    this.on('entityRemoved', listener as (...args: unknown[]) => void);
    return this;
  }

  /**
   * Typed convenience listener for the `relationRemoved` event.
   */
  onRelationRemoved(listener: (payload: RelationRemovedPayload) => void): this {
    this.on('relationRemoved', listener as (...args: unknown[]) => void);
    return this;
  }

  /**
   * Typed convenience listener for the `pruned` event.
   */
  onPruned(listener: (payload: PrunedPayload) => void): this {
    this.on('pruned', listener as (...args: unknown[]) => void);
    return this;
  }

  /**
   * Typed convenience listener for the `tick` event.
   */
  onTick(listener: (report: GcReport) => void): this {
    this.on('tick', listener as (...args: unknown[]) => void);
    return this;
  }

  /**
   * Evicts the least-connected entities until the graph holds at most
   * `target` entities, emitting a `pruned` event when anything was removed.
   *
   * The candidate list is scored once at the start by (degree ascending,
   * createdAt ascending, id) so the pruner removes leaves and oldest records
   * first; the size is re-checked against the live store after each removal
   * because each removal also cascades relations that can orphan further
   * removals.
   */
  private pruneToSize(target: number, reason: 'manual' | 'capacity'): number {
    const scored = this.storeInternal
      .entityIds()
      .map((id) => ({
        id,
        degree: this.storeInternal.degreeTotal(id),
        createdAt: this.storeInternal.getEntity(id)?.createdAt ?? 0,
      }))
      .sort(
        (a, b) =>
          a.degree - b.degree ||
          a.createdAt - b.createdAt ||
          a.id.localeCompare(b.id),
      );

    const removed: string[] = [];
    let size = this.storeInternal.entityCount;
    for (const entry of scored) {
      if (size <= target) break;
      if (this.clearEntity(entry.id)) {
        removed.push(entry.id);
        size = this.storeInternal.entityCount;
      }
    }

    if (removed.length > 0) {
      this.prunedTotal += removed.length;
      this.emit('pruned', {
        count: removed.length,
        reason,
        entityIds: removed,
        remaining: this.storeInternal.entityCount,
        at: Date.now(),
      } satisfies PrunedPayload);
    }
    return removed.length;
  }

  /** Normalizes a positive numeric option, throwing a {@link RangeError}. */
  private static normalizePositive(
    value: number,
    min: number,
    name: string,
  ): number {
    if (!Number.isFinite(value) || value < min) {
      throw new RangeError(`${name} must be a finite number >= ${min}, got ${value}`);
    }
    return value;
  }
}