/**
 * Lifecycle management for the semantic memory subsystem.
 *
 * {@link SemanticLifecycle} keeps a growing store of facts healthy over time.
 * Left alone, a semantic memory accumulates duplicate facts, stale beliefs and
 * stale low-confidence noise that degrade retrieval quality. The lifecycle
 * layer provides the housekeeping operations that counter that drift:
 *
 * - **Pruning** — {@link SemanticLifecycle.prune} removes the least valuable
 *   entries until the store is back under {@link SemanticConfig.maxEntries}.
 * - **Deduplication** — {@link SemanticLifecycle.dedupe} collapses entries
 *   whose fact text is identical (after normalisation) into a single survivor.
 * - **Decay** — {@link SemanticLifecycle.decayStale} lowers the confidence of
 *   entries that have not been updated recently, so old, un-reconfirmed
 *   beliefs gradually lose priority (and eventually become prune candidates).
 * - **Normalisation** — {@link SemanticLifecycle.normalize} recomputes the
 *   TF-IDF vectors for every entry.
 * - **Reset** — {@link SemanticLifecycle.reset} empties both the store and the
 *   index.
 *
 * ## Events
 *
 * The lifecycle emits `'prune'`, `'dedupe'`, `'decay'` and `'normalize'`
 * events (see {@link SemanticLifecycleEvent}) through a small built-in emitter
 * exposed via {@link SemanticLifecycle.on}, {@link SemanticLifecycle.off} and
 * {@link SemanticLifecycle.once}. Observers (metrics collectors, loggers,
 * notification hooks) can subscribe without touching the store.
 *
 * The emitter is intentionally a tiny hand-rolled implementation rather than
 * `node:events`, keeping the semantic layer free of any dependency beyond
 * standard ECMAScript.
 *
 * @packageDocumentation
 * @module semantic/lifecycle
 */

import type {
  Confidence,
  SemanticDecayResult,
  SemanticDedupeResult,
  SemanticEntry,
  SemanticEntryId,
  SemanticLifecycleEvent,
  SemanticNormalizeResult,
  SemanticPruneResult,
  Timestamp,
} from './types.js';
import { SemanticIndex } from './index.js';
import { SemanticStore } from './store.js';

/**
 * Default decay factor applied by {@link SemanticLifecycle.decayStale}.
 *
 * Each decayed entry's confidence is multiplied by this factor (floored at
 * {@link DEFAULT_DECAY_FLOOR}), so a single decay pass reduces confidence by
 * 10% but never below the floor in one step.
 */
export const DEFAULT_DECAY_FACTOR = 0.9;

/**
 * Default confidence floor for {@link SemanticLifecycle.decayStale}.
 *
 * Confidence is never lowered below this value in a single decay pass, so a
 * fact does not jump to zero merely because it is old; repeated decays or an
 * explicit prune are what eventually remove it.
 */
export const DEFAULT_DECAY_FLOOR: Confidence = 0.05;

/**
 * Configuration for {@link SemanticLifecycle}.
 */
export interface SemanticLifecycleOptions {
  /**
   * Clock used for all timestamp comparisons; defaults to `Date.now`.
   */
  readonly now?: () => Timestamp;

  /**
   * Multiplier applied to confidence during decay; defaults to
   * {@link DEFAULT_DECAY_FACTOR}.
   */
  readonly decayFactor?: number;

  /**
   * Floor below which decay never lowers confidence; defaults to
   * {@link DEFAULT_DECAY_FLOOR}.
   */
  readonly decayFloor?: Confidence;
}

/**
 * Listener signature for lifecycle events.
 *
 * @param event - the lifecycle event payload
 */
export type SemanticLifecycleListener = (event: SemanticLifecycleEvent) => void;

/**
 * A minimal, dependency-free event emitter.
 *
 * Supports `on`, `off` and `once` for a fixed set of lifecycle event types.
 * Listeners are stored per type in insertion order; removing a listener that
 * was never added is a no-op. `once` listeners self-remove before being
 * invoked so that re-entrant emission cannot double-fire them.
 */
export class LifecycleEmitter {
  /** type -> ordered set of listeners. */
  private readonly listeners = new Map<
    SemanticLifecycleEvent['type'],
    Set<SemanticLifecycleListener>
  >();

  /**
   * Subscribe a listener to an event type.
   *
   * @param type - the event type to subscribe to
   * @param listener - the callback to invoke on emission
   * @returns `this` for chaining
   */
  on(type: SemanticLifecycleEvent['type'], listener: SemanticLifecycleListener): this {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
    return this;
  }

  /**
   * Unsubscribe a listener from an event type.
   *
   * @param type - the event type to unsubscribe from
   * @param listener - the callback to remove
   * @returns `this` for chaining
   */
  off(type: SemanticLifecycleEvent['type'], listener: SemanticLifecycleListener): this {
    this.listeners.get(type)?.delete(listener);
    return this;
  }

  /**
   * Subscribe a listener that fires at most once.
   *
   * @param type - the event type to subscribe to
   * @param listener - the callback to invoke once
   * @returns `this` for chaining
   */
  once(type: SemanticLifecycleEvent['type'], listener: SemanticLifecycleListener): this {
    const wrapped: SemanticLifecycleListener = (event) => {
      this.off(type, wrapped);
      listener(event);
    };
    return this.on(type, wrapped);
  }

  /**
   * Emit an event to all subscribed listeners.
   *
   * Listeners are invoked synchronously in subscription order. Errors thrown
   * by a listener propagate to the emitter's caller and halt the emission, so
   * observers that must never break housekeeping should catch internally.
   *
   * @param type - the event type to emit
   * @param event - the payload to deliver
   * @returns the number of listeners invoked
   */
  emit(type: SemanticLifecycleEvent['type'], event: SemanticLifecycleEvent): number {
    const set = this.listeners.get(type);
    if (!set) {
      return 0;
    }
    let invoked = 0;
    for (const listener of [...set]) {
      invoked += 1;
      listener(event);
    }
    return invoked;
  }

  /**
   * Number of listeners currently subscribed (across all event types).
   *
   * @returns the total listener count
   */
  listenerCount(): number {
    let total = 0;
    for (const set of this.listeners.values()) {
      total += set.size;
    }
    return total;
  }
}

/**
 * Normalise fact text for deduplication.
 *
 * Two entries are considered duplicates when their facts are equal after
 * trimming, lower-casing and collapsing runs of internal whitespace.
 *
 * @param fact - the raw fact text
 * @returns a canonical comparison key
 */
export function normalizeFactKey(fact: string): string {
  return String(fact).trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Select the surviving entry from a group of duplicates.
 *
 * The survivor is the entry with the highest confidence; ties are broken by
 * the most recently updated entry, then by the most recently created one.
 *
 * @param group - the duplicate entries to compare
 * @returns the chosen survivor
 */
export function pickSurvivor(group: readonly SemanticEntry[]): SemanticEntry {
  let survivor: SemanticEntry | undefined;
  for (const candidate of group) {
    if (survivor === undefined) {
      survivor = candidate;
      continue;
    }
    const score = (candidate.confidence ?? 0) * 1_000_000 +
      (candidate.updatedAt ?? candidate.createdAt) * 1 +
      candidate.createdAt;
    const current = (survivor.confidence ?? 0) * 1_000_000 +
      (survivor.updatedAt ?? survivor.createdAt) * 1 +
      survivor.createdAt;
    if (score > current) {
      survivor = candidate;
    }
  }
  if (survivor === undefined) {
    throw new Error('pickSurvivor: duplicate group must not be empty');
  }
  return survivor;
}

/**
 * Merge a group of duplicate entries into a single survivor.
 *
 * The survivor keeps the winner's fact, triple fields, embedding, confidence
 * and timestamps; the union of all tags is preserved, and a source is carried
 * over from any group member when the survivor lacks one.
 *
 * @param group - the duplicate entries to merge
 * @returns the merged entry (a new object; not yet persisted)
 */
export function mergeDuplicates(group: readonly SemanticEntry[]): SemanticEntry {
  const survivor = pickSurvivor(group);
  const tags = new Set<string>();
  let source = survivor.source;
  for (const entry of group) {
    for (const tag of entry.tags ?? []) {
      tags.add(tag);
    }
    if (source === undefined && entry.source !== undefined) {
      source = entry.source;
    }
  }
  return {
    ...survivor,
    tags: [...tags],
    source,
    updatedAt: survivor.updatedAt ?? survivor.createdAt,
  };
}

/**
 * Lifecycle housekeeping over a semantic store and its TF-IDF index.
 *
 * Construct with the store and index you want to maintain. All operations keep
 * the store and index mutually consistent: prunes un-index the removed ids,
 * dedupe/normalize rebuild the index from the surviving store contents, and
 * decay touches only confidence, which the index does not model.
 */
export class SemanticLifecycle {
  private readonly store: SemanticStore;
  private readonly index: SemanticIndex;
  private readonly options: Required<SemanticLifecycleOptions>;
  private readonly emitter = new LifecycleEmitter();

  /**
   * Construct a lifecycle over a store and index.
   *
   * @param store - the store to maintain
   * @param index - the index to keep consistent with the store
   * @param options - optional tuning knobs; see {@link SemanticLifecycleOptions}
   */
  constructor(store: SemanticStore, index: SemanticIndex, options?: SemanticLifecycleOptions) {
    this.store = store;
    this.index = index;
    this.options = {
      now: options?.now ?? (() => Date.now()),
      decayFactor: options?.decayFactor ?? DEFAULT_DECAY_FACTOR,
      decayFloor: options?.decayFloor ?? DEFAULT_DECAY_FLOOR,
    };
  }

  /**
   * Subscribe to a lifecycle event type.
   *
   * @param type - the event type to subscribe to
   * @param listener - the callback to invoke
   * @returns `this` for chaining
   */
  on(type: SemanticLifecycleEvent['type'], listener: SemanticLifecycleListener): this {
    this.emitter.on(type, listener);
    return this;
  }

  /**
   * Unsubscribe from a lifecycle event type.
   *
   * @param type - the event type to unsubscribe from
   * @param listener - the callback to remove
   * @returns `this` for chaining
   */
  off(type: SemanticLifecycleEvent['type'], listener: SemanticLifecycleListener): this {
    this.emitter.off(type, listener);
    return this;
  }

  /**
   * Subscribe to a lifecycle event type, firing at most once.
   *
   * @param type - the event type to subscribe to
   * @param listener - the callback to invoke once
   * @returns `this` for chaining
   */
  once(type: SemanticLifecycleEvent['type'], listener: SemanticLifecycleListener): this {
    this.emitter.once(type, listener);
    return this;
  }

  /**
   * Prune the store down to at most `maxEntries` entries.
   *
   * When the store is already at or under the target nothing is removed.
   * Otherwise entries are ranked by ascending confidence, then by ascending
   * `updatedAt` (oldest first), and the least valuable tail is deleted. Removed
   * ids are un-indexed and a `'prune'` event is emitted.
   *
   * @param maxEntries - the target maximum entry count
   * @returns a {@link SemanticPruneResult} describing the removal
   */
  prune(maxEntries: number): SemanticPruneResult {
    const target = Math.max(0, Math.floor(maxEntries));
    const size = this.store.size();
    const removed: SemanticEntryId[] = [];
    if (size > target) {
      const ranked = this.store
        .getAll()
        .sort(
          (a, b) =>
            (a.confidence ?? 0) - (b.confidence ?? 0) ||
            (a.updatedAt ?? a.createdAt) - (b.updatedAt ?? b.createdAt),
        );
      const doomed = ranked.slice(0, size - target);
      for (const entry of doomed) {
        this.store.delete(entry.id);
        this.index.removeEntry(entry.id);
        removed.push(entry.id);
      }
    }
    const kept = this.store.size();
    if (removed.length > 0) {
      this.emitter.emit('prune', {
        type: 'prune',
        ids: removed,
        timestamp: this.options.now(),
        detail: removed.length,
      });
    }
    return { removed, kept };
  }

  /**
   * Merge entries whose fact text is identical after normalisation.
   *
   * Entries are grouped by {@link normalizeFactKey}. For every group of two or
   * more, a survivor is chosen with {@link pickSurvivor}, its tags are merged
   * with {@link mergeDuplicates}, and the absorbed ids are deleted. The index
   * is rebuilt from the surviving store contents so vectors match the merged
   * text. A `'dedupe'` event is emitted when anything was merged.
   *
   * @returns a {@link SemanticDedupeResult} describing the merge
   */
  dedupe(): SemanticDedupeResult {
    const groups = new Map<string, SemanticEntry[]>();
    for (const entry of this.store.getAll()) {
      const key = normalizeFactKey(entry.fact);
      const group = groups.get(key);
      if (group) {
        group.push(entry);
      } else {
        groups.set(key, [entry]);
      }
    }
    const removed: SemanticEntryId[] = [];
    const survivors: SemanticEntryId[] = [];
    let merged = 0;
    for (const group of groups.values()) {
      if (group.length < 2) {
        const sole = group[0];
        if (sole) {
          survivors.push(sole.id);
        }
        continue;
      }
      const survivor = mergeDuplicates(group);
      this.store.putEntry(survivor);
      survivors.push(survivor.id);
      for (const entry of group) {
        if (entry.id !== survivor.id && this.store.delete(entry.id)) {
          removed.push(entry.id);
        }
      }
      merged += 1;
    }
    if (merged > 0) {
      this.index.rebuild(this.store.getAll());
      this.emitter.emit('dedupe', {
        type: 'dedupe',
        ids: removed,
        timestamp: this.options.now(),
        detail: { merged, survivors, removed },
      });
    }
    return { merged, survivors, removed };
  }

  /**
   * Lower the confidence of entries not updated within `olderThanMs`.
   *
   * Any entry whose `updatedAt` (or `createdAt`, when never updated) is older
   * than `now - olderThanMs` has its confidence multiplied by the configured
   * decay factor and floored at the configured decay floor. Confidence is
   * clamped into `[0, 1]`. A `'decay'` event is emitted when anything was
   * decayed.
   *
   * @param olderThanMs - minimum age (in milliseconds) for an entry to decay
   * @returns a {@link SemanticDecayResult} describing the decay
   */
  decayStale(olderThanMs: number): SemanticDecayResult {
    const cutoff = this.options.now() - Math.max(0, olderThanMs);
    const factor = this.options.decayFactor;
    const floor = this.options.decayFloor;
    const ids: SemanticEntryId[] = [];
    for (const entry of this.store.getAll()) {
      const lastTouched = entry.updatedAt ?? entry.createdAt;
      if (lastTouched >= cutoff) {
        continue;
      }
      const current = entry.confidence ?? 1;
      const next = Math.max(floor, Math.min(1, current * factor));
      if (next >= current) {
        continue;
      }
      this.store.update(entry.id, { confidence: next });
      ids.push(entry.id);
    }
    if (ids.length > 0) {
      this.emitter.emit('decay', {
        type: 'decay',
        ids,
        timestamp: this.options.now(),
        detail: { factor, floor },
      });
    }
    return { decayed: ids.length, ids, factor, floor };
  }

  /**
   * Recompute the TF-IDF vectors for every stored entry.
   *
   * Rebuilds the index from the store's current contents, guaranteeing that
   * vectors reflect the latest fact text after any out-of-band store edits. A
   * `'normalize'` event is emitted.
   *
   * @returns a {@link SemanticNormalizeResult} describing the normalisation
   */
  normalize(): SemanticNormalizeResult {
    const entries = this.store.getAll();
    this.index.rebuild(entries);
    this.emitter.emit('normalize', {
      type: 'normalize',
      ids: this.store.keys(),
      timestamp: this.options.now(),
      detail: entries.length,
    });
    return { vectors: entries.length };
  }

  /**
   * Empty both the store and the index.
   *
   * Equivalent to clearing each in turn; no event is emitted.
   */
  reset(): void {
    this.store.clear();
    this.index.clear();
  }

  /**
   * Number of subscribed lifecycle listeners.
   *
   * @returns the total listener count across all event types
   */
  listenerCount(): number {
    return this.emitter.listenerCount();
  }
}

/**
 * Convenience factory: build a lifecycle over a store and index.
 *
 * @param store - the store to maintain
 * @param index - the index to keep consistent
 * @param options - optional tuning knobs
 * @returns a configured lifecycle
 */
export function createLifecycle(
  store: SemanticStore,
  index: SemanticIndex,
  options?: SemanticLifecycleOptions,
): SemanticLifecycle {
  return new SemanticLifecycle(store, index, options);
}