/**
 * integration.ts
 *
 * The high-level facade of the Discovery layer: `ToolDiscovery`.
 *
 * The individual components — registry, index, searcher and lifecycle — are
 * designed to be usable in isolation and composable in any arrangement. For
 * the common case, though, you want a single object that wires them together
 * with sensible defaults and exposes the operations end users actually need:
 *
 *   register / unregister / prune      — write operations
 *   search / suggest / byCapability    — read operations
 *   getSchema / list / stats           — introspection
 *   start / stop                       — periodic re-indexing
 *
 * `ToolDiscovery` is that object. It owns a {@link ToolRegistry}, a
 * {@link ToolIndex}, a {@link DiscoveryLifecycle} and a {@link ToolSearcher},
 * and delegates to them. It also exposes a `catalog` property: a
 * {@link DiscoveryAdapter} implementing the stable {@link ToolCatalog}
 * interface so that any consumer code written against a generic catalog can
 * talk to discovery without coupling to implementation details.
 *
 * This module is self-contained and has no external dependencies beyond Node
 * built-ins (`node:events` is used transitively through the lifecycle).
 */

import {
  type DiscoveryConfig,
  type DiscoveryOptions,
  type DiscoveryStats,
  type DiscoveryEventPayload,
  type SearchOptions,
  type ToolCapability,
  type ToolDefinition,
  type ToolSchema,
  DEFAULT_DISCOVERY_CONFIG,
  createToolDefinition,
  resolveDiscoveryConfig,
} from './types.js';
import { ToolRegistry } from './store.js';
import { ToolIndex } from './index.js';
import { DiscoveryLifecycle, LIFECYCLE_EVENTS } from './lifecycle.js';
import { type SearchResult, ToolSearcher } from './retrieval.js';

/**
 * Re-exported search result type so consumers of the integration facade do
 * not need to import directly from `retrieval.ts`.
 */
export type { SearchResult };

/**
 * The stable catalog contract implemented by {@link DiscoveryAdapter}.
 *
 * Any component that only needs to *read* a collection of tools — auto-
 * completion UIs, documentation generators, capability explorers — can depend
 * on this interface instead of on the concrete discovery objects. This keeps
 * coupling low and makes the catalog easy to mock in tests.
 */
export interface ToolCatalog {
  /**
   * Returns the {@link ToolSchema} for a tool by name, or `undefined`.
   */
  getSchema(name: string): ToolSchema | undefined;

  /**
   * Lists every registered tool.
   */
  list(): ToolDefinition[];

  /**
   * Searches tools by free text with optional filters.
   */
  search(query: string, options?: SearchOptions): SearchResult[];

  /**
   * Returns the names of all tools advertising a capability.
   */
  byCapability(capability: string): string[];

  /**
   * Returns the tags used across all registered tools.
   */
  tags(): string[];

  /**
   * Returns the capabilities used across all registered tools, with the
   * tools that provide them.
   */
  capabilities(): ToolCapability[];

  /**
   * Returns a {@link DiscoveryStats} snapshot.
   */
  stats(): DiscoveryStats;
}

/**
 * An immutable adapter that presents a {@link ToolDiscovery} instance through
 * the {@link ToolCatalog} interface. The adapter holds no state of its own —
 * every method delegates to the discovery object it was constructed with.
 */
export class DiscoveryAdapter implements ToolCatalog {
  /** The discovery instance backing this adapter. */
  private readonly discovery: ToolDiscovery;

  /**
   * Creates an adapter around a discovery instance.
   *
   * @param discovery the discovery object to delegate to.
   */
  constructor(discovery: ToolDiscovery) {
    this.discovery = discovery;
  }

  /** @inheritdoc */
  getSchema(name: string): ToolSchema | undefined {
    return this.discovery.getSchema(name);
  }

  /** @inheritdoc */
  list(): ToolDefinition[] {
    return this.discovery.list();
  }

  /** @inheritdoc */
  search(query: string, options?: SearchOptions): SearchResult[] {
    return this.discovery.search(query, options);
  }

  /** @inheritdoc */
  byCapability(capability: string): string[] {
    return this.discovery
      .byCapability(capability)
      .map((result) => result.tool.name);
  }

  /** @inheritdoc */
  tags(): string[] {
    return this.discovery.tags();
  }

  /** @inheritdoc */
  capabilities(): ToolCapability[] {
    return this.discovery.capabilities();
  }

  /** @inheritdoc */
  stats(): DiscoveryStats {
    return this.discovery.stats();
  }
}

/**
 * The high-level Discovery facade.
 *
 * Wires a registry, an index, a lifecycle manager and a searcher into a
 * single coherent object. Construct with {@link ToolDiscovery.constructor}
 * or the {@link createToolDiscovery} factory.
 *
 * @example
 * const discovery = createToolDiscovery();
 * discovery.register(createToolDefinition({
 *   name: 'http.get',
 *   description: 'Perform an HTTP GET request',
 *   handler: async () => ({}),
 *   tags: ['network'],
 *   capabilities: ['http.request'],
 * }));
 * const hits = discovery.search('http');
 * console.log(hits[0].tool.name); // 'http.get'
 *
 * const schema = discovery.getSchema('http.get');
 * discovery.start();              // periodic re-index every 60s
 * discovery.stop();
 */
export class ToolDiscovery {
  /** The underlying tool registry. Exposed for advanced consumers. */
  readonly registry: ToolRegistry;

  /** The underlying search index. Exposed for advanced consumers. */
  readonly index: ToolIndex;

  /** The lifecycle manager keeping registry and index in sync. */
  readonly lifecycle: DiscoveryLifecycle;

  /** The ranked searcher used for `search`, `suggest`, `byCapability`. */
  readonly searcher: ToolSearcher;

  /** Effective configuration. */
  readonly config: DiscoveryConfig;

  /**
   * A catalog adapter implementing {@link ToolCatalog}, safe to hand to
   * read-only consumers.
   */
  readonly catalog: ToolCatalog;

  /**
   * Creates a discovery facade.
   *
   * @param options optional config and seed store; see
   *   {@link DiscoveryOptions}.
   */
  constructor(options: Partial<DiscoveryOptions> = {}) {
    this.config = resolveDiscoveryConfig(options);
    this.registry = new ToolRegistry(options.store, true);
    this.index = new ToolIndex(this.config);
    this.lifecycle = new DiscoveryLifecycle(this.registry, this.index, {
      autoReindex: this.config.autoReindex,
      reindexIntervalMs: this.config.reindexIntervalMs,
    });
    this.searcher = new ToolSearcher(this.index, this.config);
    this.catalog = new DiscoveryAdapter(this);

    for (const tool of this.registry.list()) {
      this.index.indexTool(tool);
    }
  }

  /* ------------------------------------------------------------------ *
   * Write operations
   * ------------------------------------------------------------------ */

  /**
   * Registers a tool and indexes it immediately.
   *
   * @param tool the tool to register. Passed through
   *   {@link createToolDefinition} so optional fields are normalised.
   * @returns the previous definition for the same name, or `undefined`.
   * @throws {TypeError} when the definition is invalid.
   */
  register(tool: ToolDefinition): ToolDefinition | undefined {
    return this.lifecycle.register(createToolDefinition(tool));
  }

  /**
   * Registers several tools in one call.
   *
   * @param tools the definitions to register.
   * @returns the number of tools registered.
   */
  registerMany(tools: Iterable<ToolDefinition>): number {
    let count = 0;
    for (const tool of tools) {
      this.register(tool);
      count += 1;
    }
    return count;
  }

  /**
   * Unregisters a tool by name and de-indexes it.
   *
   * @param name the tool name to remove.
   * @returns the removed definition, or `undefined` when absent.
   */
  unregister(name: string): ToolDefinition | undefined {
    return this.lifecycle.unregister(name);
  }

  /**
   * Removes a batch of tools.
   *
   * @param names the tool names to prune.
   * @returns the number of tools removed.
   */
  prune(names: Iterable<string>): number {
    return this.lifecycle.prune(names);
  }

  /* ------------------------------------------------------------------ *
   * Read operations
   * ------------------------------------------------------------------ */

  /**
   * Searches registered tools with free text and optional facet filters.
   * See {@link ToolSearcher.search} for the ranking contract.
   *
   * @param query the free-text query.
   * @param options per-call search options.
   * @returns ranked results, best first.
   */
  search(query: string, options?: SearchOptions): SearchResult[] {
    return this.searcher.search(query, options ?? {});
  }

  /**
   * Generates autocomplete suggestions for a partial query.
   *
   * @param query the partial query text.
   * @param limit maximum suggestions.
   */
  suggest(query: string, limit = 5): string[] {
    return this.searcher.suggest(query, limit);
  }

  /**
   * Returns the top tools advertising a capability, as ranked results.
   *
   * @param capability the exact capability name.
   * @param limit maximum results.
   */
  byCapability(capability: string, limit?: number): SearchResult[] {
    return this.searcher.byCapability(capability, limit);
  }

  /**
   * Returns the top tools carrying a tag, as ranked results.
   *
   * @param tag the exact tag name.
   * @param limit maximum results.
   */
  byTag(tag: string, limit?: number): SearchResult[] {
    return this.searcher.byTag(tag, limit);
  }

  /**
   * Returns the names of all tools advertising a capability — convenience
   * wrapper matching the catalog contract.
   */
  capabilityToolNames(capability: string): string[] {
    return Array.from(this.index.findByCapability(capability));
  }

  /* ------------------------------------------------------------------ *
   * Introspection
   * ------------------------------------------------------------------ */

  /**
   * Returns the {@link ToolSchema} for a tool, or `undefined`.
   */
  getSchema(name: string): ToolSchema | undefined {
    return this.registry.getSchema(name);
  }

  /**
   * Returns the full tool definition for a name, or `undefined`.
   */
  get(name: string): ToolDefinition | undefined {
    return this.registry.get(name);
  }

  /**
   * Returns `true` when a tool is registered.
   */
  has(name: string): boolean {
    return this.registry.has(name);
  }

  /**
   * Lists every registered tool in insertion order.
   */
  list(): ToolDefinition[] {
    return this.registry.list();
  }

  /**
   * Returns the distinct tags used across all registered tools.
   */
  tags(): string[] {
    return this.registry.allTags();
  }

  /**
   * Returns the capabilities in use, grouped by the tools that provide them.
   */
  capabilities(): ToolCapability[] {
    return this.registry.capabilities();
  }

  /**
   * Returns a combined {@link DiscoveryStats} snapshot.
   */
  stats(): DiscoveryStats {
    return this.lifecycle.stats();
  }

  /**
   * Returns the current number of registered tools.
   */
  get size(): number {
    return this.registry.size;
  }

  /* ------------------------------------------------------------------ *
   * Lifecycle controls
   * ------------------------------------------------------------------ */

  /**
   * Starts periodic re-indexing.
   *
   * @returns `true` when a timer was started.
   */
  start(): boolean {
    return this.lifecycle.start();
  }

  /**
   * Stops periodic re-indexing.
   *
   * @returns `true` when a timer was stopped.
   */
  stop(): boolean {
    return this.lifecycle.stop();
  }

  /**
   * Returns `true` when periodic re-indexing is running.
   */
  isRunning(): boolean {
    return this.lifecycle.isRunning();
  }

  /**
   * Rebuilds the index to match the registry exactly.
   *
   * @returns `this` for chaining.
   */
  reindex(): this {
    this.lifecycle.reindex();
    return this;
  }

  /* ------------------------------------------------------------------ *
   * Events & persistence
   * ------------------------------------------------------------------ */

  /**
   * Subscribes to lifecycle events (`registered`, `unregistered`, `pruned`).
   * See {@link LIFECYCLE_EVENTS} for names.
   *
   * @param event the event name.
   * @param listener the callback.
   * @returns `this` for chaining.
   */
  on(
    event: string,
    listener: (payload: DiscoveryEventPayload) => void,
  ): this {
    this.lifecycle.on(event, listener);
    return this;
  }

  /**
   * Unsubscribes a listener added via {@link ToolDiscovery.on}.
   */
  off(
    event: string,
    listener: (payload: DiscoveryEventPayload) => void,
  ): this {
    this.lifecycle.off(event, listener);
    return this;
  }

  /**
   * Serialises the registry for persistence (handlers become `null` markers).
   */
  snapshot(): ReturnType<ToolRegistry['toJSON']> {
    return this.lifecycle.snapshot();
  }

  /**
   * Restores a snapshot produced by {@link ToolDiscovery.snapshot} (or
   * `ToolRegistry.toJSON`), replacing all current tools and re-indexing.
   */
  restore(
    serialized: Parameters<typeof ToolRegistry.fromJSON>[0],
  ): this {
    this.lifecycle.restore(serialized);
    return this;
  }

  /**
   * Resets the discovery layer: stops the timer, clears the registry and
   * clears the index.
   */
  reset(): this {
    this.lifecycle.reset();
    return this;
  }
}

/**
 * Convenience factory for a fully wired {@link ToolDiscovery}.
 *
 * @param options optional config and seed store.
 * @returns a ready-to-use discovery facade.
 */
export function createToolDiscovery(
  options?: Partial<DiscoveryOptions>,
): ToolDiscovery {
  return new ToolDiscovery(options);
}

/**
 * Default exported factory mirroring {@link createToolDiscovery}, so both
 * `import discovery from './integration.js'` and named imports work.
 */
export default createToolDiscovery;