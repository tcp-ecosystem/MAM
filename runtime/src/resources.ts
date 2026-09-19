export interface Resource {
  type: 'filesystem' | 'network' | 'memory' | 'exec' | 'tool' | 'model';
  target: string;
  access: 'read' | 'write' | 'execute' | 'readwrite';
  metadata?: Record<string, unknown>;
  tags?: string[];
}

export interface ResourceAllocation {
  id: string;
  resource: Resource;
  moduleId: string;
  timestamp: number;
  released?: number;
}

export interface ResourcePool {
  id: string;
  type: Resource['type'];
  size: number;
  available: string[];
  allocated: Map<string, ResourceAllocation>;
  createdAt: number;
}

export interface UsageHistoryEntry {
  timestamp: number;
  type: string;
  count: number;
  memoryBytes?: number;
}

export interface ModuleQuota {
  moduleId: string;
  resourceType: string;
  limit: number;
  current: number;
}

export type LimitCallback = (type: string, current: number, limit: number) => void;

export class ResourceManager {
  private allocations: Map<string, ResourceAllocation> = new Map();
  private limits: Map<string, number> = new Map();
  private pools: Map<string, ResourcePool> = new Map();
  private moduleQuotas: Map<string, ModuleQuota> = new Map();
  private usageHistory: UsageHistoryEntry[] = [];
  private gracefulReleases: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private limitCallbacks: LimitCallback[] = [];
  private maxHistoryEntries: number = 1000;

  constructor() {
    this.limits.set('filesystem', 100);
    this.limits.set('network', 50);
    this.limits.set('memory', 1024 * 1024 * 256);
    this.limits.set('exec', 10);
    this.limits.set('tool', 50);
    this.limits.set('model', 20);
  }

  request(resource: Resource, moduleId: string): { allowed: boolean; id?: string; reason?: string } {
    const typeLimit = this.limits.get(resource.type) ?? 0;
    const typeCount = this.getActiveByType(resource.type).length;

    if (typeCount >= typeLimit) {
      this.notifyLimitReached(resource.type, typeCount, typeLimit);
      return { allowed: false, reason: `Resource limit exceeded for ${resource.type}: ${typeCount}/${typeLimit}` };
    }

    const quotaKey = `${moduleId}:${resource.type}`;
    const quota = this.moduleQuotas.get(quotaKey);
    if (quota && quota.current >= quota.limit) {
      this.notifyLimitReached(resource.type, quota.current, quota.limit);
      return { allowed: false, reason: `Module quota exceeded for ${moduleId} on ${resource.type}: ${quota.current}/${quota.limit}` };
    }

    const id = this.generateId();
    const allocation: ResourceAllocation = { id, resource, moduleId, timestamp: Date.now() };
    this.allocations.set(id, allocation);

    if (quota) {
      quota.current++;
    }

    this.recordUsage(resource.type);

    return { allowed: true, id };
  }

  release(id: string): boolean {
    const allocation = this.allocations.get(id);
    if (!allocation) return false;
    if (allocation.released) return false;

    allocation.released = Date.now();
    this.cancelGracefulRelease(id);

    const quotaKey = `${allocation.moduleId}:${allocation.resource.type}`;
    const quota = this.moduleQuotas.get(quotaKey);
    if (quota && quota.current > 0) {
      quota.current--;
    }

    this.recordUsage(allocation.resource.type);
    return true;
  }

  releaseAll(moduleId: string): number {
    let count = 0;
    for (const allocation of this.allocations.values()) {
      if (allocation.moduleId === moduleId && !allocation.released) {
        allocation.released = Date.now();
        this.cancelGracefulRelease(allocation.id);

        const quotaKey = `${moduleId}:${allocation.resource.type}`;
        const quota = this.moduleQuotas.get(quotaKey);
        if (quota && quota.current > 0) {
          quota.current--;
        }

        count++;
      }
    }
    if (count > 0) {
      this.snapshotAllUsage();
    }
    return count;
  }

  getActive(): ResourceAllocation[] {
    return Array.from(this.allocations.values()).filter(a => !a.released);
  }

  getByModule(moduleId: string): ResourceAllocation[] {
    return Array.from(this.allocations.values()).filter(a => a.moduleId === moduleId);
  }

  getStats(): Record<string, number> {
    const stats: Record<string, number> = {};
    for (const allocation of this.allocations.values()) {
      if (!allocation.released) {
        stats[allocation.resource.type] = (stats[allocation.resource.type] ?? 0) + 1;
      }
    }
    return stats;
  }

  setLimit(type: string, limit: number): void {
    this.limits.set(type, limit);
  }

  getLimit(type: string): number {
    return this.limits.get(type) ?? 0;
  }

  createPool(type: Resource['type'], size: number): ResourcePool {
    const poolId = `pool-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const slots: string[] = [];
    for (let i = 0; i < size; i++) {
      slots.push(this.generateId());
    }
    const pool: ResourcePool = {
      id: poolId,
      type,
      size,
      available: slots,
      allocated: new Map(),
      createdAt: Date.now(),
    };
    this.pools.set(poolId, pool);
    return pool;
  }

  acquireFromPool(poolId: string, moduleId: string): { success: boolean; id?: string; allocation?: ResourceAllocation } {
    const pool = this.pools.get(poolId);
    if (!pool) return { success: false };

    if (pool.available.length === 0) {
      return { success: false };
    }

    const slotId = pool.available.pop()!;
    const resource: Resource = {
      type: pool.type,
      target: `pooled:${poolId}:${slotId}`,
      access: 'readwrite',
      tags: ['pooled'],
    };

    const allocation: ResourceAllocation = {
      id: slotId,
      resource,
      moduleId,
      timestamp: Date.now(),
    };

    pool.allocated.set(slotId, allocation);
    this.allocations.set(slotId, allocation);

    this.recordUsage(pool.type);

    return { success: true, id: slotId, allocation };
  }

  releaseToPool(poolId: string, allocationId: string): boolean {
    const pool = this.pools.get(poolId);
    if (!pool) return false;

    const allocation = pool.allocated.get(allocationId);
    if (!allocation) return false;

    allocation.released = Date.now();
    pool.allocated.delete(allocationId);
    pool.available.push(allocationId);

    this.cancelGracefulRelease(allocationId);
    this.recordUsage(pool.type);

    return true;
  }

  setQuota(moduleId: string, resourceType: string, limit: number): void {
    const key = `${moduleId}:${resourceType}`;
    const existing = this.moduleQuotas.get(key);
    const current = existing?.current ?? 0;
    this.moduleQuotas.set(key, { moduleId, resourceType, limit, current });
  }

  getQuota(moduleId: string, resourceType: string): ModuleQuota | undefined {
    return this.moduleQuotas.get(`${moduleId}:${resourceType}`);
  }

  getModuleQuotas(moduleId: string): ModuleQuota[] {
    return Array.from(this.moduleQuotas.values()).filter(q => q.moduleId === moduleId);
  }

  getUsageHistory(resourceType: string): UsageHistoryEntry[] {
    return this.usageHistory.filter(e => e.type === resourceType);
  }

  getFullUsageHistory(): UsageHistoryEntry[] {
    return [...this.usageHistory];
  }

  cleanupModule(moduleId: string): number {
    const released = this.releaseAll(moduleId);
    this.clearGracefulReleasesForModule(moduleId);

    const quotaKeys = Array.from(this.moduleQuotas.keys()).filter(k => k.startsWith(`${moduleId}:`));
    for (const key of quotaKeys) {
      const quota = this.moduleQuotas.get(key);
      if (quota) {
        quota.current = 0;
      }
    }

    this.snapshotAllUsage();
    return released;
  }

  getDependencyGraph(): Map<string, ResourceAllocation[]> {
    const graph = new Map<string, ResourceAllocation[]>();
    for (const allocation of this.allocations.values()) {
      if (!allocation.released) {
        const existing = graph.get(allocation.moduleId) ?? [];
        existing.push(allocation);
        graph.set(allocation.moduleId, existing);
      }
    }
    return graph;
  }

  setGracefulRelease(id: string, delayMs: number): boolean {
    const allocation = this.allocations.get(id);
    if (!allocation || allocation.released) return false;

    this.cancelGracefulRelease(id);

    const timer = setTimeout(() => {
      this.release(id);
      this.gracefulReleases.delete(id);
    }, delayMs);

    this.gracefulReleases.set(id, timer);
    return true;
  }

  cancelGracefulRelease(id: string): boolean {
    const timer = this.gracefulReleases.get(id);
    if (!timer) return false;
    clearTimeout(timer);
    this.gracefulReleases.delete(id);
    return true;
  }

  getOldestActive(resourceType: string): ResourceAllocation | undefined {
    let oldest: ResourceAllocation | undefined;
    for (const allocation of this.allocations.values()) {
      if (allocation.released) continue;
      if (allocation.resource.type !== resourceType) continue;
      if (!oldest || allocation.timestamp < oldest.timestamp) {
        oldest = allocation;
      }
    }
    return oldest;
  }

  compact(): number {
    let reclaimed = 0;
    const toRemove: string[] = [];

    for (const [id, allocation] of this.allocations) {
      if (allocation.released) {
        const age = Date.now() - allocation.released;
        if (age > 60000) {
          toRemove.push(id);
          reclaimed++;
        }
      }
    }

    for (const id of toRemove) {
      this.allocations.delete(id);
    }

    for (const pool of this.pools.values()) {
      const releasedIds = Array.from(pool.allocated.entries())
        .filter(([, a]) => a.released !== undefined)
        .map(([slotId]) => slotId);

      for (const slotId of releasedIds) {
        pool.allocated.delete(slotId);
        if (!pool.available.includes(slotId)) {
          pool.available.push(slotId);
        }
      }
    }

    return reclaimed;
  }

  getTotalMemoryUsage(): number {
    let total = 0;
    for (const allocation of this.allocations.values()) {
      if (allocation.released) continue;
      if (allocation.resource.type !== 'memory') continue;
      const size = allocation.resource.metadata?.size;
      if (typeof size === 'number') {
        total += size;
      }
    }
    return total;
  }

  onLimitReached(callback: LimitCallback): () => void {
    this.limitCallbacks.push(callback);
    return () => {
      const idx = this.limitCallbacks.indexOf(callback);
      if (idx >= 0) {
        this.limitCallbacks.splice(idx, 1);
      }
    };
  }

  getPool(poolId: string): ResourcePool | undefined {
    return this.pools.get(poolId);
  }

  getPools(): ResourcePool[] {
    return Array.from(this.pools.values());
  }

  getPoolStats(): { total: number; allocated: number; available: number }[] {
    return Array.from(this.pools.values()).map(pool => ({
      total: pool.size,
      allocated: pool.allocated.size,
      available: pool.available.length,
    }));
  }

  getAllocationsByTag(tag: string): ResourceAllocation[] {
    return Array.from(this.allocations.values()).filter(
      a => !a.released && a.resource.tags?.includes(tag)
    );
  }

  getActiveCount(type: string): number {
    return this.getActiveByType(type).length;
  }

  isLimitReached(type: string): boolean {
    const active = this.getActiveByType(type).length;
    const limit = this.limits.get(type) ?? 0;
    return active >= limit;
  }

  getRemainingCapacity(type: string): number {
    const active = this.getActiveByType(type).length;
    const limit = this.limits.get(type) ?? 0;
    return Math.max(0, limit - active);
  }

  private getActiveByType(type: string): ResourceAllocation[] {
    return Array.from(this.allocations.values()).filter(
      a => !a.released && a.resource.type === type
    );
  }

  private generateId(): string {
    return `res-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private recordUsage(type: string): void {
    const count = this.getActiveByType(type).length;
    const entry: UsageHistoryEntry = { timestamp: Date.now(), type, count };

    if (type === 'memory') {
      entry.memoryBytes = this.getTotalMemoryUsage();
    }

    this.usageHistory.push(entry);

    if (this.usageHistory.length > this.maxHistoryEntries) {
      this.usageHistory = this.usageHistory.slice(-this.maxHistoryEntries);
    }
  }

  private snapshotAllUsage(): void {
    const types = new Set<string>();
    for (const allocation of this.allocations.values()) {
      types.add(allocation.resource.type);
    }
    for (const type of types) {
      this.recordUsage(type);
    }
  }

  private clearGracefulReleasesForModule(moduleId: string): void {
    for (const [id, timer] of this.gracefulReleases) {
      const allocation = this.allocations.get(id);
      if (allocation && allocation.moduleId === moduleId) {
        clearTimeout(timer);
        this.gracefulReleases.delete(id);
      }
    }
  }

  private notifyLimitReached(type: string, current: number, limit: number): void {
    for (const callback of this.limitCallbacks) {
      try {
        callback(type, current, limit);
      } catch {
        // callback error intentionally swallowed
      }
    }
  }
}
