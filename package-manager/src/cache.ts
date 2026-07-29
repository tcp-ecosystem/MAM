/**
 * MAM Package Cache
 *
 * LRU cache with TTL support for downloaded packages.
 */

import { readFile, writeFile, mkdir, access, readdir, stat, unlink } from 'node:fs/promises';
import { join, extname } from 'node:path';

// ============================================================================
// Types
// ============================================================================

export interface CacheEntry {
  /** Package name */
  name: string;
  /** Package version */
  version: string;
  /** Cached file path */
  path: string;
  /** Entry size in bytes */
  size: number;
  /** Number of times accessed */
  accessCount: number;
  /** ISO timestamp of last access */
  lastAccessed: string;
  /** ISO timestamp when cached */
  cachedAt: string;
  /** Integrity hash */
  integrity?: string;
  /** Custom metadata */
  metadata: Record<string, unknown>;
}

export interface CacheConfig {
  /** Maximum cache size in bytes (default 500MB) */
  maxSize: number;
  /** TTL in milliseconds (default 7 days) */
  ttl: number;
  /** Cache directory path */
  cacheDir: string;
  /** Enable compression */
  compress: boolean;
}

export interface CacheStats {
  /** Total number of entries */
  entries: number;
  /** Total cache size in bytes */
  totalSize: number;
  /** Number of cache hits */
  hits: number;
  /** Number of cache misses */
  misses: number;
  /** Hit rate as percentage */
  hitRate: number;
  /** Oldest entry timestamp */
  oldestEntry: string | null;
  /** Newest entry timestamp */
  newestEntry: string | null;
}

export interface CacheSetOptions {
  /** Integrity hash for the entry */
  integrity?: string;
  /** Custom metadata to store */
  metadata?: Record<string, unknown>;
  /** TTL override in milliseconds */
  ttl?: number;
}

export interface CachePruneResult {
  /** Number of entries removed */
  removed: number;
  /** Freed space in bytes */
  freedBytes: number;
  /** Names of removed packages */
  removedPackages: string[];
}

// ============================================================================
// Package Cache
// ============================================================================

export class PackageCache {
  private config: CacheConfig;
  private entries: Map<string, CacheEntry> = new Map();
  private hits = 0;
  private misses = 0;

  constructor(config: Partial<CacheConfig> & { cacheDir: string }) {
    this.config = {
      maxSize: 500 * 1024 * 1024,
      ttl: 7 * 24 * 60 * 60 * 1000,
      compress: false,
      ...config,
    };
  }

  /**
   * Get a cached package by name and version
   */
  async get(name: string, version?: string): Promise<CacheEntry | null> {
    const key = version ? this.key(name, version) : this.findLatestKey(name);

    if (!key) {
      this.misses++;
      return null;
    }

    const entry = this.entries.get(key);

    if (!entry) {
      this.misses++;
      return null;
    }

    // Check TTL
    if (this.isExpired(entry)) {
      await this.delete(name, entry.version);
      this.misses++;
      return null;
    }

    // Update access stats
    entry.accessCount++;
    entry.lastAccessed = new Date().toISOString();

    this.hits++;
    return entry;
  }

  /**
   * Store a package in cache
   */
  async set(name: string, version: string, filePath: string, options: CacheSetOptions = {}): Promise<CacheEntry> {
    const key = this.key(name, version);
    const fileStat = await stat(filePath);

    const entry: CacheEntry = {
      name,
      version,
      path: filePath,
      size: fileStat.size,
      accessCount: 0,
      lastAccessed: new Date().toISOString(),
      cachedAt: new Date().toISOString(),
      integrity: options.integrity,
      metadata: options.metadata || {},
    };

    this.entries.set(key, entry);

    // Evict if over size limit
    if (this.getTotalSize() > this.config.maxSize) {
      await this.evict();
    }

    return entry;
  }

  /**
   * Check if a package is cached
   */
  async has(name: string, version?: string): Promise<boolean> {
    const key = version ? this.key(name, version) : this.findLatestKey(name);

    if (!key) {
      return false;
    }

    const entry = this.entries.get(key);

    if (!entry) {
      return false;
    }

    if (this.isExpired(entry)) {
      await this.delete(name, entry.version);
      return false;
    }

    return true;
  }

  /**
   * Delete a cached package
   */
  async delete(name: string, version: string): Promise<boolean> {
    const key = this.key(name, version);
    const entry = this.entries.get(key);

    if (!entry) {
      return false;
    }

    try {
      await unlink(entry.path);
    } catch {
      // File may already be gone
    }

    this.entries.delete(key);
    return true;
  }

  /**
   * Clear entire cache
   */
  async clear(): Promise<void> {
    for (const [key, entry] of this.entries) {
      try {
        await unlink(entry.path);
      } catch {
        // Continue cleanup
      }
    }

    this.entries.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const entries = Array.from(this.entries.values());
    const totalRequests = this.hits + this.misses;

    return {
      entries: entries.length,
      totalSize: this.getTotalSize(),
      hits: this.hits,
      misses: this.misses,
      hitRate: totalRequests > 0 ? (this.hits / totalRequests) * 100 : 0,
      oldestEntry: entries.length > 0
        ? entries.reduce((oldest, e) =>
            new Date(e.cachedAt) < new Date(oldest.cachedAt) ? e : oldest
          ).cachedAt
        : null,
      newestEntry: entries.length > 0
        ? entries.reduce((newest, e) =>
            new Date(e.cachedAt) > new Date(newest.cachedAt) ? e : newest
          ).cachedAt
        : null,
    };
  }

  /**
   * Remove expired or least-used entries to fit within max size
   */
  async prune(): Promise<CachePruneResult> {
    const result: CachePruneResult = {
      removed: 0,
      freedBytes: 0,
      removedPackages: [],
    };

    // First remove expired entries
    for (const [key, entry] of this.entries) {
      if (this.isExpired(entry)) {
        await this.delete(entry.name, entry.version);
        result.removed++;
        result.freedBytes += entry.size;
        result.removedPackages.push(entry.name);
      }
    }

    // Then evict LRU if still over limit
    while (this.getTotalSize() > this.config.maxSize && this.entries.size > 0) {
      const lruKey = this.findLRU();

      if (!lruKey) {
        break;
      }

      const entry = this.entries.get(lruKey)!;
      await this.delete(entry.name, entry.version);
      result.removed++;
      result.freedBytes += entry.size;
      result.removedPackages.push(entry.name);
    }

    return result;
  }

  /**
   * Get total number of cached entries
   */
  size(): number {
    return this.entries.size;
  }

  /**
   * Load cache index from disk
   */
  async load(): Promise<void> {
    const indexPath = join(this.config.cacheDir, 'cache-index.json');

    try {
      const content = await readFile(indexPath, 'utf-8');
      const data = JSON.parse(content) as CacheEntry[];

      this.entries.clear();

      for (const entry of data) {
        if (!this.isExpired(entry)) {
          this.entries.set(this.key(entry.name, entry.version), entry);
        }
      }
    } catch {
      // No cache index yet
    }
  }

  /**
   * Save cache index to disk
   */
  async save(): Promise<void> {
    await mkdir(this.config.cacheDir, { recursive: true });

    const indexPath = join(this.config.cacheDir, 'cache-index.json');
    const data = Array.from(this.entries.values());

    await writeFile(indexPath, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * List all cached package names
   */
  listPackages(): string[] {
    const names = new Set<string>();

    for (const entry of this.entries.values()) {
      names.add(entry.name);
    }

    return Array.from(names);
  }

  /**
   * List all cached versions for a package
   */
  listVersions(name: string): string[] {
    const versions: string[] = [];

    for (const entry of this.entries.values()) {
      if (entry.name === name) {
        versions.push(entry.version);
      }
    }

    return versions;
  }

  /**
   * Get entry size in bytes
   */
  getEntrySize(name: string, version: string): number {
    const key = this.key(name, version);
    const entry = this.entries.get(key);

    return entry?.size || 0;
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  private key(name: string, version: string): string {
    return `${name}@${version}`;
  }

  private findLatestKey(name: string): string | null {
    let latest: CacheEntry | null = null;

    for (const entry of this.entries.values()) {
      if (entry.name === name) {
        if (!latest || entry.version > latest.version) {
          latest = entry;
        }
      }
    }

    return latest ? this.key(latest.name, latest.version) : null;
  }

  private findLRU(): string | null {
    let lruKey: string | null = null;
    let lruTime: Date | null = null;

    for (const [key, entry] of this.entries) {
      const accessed = new Date(entry.lastAccessed);

      if (!lruTime || accessed < lruTime) {
        lruTime = accessed;
        lruKey = key;
      }
    }

    return lruKey;
  }

  private isExpired(entry: CacheEntry): boolean {
    const age = Date.now() - new Date(entry.cachedAt).getTime();
    return age > this.config.ttl;
  }

  private getTotalSize(): number {
    let total = 0;

    for (const entry of this.entries.values()) {
      total += entry.size;
    }

    return total;
  }

  private async evict(): Promise<void> {
    while (this.getTotalSize() > this.config.maxSize && this.entries.size > 0) {
      const lruKey = this.findLRU();

      if (!lruKey) {
        break;
      }

      const entry = this.entries.get(lruKey)!;
      await this.delete(entry.name, entry.version);
    }
  }
}
