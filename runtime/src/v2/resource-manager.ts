/**
 * MAM V2 Resource Manager
 *
 * Manages runtime resources (filesystem, network, storage, memory, external
 * services, tools, model providers) with acquisition, release, limits, and
 * permission checks.
 */

export type ResourceType =
  | 'filesystem'
  | 'network'
  | 'storage'
  | 'memory'
  | 'service'
  | 'tool'
  | 'model'
  | 'cpu'
  | 'other';

export interface ResourceLimits {
  /** Maximum amount that may be held at once (-1 = unlimited). */
  maxAcquired?: number;
  /** Maximum concurrent acquisitions (-1 = unlimited). */
  maxConcurrent?: number;
  /** Maximum total amount ever acquired (-1 = unlimited). */
  maxTotal?: number;
}

export interface ResourceDefinition {
  name: string;
  type: ResourceType;
  description?: string;
  capacity?: number;
  unit?: string;
  limits?: ResourceLimits;
  permissions?: string[];
  metadata?: Record<string, unknown>;
}

export interface ResourceLease {
  id: string;
  name: string;
  type: ResourceType;
  amount: number;
  acquiredAt: number;
  expiresAt?: number;
}

export interface ResourceStats {
  registered: number;
  active: number;
  totalAcquired: number;
  totalReleased: number;
  totalFailed: number;
  peakActive: number;
  byType: Record<ResourceType, number>;
}

interface ResourceState extends ResourceDefinition {
  active: number;
  acquiredTotal: number;
  failed: number;
  leases: Map<string, ResourceLease>;
}

const TYPES: ResourceType[] = ['filesystem', 'network', 'storage', 'memory', 'service', 'tool', 'model', 'cpu', 'other'];

export class ResourceManager {
  private resources: Map<string, ResourceState> = new Map();

  register(def: ResourceDefinition): void {
    if (this.resources.has(def.name)) {
      throw new Error(`Resource already registered: ${def.name}`);
    }
    this.resources.set(def.name, {
      ...def,
      active: 0,
      acquiredTotal: 0,
      failed: 0,
      leases: new Map(),
    });
  }

  unregister(name: string): boolean {
    const res = this.resources.get(name);
    if (!res || res.active > 0) return false;
    return this.resources.delete(name);
  }

  get(name: string): ResourceDefinition | undefined {
    const res = this.resources.get(name);
    return res ? { ...res, limits: res.limits, permissions: res.permissions } : undefined;
  }

  has(name: string): boolean {
    return this.resources.has(name);
  }

  list(): ResourceDefinition[] {
    return [...this.resources.values()].map((r) => ({
      name: r.name,
      type: r.type,
      description: r.description,
      capacity: r.capacity,
      unit: r.unit,
      limits: r.limits,
      permissions: r.permissions,
      metadata: r.metadata,
    }));
  }

  listTypes(): ResourceType[] {
    return TYPES;
  }

  // -------------------------------------------------------------------------
  // Permissions
  // -------------------------------------------------------------------------

  checkPermission(name: string, action: string): boolean {
    const res = this.resources.get(name);
    if (!res) return false;
    if (!res.permissions || res.permissions.length === 0) return true;
    return res.permissions.some((p) => p === action || p === '*');
  }

  grant(name: string, action: string): void {
    const res = this.resources.get(name);
    if (!res) return;
    if (!res.permissions) res.permissions = [];
    if (!res.permissions.includes(action)) res.permissions.push(action);
  }

  revoke(name: string, action: string): void {
    const res = this.resources.get(name);
    if (!res || !res.permissions) return;
    res.permissions = res.permissions.filter((p) => p !== action);
  }

  // -------------------------------------------------------------------------
  // Acquisition
  // -------------------------------------------------------------------------

  acquire(
    name: string,
    amount = 1,
    options: { ttlMs?: number } = {},
  ): ResourceLease {
    const res = this.resources.get(name);
    if (!res) throw new Error(`Unknown resource: ${name}`);
    if (res.capacity !== undefined && res.active + amount > res.capacity) {
      res.failed++;
      throw new Error(`Resource "${name}" at capacity (${res.capacity})`);
    }

    const limits = res.limits ?? {};
    if ((limits.maxConcurrent ?? -1) >= 0 && res.active >= limits.maxConcurrent!) {
      res.failed++;
      throw new Error(`Resource "${name}" concurrency limit reached (${limits.maxConcurrent})`);
    }
    if ((limits.maxAcquired ?? -1) >= 0 && res.active + amount > limits.maxAcquired!) {
      res.failed++;
      throw new Error(`Resource "${name}" acquisition limit reached (${limits.maxAcquired})`);
    }
    if ((limits.maxTotal ?? -1) >= 0 && res.acquiredTotal + amount > limits.maxTotal!) {
      res.failed++;
      throw new Error(`Resource "${name}" total limit reached (${limits.maxTotal})`);
    }

    const lease: ResourceLease = {
      id: `lease-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      type: res.type,
      amount,
      acquiredAt: Date.now(),
      expiresAt: options.ttlMs ? Date.now() + options.ttlMs : undefined,
    };
    res.leases.set(lease.id, lease);
    res.active += amount;
    res.acquiredTotal += amount;
    return lease;
  }

  release(leaseId: string): boolean {
    for (const res of this.resources.values()) {
      const lease = res.leases.get(leaseId);
      if (lease) {
        res.leases.delete(leaseId);
        res.active -= lease.amount;
        if (res.active < 0) res.active = 0;
        return true;
      }
    }
    return false;
  }

  releaseAll(name: string): number {
    const res = this.resources.get(name);
    if (!res) return 0;
    const count = res.leases.size;
    res.leases.clear();
    res.active = 0;
    return count;
  }

  /** Acquire and auto-release a resource around a callback. */
  async withResource<T>(name: string, fn: (lease: ResourceLease) => Promise<T>, amount = 1, options: { ttlMs?: number } = {}): Promise<T> {
    const lease = this.acquire(name, amount, options);
    try {
      return await fn(lease);
    } finally {
      this.release(lease.id);
    }
  }

  getActiveLeases(name?: string): ResourceLease[] {
    if (name) {
      const res = this.resources.get(name);
      return res ? [...res.leases.values()] : [];
    }
    const all: ResourceLease[] = [];
    for (const res of this.resources.values()) all.push(...res.leases.values());
    return all;
  }

  // -------------------------------------------------------------------------
  // Limits / stats
  // -------------------------------------------------------------------------

  setLimits(name: string, limits: ResourceLimits): void {
    const res = this.resources.get(name);
    if (res) res.limits = limits;
  }

  getStats(): ResourceStats {
    const byType: Record<ResourceType, number> = { filesystem: 0, network: 0, storage: 0, memory: 0, service: 0, tool: 0, model: 0, cpu: 0, other: 0 };
    let active = 0;
    let peak = 0;
    let acquired = 0;
    let released = 0;
    let failed = 0;
    for (const res of this.resources.values()) {
      byType[res.type] = (byType[res.type] ?? 0) + 1;
      active += res.active;
      acquired += res.acquiredTotal;
      released += res.acquiredTotal - res.active;
      failed += res.failed;
      peak += res.active;
    }
    return {
      registered: this.resources.size,
      active,
      totalAcquired: acquired,
      totalReleased: released,
      totalFailed: failed,
      peakActive: peak,
      byType,
    };
  }
}

export function createResourceManager(): ResourceManager {
  return new ResourceManager();
}