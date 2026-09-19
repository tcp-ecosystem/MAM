import { MemoryStore, MemoryOptions, MemoryStats } from './types.js';

interface MemoryEntry {
  value: unknown;
  expiry?: number;
  tags?: string[];
  createdAt: number;
  accessCount: number;
  lastAccessed: number;
}

interface MemorySnapshot {
  timestamp: number;
  entries: Map<string, MemoryEntry>;
  scopedSnapshots: Map<string, Map<string, MemoryEntry>>;
  stats: MemoryStats;
}

type PressureLevel = 'normal' | 'moderate' | 'high' | 'critical';
type PressureCallback = (level: PressureLevel, stats: MemoryStats) => void;

interface DetailedStats extends MemoryStats {
  totalSize: number;
  scopedEntries: Record<string, number>;
  tagBreakdown: Record<string, number>;
  avgAccessCount: number;
  oldestEntryAge: number;
  newestEntryAge: number;
  pressureLevel: PressureLevel;
  hotKeys: string[];
  coldKeys: string[];
}

export class InMemoryMemoryStore implements MemoryStore {
  private store = new Map<string, MemoryEntry>();
  private scopedStores: Map<string, Map<string, MemoryEntry>> = new Map();
  private statsData = { hits: 0, misses: 0, evictions: 0, writes: 0, deletes: 0 };
  private snapshots: MemorySnapshot[] = [];
  private maxSnapshots: number;
  private maxSize: number;
  private accessOrder: string[] = [];
  private pressureCallbacks: PressureCallback[] = [];
  private pressureLevel: PressureLevel = 'normal';
  private compactedCount = 0;
  private totalEvictedByPressure = 0;

  constructor(options?: { maxSnapshots?: number; maxSize?: number }) {
    this.maxSnapshots = options?.maxSnapshots ?? 10;
    this.maxSize = options?.maxSize ?? 10000;
  }

  async set(key: string, value: unknown, options?: MemoryOptions): Promise<void> {
    this.evict();
    const now = Date.now();
    const entry: MemoryEntry = {
      value,
      createdAt: now,
      accessCount: 0,
      lastAccessed: now,
    };
    if (options?.ttl) {
      entry.expiry = now + options.ttl * 1000;
    }
    if (options?.tags) {
      entry.tags = options.tags;
    }

    if (options?.scope && options.scope !== 'local') {
      const scopeKey = options.scope === 'shared' ? '__shared__' : '__global__';
      if (!this.scopedStores.has(scopeKey)) {
        this.scopedStores.set(scopeKey, new Map());
      }
      this.scopedStores.get(scopeKey)!.set(key, entry);
    } else {
      this.store.set(key, entry);
    }

    this.statsData.writes++;
    this.updateAccessOrder(key);
    this.checkPressure();
  }

  async get(key: string): Promise<unknown> {
    this.evict();
    const entry = this.store.get(key);
    if (!entry) {
      this.statsData.misses++;
      for (const scoped of this.scopedStores.values()) {
        const scopedEntry = scoped.get(key);
        if (scopedEntry && !this.isExpired(scopedEntry)) {
          scopedEntry.accessCount++;
          scopedEntry.lastAccessed = Date.now();
          this.statsData.hits++;
          this.updateAccessOrder(key);
          return scopedEntry.value;
        }
      }
      return undefined;
    }
    if (this.isExpired(entry)) {
      this.store.delete(key);
      this.statsData.misses++;
      this.statsData.evictions++;
      return undefined;
    }
    entry.accessCount++;
    entry.lastAccessed = Date.now();
    this.statsData.hits++;
    this.updateAccessOrder(key);
    return entry.value;
  }

  async delete(key: string): Promise<void> {
    if (this.store.delete(key)) {
      this.statsData.deletes++;
    }
    for (const scoped of this.scopedStores.values()) {
      if (scoped.delete(key)) {
        this.statsData.deletes++;
      }
    }
    this.removeFromAccessOrder(key);
  }

  async has(key: string): Promise<boolean> {
    this.evict();
    const entry = this.store.get(key);
    if (entry && !this.isExpired(entry)) return true;
    for (const scoped of this.scopedStores.values()) {
      const scopedEntry = scoped.get(key);
      if (scopedEntry && !this.isExpired(scopedEntry)) return true;
    }
    return false;
  }

  async keys(): Promise<string[]> {
    this.evict();
    const validKeys: string[] = [];
    for (const [key, entry] of this.store) {
      if (!this.isExpired(entry)) {
        validKeys.push(key);
      }
    }
    for (const scoped of this.scopedStores.values()) {
      for (const [key, entry] of scoped) {
        if (!this.isExpired(entry)) {
          validKeys.push(key);
        }
      }
    }
    return validKeys;
  }

  async keysByTag(tag: string): Promise<string[]> {
    this.evict();
    const validKeys: string[] = [];
    for (const [key, entry] of this.store) {
      if (!this.isExpired(entry) && entry.tags?.includes(tag)) {
        validKeys.push(key);
      }
    }
    for (const scoped of this.scopedStores.values()) {
      for (const [key, entry] of scoped) {
        if (!this.isExpired(entry) && entry.tags?.includes(tag)) {
          validKeys.push(key);
        }
      }
    }
    return validKeys;
  }

  async clear(): Promise<void> {
    this.store.clear();
    this.scopedStores.clear();
    this.accessOrder = [];
    this.resetStats();
    this.pressureLevel = 'normal';
  }

  async stats(): Promise<MemoryStats> {
    this.evict();
    const totalRequests = this.statsData.hits + this.statsData.misses;
    return {
      totalEntries: this.store.size + Array.from(this.scopedStores.values()).reduce((sum, s) => sum + s.size, 0),
      memoryUsed: this.estimateMemory(),
      hitRate: totalRequests > 0 ? this.statsData.hits / totalRequests : 0,
      evictions: this.statsData.evictions,
    };
  }

  async snapshot(): Promise<MemorySnapshot> {
    const scopedSnapshots = new Map<string, Map<string, MemoryEntry>>();
    for (const [scopeKey, scopedMap] of this.scopedStores) {
      scopedSnapshots.set(scopeKey, new Map(scopedMap));
    }
    const snapshot: MemorySnapshot = {
      timestamp: Date.now(),
      entries: new Map(this.store),
      scopedSnapshots,
      stats: await this.stats(),
    };
    this.snapshots.push(snapshot);
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift();
    }
    return snapshot;
  }

  async restoreSnapshot(snapshot: MemorySnapshot): Promise<void> {
    this.store = new Map(snapshot.entries);
    if (snapshot.scopedSnapshots) {
      this.scopedStores = new Map(snapshot.scopedSnapshots);
    }
    this.rebuildAccessOrder();
  }

  async export(): Promise<Record<string, unknown>> {
    const data: Record<string, unknown> = {};
    for (const [key, entry] of this.store) {
      if (!this.isExpired(entry)) {
        data[key] = entry.value;
      }
    }
    for (const scoped of this.scopedStores.values()) {
      for (const [key, entry] of scoped) {
        if (!this.isExpired(entry)) {
          data[key] = entry.value;
        }
      }
    }
    return data;
  }

  async import(data: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(data)) {
      await this.set(key, value);
    }
  }

  async getLeastRecentlyUsed(count: number): Promise<string[]> {
    return this.accessOrder.slice(0, count);
  }

  async evictByTag(tag: string): Promise<number> {
    let evicted = 0;
    for (const [key, entry] of this.store) {
      if (entry.tags?.includes(tag)) {
        this.store.delete(key);
        this.removeFromAccessOrder(key);
        evicted++;
      }
    }
    for (const scoped of this.scopedStores.values()) {
      for (const [key, entry] of scoped) {
        if (entry.tags?.includes(tag)) {
          scoped.delete(key);
          evicted++;
        }
      }
    }
    this.statsData.evictions += evicted;
    this.checkPressure();
    return evicted;
  }

  async compact(): Promise<{ removed: number; freed: number }> {
    let removed = 0;
    let freed = 0;
    const before = this.estimateMemory();

    for (const [key, entry] of this.store) {
      if (this.isExpired(entry)) {
        freed += this.sizeOf(entry.value);
        this.store.delete(key);
        this.removeFromAccessOrder(key);
        removed++;
      }
    }

    for (const scoped of this.scopedStores.values()) {
      for (const [key, entry] of scoped) {
        if (this.isExpired(entry)) {
          freed += this.sizeOf(entry.value);
          scoped.delete(key);
          removed++;
        }
      }
    }

    const deduped = this.deduplicateAccessOrder();
    removed += deduped;

    this.compactedCount++;
    this.statsData.evictions += removed;
    const after = this.estimateMemory();
    freed += Math.max(0, before - after);

    this.checkPressure();
    return { removed, freed };
  }

  async getHotKeys(count: number): Promise<string[]> {
    const entries = this.collectAllEntries();
    return entries
      .sort((a, b) => b.entry.accessCount - a.entry.accessCount)
      .slice(0, count)
      .map(e => e.key);
  }

  async getColdKeys(count: number): Promise<string[]> {
    const entries = this.collectAllEntries();
    return entries
      .sort((a, b) => a.entry.accessCount - b.entry.accessCount)
      .slice(0, count)
      .map(e => e.key);
  }

  async resize(newMaxSize: number): Promise<void> {
    this.maxSize = newMaxSize;
    this.evict();
  }

  async onPressure(callback: PressureCallback): Promise<void> {
    this.pressureCallbacks.push(callback);
  }

  async removePressureCallback(callback: PressureCallback): Promise<void> {
    const idx = this.pressureCallbacks.indexOf(callback);
    if (idx >= 0) {
      this.pressureCallbacks.splice(idx, 1);
    }
  }

  async getPressureLevel(): Promise<PressureLevel> {
    this.checkPressure();
    return this.pressureLevel;
  }

  async getDetailedStats(): Promise<DetailedStats> {
    this.evict();
    const basicStats = await this.stats();
    const entries = this.collectAllEntries();
    const now = Date.now();

    let totalAccess = 0;
    let oldest = now;
    let newest = 0;
    const tagBreakdown: Record<string, number> = {};

    for (const e of entries) {
      totalAccess += e.entry.accessCount;
      if (e.entry.createdAt < oldest) oldest = e.entry.createdAt;
      if (e.entry.createdAt > newest) newest = e.entry.createdAt;
      if (e.entry.tags) {
        for (const tag of e.entry.tags) {
          tagBreakdown[tag] = (tagBreakdown[tag] || 0) + 1;
        }
      }
    }

    const scopedEntries: Record<string, number> = {};
    for (const [scopeKey, scopedMap] of this.scopedStores) {
      scopedEntries[scopeKey] = scopedMap.size;
    }

    const hotKeys = await this.getHotKeys(5);
    const coldKeys = await this.getColdKeys(5);

    return {
      ...basicStats,
      totalSize: this.store.size + Array.from(this.scopedStores.values()).reduce((s, m) => s + m.size, 0),
      scopedEntries,
      tagBreakdown,
      avgAccessCount: entries.length > 0 ? totalAccess / entries.length : 0,
      oldestEntryAge: entries.length > 0 ? now - oldest : 0,
      newestEntryAge: entries.length > 0 ? now - newest : 0,
      pressureLevel: this.pressureLevel,
      hotKeys,
      coldKeys,
    };
  }

  async getCompactionCount(): Promise<number> {
    return this.compactedCount;
  }

  async getTotalPressureEvictions(): Promise<number> {
    return this.totalEvictedByPressure;
  }

  private isExpired(entry: MemoryEntry): boolean {
    if (entry.expiry === undefined) return false;
    return Date.now() > entry.expiry;
  }

  private evict(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expiry !== undefined && now > entry.expiry) {
        this.store.delete(key);
        this.removeFromAccessOrder(key);
        this.statsData.evictions++;
      }
    }
    for (const scoped of this.scopedStores.values()) {
      for (const [key, entry] of scoped) {
        if (entry.expiry !== undefined && now > entry.expiry) {
          scoped.delete(key);
          this.statsData.evictions++;
        }
      }
    }
    if (this.store.size > this.maxSize) {
      const excess = this.store.size - this.maxSize;
      const lru = this.accessOrder.slice(0, excess);
      for (const key of lru) {
        this.store.delete(key);
        this.statsData.evictions++;
      }
      this.accessOrder = this.accessOrder.slice(lru.length);
    }
    this.checkPressure();
  }

  private estimateMemory(): number {
    let bytes = 0;
    for (const [, entry] of this.store) {
      bytes += this.sizeOf(entry.value);
      if (entry.tags) {
        bytes += entry.tags.reduce((sum, tag) => sum + tag.length * 2, 0);
      }
    }
    for (const scoped of this.scopedStores.values()) {
      for (const [, entry] of scoped) {
        bytes += this.sizeOf(entry.value);
        if (entry.tags) {
          bytes += entry.tags.reduce((sum, tag) => sum + tag.length * 2, 0);
        }
      }
    }
    return bytes;
  }

  private sizeOf(value: unknown): number {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'string') return value.length * 2;
    if (typeof value === 'number') return 8;
    if (typeof value === 'boolean') return 4;
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value).length * 2;
      } catch {
        return 0;
      }
    }
    return 0;
  }

  private updateAccessOrder(key: string): void {
    this.removeFromAccessOrder(key);
    this.accessOrder.push(key);
  }

  private removeFromAccessOrder(key: string): void {
    const idx = this.accessOrder.indexOf(key);
    if (idx >= 0) this.accessOrder.splice(idx, 1);
  }

  private resetStats(): void {
    this.statsData = { hits: 0, misses: 0, evictions: 0, writes: 0, deletes: 0 };
  }

  private rebuildAccessOrder(): void {
    this.accessOrder = [];
    const entries = this.collectAllEntries();
    entries.sort((a, b) => a.entry.lastAccessed - b.entry.lastAccessed);
    for (const e of entries) {
      this.accessOrder.push(e.key);
    }
  }

  private collectAllEntries(): { key: string; entry: MemoryEntry }[] {
    const result: { key: string; entry: MemoryEntry }[] = [];
    for (const [key, entry] of this.store) {
      if (!this.isExpired(entry)) {
        result.push({ key, entry });
      }
    }
    for (const scoped of this.scopedStores.values()) {
      for (const [key, entry] of scoped) {
        if (!this.isExpired(entry)) {
          result.push({ key, entry });
        }
      }
    }
    return result;
  }

  private deduplicateAccessOrder(): number {
    const seen = new Set<string>();
    const deduped: string[] = [];
    let count = 0;
    for (const key of this.accessOrder) {
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(key);
      } else {
        count++;
      }
    }
    this.accessOrder = deduped;
    return count;
  }

  private checkPressure(): void {
    const prev = this.pressureLevel;
    const currentSize = this.store.size + Array.from(this.scopedStores.values()).reduce((s, m) => s + m.size, 0);
    const ratio = currentSize / this.maxSize;

    if (ratio >= 0.95) {
      this.pressureLevel = 'critical';
    } else if (ratio >= 0.8) {
      this.pressureLevel = 'high';
    } else if (ratio >= 0.6) {
      this.pressureLevel = 'moderate';
    } else {
      this.pressureLevel = 'normal';
    }

    if (this.pressureLevel !== prev) {
      this.notifyPressureCallbacks();
    }

    if (this.pressureLevel === 'critical') {
      this.autoEvictByPressure();
    }
  }

  private notifyPressureCallbacks(): void {
    const stats: MemoryStats = {
      totalEntries: this.store.size,
      memoryUsed: this.estimateMemory(),
      hitRate: this.statsData.hits / (this.statsData.hits + this.statsData.misses || 1),
      evictions: this.statsData.evictions,
    };
    for (const cb of this.pressureCallbacks) {
      try {
        cb(this.pressureLevel, stats);
      } catch {
        // swallow callback errors
      }
    }
  }

  private autoEvictByPressure(): void {
    const target = Math.floor(this.maxSize * 0.7);
    const currentSize = this.store.size;
    if (currentSize <= target) return;

    const toEvict = currentSize - target;
    const lru = this.accessOrder.slice(0, toEvict);
    for (const key of lru) {
      const entry = this.store.get(key);
      if (entry) {
        this.statsData.evictions++;
        this.totalEvictedByPressure++;
      }
      this.store.delete(key);
      this.removeFromAccessOrder(key);
    }
  }
}
