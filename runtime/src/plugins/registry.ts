/**
 * MAM Plugin Registry
 *
 * Manages plugin metadata, discovery, hook management, event bus, and
 * validation for the plugin ecosystem.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PluginMetadata {
  name: string;
  version: string;
  description?: string;
  author?: string;
  type?: string;
  tags?: string[];
  dependencies?: string[];
  /** Approximate size in bytes after load. */
  size?: number;
}

export interface PluginHook {
  name: string;
  phase: 'before' | 'after' | 'around';
  handler: (data: unknown) => unknown | Promise<unknown>;
  description?: string;
}

export interface PluginEvent {
  name: string;
  data: unknown;
  timestamp: number;
  source: string;
}

export type PluginEventListener = (event: PluginEvent) => void;

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export class PluginRegistry {
  private metadata: Map<string, PluginMetadata> = new Map();
  private hooks: Map<string, PluginHook[]> = new Map();
  private eventListeners: Map<string, Set<PluginEventListener>> = new Map();
  private eventHistory: PluginEvent[] = [];
  private maxHistorySize: number;

  constructor(options?: { maxHistorySize?: number }) {
    this.maxHistorySize = options?.maxHistorySize ?? 1000;
  }

  // -----------------------------------------------------------------------
  // Core CRUD
  // -----------------------------------------------------------------------

  register(meta: PluginMetadata): void {
    if (this.metadata.has(meta.name)) {
      throw new Error(`Plugin "${meta.name}" is already registered`);
    }
    const validated = this.validate(meta);
    this.metadata.set(validated.name, validated);
  }

  unregister(name: string): void {
    this.metadata.delete(name);
    this.hooks.delete(name);
  }

  get(name: string): PluginMetadata | undefined {
    return this.metadata.get(name);
  }

  list(): PluginMetadata[] {
    return Array.from(this.metadata.values());
  }

  has(name: string): boolean {
    return this.metadata.has(name);
  }

  find(predicate: (meta: PluginMetadata) => boolean): PluginMetadata | undefined {
    return this.list().find(predicate);
  }

  // -----------------------------------------------------------------------
  // Search & filter
  // -----------------------------------------------------------------------

  /**
   * Full-text search across name, description, author, and tags.
   */
  search(query: string): PluginMetadata[] {
    const lower = query.toLowerCase();
    return this.list().filter((meta) => {
      const haystack = [
        meta.name,
        meta.description ?? '',
        meta.author ?? '',
        ...(meta.tags ?? []),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(lower);
    });
  }

  /**
   * Semver-compatible version matching.
   * Supports exact match, prefix (1.x), range (^1.0.0, ~1.2.0), and
   * wildcard (*).
   */
  getByVersion(version: string): PluginMetadata[] {
    return this.list().filter((meta) => this.matchesVersion(meta.version, version));
  }

  getByType(type: string): PluginMetadata[] {
    return this.list().filter((meta) => meta.type === type);
  }

  getByTag(tag: string): PluginMetadata[] {
    return this.list().filter((meta) => meta.tags?.includes(tag));
  }

  // -----------------------------------------------------------------------
  // Hook management
  // -----------------------------------------------------------------------

  addHook(pluginName: string, hook: PluginHook): void {
    if (!this.metadata.has(pluginName)) {
      throw new Error(`Plugin "${pluginName}" is not registered`);
    }
    if (!this.hooks.has(pluginName)) {
      this.hooks.set(pluginName, []);
    }
    const existing = this.hooks.get(pluginName)!;
    if (existing.some((h) => h.name === hook.name)) {
      throw new Error(`Hook "${hook.name}" already exists for plugin "${pluginName}"`);
    }
    existing.push(hook);
  }

  removeHook(pluginName: string, hookName: string): void {
    const hooks = this.hooks.get(pluginName);
    if (!hooks) return;
    const idx = hooks.findIndex((h) => h.name === hookName);
    if (idx !== -1) hooks.splice(idx, 1);
    if (hooks.length === 0) this.hooks.delete(pluginName);
  }

  getHooks(pluginName: string): PluginHook[] {
    return this.hooks.get(pluginName) ?? [];
  }

  getAllHooks(): Map<string, PluginHook[]> {
    return new Map(this.hooks);
  }

  // -----------------------------------------------------------------------
  // Event system
  // -----------------------------------------------------------------------

  emit(event: PluginEvent): void {
    this.eventHistory.push(event);
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory = this.eventHistory.slice(-this.maxHistorySize);
    }

    for (const listener of this.eventListeners.get(event.name) ?? []) {
      try {
        listener(event);
      } catch { /* swallow */ }
    }
    for (const listener of this.eventListeners.get('*') ?? []) {
      try {
        listener(event);
      } catch { /* swallow */ }
    }
  }

  on(eventName: string, listener: PluginEventListener): () => void {
    if (!this.eventListeners.has(eventName)) {
      this.eventListeners.set(eventName, new Set());
    }
    this.eventListeners.get(eventName)!.add(listener);
    return () => {
      this.eventListeners.get(eventName)?.delete(listener);
    };
  }

  getEventHistory(eventName?: string): PluginEvent[] {
    if (eventName) return this.eventHistory.filter((e) => e.name === eventName);
    return [...this.eventHistory];
  }

  clearEventHistory(): void {
    this.eventHistory = [];
  }

  // -----------------------------------------------------------------------
  // Validation
  // -----------------------------------------------------------------------

  validate(meta: PluginMetadata): PluginMetadata {
    const errors: string[] = [];

    if (!meta.name || typeof meta.name !== 'string') {
      errors.push('name is required and must be a string');
    }
    if (!meta.version || typeof meta.version !== 'string') {
      errors.push('version is required and must be a string');
    } else if (!this.isValidSemver(meta.version)) {
      errors.push(`version "${meta.version}" is not valid semver`);
    }
    if (meta.description && typeof meta.description !== 'string') {
      errors.push('description must be a string');
    }
    if (meta.author && typeof meta.author !== 'string') {
      errors.push('author must be a string');
    }
    if (meta.type && typeof meta.type !== 'string') {
      errors.push('type must be a string');
    }
    if (meta.tags && !Array.isArray(meta.tags)) {
      errors.push('tags must be an array of strings');
    }
    if (meta.dependencies && !Array.isArray(meta.dependencies)) {
      errors.push('dependencies must be an array of strings');
    }
    if (meta.size !== undefined && (typeof meta.size !== 'number' || meta.size < 0)) {
      errors.push('size must be a non-negative number');
    }

    if (errors.length > 0) {
      throw new Error(`Invalid metadata for plugin "${meta.name ?? '(unnamed)'}": ${errors.join('; ')}`);
    }

    return {
      tags: [],
      dependencies: [],
      size: 0,
      ...meta,
    };
  }

  // -----------------------------------------------------------------------
  // Statistics
  // -----------------------------------------------------------------------

  getStats(): RegistryStats {
    const byType: Record<string, number> = {};
    const byTag: Record<string, number> = {};
    let totalSize = 0;
    let hookCount = 0;

    for (const meta of this.metadata.values()) {
      const t = meta.type ?? 'unknown';
      byType[t] = (byType[t] ?? 0) + 1;
      for (const tag of meta.tags ?? []) {
        byTag[tag] = (byTag[tag] ?? 0) + 1;
      }
      totalSize += meta.size ?? 0;
    }

    for (const hooks of this.hooks.values()) {
      hookCount += hooks.length;
    }

    return {
      totalRegistered: this.metadata.size,
      byType,
      byTag,
      totalSize,
      hookCount,
      eventHistorySize: this.eventHistory.length,
    };
  }

  // -----------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private isValidSemver(version: string): boolean {
    return /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?(\+[a-zA-Z0-9.]+)?$/.test(version);
  }

  private matchesVersion(actual: string, pattern: string): boolean {
    if (pattern === '*') return true;
    if (pattern === actual) return true;

    if (pattern.endsWith('.x') || pattern.endsWith('.*')) {
      const prefix = pattern.replace(/\.x$|\.*/, '');
      return actual.startsWith(prefix + '.');
    }

    if (pattern.startsWith('^')) {
      const target = pattern.slice(1);
      return this.compareSemver(actual, target) >= 0 && this.majorCompatible(actual, target);
    }

    if (pattern.startsWith('~')) {
      const target = pattern.slice(1);
      return this.compareSemver(actual, target) >= 0 && this.minorCompatible(actual, target);
    }

    if (pattern.includes(' - ')) {
      const [low, high] = pattern.split(' - ').map((s) => s.trim());
      return this.compareSemver(actual, low) >= 0 && this.compareSemver(actual, high) <= 0;
    }

    return actual === pattern;
  }

  private compareSemver(a: string, b: string): number {
    const pa = a.split(/[.-]/).map(Number);
    const pb = b.split(/[.-]/).map(Number);
    for (let i = 0; i < 3; i++) {
      const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
      if (diff !== 0) return diff;
    }
    return 0;
  }

  private majorCompatible(a: string, b: string): boolean {
    return a.split('.')[0] === b.split('.')[0];
  }

  private minorCompatible(a: string, b: string): boolean {
    return a.split('.').slice(0, 2).join('.') === b.split('.').slice(0, 2).join('.');
  }
}

// -----------------------------------------------------------------------
// Stats
// -----------------------------------------------------------------------

export interface RegistryStats {
  totalRegistered: number;
  byType: Record<string, number>;
  byTag: Record<string, number>;
  totalSize: number;
  hookCount: number;
  eventHistorySize: number;
}
