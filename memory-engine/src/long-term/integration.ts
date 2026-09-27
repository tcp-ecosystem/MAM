/**
 * @fileOverview Integration surface for the long-term memory layer.
 *
 * This module adapts the long-term machinery (`store`, `index`, `retriever`,
 * `lifecycle`) into two ergonomic entry points:
 *
 *   1. {@link LongTermRuntimeAdapter} – a small {@link RuntimeMemory}
 *      implementation that behaves like a durable, semantic key/value memory:
 *      `set` / `get` / `delete` / `has` / `keys` / `clear` / `stats`, plus
 *      `search` and `recall` for semantic lookup, and `persist` for explicit
 *      flushing.
 *
 *   2. {@link LongTermRepository} – a higher-level "knowledge base" that adds
 *      tags + importance scoring on top of the adapter.  It exposes verb-like
 *      methods (`remember`, `recall`, `forget`, `learn`) and knowledge
 *      plumbing (`knowledge`, `snapshot`, `restore`) so the rest of the MAM
 *      engine can treat long-term memory as a first-class durable store.
 *
 * Both are created through small factories (`createLongTermAdapter`,
 * `createLongTermRepository`) that default every option so a one-line
 * instantiation "just works".
 */

import {
  LongTermConfig,
  LongTermEntry,
  LongTermEntryOptions,
  LongTermEntryInput,
  LongTermStats,
  PersistenceOptions,
  ScoredLongTermResult,
  buildEntry,
  cloneValue,
  normalizeTags,
  sortByNewest,
} from './types.js';

import { LongTermStore } from './store.js';
import { LongTermIndex } from './index.js';
import {
  HybridRetrievalOptions,
  LongTermRetriever,
  RecallContext,
} from './retrieval.js';
import { LongTermLifecycle } from './lifecycle.js';

/**
 * Minimal runtime-memory contract that the long-term adapter implements.
 * Sized so that other memory layers (working-memory, episodic, etc.) can share
 * the same interface and be swapped transparently.
 */
export interface RuntimeMemory {
  /** Stores a value under a key, returning the stored entry. */
  set(key: string, value: unknown, options?: LongTermEntryOptions): LongTermEntry;
  /** Reads the entry for a key, touching its access time. */
  get(key: string): LongTermEntry | undefined;
  /** Deletes a key, returning true when something was removed. */
  delete(key: string): boolean;
  /** Returns true when the key exists. */
  has(key: string): boolean;
  /** Lists every stored key. */
  keys(): string[];
  /** Removes all entries; returns the number removed. */
  clear(): number;
  /** Returns structural statistics for the memory. */
  stats(): LongTermStats;
  /** Semantic free-text search over the memory. */
  search(query: string, opts?: HybridRetrievalOptions): LongTermEntry[];
  /** Contextual recall (semantic + tag hints). */
  recall(context: string | RecallContext, opts?: HybridRetrievalOptions): ScoredLongTermResult[];
  /** Flushes in-memory state to durable storage. */
  persist(): Promise<number>;
}

/** Options accepted by {@link LongTermRuntimeAdapter}. */
export interface LongTermAdapterOptions {
  /** Shared store configuration (maxEntries, persistPath, ...). */
  config?: Partial<LongTermConfig>;
  /** Pre-seed the adapter with entries before the first load. */
  initialEntries?: Iterable<LongTermEntry>;
  /** Start the auto-persist lifecycle immediately (default true). */
  autoStart?: boolean;
  /** Override the auto-persist interval in ms. */
  persistIntervalMs?: number;
}

/**
 * Durable, taggable, importance-scored key/value memory with semantic recall.
 *
 * The adapter wires a {@link LongTermStore}, a {@link LongTermIndex}, a
 * {@link LongTermRetriever}, and a {@link LongTermLifecycle} together so that
 * every `set` is indexed, every `search` is ranked, and (when configured with
 * a `persistPath`) every dirty change is flushed to disk on the lifecycle
 * interval.
 *
 * @example
 * ```ts
 * const memory = createLongTermAdapter({ persistPath: './mem.json' });
 * memory.set('goal', 'ship the parser', { tags: ['goal'], importance: 0.9 });
 * memory.recall('what should I ship?').forEach(({ entry, score }) => ...);
 * await memory.persist();
 * ```
 */
export class LongTermRuntimeAdapter implements RuntimeMemory {
  private readonly store: LongTermStore;
  private readonly index: LongTermIndex;
  private readonly retriever: LongTermRetriever;
  private readonly lifecycle: LongTermLifecycle;

  /** Creates an adapter, optionally with a pre-seeded store. */
  constructor(options: LongTermAdapterOptions = {}) {
    this.store = new LongTermStore(options.config, {
      initialEntries: options.initialEntries,
    });
    this.index = new LongTermIndex();
    this.index.rebuild(this.store.getAll({ includeArchived: true }));
    this.retriever = new LongTermRetriever({ store: this.store, index: this.index });
    this.lifecycle = new LongTermLifecycle(this.store, {
      index: this.index,
      intervalMs: options.persistIntervalMs ?? options.config?.persistIntervalMs,
      autoStart: options.autoStart !== false,
    });
  }

  /* ------------------------------------------------------------------ *
   * RuntimeMemory contract
   * ------------------------------------------------------------------ */

  /** Stores a value under `key`; the value is deep-cloned on write. */
  set(
    key: string,
    value: unknown,
    options?: LongTermEntryOptions,
  ): LongTermEntry {
    const entry = this.store.set(key, value, options);
    this.index.indexEntry(this.store.get(key, { touch: false }) ?? entry);
    return entry;
  }

  /** Reads the entry for `key`, touching `lastAccessAt`. */
  get(key: string): LongTermEntry | undefined {
    return this.store.get(key);
  }

  /** Deletes `key` from the store and the index. */
  delete(key: string): boolean {
    const removed = this.store.delete(key);
    if (removed) {
      this.index.removeEntry(key);
    }
    return removed;
  }

  /** Returns true when `key` is present (archived included). */
  has(key: string): boolean {
    return this.store.has(key);
  }

  /** Lists all stored keys. */
  keys(): string[] {
    return this.store.keys();
  }

  /** Removes every entry (store and index), returning the count. */
  clear(): number {
    const removed = this.store.clear();
    this.index.clear();
    return removed;
  }

  /** Returns structural statistics. */
  stats(): LongTermStats {
    return this.store.stats();
  }

  /** Semantic free-text search returning ranked plain entries. */
  search(
    query: string,
    opts?: HybridRetrievalOptions,
  ): LongTermEntry[] {
    return this.retriever.search(query, opts);
  }

  /**
   * Contextual recall.  Accepts either a plain string (free text) or a
   * {@link RecallContext} with hints.  Always returns scored results so
   * callers can threshold on `score`.
   */
  recall(
    context: string | RecallContext,
    opts?: HybridRetrievalOptions,
  ): ScoredLongTermResult[] {
    const ctx: RecallContext =
      typeof context === 'string' ? { query: context } : context;
    if (ctx.tags !== undefined && ctx.tags.length > 0) {
      const tagged = this.retriever.tagged(ctx.tags, {
        limit: ctx.limit ?? opts?.limit,
      });
      if (tagged.length > 0) {
        const scores = this.scorePreservingOrder(tagged);
        return scores.slice(0, ctx.limit ?? 10);
      }
    }
    if (ctx.source !== undefined) {
      const fromSource = this.retriever.source(ctx.source, {
        limit: ctx.limit ?? opts?.limit,
      });
      if (fromSource.length > 0) {
        return this.scorePreservingOrder(fromSource).slice(0, ctx.limit ?? 10);
      }
    }
    if (ctx.query !== undefined && ctx.query.trim().length > 0) {
      return this.retriever.hybrid(ctx.query, {
        ...opts,
        ...ctx.hybrid,
        limit: ctx.limit ?? opts?.limit,
        minImportance: ctx.minImportance ?? opts?.minImportance,
      });
    }
    return this.recent(ctx.limit ?? 10);
  }

  /** Flushes dirty in-memory state to disk via the lifecycle. */
  async persist(): Promise<number> {
    return this.lifecycle.persist();
  }

  /* ------------------------------------------------------------------ *
   * Adapter conveniences
   * ------------------------------------------------------------------ */

  /** Inserts many entries in one call (indexed together). */
  setMany(inputs: LongTermEntryInput[]): LongTermEntry[] {
    const stored = this.store.putMany(inputs);
    for (const entry of stored) {
      this.index.indexEntry(this.store.get(entry.id, { touch: false }) ?? entry);
    }
    return stored;
  }

  /** Returns the most recent entries, newest first. */
  recent(limit = 10): ScoredLongTermResult[] {
    const entries = this.retriever.recent({ limit });
    return this.scorePreservingOrder(entries);
  }

  /** Returns the most important entries, highest first. */
  important(limit = 10): ScoredLongTermResult[] {
    const entries = this.retriever.important({ limit });
    return this.scorePreservingOrder(entries);
  }

  /** Returns entries carrying all requested tags. */
  tagged(tags: string | string[], limit = 10): ScoredLongTermResult[] {
    const entries = this.retriever.tagged(tags, { limit });
    return this.scorePreservingOrder(entries);
  }

  /** Archives an entry (soft delete), keeping it on disk. */
  archive(key: string): boolean {
    const ok = this.store.archive(key);
    if (ok) {
      this.index.reindexImportance(key);
    }
    return ok;
  }

  /** Un-archives an entry, making it visible to retrieval again. */
  unarchive(key: string): boolean {
    return this.store.unarchive(key);
  }

  /** Applies a partial patch to an existing entry. */
  update(
    key: string,
    patch: Partial<Omit<LongTermEntry, 'id'>>,
  ): LongTermEntry | undefined {
    const updated = this.store.update(key, patch);
    if (updated !== undefined) {
      this.index.indexEntry(updated);
    }
    return updated;
  }

  /** Re-scores an entry's importance, re-keying the importance index. */
  rescore(key: string, importance: number): LongTermEntry | undefined {
    const updated = this.store.update(key, { importance });
    if (updated !== undefined) {
      this.index.reindexImportance(key);
    }
    return updated;
  }

  /** Runs a maintenance pass (prune + archiveOld + consolidate). */
  maintain(): { pruned: number; archived: number; consolidated: number } {
    const archived = this.lifecycle.archiveOld();
    const pruned = this.lifecycle.prune();
    const consolidated = this.lifecycle.consolidate();
    return {
      pruned: pruned.length,
      archived: archived.length,
      consolidated: consolidated.merged.length,
    };
  }

  /** Returns the underlying store for advanced use. */
  getStore(): LongTermStore {
    return this.store;
  }

  /** Returns the underlying index for advanced use. */
  getIndex(): LongTermIndex {
    return this.index;
  }

  /** Returns the underlying retriever for advanced use. */
  getRetriever(): LongTermRetriever {
    return this.retriever;
  }

  /** Returns the lifecycle manager (for events / timer control). */
  getLifecycle(): LongTermLifecycle {
    return this.lifecycle;
  }

  /* ------------------------------------------------------------------ *
   * Internal helpers
   * ------------------------------------------------------------------ */

  /**
   * Wraps plain entries in scored results with a monotonic "rank" score so
   * every adapter method returns a uniform shape without fabricating semantic
   * scores.
   */
  private scorePreservingOrder(entries: LongTermEntry[]): ScoredLongTermResult[] {
    const total = Math.max(1, entries.length);
    return entries.map((entry, i) => {
      const score = total === 1 ? 1 : (total - i) / total;
      return {
        entry,
        score,
        breakdown: { importance: score, recency: score, match: score },
      };
    });
  }
}

/**
 * Creates a ready-to-use {@link LongTermRuntimeAdapter}.
 *
 * @example
 * ```ts
 * const memory = createLongTermAdapter({ persistPath: './mem.json' });
 * ```
 */
export function createLongTermAdapter(
  options?: LongTermAdapterOptions,
): LongTermRuntimeAdapter {
  return new LongTermRuntimeAdapter(options);
}

/* -------------------------------------------------------------------------- *
 * LongTermRepository
 * -------------------------------------------------------------------------- */

/** Options accepted by {@link LongTermRepository}. */
export interface LongTermRepositoryOptions {
  /** Persistence path for the knowledge base. */
  persistPath?: string;
  /** Maximum entries before pruning kicks in. */
  maxEntries?: number;
  /** Start auto-persist immediately (default true). */
  autoStart?: boolean;
  /** Seed the repository with initial knowledge. */
  initialEntries?: Iterable<LongTermEntry>;
}

/** Result of {@link LongTermRepository.knowledge}. */
export interface KnowledgeProfile {
  /** Entry the profile was computed for. */
  entry: LongTermEntry;
  /** Union of tags (with the entry's own tags always included). */
  tags: string[];
  /** Effective importance, or 0 when unscored. */
  importance: number;
  /** True when the entry is currently archived. */
  archived: boolean;
  /** Age of the entry in milliseconds. */
  ageMs: number;
}

/**
 * A higher-level, durable knowledge base built on the long-term adapter.
 *
 * Adds a small amount of domain language on top of {@link RuntimeMemory} so
 * agents can express intent in verbs:
 *
 *   - `remember` a fact (with tags + importance),
 *   - `recall` what is relevant to a query,
 *   - `forget` / `archive` knowledge,
 *   - `learn` batches of facts in one transaction,
 *   - `knowledge` to inspect how a stored fact is profiled,
 *   - `snapshot` / `restore` to move the whole knowledge base as JSON.
 */
export class LongTermRepository {
  private readonly adapter: LongTermRuntimeAdapter;
  private readonly defaultTags: string[];

  /** Creates a repository over a fresh adapter. */
  constructor(options: LongTermRepositoryOptions = {}) {
    this.defaultTags = normalizeTags(options.maxEntries !== undefined ? [] : []);
    this.adapter = createLongTermAdapter({
      config: {
        persistPath: options.persistPath,
        maxEntries: options.maxEntries,
      },
      initialEntries: options.initialEntries,
      autoStart: options.autoStart,
    });
  }

  /**
   * Stores a fact in the knowledge base.  Tags default to a caller-supplied
   * namespace tag (via the constructor) and are always normalised.
   *
   * @returns the stored entry.
   */
  remember(
    value: unknown,
    options: LongTermEntryOptions & { key?: string } = {},
  ): LongTermEntry {
    const key = options.key ?? this.deterministicKey(value);
    const tags = normalizeTags([...this.defaultTags, ...(options.tags ?? [])]);
    return this.adapter.set(key, value, { ...options, tags });
  }

  /**
   * Semantic recall.  Returns scored hits, newest and most relevant first.
   */
  recall(
    query: string,
    options: HybridRetrievalOptions = {},
  ): ScoredLongTermResult[] {
    return this.adapter.recall(query, options);
  }

  /** Removes a fact from the knowledge base permanently. */
  forget(key: string): boolean {
    return this.adapter.delete(key);
  }

  /** Soft-deletes a fact (kept on disk, hidden from recall). */
  archive(key: string): boolean {
    return this.adapter.archive(key);
  }

  /** Restores a previously archived fact. */
  restoreArchived(key: string): boolean {
    return this.adapter.unarchive(key);
  }

  /**
   * Learns many facts at once, returning every stored entry.
   */
  learn(
    items: Array<{
      value: unknown;
      key?: string;
      options?: LongTermEntryOptions;
    }>,
  ): LongTermEntry[] {
    return items.map((item) =>
      this.remember(item.value, { key: item.key, ...item.options }),
    );
  }

  /**
   * Searches by tag.  Returns scored results.
   */
  byTag(tags: string | string[], limit = 20): ScoredLongTermResult[] {
    return this.adapter.tagged(tags, limit);
  }

  /**
   * Searches by importance threshold.
   */
  byImportance(min: number, limit = 20): ScoredLongTermResult[] {
    const entries = this.adapter
      .getStore()
      .getByImportance(min, { limit })
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    return entries.map((entry, i, arr) => ({
      entry,
      score: arr.length === 1 ? 1 : (arr.length - i) / arr.length,
      breakdown: { importance: 1, recency: 1, match: 1 },
    }));
  }

  /**
   * Inspects how a stored fact is profiled: tags, importance, archived state,
   * and age.
   */
  knowledge(key: string): KnowledgeProfile | undefined {
    const entry = this.adapter.get(key);
    if (entry === undefined) {
      return undefined;
    }
    return {
      entry,
      tags: normalizeTags(entry.tags),
      importance: entry.importance ?? 0,
      archived: entry.archived === true,
      ageMs: Math.max(0, Date.now() - (entry.updatedAt ?? entry.createdAt)),
    };
  }

  /** Returns structural statistics for the whole knowledge base. */
  stats(): LongTermStats {
    return this.adapter.stats();
  }

  /** Returns every stored entry, newest first. */
  all(): LongTermEntry[] {
    return sortByNewest(this.adapter.getStore().getAll({ includeArchived: true }));
  }

  /**
   * Serialises the entire knowledge base (plus a schema marker) to a plain
   * JSON object that can be persisted or transferred.
   */
  snapshot(): Record<string, unknown> {
    const store = this.adapter.getStore();
    const entries = store.getAll({ includeArchived: true }).map((entry) => ({
      id: entry.id,
      value: cloneValue(entry.value),
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      lastAccessAt: entry.lastAccessAt,
      importance: entry.importance,
      tags: [...normalizeTags(entry.tags)],
      metadata: cloneValue(entry.metadata ?? {}),
      source: entry.source,
      archived: entry.archived,
    }));
    return {
      kind: 'mam.long-term.repository',
      version: 1,
      takenAt: Date.now(),
      entries,
    };
  }

  /**
   * Replaces the entire knowledge base from a `snapshot()`-shaped object.
   * Returns the number of entries restored.
   */
  async restore(
    snapshot: unknown,
    options?: PersistenceOptions,
  ): Promise<number> {
    if (typeof snapshot !== 'object' || snapshot === null) {
      throw new TypeError('restore() expects a snapshot object');
    }
    const record = snapshot as Record<string, unknown>;
    if (!Array.isArray(record['entries'])) {
      throw new TypeError('snapshot is missing an entries array');
    }
    const inputs: LongTermEntryInput[] = [];
    for (const raw of record['entries'] as unknown[]) {
      if (typeof raw !== 'object' || raw === null) {
        continue;
      }
      const e = raw as Record<string, unknown>;
      if (typeof e['id'] !== 'string') {
        continue;
      }
      inputs.push({
        id: e['id'],
        value: e['value'],
        options: {
          createdAt: typeof e['createdAt'] === 'number' ? e['createdAt'] : undefined,
          importance: typeof e['importance'] === 'number' ? e['importance'] : undefined,
          tags: Array.isArray(e['tags']) ? (e['tags'] as string[]) : undefined,
          metadata:
            typeof e['metadata'] === 'object' && e['metadata'] !== null
              ? (e['metadata'] as Record<string, unknown>)
              : undefined,
          source: typeof e['source'] === 'string' ? e['source'] : undefined,
          archived: e['archived'] === true ? true : undefined,
        },
      });
    }
    this.adapter.clear();
    this.adapter.setMany(inputs);
    if (options) {
      await this.adapter.persist();
    }
    return inputs.length;
  }

  /** Flushes the knowledge base to disk. */
  async persist(): Promise<number> {
    return this.adapter.persist();
  }

  /** Returns the underlying adapter for escape-hatch access. */
  getAdapter(): LongTermRuntimeAdapter {
    return this.adapter;
  }

  /**
   * Derives a stable storage key from a value, so the same fact re-remembered
   * overwrites its prior copy instead of duplicating it.  Collision risk is
   * acceptable for a default key; callers who need explicit keys pass one.
   */
  private deterministicKey(value: unknown): string {
    if (typeof value === 'string') {
      return `fact:${value.slice(0, 80)}`;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return `fact:${String(value)}`;
    }
    try {
      const json = JSON.stringify(value);
      return `fact:${json.slice(0, 80)}`;
    } catch {
      return `fact:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    }
  }
}

/**
 * Factory that builds a {@link LongTermRepository}.
 *
 * @example
 * ```ts
 * const kb = createLongTermRepository({ persistPath: './knowledge.json' });
 * kb.remember('the parser tokenizer handles EOF', { tags: ['parser'], importance: 0.8 });
 * ```
 */
export function createLongTermRepository(
  options?: LongTermRepositoryOptions,
): LongTermRepository {
  return new LongTermRepository(options);
}