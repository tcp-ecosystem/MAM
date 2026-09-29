/**
 * @fileoverview Lifecycle management for the evaluation layer.
 *
 * `EvaluationLifecycle` owns a {@link Store.EvaluationStore} and an
 * {@link Index.EvaluationIndex}, keeps them synchronised, and supervises the
 * result lifecycle: recording, pruning, and periodic maintenance.
 *
 * Responsibilities:
 *
 * - **record** — a single entry point that writes a result to the store,
 *   indexes it, and emits a `"record"` event so dashboards/alerts can react;
 * - **prune** — removes results older than a cutoff from both store and index,
 *   then emits a `"prune"` event with a {@link PruneSummary};
 * - **reset** — wipes every result and stops any running periodic timer;
 * - **start/stop** — runs a periodic prune at a fixed interval so the store
 *   never grows unbounded in long-running MAM processes.
 *
 * The class extends `node:events.EventEmitter` and exposes typed `on`/`off`
 * helpers for the `"record"` and `"prune"` events.
 */

import { EventEmitter } from "node:events";

import {
  DEFAULT_CONFIG,
  EvaluationEvents,
  EvaluationLifecycleOptions,
  EvaluationListener,
  EvaluationResult,
  PruneSummary,
} from "./types.js";
import { EvaluationStore } from "./store.js";
import { EvaluationIndex } from "./index.js";

/** Default periodic prune interval when none is configured: 60 seconds. */
const DEFAULT_PRUNE_INTERVAL_MS = 60_000;

/** Default data retention window for periodic pruning: 24 hours. */
const DEFAULT_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * Supervises the lifetime of evaluation results.
 *
 * The lifecycle is the "owner" object for an evaluation dataset: it holds the
 * store and the index, guarantees they never drift apart, and exposes an
 * event stream consumers can subscribe to without poking at internal maps.
 *
 * @example
 * const lifecycle = new EvaluationLifecycle();
 * lifecycle.on("record", (r) => console.log(`recorded ${r.name} → ${r.passed}`));
 * lifecycle.record({ name: "accuracy", score: 0.85, passed: true, metrics: [] });
 * lifecycle.start(); // periodic prune every 60s
 */
export class EvaluationLifecycle extends EventEmitter {
  /** Backing store for results. */
  private readonly store: EvaluationStore;
  /** Secondary index kept in sync with the store. */
  private readonly index: EvaluationIndex;
  /** Interval id of the running periodic prune, if any. */
  private timer: NodeJS.Timeout | null = null;
  /** Retention window used by the periodic prune, in ms. */
  private readonly retentionMs: number;

  /**
   * Create a lifecycle with a fresh store and index.
   *
   * @param options Capacity and periodic-prune tuning knobs.
   */
  constructor(options: EvaluationLifecycleOptions = {}) {
    super();
    this.store = new EvaluationStore({ capacity: options.capacity });
    this.index = new EvaluationIndex();
    this.retentionMs =
      options.pruneIntervalMs !== undefined
        ? options.pruneIntervalMs
        : DEFAULT_PRUNE_INTERVAL_MS;
  }

  /**
   * The backing store, exposed for read-only inspection and serialisation.
   *
   * @returns The internal {@link EvaluationStore}.
   */
  getStore(): EvaluationStore {
    return this.store;
  }

  /**
   * The backing index, exposed for fast lookups.
   *
   * @returns The internal {@link EvaluationIndex}.
   */
  getIndex(): EvaluationIndex {
    return this.index;
  }

  /**
   * Number of results currently retained.
   */
  get size(): number {
    return this.store.size;
  }

  /**
   * Whether a periodic prune is currently scheduled.
   */
  get isRunning(): boolean {
    return this.timer !== null;
  }

  /**
   * Record a result into the store and index, then emit `"record"`.
   *
   * This is the only intended write path into the dataset owned by this
   * lifecycle; it guarantees the store and index never drift.
   *
   * @param input A full or partial result (only `name` and `score` required).
   * @returns The normalised, stored result.
   */
  record(
    input: EvaluationResult | (Partial<EvaluationResult> & { name: string; score: number }),
  ): EvaluationResult {
    const result = this.store.record(input);
    this.index.indexResult(result);
    this.emit("record", result);
    return result;
  }

  /**
   * Remove every result older than the given cutoff from both store and index.
   *
   * When at least one result was removed a `"prune"` event is emitted with a
   * summary of the removal. The store's capacity bound is unaffected.
   *
   * @param olderThanMs Results with `timestamp < olderThanMs` are removed.
   * @returns A {@link PruneSummary} describing the prune.
   */
  prune(olderThanMs: number): PruneSummary {
    const cutoff = olderThanMs;
    const removedIds = this.store.prune(cutoff);
    for (const id of removedIds) {
      this.index.removeResult(id);
    }
    const summary: PruneSummary = {
      removed: removedIds.length,
      remaining: this.store.size,
      cutoff,
      ids: removedIds,
    };
    if (removedIds.length > 0) {
      this.emit("prune", summary);
    }
    return summary;
  }

  /**
   * Prune results that are older than `now - retentionMs`.
   *
   * Convenience wrapper used by the periodic timer.
   *
   * @param retentionMs Retention window in ms (default 24h).
   * @returns The prune summary.
   */
  pruneOld(retentionMs = DEFAULT_RETENTION_MS): PruneSummary {
    return this.prune(Date.now() - retentionMs);
  }

  /**
   * Start periodic pruning.
   *
   * The timer prunes results older than the configured retention window on the
   * configured interval. Calling `start()` while already running is a no-op.
   *
   * @param intervalMs Optional override of the configured interval.
   * @returns The lifecycle instance for chaining.
   */
  start(intervalMs?: number): this {
    if (this.timer !== null) return this;
    const interval =
      intervalMs !== undefined && intervalMs > 0 ? intervalMs : this.retentionMs;
    this.timer = setInterval(() => {
      this.pruneOld();
    }, interval);
    // Do not keep the process alive purely for pruning.
    if (typeof this.timer.unref === "function") {
      this.timer.unref();
    }
    return this;
  }

  /**
   * Stop periodic pruning. Safe to call when nothing is running.
   *
   * @returns The lifecycle instance for chaining.
   */
  stop(): this {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    return this;
  }

  /**
   * Remove every result from store and index and stop periodic pruning.
   *
   * A `"prune"` event is **not** emitted for a reset; use this when you want a
   * hard wipe rather than a retention-driven prune.
   *
   * @returns The lifecycle instance for chaining.
   */
  reset(): this {
    this.stop();
    this.store.clear();
    this.index.clear();
    return this;
  }

  /**
   * Delete a single result by id from both store and index.
   *
   * @param id The result id to delete.
   * @returns `true` when a result was removed.
   */
  delete(id: string): boolean {
    const removed = this.store.delete(id);
    if (removed) {
      this.index.removeResult(id);
    }
    return removed;
  }

  /**
   * Whether the lifecycle currently holds a given result id.
   *
   * @param id The id to test.
   * @returns `true` when present.
   */
  has(id: string): boolean {
    return this.store.has(id);
  }

  /**
   * Typed subscription helper for lifecycle events.
   *
   * @example
   * lifecycle.on("record", (result) => { ... });
   *
   * @param event The event name ("record" | "prune").
   * @param listener The callback receiving the event payload.
   * @returns The lifecycle instance for chaining.
   */
  on<K extends keyof EvaluationEvents>(
    event: K,
    listener: EvaluationListener<K>,
  ): this {
    return super.on(event, listener as (...args: unknown[]) => void) as this;
  }

  /**
   * Typed one-shot subscription for lifecycle events.
   *
   * @param event The event name ("record" | "prune").
   * @param listener The callback receiving the event payload.
   * @returns The lifecycle instance for chaining.
   */
  once<K extends keyof EvaluationEvents>(
    event: K,
    listener: EvaluationListener<K>,
  ): this {
    return super.once(event, listener as (...args: unknown[]) => void) as this;
  }

  /**
   * Typed unsubscription helper for lifecycle events.
   *
   * @param event The event name ("record" | "prune").
   * @param listener The callback to remove.
   * @returns The lifecycle instance for chaining.
   */
  off<K extends keyof EvaluationEvents>(
    event: K,
    listener: EvaluationListener<K>,
  ): this {
    return super.off(event, listener as (...args: unknown[]) => void) as this;
  }

  /**
   * Snapshot the entire dataset as a serialisable structure.
   *
   * @returns The store's `toJSON()` payload.
   */
  toJSON() {
    return this.store.toJSON();
  }

  /**
   * Restore a dataset previously produced by `toJSON()`.
   *
   * Rebuilds both the store and the index, so lookups are immediately
   * available after loading.
   *
   * @param data The snapshot to load.
   * @returns The number of results loaded.
   */
  fromJSON(data: Parameters<EvaluationStore["fromJSON"]>[0]): number {
    this.reset();
    const loaded = this.store.fromJSON(data);
    this.index.rebuild(this.store.values());
    return loaded;
  }

  /**
   * Serialise this lifecycle for debugging/reporting.
   *
   * @returns A plain description of the lifecycle state.
   */
  describe(): Record<string, unknown> {
    return {
      size: this.size,
      running: this.isRunning,
      intervalMs: this.retentionMs,
      storeVersion: DEFAULT_CONFIG.scale,
    };
  }
}