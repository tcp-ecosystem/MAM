/**
 * lifecycle.ts
 *
 * The `DiscoveryLifecycle` — the orchestration layer that keeps the
 * registry, index and searcher in agreement over time.
 *
 * The registry (`store.ts`) is the write-side and the index (`index.ts`) is
 * the read-side; neither knows about the other. The lifecycle manager is the
 * glue that:
 *
 *   - pushes `registered` / `unregistered` changes from the registry into the
 *     index immediately,
 *   - exposes `prune(names)` for bulk, transactional removal,
 *   - runs an optional periodic re-index pass (`start` / `stop`) so that a
 *     registry that was mutated underneath us (or restored from a snapshot)
 *     is reconciled automatically,
 *   - emits `registered`, `unregistered` and `pruned` events through an
 *     injected event emitter (defaults to `node:events` `EventEmitter`),
 *   - clears / resets both sides on demand.
 *
 * The periodic pass uses `setInterval` and is unref'd so that it never keeps
 * a Node process alive on its own. Calling `start` twice is idempotent —
 * the second call is ignored while running.
 *
 * This module is self-contained and has no external dependencies beyond Node
 * built-ins (`node:events`).
 */

import { EventEmitter } from 'node:events';

import {
  type DiscoveryEmitter,
  type DiscoveryStats,
  type ToolDefinition,
} from './types.js';
import { ToolRegistry } from './store.js';
import { ToolIndex } from './index.js';

/**
 * Names of the lifecycle events. Kept in one place so consumers can subscribe
 * with confidence and so typo-prone string literals never leak into call
 * sites.
 */
export const LIFECYCLE_EVENTS = Object.freeze({
  /** Emitted after a tool was registered and indexed. */
  registered: 'registered',
  /** Emitted after a tool was unregistered and de-indexed. */
  unregistered: 'unregistered',
  /** Emitted after one or more tools were pruned. */
  pruned: 'pruned',
} as const);

/** Payload attached to every lifecycle event. */
export interface LifecycleEventPayload {
  /** The tool name that changed. */
  name: string;
  /** The current registry size after the change. */
  toolCount: number;
}

/**
 * Coordinates the registry and index over the lifetime of a discovery
 * process.
 *
 * @example
 * const registry = new ToolRegistry();
 * const index = new ToolIndex();
 * const lifecycle = new DiscoveryLifecycle(registry, index);
 *
 * lifecycle.on('registered', ({ name, toolCount }) => {
 *   console.log(`indexed ${name}; ${toolCount} tools total`);
 * });
 *
 * lifecycle.register(tool);            // indexes + emits 'registered'
 * lifecycle.unregister('old.tool');    // de-indexes + emits 'unregistered'
 * lifecycle.prune(['a', 'b', 'c']);    // bulk removal + emits 'pruned'
 *
 * lifecycle.start();                   // begin periodic re-index
 * lifecycle.stop();                    // stop it again
 */
export class DiscoveryLifecycle {
  /** The authoritative registry this lifecycle manages. */
  readonly registry: ToolRegistry;

  /** The search index kept in sync with the registry. */
  readonly index: ToolIndex;

  /** The event emitter used for lifecycle events. */
  readonly emitter: DiscoveryEmitter;

  /** Interval handle of the periodic re-index pass, or `undefined`. */
  private timer?: ReturnType<typeof setInterval>;

  /** Config used by the lifecycle (auto-reindex interval, etc.). */
  private readonly reindexIntervalMs: number;

  /** Whether automatic re-indexing is permitted at all. */
  private readonly autoReindex: boolean;

  /**
   * Creates a lifecycle manager bound to a registry and index.
   *
   * @param registry the registry to manage.
   * @param index the index to keep in sync.
   * @param options optional config: `autoReindex`, `reindexIntervalMs`, and
   *   an injectable `emitter`.
   */
  constructor(
    registry: ToolRegistry,
    index: ToolIndex,
    options: {
      autoReindex?: boolean;
      reindexIntervalMs?: number;
      emitter?: DiscoveryEmitter;
    } = {},
  ) {
    this.registry = registry;
    this.index = index;
    this.emitter = options.emitter ?? new EventEmitter();
    this.autoReindex = options.autoReindex ?? true;
    this.reindexIntervalMs = options.reindexIntervalMs ?? 60_000;
  }

  /* ------------------------------------------------------------------ *
   * Change propagation
   * ------------------------------------------------------------------ */

  /**
   * Registers a tool with the underlying registry and immediately indexes it.
   * This is the lifecycle-aware alternative to calling
   * `registry.register` directly; use it whenever you want events and index
   * consistency.
   *
   * @param tool the tool to register.
   * @returns the previous definition for the same name, or `undefined`.
   */
  register(tool: ToolDefinition): ToolDefinition | undefined {
    const previous = this.registry.register(tool);
    this.index.indexTool(tool);
    this.emitter.emit(LIFECYCLE_EVENTS.registered, {
      name: tool.name,
      toolCount: this.registry.size,
    } satisfies LifecycleEventPayload);
    return previous;
  }

  /**
   * Unregisters a tool by name and removes it from the index.
   *
   * @param name the tool name to remove.
   * @returns the removed definition, or `undefined` when absent.
   */
  unregister(name: string): ToolDefinition | undefined {
    const removed = this.registry.unregister(name);
    if (removed !== undefined) {
      this.index.removeTool(name);
      this.emitter.emit(LIFECYCLE_EVENTS.unregistered, {
        name,
        toolCount: this.registry.size,
      } satisfies LifecycleEventPayload);
    }
    return removed;
  }

  /**
   * Removes a batch of tools in one transaction. Index removal happens for
   * every name that was actually registered, so absent names are ignored
   * silently.
   *
   * @param names the tool names to prune.
   * @returns the number of tools actually removed.
   */
  prune(names: Iterable<string>): number {
    let removedCount = 0;
    for (const name of names) {
      if (this.registry.unregister(name) !== undefined) {
        this.index.removeTool(name);
        removedCount += 1;
        this.emitter.emit(LIFECYCLE_EVENTS.unregistered, {
          name,
          toolCount: this.registry.size,
        } satisfies LifecycleEventPayload);
      }
    }
    if (removedCount > 0) {
      this.emitter.emit(LIFECYCLE_EVENTS.pruned, {
        name: `<pruned:${removedCount}>`,
        toolCount: this.registry.size,
      } satisfies LifecycleEventPayload);
    }
    return removedCount;
  }

  /* ------------------------------------------------------------------ *
   * Index reconciliation
   * ------------------------------------------------------------------ */

  /**
   * Rebuilds the index from scratch to match the registry exactly. Useful
   * after external mutations to the registry (e.g. bulk imports or snapshot
   * restores) that bypassed the lifecycle.
   *
   * @returns `this` for chaining.
   */
  reindex(): this {
    this.index.rebuild(this.registry.list());
    return this;
  }

  /**
   * Clears the index while leaving the registry intact. Use with care: search
   * will return nothing until the next {@link DiscoveryLifecycle.reindex} or
   * {@link DiscoveryLifecycle.start} pass.
   *
   * @returns `this` for chaining.
   */
  clearIndex(): this {
    this.index.clear();
    return this;
  }

  /**
   * Clears both the registry and the index, returning the lifecycle to its
   * initial empty state. The timer (if running) is stopped first.
   *
   * @returns `this` for chaining.
   */
  reset(): this {
    this.stop();
    this.registry.clear();
    this.index.clear();
    return this;
  }

  /* ------------------------------------------------------------------ *
   * Periodic re-indexing
   * ------------------------------------------------------------------ */

  /**
   * Starts the periodic re-index pass. Every `reindexIntervalMs` the index is
   * rebuilt from the registry, which reconciles any drift.
   *
   * The timer is `unref`'d so the process can still exit naturally. Starting
   * while already running is a no-op. When `autoReindex` was disabled at
   * construction, `start` does nothing.
   *
   * @returns `true` when a new timer was started, `false` when one was
   *   already running or auto-reindexing is disabled.
   */
  start(): boolean {
    if (!this.autoReindex || this.timer !== undefined) {
      return false;
    }
    this.timer = setInterval(() => {
      this.reindex();
    }, this.reindexIntervalMs);
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
    return true;
  }

  /**
   * Stops the periodic re-index pass, if one is running.
   *
   * @returns `true` when a timer was stopped, `false` when none was running.
   */
  stop(): boolean {
    if (this.timer === undefined) {
      return false;
    }
    clearInterval(this.timer);
    this.timer = undefined;
    return true;
  }

  /**
   * Returns `true` when the periodic re-index pass is currently running.
   */
  isRunning(): boolean {
    return this.timer !== undefined;
  }

  /* ------------------------------------------------------------------ *
   * Subscription helpers
   * ------------------------------------------------------------------ */

  /**
   * Subscribes to lifecycle events. See {@link LIFECYCLE_EVENTS} for the
   * available event names; payloads are {@link LifecycleEventPayload}.
   *
   * @param event the event name.
   * @param listener the callback.
   * @returns `this` for chaining.
   */
  on(
    event: string,
    listener: (payload: LifecycleEventPayload) => void,
  ): this {
    this.emitter.on(event, listener);
    return this;
  }

  /**
   * Unsubscribes a listener previously added via {@link DiscoveryLifecycle.on}.
   *
   * @param event the event name.
   * @param listener the callback to remove.
   * @returns `this` for chaining.
   */
  off(
    event: string,
    listener: (payload: LifecycleEventPayload) => void,
  ): this {
    this.emitter.off(event, listener);
    return this;
  }

  /* ------------------------------------------------------------------ *
   * Observation
   * ------------------------------------------------------------------ */

  /**
   * Returns a {@link DiscoveryStats} snapshot combining the registry's
   * authoritative counts with the index's derived statistics and the current
   * lifecycle run state.
   */
  stats(): DiscoveryStats {
    const registryStats = this.registry.stats();
    const indexStats = this.index.stats();
    return {
      ...registryStats,
      distinctTags: indexStats.distinctTags,
      distinctCapabilities: indexStats.distinctCapabilities,
      tokenCount: indexStats.tokenCount,
      lastIndexedAt: indexStats.lastIndexedAt,
      running: this.isRunning(),
    };
  }

  /**
   * Returns every registered tool as an array, in insertion order.
   */
  list(): ToolDefinition[] {
    return this.registry.list();
  }

  /**
   * Serialises the current registry using {@link ToolRegistry.toJSON} so it
   * can be persisted and restored on a later boot.
   */
  snapshot(): ReturnType<ToolRegistry['toJSON']> {
    return this.registry.toJSON();
  }

  /**
   * Replaces the registry contents with a restored snapshot and re-indexes.
   * The restored handlers are stubs (see `ToolRegistry.fromJSON`), so any
   * tool that needs a live handler must be re-registered afterwards.
   *
   * @param serialized the serialised registry entries.
   * @returns `this` for chaining.
   */
  restore(
    serialized: Parameters<typeof ToolRegistry.fromJSON>[0],
  ): this {
    const restored = ToolRegistry.fromJSON(serialized);
    this.registry.clear();
    for (const tool of restored.list()) {
      this.registry.register(tool);
    }
    this.index.rebuild(this.registry.list());
    return this;
  }
}

/**
 * Default exported convenience factory mirroring the class.
 *
 * @param registry the registry to manage.
 * @param index the index to keep in sync.
 * @param options optional config.
 * @returns a new {@link DiscoveryLifecycle}.
 */
export default function createLifecycle(
  registry: ToolRegistry,
  index: ToolIndex,
  options?: ConstructorParameters<typeof DiscoveryLifecycle>[2],
): DiscoveryLifecycle {
  return new DiscoveryLifecycle(registry, index, options);
}