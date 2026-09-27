/**
 * @fileOverview Persistent-capable long-term store.
 *
 * {@link LongTermStore} is the workhorse of the long-term memory layer.  It
 * keeps an in-memory `Map<string, LongTermEntry>` and optionally mirrors that
 * state to a JSON file on disk via `node:fs/promises`.
 *
 * Responsibilities:
 *
 *   - CRUD operations (`put`, `get`, `delete`, `has`, `keys`, `clear`).
 *   - Bulk operations (`putMany`, `getAll`, `update`).
 *   - Semantic queries (`getByTag`, `getByImportance`).
 *   - Soft deletion (`archive` / `unarchive`).
 *   - Durable persistence (`persist` / `load`) using an atomic
 *     write-temp-then-rename strategy so a crash mid-write never corrupts the
 *     on-disk snapshot.
 *   - Introspection (`size`, `stats`, `getConfig`, `setConfig`).
 *
 * The store is deliberately synchronous for in-memory operations; only disk
 * I/O (`persist` / `load`) is asynchronous.
 */

import {
  LongTermConfig,
  LongTermEntry,
  LongTermEntryInput,
  LongTermEntryOptions,
  LongTermStats,
  PersistenceOptions,
  DEFAULT_MAX_ENTRIES,
  DEFAULT_IMPORTANCE_THRESHOLD,
  assertValidEntry,
  assertValidId,
  buildEntry,
  cloneValue,
  entryFromJSON,
  entryToJSON,
  filterArchived,
  isLongTermEntry,
  mergeEntry,
  normalizeImportance,
  normalizeTags,
  partitionLive,
  sortByImportance,
  sortByNewest,
  valuesEqual,
} from './types.js';

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

/**
 * Minimum number of bytes that still count as "empty" a persist file may
 * legitimately contain (an empty JSON object plus whitespace).
 */
const EMPTY_FILE_MAX_BYTES = 64;

/**
 * Version marker embedded in persisted snapshots.  Bumping this invalidates
 * snapshots written by older releases.
 */
const SNAPSHOT_VERSION = 1;

/**
 * Shape of the on-disk JSON snapshot produced by {@link LongTermStore.persist}
 * and consumed by {@link LongTermStore.load}.
 */
export interface LongTermSnapshot {
  version: number;
  writtenAt: number;
  count: number;
  entries: Record<string, unknown>[];
}

/**
 * Optional constructor flags beyond the shared {@link LongTermConfig}.
 */
export interface LongTermStoreOptions {
  /**
   * Pre-populate the store with these entries before any `load()` call.  Used
   * by tests and by the lifecycle layer when reconstructing from an index.
   */
  initialEntries?: Iterable<LongTermEntry>;
}

/**
 * In-memory, optionally file-backed store for {@link LongTermEntry} records.
 *
 * @example
 * ```ts
 * const store = new LongTermStore({ persistPath: './memories.json' });
 * store.put({ id: 'note-1', value: 'hello', createdAt: Date.now(), tags: ['greeting'] });
 * await store.persist();
 * ```
 */
export class LongTermStore {
  private entries: Map<string, LongTermEntry> = new Map();
  private config: LongTermConfig;
  private lastWriteAt = 0;
  private lastReadAt = 0;
  private lastPersistAt = 0;
  private lastPersistBytes = 0;
  private persistInFlight: Promise<void> | null = null;

  /**
   * Creates a store.  When `config.persistPath` is set and `autoLoad` is not
   * explicitly `false`, an asynchronous `load()` is kicked off immediately
   * (the constructor does not await it, so callers should `await store.load()`
   * themselves if they need the data before first use).
   */
  constructor(config?: Partial<LongTermConfig>, options?: LongTermStoreOptions) {
    this.config = this.resolveConfig(config);
    if (options?.initialEntries) {
      for (const entry of options.initialEntries) {
        assertValidEntry(entry);
        this.entries.set(entry.id, cloneValue(entry));
      }
    }
    if (this.config.persistPath && this.config.autoLoad !== false) {
      void this.load({ path: this.config.persistPath, strict: false });
    }
  }

  /* ------------------------------------------------------------------ *
   * Configuration
   * ------------------------------------------------------------------ */

  /** Fills defaulted config values from the shared constants. */
  private resolveConfig(config?: Partial<LongTermConfig>): LongTermConfig {
    return {
      maxEntries: config?.maxEntries ?? DEFAULT_MAX_ENTRIES,
      persistPath: config?.persistPath,
      persistIntervalMs: config?.persistIntervalMs,
      autoLoad: config?.autoLoad ?? true,
      importanceThreshold:
        config?.importanceThreshold ?? DEFAULT_IMPORTANCE_THRESHOLD,
    };
  }

  /**
   * Replaces the active configuration.  Any previously scheduled persistence
   * behaviour is NOT re-run automatically; callers should trigger a
   * `persist()` themselves if they changed `persistPath`.
   *
   * @returns `this` for chaining.
   */
  setConfig(config: Partial<LongTermConfig>): this {
    this.config = this.resolveConfig({ ...this.config, ...config });
    return this;
  }

  /** Returns a read-only snapshot of the active configuration. */
  getConfig(): Readonly<LongTermConfig> {
    return { ...this.config };
  }

  /** Returns the effective importance threshold in use for this store. */
  getImportanceThreshold(): number {
    return this.config.importanceThreshold ?? DEFAULT_IMPORTANCE_THRESHOLD;
  }

  /* ------------------------------------------------------------------ *
   * Core CRUD
   * ------------------------------------------------------------------ */

  /**
   * Inserts (or, by default, replaces) a single entry.
   *
   * Accepts either a fully-formed {@link LongTermEntry} or an
   * `{ id, value, options }` input.  Tags are normalised, importance clamped,
   * and `createdAt` defaulted before the entry is stored.
   *
   * @returns the entry as actually stored (a deep clone).
   */
  put(input: LongTermEntryInput): LongTermEntry {
    const entry = this.toEntry(input);
    const existing = this.entries.get(entry.id);
    const stored =
      existing !== undefined && entry.updatedAt === undefined
        ? mergeEntry(existing, { ...entry, updatedAt: Date.now() })
        : entry;
    this.entries.set(stored.id, cloneValue(stored));
    this.lastWriteAt = Date.now();
    return this.getUnsafe(stored.id) as LongTermEntry;
  }

  /**
   * Convenience wrapper around {@link LongTermStore.put} that accepts an id,
   * a value, and {@link LongTermEntryOptions} directly.
   */
  set(
    id: string,
    value: unknown,
    options?: LongTermEntryOptions,
  ): LongTermEntry {
    return this.put({ id, value, options });
  }

  /**
   * Creates a fresh entry under `id`.  Unlike `put`, this never overwrites an
   * existing entry: it returns `undefined` and leaves the map untouched when
   * the id already exists.
   *
   * @returns the new entry, or `undefined` if the id was already taken.
   */
  create(
    id: string,
    value: unknown,
    options?: LongTermEntryOptions,
  ): LongTermEntry | undefined {
    assertValidId(id);
    if (this.entries.has(id)) {
      return undefined;
    }
    return this.put({ id, value, options });
  }

  /**
   * Returns a cloned copy of the entry with the given id, or `undefined` when
   * it does not exist.  When `options.touch` is true (default), the entry's
   * `lastAccessAt` is updated in place and the store's `lastReadAt` marker is
   * refreshed.
   */
  get(
    id: string,
    options?: { touch?: boolean },
  ): LongTermEntry | undefined {
    assertValidId(id);
    this.lastReadAt = Date.now();
    const entry = this.entries.get(id);
    if (entry === undefined) {
      return undefined;
    }
    if (options?.touch !== false) {
      entry.lastAccessAt = Date.now();
    }
    return cloneValue(entry);
  }

  /** Non-cloning internal read; callers must not mutate the result. */
  private getUnsafe(id: string): LongTermEntry | undefined {
    return this.entries.get(id);
  }

  /**
   * Returns `true` when an entry with `id` exists (archived entries still
   * count as present).
   */
  has(id: string): boolean {
    assertValidId(id);
    return this.entries.has(id);
  }

  /**
   * Removes the entry with `id` from the store.
   *
   * @returns `true` if an entry was removed, `false` if none existed.
   */
  delete(id: string): boolean {
    assertValidId(id);
    this.lastWriteAt = Date.now();
    return this.entries.delete(id);
  }

  /** Returns a copy of all currently held entry ids (unsorted). */
  keys(): string[] {
    return [...this.entries.keys()];
  }

  /** Returns a copy of all currently held entries (unsorted). */
  getAll(options?: { includeArchived?: boolean }): LongTermEntry[] {
    const includeArchived = options?.includeArchived ?? false;
    this.lastReadAt = Date.now();
    return filterArchived([...this.entries.values()], includeArchived).map(
      (entry) => cloneValue(entry),
    );
  }

  /**
   * Removes every entry.
   *
   * @returns the number of entries that were removed.
   */
  clear(): number {
    const removed = this.entries.size;
    this.entries.clear();
    this.lastWriteAt = Date.now();
    return removed;
  }

  /** Returns the total number of entries currently held (including archived). */
  size(): number {
    return this.entries.size;
  }

  /* ------------------------------------------------------------------ *
   * Bulk operations
   * ------------------------------------------------------------------ */

  /**
   * Inserts many entries in one call.  Each input goes through the same
   * validation and normalisation as {@link LongTermStore.put}.
   *
   * @returns the entries as actually stored, in input order.
   */
  putMany(inputs: LongTermEntryInput[]): LongTermEntry[] {
    return inputs.map((input) => this.put(input));
  }

  /**
   * Applies a partial patch to the entry with `id`.  The id is immutable;
   * `updatedAt` is refreshed, tags are normalised, metadata is shallow-merged.
   *
   * @returns the updated entry, or `undefined` when the id does not exist.
   */
  update(
    id: string,
    patch: Partial<Omit<LongTermEntry, 'id'>>,
  ): LongTermEntry | undefined {
    assertValidId(id);
    const existing = this.entries.get(id);
    if (existing === undefined) {
      return undefined;
    }
    const merged = mergeEntry(existing, patch);
    this.entries.set(id, merged);
    this.lastWriteAt = Date.now();
    return cloneValue(merged);
  }

  /**
   * Batch variant of {@link LongTermStore.update}: applies each patch to its
   * named entry and returns the number of entries that were actually updated.
   */
  updateMany(
    patches: Array<{ id: string; patch: Partial<Omit<LongTermEntry, 'id'>> }>,
  ): number {
    let updated = 0;
    for (const { id, patch } of patches) {
      if (this.update(id, patch) !== undefined) {
        updated += 1;
      }
    }
    return updated;
  }

  /* ------------------------------------------------------------------ *
   * Semantic queries
   * ------------------------------------------------------------------ */

  /**
   * Returns entries carrying every one of the requested tags.  When multiple
   * tags are supplied the match is an AND: an entry must have all of them.
   * Archived entries are excluded unless `includeArchived` is set.
   */
  getByTag(
    tags: string | string[],
    options?: { includeArchived?: boolean; limit?: number },
  ): LongTermEntry[] {
    const wanted = new Set(normalizeTags(tags));
    const results: LongTermEntry[] = [];
    for (const entry of this.entries.values()) {
      if (entry.archived === true && options?.includeArchived !== true) {
        continue;
      }
      const entryTags = new Set(entry.tags ?? []);
      let matched = true;
      for (const tag of wanted) {
        if (!entryTags.has(tag)) {
          matched = false;
          break;
        }
      }
      if (matched) {
        results.push(cloneValue(entry));
        if (options?.limit !== undefined && results.length >= options.limit) {
          break;
        }
      }
    }
    return sortByNewest(results);
  }

  /**
   * Returns live entries whose importance is at least `min`.  When `min` is
   * omitted the store's configured `importanceThreshold` is used.
   */
  getByImportance(
    min?: number,
    options?: { includeArchived?: boolean; limit?: number },
  ): LongTermEntry[] {
    const threshold = normalizeImportance(
      min ?? this.config.importanceThreshold ?? DEFAULT_IMPORTANCE_THRESHOLD,
    );
    const results: LongTermEntry[] = [];
    for (const entry of this.entries.values()) {
      if (entry.archived === true && options?.includeArchived !== true) {
        continue;
      }
      if (normalizeImportance(entry.importance) >= threshold) {
        results.push(cloneValue(entry));
        if (options?.limit !== undefined && results.length >= options.limit) {
          break;
        }
      }
    }
    return sortByImportance(results);
  }

  /* ------------------------------------------------------------------ *
   * Archiving
   * ------------------------------------------------------------------ */

  /**
   * Soft-deletes the entry with `id` by setting `archived = true`.  Archived
   * entries remain in the store and on disk but are excluded from normal
   * retrieval.
   *
   * @returns `true` when the entry was found and archived.
   */
  archive(id: string): boolean {
    return this.setArchived(id, true);
  }

  /**
   * Re-activates a previously archived entry.
   *
   * @returns `true` when the entry was found and un-archived.
   */
  unarchive(id: string): boolean {
    return this.setArchived(id, false);
  }

  /** Shared implementation of {@link LongTermStore.archive} / `unarchive`. */
  private setArchived(id: string, archived: boolean): boolean {
    assertValidId(id);
    const entry = this.entries.get(id);
    if (entry === undefined || entry.archived === archived) {
      return entry !== undefined;
    }
    entry.archived = archived;
    entry.updatedAt = Date.now();
    this.lastWriteAt = Date.now();
    return true;
  }

  /* ------------------------------------------------------------------ *
   * Persistence
   * ------------------------------------------------------------------ */

  /**
   * Serialises the entire store to JSON and writes it to disk atomically.
   *
   * The snapshot is first written to a uniquely-named temporary file in the
   * same directory and then `rename`d over the target, so a crash mid-write
   * can never leave a truncated snapshot behind.
   *
   * When no `persistPath` is configured (neither in the store config nor via
   * `options.path`), the call is a no-op that resolves immediately.
   *
   * @returns the number of entries written.
   */
  async persist(options?: PersistenceOptions): Promise<number> {
    const path = options?.path ?? this.config.persistPath;
    if (!path) {
      return 0;
    }
    if (this.persistInFlight) {
      await this.persistInFlight;
    }
    const snapshot = this.buildSnapshot();
    const json = JSON.stringify(
      snapshot,
      null,
      options?.pretty === false ? undefined : 2,
    );
    const tempPath = `${path}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
    const promise = (async () => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(tempPath, json, 'utf8');
      await rename(tempPath, path);
      this.lastPersistAt = Date.now();
      this.lastPersistBytes = Buffer.byteLength(json, 'utf8');
    })().finally(async () => {
      await rm(tempPath, { force: true }).catch(() => undefined);
      this.persistInFlight = null;
    });
    this.persistInFlight = promise;
    await promise;
    return snapshot.count;
  }

  /** Builds the serialisable snapshot object for the current contents. */
  private buildSnapshot(): LongTermSnapshot {
    const entries = [...this.entries.values()].map((entry) => entryToJSON(entry));
    return {
      version: SNAPSHOT_VERSION,
      writtenAt: Date.now(),
      count: entries.length,
      entries,
    };
  }

  /**
   * Loads entries from a JSON snapshot on disk into the store.
   *
   * By default the file contents **replace** the in-memory state
   * (`options.replace === true`).  Set `replace: false` to merge the file
   * entries underneath the existing ones (existing ids win).
   *
   * A missing file is not an error unless `strict` is set; a malformed
   * snapshot always throws.
   *
   * @returns the number of entries loaded.
   */
  async load(options?: PersistenceOptions): Promise<number> {
    const path = options?.path ?? this.config.persistPath;
    if (!path) {
      return 0;
    }
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch (error) {
      if (options?.strict === true) {
        throw error;
      }
      return 0;
    }
    if (raw.trim().length === 0 || raw.trim().length <= EMPTY_FILE_MAX_BYTES) {
      if (options?.strict === true && raw.trim().length === 0) {
        throw new Error(`Persistence file "${path}" is empty`);
      }
      return 0;
    }
    const parsed: unknown = JSON.parse(raw);
    const snapshot = parsed as Partial<LongTermSnapshot>;
    if (
      typeof snapshot !== 'object' ||
      snapshot === null ||
      !Array.isArray(snapshot.entries)
    ) {
      throw new Error(
        `Persistence file "${path}" is not a valid LongTermSnapshot (missing entries array)`,
      );
    }
    if (snapshot.version !== SNAPSHOT_VERSION && options?.strict === true) {
      throw new Error(
        `Persistence file "${path}" uses unknown snapshot version ${JSON.stringify(snapshot.version)}`,
      );
    }
    const loaded = new Map<string, LongTermEntry>();
    for (const rawEntry of snapshot.entries) {
      const entry = entryFromJSON(rawEntry, options?.strict === true);
      if (entry === undefined) {
        continue;
      }
      loaded.set(entry.id, entry);
    }
    if (options?.replace !== false) {
      this.entries = loaded;
    } else {
      for (const [id, entry] of loaded) {
        if (!this.entries.has(id)) {
          this.entries.set(id, entry);
        }
      }
    }
    this.lastWriteAt = Date.now();
    this.lastReadAt = Date.now();
    return loaded.size;
  }

  /* ------------------------------------------------------------------ *
   * Introspection
   * ------------------------------------------------------------------ */

  /**
   * Computes {@link LongTermStats} for the current store contents.  This is an
   * O(n) scan and should not be called on every keystroke.
   */
  stats(): LongTermStats {
    const { live, archived } = partitionLive([...this.entries.values()]);
    const tags = new Set<string>();
    const sources = new Set<string>();
    for (const entry of live) {
      for (const tag of entry.tags ?? []) {
        tags.add(tag);
      }
      if (entry.source) {
        sources.add(entry.source);
      }
    }
    return {
      total: this.entries.size,
      archived: archived.length,
      live: live.length,
      tags: tags.size,
      sources: sources.size,
      lastWriteAt: this.lastWriteAt,
      lastReadAt: this.lastReadAt,
      lastPersistAt: this.lastPersistAt,
      lastPersistBytes: this.lastPersistBytes,
      dirty: this.lastWriteAt > this.lastPersistAt,
    };
  }

  /**
   * Reports whether the in-memory state is ahead of the last successful
   * persist (i.e. `persist()` should be called).
   */
  isDirty(): boolean {
    return this.lastWriteAt > this.lastPersistAt;
  }

  /**
   * Returns the entry whose `value` deeply equals `value`.  Uses the O(n)
   * `valuesEqual` structural comparison; intended for the consolidation pass
   * and small stores.
   */
  findValue(value: unknown): LongTermEntry | undefined {
    for (const entry of this.entries.values()) {
      if (valuesEqual(entry.value, value)) {
        return cloneValue(entry);
      }
    }
    return undefined;
  }

  /* ------------------------------------------------------------------ *
   * Internal helpers
   * ------------------------------------------------------------------ */

  /** Normalises a {@link LongTermEntryInput} into a validated entry. */
  private toEntry(input: LongTermEntryInput): LongTermEntry {
    if (isLongTermEntry(input)) {
      assertValidEntry(input);
      const entry = cloneValue(input);
      entry.tags = normalizeTags(entry.tags);
      entry.importance =
        entry.importance !== undefined
          ? normalizeImportance(entry.importance)
          : undefined;
      if (entry.updatedAt === undefined) {
        entry.updatedAt = entry.createdAt;
      }
      return entry;
    }
    return buildEntry(input.id, input.value, input.options);
  }
}