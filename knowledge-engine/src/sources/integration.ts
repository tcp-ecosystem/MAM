/**
 * Integration layer for the Sources subsystem: adapters and registries.
 *
 * This module connects the standalone pieces (`KnowledgeSourceStore`,
 * `SourceIndex`, `SourceRetriever`) into composite objects a knowledge engine
 * actually wires up:
 *
 * - **`SourceStore`** — the minimal, structural contract an adapter exposes so
 *   other layers can consume sources without depending on the concrete store.
 * - **`KnowledgeSourceAdapter`** — a convenient façade bundling a store, an
 *   index and a retriever behind a single surface, with `createSourceAdapter`
 *   as its factory.
 * - **`SourceRegistry`** — a collection of named adapters that supports bulk
 *   ingestion (`ingestAll`), cross-adapter queries (`query`) and merged search
 *   (`search`), mirroring how a multi-tenant engine would host one adapter per
 *   knowledge domain.
 *
 * @packageDocumentation
 * @module sources/integration
 */

import type {
  KnowledgeSource,
  SourceId,
  SourceKind,
  SourceConfig,
  SourceStats,
  TextIngestOptions,
  FileIngestOptions,
  UrlIngestOptions,
  IngestResult,
  SerializedSources,
  Timestamp,
} from './types.js';
import { isKnowledgeSource } from './types.js';
import { KnowledgeSourceStore, isSourceStoreLike } from './store.js';
import { SourceIndex } from './index.js';
import type { TagMatchMode } from './index.js';
import {
  SourceRetriever,
  mergeSearchResults,
} from './retrieval.js';
import type {
  ScoredSource,
  SearchOptions,
  SourceSearchResult,
  SourceRetrieverOptions,
} from './retrieval.js';

/**
 * The minimal store surface consumed by adapters and registries.
 *
 * Structural, not nominal: any object satisfying these members is accepted by
 * {@link isSourceStoreLike} and can back a {@link KnowledgeSourceAdapter}.
 */
export interface SourceStore {
  /** Number of registered sources. */
  readonly size: number;
  /** Epoch-millisecond construction time. */
  readonly created: Timestamp;
  /** Fetch a source by id. */
  get(id: SourceId): KnowledgeSource | undefined;
  /** Test whether an id is registered. */
  has(id: SourceId): boolean;
  /** All registered ids. */
  keys(): SourceId[];
  /** All registered sources. */
  values(): KnowledgeSource[];
  /** Register a source. */
  register(source: KnowledgeSource): IngestResult;
  /** Remove a source. */
  unregister(id: SourceId): boolean;
  /** Remove every source. */
  clear(): number;
  /** Aggregate statistics. */
  stats(): SourceStats;
}

/**
 * Options for {@link createSourceAdapter} and the {@link KnowledgeSourceAdapter}
 * constructor.
 */
export interface SourceAdapterConfig {
  /**
   * Human-readable name for the adapter. Defaults to `'default'`.
   */
  readonly name?: string;

  /**
   * A pre-built store to wrap. When omitted, a fresh store is created using
   * `storeConfig`.
   */
  readonly store?: KnowledgeSourceStore;

  /**
   * Behaviour options forwarded to a fresh {@link KnowledgeSourceStore}.
   */
  readonly storeConfig?: SourceConfig;

  /**
   * A pre-built index. When omitted, one is built from the store's contents.
   */
  readonly index?: SourceIndex;

  /**
   * Options forwarded to the internal {@link SourceRetriever}.
   */
  readonly retrieverOptions?: SourceRetrieverOptions;

  /**
   * Optional clock used instead of `Date.now()`.
   */
  readonly now?: () => Timestamp;
}

/**
 * A discriminated union of things {@link SourceRegistry.ingestAll} can ingest.
 *
 * Routing is structural: an item with `text` is ingested as text, one with
 * `path` as a file, one with `url` as a URL, and an item whose `kind` is
 * `'memory'` is registered directly. A full {@link KnowledgeSource} is also
 * accepted and registered verbatim.
 */
export type IngestItem =
  | {
      id: SourceId;
      text: string;
      name?: string;
      tags?: readonly string[];
      metadata?: Readonly<Record<string, unknown>>;
      mimeType?: string;
    }
  | {
      id: SourceId;
      path: string;
      name?: string;
      tags?: readonly string[];
      metadata?: Readonly<Record<string, unknown>>;
      mimeType?: string;
      encoding?: BufferEncoding;
    }
  | {
      id: SourceId;
      url: string;
      name?: string;
      tags?: readonly string[];
      metadata?: Readonly<Record<string, unknown>>;
      mimeType?: string;
      autoFetch?: boolean;
      fetchTimeoutMs?: number;
    }
  | {
      id: SourceId;
      kind: 'memory';
      content?: string;
      name?: string;
      tags?: readonly string[];
      metadata?: Readonly<Record<string, unknown>>;
    }
  | KnowledgeSource;

/**
 * The outcome of a bulk ingestion pass.
 */
export interface IngestBatchResult {
  /** One result per accepted item, in input order. */
  readonly results: readonly IngestResult[];
  /** Number of items that created or replaced a source. */
  readonly ok: number;
  /** Number of items that failed and were skipped. */
  readonly failed: number;
  /** Number of items skipped by a duplicate policy. */
  readonly skipped: number;
  /** Epoch-millisecond time the batch completed. */
  readonly at: Timestamp;
}

/**
 * A merged, cross-adapter search result.
 */
export interface RegistrySearchResult {
  /** The (normalised) query text. */
  readonly query: string;
  /** The merged, ranked hits. */
  readonly results: readonly ScoredSource[];
  /** Number of hits returned. */
  readonly returned: number;
  /** Number of adapters searched. */
  readonly adapters: number;
  /** Epoch-millisecond time the search ran. */
  readonly at: Timestamp;
}

/**
 * Aggregate statistics for a {@link SourceRegistry}.
 */
export interface RegistryStats {
  /** Number of registered adapters. */
  readonly adapters: number;
  /** Total sources across all adapters. */
  readonly sources: number;
  /** Per-adapter source counts. */
  readonly perAdapter: Readonly<Record<string, number>>;
  /** Epoch-millisecond construction time. */
  readonly createdAt: Timestamp;
}

/**
 * A façade bundling a store, an index and a retriever behind one surface.
 *
 * `KnowledgeSourceAdapter` implements {@link SourceStore} by delegation and
 * additionally exposes the retrieval surface, so callers can treat a whole
 * knowledge domain (store + index + retriever) as a single value.
 *
 * @example
 * ```ts
 * const adapter = createSourceAdapter({ name: 'docs', storeConfig: { onDuplicate: 'skip' } });
 * await adapter.ingestText('welcome', 'Hello from the engine.');
 * const hits = adapter.search('engine', 5);
 * ```
 */
export class KnowledgeSourceAdapter implements SourceStore {
  /** Human-readable adapter name. */
  readonly name: string;

  /** The wrapped store. */
  readonly store: KnowledgeSourceStore;

  /** The index backing axis lookups. */
  readonly index: SourceIndex;

  /** The retriever answering lookup/search calls. */
  readonly retriever: SourceRetriever;

  /** Epoch-millisecond construction time. */
  readonly createdAt: Timestamp;

  /**
   * Construct an adapter.
   *
   * @param store - the store to wrap
   * @param index - optional pre-built index
   * @param options - adapter options (name, retriever options, clock)
   */
  constructor(
    store: KnowledgeSourceStore,
    index?: SourceIndex,
    options: {
      name?: string;
      now?: () => Timestamp;
      retrieverOptions?: SourceRetrieverOptions;
    } = {},
  ) {
    const now = options.now ?? (() => Date.now());
    this.name = options.name ?? 'default';
    this.store = store;
    this.index = index ?? new SourceIndex(store.values());
    this.retriever = new SourceRetriever(store, this.index, {
      ...(options.retrieverOptions ?? {}),
      now,
    });
    this.createdAt = now();
  }

  /** @returns the number of registered sources. */
  get size(): number {
    return this.store.size;
  }

  /** @returns the store's construction time. */
  get created(): Timestamp {
    return this.store.created;
  }

  /** Fetch a source by id. */
  get(id: SourceId): KnowledgeSource | undefined {
    return this.store.get(id);
  }

  /** Test whether an id is registered. */
  has(id: SourceId): boolean {
    return this.store.has(id);
  }

  /** All registered ids. */
  keys(): SourceId[] {
    return this.store.keys();
  }

  /** All registered sources. */
  values(): KnowledgeSource[] {
    return this.store.values();
  }

  /** Register a source. */
  register(source: KnowledgeSource): IngestResult {
    return this.store.register(source);
  }

  /** Remove a source. */
  unregister(id: SourceId): boolean {
    return this.store.unregister(id);
  }

  /** Remove every source. */
  clear(): number {
    const count = this.store.clear();
    this.index.clear();
    return count;
  }

  /** Aggregate statistics. */
  stats(): SourceStats {
    return this.store.stats();
  }

  /**
   * Ingest free text.
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
    this.index.indexSource(result.source);
    return result;
  }

  /**
   * Ingest a file.
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
    this.index.indexSource(result.source);
    return result;
  }

  /**
   * Ingest a URL.
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
    this.index.indexSource(result.source);
    return result;
  }

  /**
   * Register a memory source directly.
   *
   * @param id - the source id
   * @param content - optional content
   * @param opts - per-call options
   * @returns the ingestion result
   */
  ingestMemory(
    id: SourceId,
    content: string | undefined,
    opts: { name?: string; tags?: readonly string[]; metadata?: Readonly<Record<string, unknown>> } = {},
  ): IngestResult {
    const result = this.store.register({
      id,
      name: opts.name ?? id,
      kind: 'memory',
      content,
      tags: opts.tags,
      metadata: opts.metadata,
      createdAt: this.store.created,
    });
    this.index.indexSource(result.source);
    return result;
  }

  /**
   * Return a source's textual content.
   *
   * @param id - the source id
   * @returns the content, or `undefined`
   */
  getContent(id: SourceId): string | undefined {
    return this.store.getContent(id);
  }

  /**
   * List sources of a given kind.
   *
   * @param kind - the {@link SourceKind}
   * @returns the matching sources
   */
  listByKind(kind: SourceKind): KnowledgeSource[] {
    return this.store.listByKind(kind);
  }

  /**
   * Update a source by merging a patch.
   *
   * @param id - the source id
   * @param patch - the fields to merge
   * @returns the updated source, or `undefined`
   */
  update(
    id: SourceId,
    patch: Partial<Omit<KnowledgeSource, 'id' | 'createdAt'>> = {},
  ): KnowledgeSource | undefined {
    const updated = this.store.update(id, patch);
    if (updated) {
      this.index.indexSource(updated);
    }
    return updated;
  }

  /**
   * Serialise the adapter's store.
   *
   * @returns a {@link SerializedSources} payload
   */
  toJSON(): SerializedSources {
    return this.store.toJSON();
  }

  /**
   * Rebuild an adapter from a serialised payload.
   *
   * @param data - the serialised sources
   * @param config - adapter configuration
   * @returns a new adapter
   */
  static fromJSON(
    data: SerializedSources,
    config: SourceAdapterConfig = {},
  ): KnowledgeSourceAdapter {
    const store = KnowledgeSourceStore.fromJSON(data, config.storeConfig);
    return createSourceAdapter({ ...config, store });
  }

  /**
   * Return the most recently touched sources.
   *
   * @param limit - maximum results
   * @returns the recent sources
   */
  recent(limit?: number): KnowledgeSource[] {
    return this.retriever.recent(limit);
  }

  /**
   * Search by weighted relevance.
   *
   * @param query - the free-text query
   * @param limit - maximum results
   * @param options - per-call search options
   * @returns a {@link SourceSearchResult}
   */
  search(query: string, limit?: number, options: SearchOptions = {}): SourceSearchResult {
    return this.retriever.search(query, limit, options);
  }

  /**
   * Return sources carrying given tags.
   *
   * @param tags - the tags to match
   * @param limit - maximum results
   * @param mode - `'all'` (default) or `'any'`
   * @returns the matching sources
   */
  byTags(
    tags: readonly string[],
    limit?: number,
    mode: TagMatchMode = 'all',
  ): KnowledgeSource[] {
    return this.retriever.byTags(tags, limit, mode);
  }

  /**
   * Return a random sample of sources.
   *
   * @param limit - maximum results
   * @param seed - optional PRNG seed
   * @returns the sampled sources
   */
  random(limit?: number, seed?: number): KnowledgeSource[] {
    return this.retriever.random(limit, seed);
  }
}

/**
 * Factory for {@link KnowledgeSourceAdapter}.
 *
 * Builds (or reuses) a store, derives an index from it, and wires a retriever.
 *
 * @param config - adapter configuration
 * @returns a ready-to-use adapter
 */
export function createSourceAdapter(
  config: SourceAdapterConfig = {},
): KnowledgeSourceAdapter {
  const now = config.now ?? (() => Date.now());
  const store = config.store ?? new KnowledgeSourceStore(config.storeConfig);
  const index = config.index ?? new SourceIndex(store.values());
  const retrieverOptions: SourceRetrieverOptions = {
    ...(config.retrieverOptions ?? {}),
    now,
  };
  return new KnowledgeSourceAdapter(store, index, {
    name: config.name,
    retrieverOptions,
  });
}

/**
 * A collection of named {@link KnowledgeSourceAdapter}s.
 *
 * Supports bulk ingestion across adapters (`ingestAll`), generic
 * fan-out queries (`query`), merged cross-adapter search (`search`) and
 * aggregate statistics.
 *
 * @example
 * ```ts
 * const registry = new SourceRegistry();
 * registry.register(createSourceAdapter({ name: 'docs' }));
 * registry.register(createSourceAdapter({ name: 'kb' }));
 * await registry.ingestAll([{ id: 'a', text: 'Alpha' }, { id: 'b', url: 'https://x.example' }]);
 * const hits = registry.search('alpha');
 * ```
 */
export class SourceRegistry {
  /** Named adapter map, keyed by adapter name. */
  private readonly adapters = new Map<string, KnowledgeSourceAdapter>();

  /** Epoch-millisecond construction time. */
  private readonly createdAt: Timestamp;

  /** Name of the lazily-created fallback adapter. */
  private readonly defaultName: string;

  /**
   * Construct a registry.
   *
   * @param options - optional default adapter name and clock
   */
  constructor(
    options: { defaultName?: string; now?: () => Timestamp } = {},
  ) {
    this.defaultName = options.defaultName ?? 'default';
    this.createdAt = (options.now ?? (() => Date.now()))();
  }

  /** @returns the number of registered adapters. */
  get size(): number {
    return this.adapters.size;
  }

  /**
   * Register an adapter under its name.
   *
   * @param adapter - the adapter to register
   * @param overwrite - when `true`, replaces an existing adapter of the same
   * name; defaults to `false`
   * @throws `Error` when the name is taken and `overwrite` is `false`
   */
  register(adapter: KnowledgeSourceAdapter, overwrite = false): void {
    if (this.adapters.has(adapter.name) && !overwrite) {
      throw new Error(
        `An adapter named "${adapter.name}" is already registered`,
      );
    }
    this.adapters.set(adapter.name, adapter);
  }

  /**
   * Register many adapters at once.
   *
   * @param adapters - the adapters to register
   * @param overwrite - whether duplicate names may be replaced
   * @returns the number registered
   */
  registerMany(
    adapters: readonly KnowledgeSourceAdapter[],
    overwrite = false,
  ): number {
    for (const adapter of adapters) {
      this.register(adapter, overwrite);
    }
    return adapters.length;
  }

  /**
   * Remove an adapter by name.
   *
   * @param name - the adapter name
   * @returns `true` when an adapter was removed
   */
  unregister(name: string): boolean {
    return this.adapters.delete(name);
  }

  /**
   * Fetch an adapter by name.
   *
   * @param name - the adapter name
   * @returns the adapter, or `undefined`
   */
  get(name: string): KnowledgeSourceAdapter | undefined {
    return this.adapters.get(name);
  }

  /**
   * Test whether an adapter is registered.
   *
   * @param name - the adapter name
   * @returns `true` when present
   */
  has(name: string): boolean {
    return this.adapters.has(name);
  }

  /**
   * All adapter names.
   *
   * @returns the names, in registration order
   */
  keys(): string[] {
    return [...this.adapters.keys()];
  }

  /**
   * All adapters.
   *
   * @returns the adapters, in registration order
   */
  values(): KnowledgeSourceAdapter[] {
    return [...this.adapters.values()];
  }

  /**
   * Remove every adapter.
   *
   * @returns the number removed
   */
  clear(): number {
    const count = this.adapters.size;
    this.adapters.clear();
    return count;
  }

  /**
   * Fan a callback out over every registered adapter.
   *
   * @param fn - the callback, invoked with each adapter
   * @returns the per-adapter results, in registration order
   */
  query<R>(fn: (adapter: KnowledgeSourceAdapter) => R): R[] {
    const out: R[] = [];
    for (const adapter of this.adapters.values()) {
      out.push(fn(adapter));
    }
    return out;
  }

  /**
   * Bulk-ingest items, routing each to the appropriate ingestion path.
   *
   * Items are routed structurally (see {@link IngestItem}). A full
   * {@link KnowledgeSource} is registered verbatim. Each item is ingested into
   * `targetName` (defaults to the lazily-created default adapter) or, when
   * `targetName` is omitted and more than one adapter exists, into the first
   * registered adapter.
   *
   * @param items - the items to ingest
   * @param targetName - optional target adapter name
   * @returns a {@link IngestBatchResult}
   */
  async ingestAll(
    items: readonly IngestItem[],
    targetName?: string,
  ): Promise<IngestBatchResult> {
    const adapter = this.resolveAdapter(targetName);
    const results: IngestResult[] = [];
    let ok = 0;
    let failed = 0;
    let skipped = 0;

    for (const item of items) {
      try {
        const result = await this.ingestOne(adapter, item);
        results.push(result);
        if (result.ok) {
          ok += 1;
        }
        if (result.skipped) {
          skipped += 1;
        }
      } catch {
        failed += 1;
      }
    }

    return {
      results,
      ok,
      failed,
      skipped,
      at: (() => Date.now())(),
    };
  }

  /**
   * Search across every registered adapter and merge the ranked hits.
   *
   * @param query - the free-text query
   * @param limit - maximum total results
   * @param options - per-call search options
   * @returns a merged {@link RegistrySearchResult}
   */
  search(
    query: string,
    limit?: number,
    options: SearchOptions = {},
  ): RegistrySearchResult {
    const adapters = this.values();
    const merged = mergeSearchResults(
      adapters.map((adapter) => adapter.search(query, undefined, options)),
      limit,
    );
    return {
      query,
      results: merged,
      returned: merged.length,
      adapters: adapters.length,
      at: Date.now(),
    };
  }

  /**
   * Aggregate statistics across all adapters.
   *
   * @returns a {@link RegistryStats} snapshot
   */
  stats(): RegistryStats {
    const perAdapter: Record<string, number> = {};
    let sources = 0;
    for (const [name, adapter] of this.adapters) {
      const count = adapter.size;
      perAdapter[name] = count;
      sources += count;
    }
    return {
      adapters: this.adapters.size,
      sources,
      perAdapter,
      createdAt: this.createdAt,
    };
  }

  /**
   * Resolve the adapter a batch should target.
   *
   * @param targetName - an explicit name, or `undefined` for the default
   * @returns the resolved adapter, creating the default lazily
   */
  private resolveAdapter(targetName?: string): KnowledgeSourceAdapter {
    if (targetName !== undefined) {
      const adapter = this.adapters.get(targetName);
      if (!adapter) {
        throw new Error(`No adapter named "${targetName}" is registered`);
      }
      return adapter;
    }
    const existing = this.adapters.get(this.defaultName);
    if (existing) {
      return existing;
    }
    const created = createSourceAdapter({ name: this.defaultName });
    this.adapters.set(this.defaultName, created);
    return created;
  }

  /**
   * Ingest a single item through the appropriate path.
   *
   * @param adapter - the target adapter
   * @param item - the item to ingest
   * @returns the ingestion result
   * @throws `TypeError` for unrecognised item shapes
   */
  private async ingestOne(
    adapter: KnowledgeSourceAdapter,
    item: IngestItem,
  ): Promise<IngestResult> {
    if (isKnowledgeSource(item)) {
      const result = adapter.register(item);
      adapter.index.indexSource(result.source);
      return result;
    }
    if ('text' in item && typeof item.text === 'string') {
      return adapter.ingestText(item.id, item.text, {
        name: item.name,
        tags: item.tags,
        metadata: item.metadata,
        mimeType: item.mimeType,
      });
    }
    if ('path' in item && typeof item.path === 'string') {
      return adapter.ingestFile(item.id, item.path, {
        name: item.name,
        tags: item.tags,
        metadata: item.metadata,
        mimeType: item.mimeType,
        encoding: 'encoding' in item ? item.encoding : undefined,
      });
    }
    if ('url' in item && typeof item.url === 'string') {
      return adapter.ingestUrl(item.id, item.url, {
        name: item.name,
        tags: item.tags,
        metadata: item.metadata,
        mimeType: item.mimeType,
        autoFetch: 'autoFetch' in item ? item.autoFetch : undefined,
        fetchTimeoutMs: 'fetchTimeoutMs' in item ? item.fetchTimeoutMs : undefined,
      });
    }
    if ('kind' in item && item.kind === 'memory') {
      return adapter.ingestMemory(item.id, item.content, {
        name: item.name,
        tags: item.tags,
        metadata: item.metadata,
      });
    }
    throw new TypeError('Unrecognised ingest item shape');
  }
}

/**
 * Guard: is a value a {@link SourceStore}-compatible object?
 *
 * @param value - the value to test
 * @returns `true` when the value exposes the core store surface
 */
export function isSourceStore(value: unknown): value is SourceStore {
  return isSourceStoreLike(value);
}