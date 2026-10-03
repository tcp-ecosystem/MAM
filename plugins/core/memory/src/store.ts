/**
 * Memory Plugin - In-Memory Store & File Persistence
 *
 * Layered state storage: a fast in-memory map fronted by per-module JSON
 * files. Persistence is atomic (write to a temp file, then rename) and
 * versioned, so a crash mid-write cannot leave a half-written module behind
 * and an older envelope can be migrated on read.
 */

import { readFile, writeFile, rename, access, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

export const MEMORY_DIR = join(process.cwd(), '.mam', 'memory');

/** Envelope version written by this build. Older files are read and migrated. */
export const MEMORY_FILE_VERSION = 2;

export interface MemoryStoreOptions {
  /** Directory holding persisted modules. */
  memoryDir?: string;
  /** Per-key time-to-live in ms applied when a write does not specify one. */
  defaultTtlMs?: number;
  /** Hard cap on stored keys across all modules; further writes throw. */
  maxKeys?: number;
  /** Reject keys longer than this many characters. */
  maxKeyLength?: number;
  /**
   * Invoked when a persistence operation fails.
   *
   * Errors used to be swallowed outright, which turned a full disk into silent
   * data loss. With no handler the error is still swallowed, so existing
   * callers keep working, but a host can opt into visibility here.
   */
  onError?: (error: Error, context: { operation: string; moduleId?: string }) => void;
}

export interface MemorySetOptions {
  /** Time-to-live in ms for this key. Overrides the store default. */
  ttlMs?: number;
}

export type MemoryChangeType = 'set' | 'delete' | 'clear' | 'expire' | 'load';

export interface MemoryChange {
  type: MemoryChangeType;
  moduleId: string;
  keys: string[];
}

export type MemoryChangeListener = (change: MemoryChange) => void;

/** On-disk shape. `data` is the same record that `loadFile` returns. */
export interface MemoryFileEnvelope {
  version: number;
  updatedAt: string;
  data: Record<string, unknown>;
}

export interface MemoryStats {
  modules: number;
  keys: number;
  expiredKeys: number;
  hits: number;
  misses: number;
  writes: number;
  deletes: number;
  hitRate: number;
}

/** Raised when a write would exceed a configured limit. */
export class MemoryLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemoryLimitError';
  }
}

interface Entry {
  value: unknown;
  /** Absolute expiry, or undefined for a value that never expires. */
  expiresAt?: number;
}

const now = (): number => Date.now();

export class MemoryStore {
  /**
   * Module id -> key -> entry.
   *
   * Nested rather than a single flat map keyed `${moduleId}:${key}`: a module
   * named `a` would otherwise match the `a:` prefix of a module named `a:b`
   * and hand back the other module's keys from `keys()` and `entries()`.
   */
  private modules: Map<string, Map<string, Entry>> = new Map();
  private options: Required<Omit<MemoryStoreOptions, 'onError'>> & { onError?: MemoryStoreOptions['onError'] };
  private memoryDir: string;
  private listeners: MemoryChangeListener[] = [];
  private hits = 0;
  private misses = 0;
  private writes = 0;
  private deletes = 0;

  constructor(memoryDirOrOptions?: string | MemoryStoreOptions) {
    const opts: MemoryStoreOptions =
      typeof memoryDirOrOptions === 'string' ? { memoryDir: memoryDirOrOptions } : memoryDirOrOptions ?? {};
    this.memoryDir = opts.memoryDir || MEMORY_DIR;
    this.options = {
      memoryDir: this.memoryDir,
      defaultTtlMs: opts.defaultTtlMs,
      maxKeys: opts.maxKeys ?? Number.POSITIVE_INFINITY,
      maxKeyLength: opts.maxKeyLength ?? 256,
      onError: opts.onError,
    };
  }

  // ─── Core Access ──────────────────────────────────────────────

  get(moduleId: string, key: string): unknown {
    const entry = this.peek(moduleId, key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    this.hits++;
    return entry.value;
  }

  /** Returns true when the key exists and has not expired. */
  has(moduleId: string, key: string): boolean {
    return this.peek(moduleId, key) !== undefined;
  }

  set(moduleId: string, key: string, value: unknown, options?: MemorySetOptions): void {
    this.assertKeyAllowed(key);
    if (!this.has(moduleId, key) && this.size() >= this.options.maxKeys) {
      throw new MemoryLimitError(
        `Cannot store "${moduleId}:${key}": store is at its limit of ${this.options.maxKeys} keys`,
      );
    }

    const bucket = this.bucket(moduleId, true);
    const ttl = options?.ttlMs ?? this.options.defaultTtlMs;
    bucket.set(key, { value, expiresAt: ttl && ttl > 0 ? now() + ttl : undefined });
    this.writes++;
    this.emit({ type: 'set', moduleId, keys: [key] });
  }

  /**
   * Writes a key only when absent, and reports which path was taken.
   *
   * The common case is concurrent writers seeding default state, where a
   * read-then-write pair races and the second write clobbers the first.
   */
  setIfAbsent(moduleId: string, key: string, value: unknown): boolean {
    if (this.has(moduleId, key)) return false;
    this.set(moduleId, key, value);
    return true;
  }

  /** Returns the existing value, or writes and returns `defaultValue`. */
  getOrDefault(moduleId: string, key: string, defaultValue: unknown): unknown {
    if (this.has(moduleId, key)) return this.get(moduleId, key);
    this.set(moduleId, key, defaultValue);
    return defaultValue;
  }

  /**
   * Atomically replaces a key with `updater`'s result.
   *
   * The updater receives `undefined` when the key is absent. Returning
   * `undefined` leaves the key deleted rather than storing undefined.
   */
  update(moduleId: string, key: string, updater: (current: unknown) => unknown): unknown {
    const next = updater(this.get(moduleId, key));
    if (next === undefined) {
      this.delete(moduleId, key);
      return undefined;
    }
    this.set(moduleId, key, next);
    return next;
  }

  delete(moduleId: string, key: string): boolean {
    const bucket = this.modules.get(moduleId);
    if (!bucket || !bucket.delete(key)) return false;
    this.deletes++;
    if (bucket.size === 0) this.modules.delete(moduleId);
    this.emit({ type: 'delete', moduleId, keys: [key] });
    return true;
  }

  keys(moduleId: string): string[] {
    const bucket = this.modules.get(moduleId);
    if (!bucket) return [];
    const nowMs = now();
    const result: string[] = [];
    for (const [key, entry] of bucket) {
      if (this.isLive(entry, nowMs)) result.push(key);
    }
    return result;
  }

  entries(moduleId: string): Record<string, unknown> {
    const bucket = this.modules.get(moduleId);
    const result: Record<string, unknown> = {};
    if (!bucket) return result;
    const nowMs = now();
    for (const [key, entry] of bucket) {
      if (this.isLive(entry, nowMs)) result[key] = entry.value;
    }
    return result;
  }

  /** Returns the keys within a module that start with `keyPrefix`. */
  findKeysByPrefix(moduleId: string, keyPrefix: string): string[] {
    return this.keys(moduleId)
      .filter((key) => key.startsWith(keyPrefix))
      .sort();
  }

  clear(moduleId?: string): void {
    if (moduleId) {
      const bucket = this.modules.get(moduleId);
      if (!bucket) return;
      const keys = [...bucket.keys()];
      this.modules.delete(moduleId);
      this.emit({ type: 'clear', moduleId, keys });
    } else {
      const all: MemoryChange[] = [];
      for (const [id, bucket] of this.modules) {
        all.push({ type: 'clear', moduleId: id, keys: [...bucket.keys()] });
      }
      this.modules.clear();
      for (const change of all) this.emit(change);
    }
  }

  size(moduleId?: string): number {
    if (moduleId) return this.keys(moduleId).length;
    let total = 0;
    const nowMs = now();
    for (const bucket of this.modules.values()) {
      for (const entry of bucket.values()) {
        if (this.isLive(entry, nowMs)) total++;
      }
    }
    return total;
  }

  /** Returns every loaded module id, sorted. */
  listModules(): string[] {
    return [...this.modules.keys()].filter((id) => this.keys(id).length > 0).sort();
  }

  // ─── Batch Operations ─────────────────────────────────────────

  /** Reads several keys at once, omitting the ones that are absent. */
  getMany(moduleId: string, keys: string[]): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      if (this.has(moduleId, key)) result[key] = this.get(moduleId, key);
    }
    return result;
  }

  /**
   * Writes several keys, emitting a single change event.
   *
   * Persisting state one key at a time emits one event per key, which floods
   * listeners that care only about the batch.
   */
  setMany(moduleId: string, values: Record<string, unknown>, options?: MemorySetOptions): void {
    const keys = Object.keys(values);
    for (const key of keys) this.assertKeyAllowed(key);

    const existing = this.size();
    const fresh = keys.filter((key) => !this.has(moduleId, key)).length;
    if (existing + fresh > this.options.maxKeys) {
      throw new MemoryLimitError(
        `Cannot store ${fresh} key(s) for "${moduleId}": limit of ${this.options.maxKeys} would be exceeded`,
      );
    }

    const bucket = this.bucket(moduleId, true);
    const ttl = options?.ttlMs ?? this.options.defaultTtlMs;
    for (const [key, value] of Object.entries(values)) {
      bucket.set(key, { value, expiresAt: ttl && ttl > 0 ? now() + ttl : undefined });
    }
    this.writes += keys.length;
    this.emit({ type: 'set', moduleId, keys });
  }

  /** Removes several keys, returning the ones that were present. */
  deleteMany(moduleId: string, keys: string[]): string[] {
    const bucket = this.modules.get(moduleId);
    if (!bucket) return [];
    const removed: string[] = [];
    for (const key of keys) {
      if (bucket.delete(key)) removed.push(key);
    }
    if (removed.length > 0) {
      this.deletes += removed.length;
      if (bucket.size === 0) this.modules.delete(moduleId);
      this.emit({ type: 'delete', moduleId, keys: removed });
    }
    return removed;
  }

  /** Drops an entire module, returning whether it existed. */
  deleteModule(moduleId: string): boolean {
    return this.modules.delete(moduleId);
  }

  /** Renames a module, overwriting the destination when it exists. */
  renameModule(from: string, to: string): boolean {
    const bucket = this.modules.get(from);
    if (!bucket) return false;
    this.modules.delete(from);
    this.modules.set(to, bucket);
    return true;
  }

  // ─── Change Notifications ─────────────────────────────────────

  /** Subscribes to changes; returns an unsubscribe function. */
  onChange(listener: MemoryChangeListener): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index !== -1) this.listeners.splice(index, 1);
    };
  }

  private emit(change: MemoryChange): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(change);
      } catch {
        // A faulty listener must not break the write that triggered it.
      }
    }
  }

  // ─── Time To Live ─────────────────────────────────────────────

  /** Returns the expiry timestamp for a key, or undefined when it never expires. */
  getExpiry(moduleId: string, key: string): number | undefined {
    return this.modules.get(moduleId)?.get(key)?.expiresAt;
  }

  /** Returns the milliseconds until a key expires; 0 when already expired. */
  getTimeToLive(moduleId: string, key: string): number | undefined {
    const expiresAt = this.getExpiry(moduleId, key);
    if (expiresAt === undefined) return undefined;
    return Math.max(0, expiresAt - now());
  }

  /** Drops every expired key, returning the keys that were removed. */
  purgeExpired(): string[] {
    const nowMs = now();
    const removed: string[] = [];
    for (const [moduleId, bucket] of this.modules) {
      for (const [key, entry] of bucket) {
        if (!this.isLive(entry, nowMs)) {
          bucket.delete(key);
          removed.push(`${moduleId}:${key}`);
        }
      }
      if (bucket.size === 0) this.modules.delete(moduleId);
    }
    if (removed.length > 0) {
      for (const path of removed) this.emit({ type: 'expire', moduleId: path.slice(0, path.indexOf(':')), keys: [path] });
    }
    return removed;
  }

  private isLive(entry: Entry, nowMs: number): boolean {
    return entry.expiresAt === undefined || entry.expiresAt > nowMs;
  }

  // ─── Introspection ────────────────────────────────────────────

  getStats(): MemoryStats {
    const total = this.hits + this.misses;
    let expired = 0;
    const nowMs = now();
    for (const bucket of this.modules.values()) {
      for (const entry of bucket.values()) {
        if (!this.isLive(entry, nowMs)) expired++;
      }
    }
    return {
      modules: this.modules.size,
      keys: this.size(),
      expiredKeys: expired,
      hits: this.hits,
      misses: this.misses,
      writes: this.writes,
      deletes: this.deletes,
      hitRate: total === 0 ? 0 : this.hits / total,
    };
  }

  /** Resets hit/miss/write counters without touching stored data. */
  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
    this.writes = 0;
    this.deletes = 0;
  }

  /** Returns every module's data as one record, for backup or export. */
  exportAll(): Record<string, Record<string, unknown>> {
    const result: Record<string, Record<string, unknown>> = {};
    for (const id of this.listModules()) result[id] = this.entries(id);
    return result;
  }

  /** Merges a record produced by `exportAll` into the store. */
  importAll(data: Record<string, Record<string, unknown>>, options?: MemorySetOptions): void {
    for (const [moduleId, values] of Object.entries(data)) {
      this.setMany(moduleId, values, options);
    }
  }

  // ─── Persistence ──────────────────────────────────────────────

  private filePath(moduleId: string): string {
    return join(this.memoryDir, `${moduleId}.json`);
  }

  private bucket(moduleId: string, create: boolean): Map<string, Entry> {
    let bucket = this.modules.get(moduleId);
    if (!bucket && create) {
      bucket = new Map();
      this.modules.set(moduleId, bucket);
    }
    return bucket ?? new Map();
  }

  private peek(moduleId: string, key: string): Entry | undefined {
    const entry = this.modules.get(moduleId)?.get(key);
    if (!entry) return undefined;
    if (!this.isLive(entry, now())) return undefined;
    return entry;
  }

  private assertKeyAllowed(key: string): void {
    if (key.length > this.options.maxKeyLength) {
      throw new MemoryLimitError(
        `Key is too long (${key.length} characters, max ${this.options.maxKeyLength})`,
      );
    }
  }

  /**
   * Reads a module's persisted data.
   *
   * Accepts both the current envelope and the legacy bare-object format, so
   * files written before versioning are picked up rather than silently read
   * as a single `version` key.
   */
  async loadFile(moduleId: string): Promise<Record<string, unknown>> {
    try {
      await access(this.filePath(moduleId));
      const content = await readFile(this.filePath(moduleId), 'utf-8');
      const parsed: unknown = JSON.parse(content);
      return MemoryStore.unwrapEnvelope(parsed);
    } catch (error) {
      this.reportError(error as Error, 'loadFile', moduleId);
      return {};
    }
  }

  /**
   * Writes a module's data atomically.
   *
   * The payload lands in a temp file that is then renamed over the target, so
   * a crash can leave either the old file or the new one, never a truncated
   * one.
   */
  async saveFile(moduleId: string, data: Record<string, unknown>): Promise<boolean> {
    const target = this.filePath(moduleId);
    const temp = `${target}.${process.pid}.tmp`;
    try {
      await mkdir(this.memoryDir, { recursive: true });
      const envelope: MemoryFileEnvelope = {
        version: MEMORY_FILE_VERSION,
        updatedAt: new Date().toISOString(),
        data,
      };
      await writeFile(temp, JSON.stringify(envelope, null, 2), 'utf-8');
      await rename(temp, target);
      return true;
    } catch (error) {
      this.reportError(error as Error, 'saveFile', moduleId);
      await rm(temp, { force: true }).catch(() => {});
      return false;
    }
  }

  /** Splits an envelope, or returns a bare object unchanged. */
  private static unwrapEnvelope(parsed: unknown): Record<string, unknown> {
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const candidate = parsed as Partial<MemoryFileEnvelope>;
    if (typeof candidate.version === 'number' && typeof candidate.data === 'object' && candidate.data !== null) {
      return candidate.data as Record<string, unknown>;
    }
    return parsed as Record<string, unknown>;
  }

  /**
   * Merges persisted data into memory, overwriting in-memory values.
   *
   * File wins by design: it is the durable copy, and a stale in-memory value
   * from an earlier process is the thing to discard.
   */
  async syncFromFile(moduleId: string): Promise<Record<string, unknown>> {
    const fileData = await this.loadFile(moduleId);
    this.setMany(moduleId, fileData);
    if (Object.keys(fileData).length > 0) {
      this.emit({ type: 'load', moduleId, keys: Object.keys(fileData) });
    }
    return fileData;
  }

  /** Writes a module's in-memory data to disk. */
  async persistToFile(moduleId: string): Promise<boolean> {
    return this.saveFile(moduleId, this.entries(moduleId));
  }

  /** Writes every module to disk, returning the ones that succeeded. */
  async persistAll(): Promise<string[]> {
    const saved: string[] = [];
    for (const moduleId of this.listModules()) {
      if (await this.persistToFile(moduleId)) saved.push(moduleId);
    }
    return saved;
  }

  /** Removes a module's persisted file, keeping the in-memory copy. */
  async deleteFile(moduleId: string): Promise<boolean> {
    try {
      await rm(this.filePath(moduleId), { force: true });
      return true;
    } catch (error) {
      this.reportError(error as Error, 'deleteFile', moduleId);
      return false;
    }
  }

  /** Returns the directory this store persists to. */
  getMemoryDir(): string {
    return this.memoryDir;
  }

  private reportError(error: Error, operation: string, moduleId?: string): void {
    this.options.onError?.(error, { operation, moduleId });
  }
}

export function createMemoryStore(memoryDirOrOptions?: string | MemoryStoreOptions): MemoryStore {
  return new MemoryStore(memoryDirOrOptions);
}
