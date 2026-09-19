import {
  ContextEngine,
  ContextConfig,
  ContextSource,
  ContextResult,
  ContextEntry,
  DroppedEntry,
  ContextAssemblyStats,
  ContextEngineStats,
  TokenBudget,
  ContextPriority,
  ContextOptimization,
  ContextDropReason,
  TokenAllocation,
  TokenUsage,
} from './types.js';

const PRIORITY_WEIGHTS: Record<ContextPriority, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  background: 1,
};

interface SourceRecord {
  source: ContextSource;
  registeredAt: number;
  expiresAt: number | null;
}

interface CacheEntry {
  entries: ContextEntry[];
  cachedAt: number;
  expiresAt: number;
}

interface ManagedTokenBudget extends TokenBudget {
  totalBudget: number;
  allocations: TokenAllocation[];
  spentMap: Record<string, number>;
  counter: number;
  allocate(amount: number, label?: string): TokenAllocation;
  spend(allocationId: string, amount: number): void;
  remaining(): number;
  getUsage(): TokenUsage;
}

function createTokenBudget(totalBudget: number): ManagedTokenBudget {
  const state = {
    allocations: [] as TokenAllocation[],
    spentMap: {} as Record<string, number>,
    counter: 0,
  };

  return {
    totalBudget,
    allocations: state.allocations,
    spentMap: state.spentMap,
    counter: state.counter,
    allocate(amount: number, label?: string): TokenAllocation {
      const id = `alloc_${++state.counter}`;
      const allocation: TokenAllocation = {
        id,
        amount,
        label,
        allocatedAt: Date.now(),
      };
      state.allocations.push(allocation);
      state.spentMap[id] = 0;
      return allocation;
    },
    spend(allocationId: string, amount: number): void {
      const current = state.spentMap[allocationId] ?? 0;
      state.spentMap[allocationId] = current + amount;
    },
    remaining(): number {
      let totalSpent = 0;
      const keys = Object.keys(state.spentMap);
      for (let i = 0; i < keys.length; i++) {
        totalSpent += state.spentMap[keys[i]];
      }
      return Math.max(0, totalBudget - totalSpent);
    },
    getUsage(): TokenUsage {
      let totalAllocated = 0;
      let totalSpent = 0;
      const allocations: TokenAllocation[] = [];
      for (let i = 0; i < state.allocations.length; i++) {
        const alloc = state.allocations[i];
        totalAllocated += alloc.amount;
        totalSpent += state.spentMap[alloc.id] ?? 0;
        allocations.push(alloc);
      }
      return {
        totalAllocated,
        totalSpent,
        totalRemaining: Math.max(0, totalBudget - totalSpent),
        allocations,
      };
    },
  };
}

function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function priorityCompare(a: ContextPriority, b: ContextPriority): number {
  return PRIORITY_WEIGHTS[b] - PRIORITY_WEIGHTS[a];
}

function deduplicateEntries(entries: ContextEntry[]): ContextEntry[] {
  const seen: Record<string, ContextEntry> = {};
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const key = `${entry.sourceId}:${entry.content}`;
    const existing = seen[key];
    if (!existing || entry.score > existing.score) {
      seen[key] = entry;
    }
  }
  return Object.values(seen);
}

function compressContent(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export class DefaultContextEngine implements ContextEngine {
  private sources: Record<string, SourceRecord> = {};
  private cache: Record<string, CacheEntry> = {};
  private cacheKeys: string[] = [];
  private budget: ManagedTokenBudget;
  private strategy: ContextOptimization = 'none';
  private totalAssemblies = 0;
  private totalTokensUsed = 0;
  private totalAssemblyTimeMs = 0;
  private cacheHits = 0;
  private cacheMisses = 0;

  constructor(budget: number = 4096) {
    this.budget = createTokenBudget(budget);
  }

  assemble(config: ContextConfig): Promise<ContextResult> {
    const start = performance.now();
    const sourceRecords = this.getActiveSourceRecords();
    const requestedRecords = sourceRecords.filter((r) =>
      config.sources.includes(r.source.id)
    );
    const cacheKey = this.buildCacheKey(config);
    const cached = this.cache[cacheKey];
    const now = Date.now();

    if (cached && cached.expiresAt > now) {
      this.cacheHits++;
      const stats = this.buildStats(
        requestedRecords.length,
        cached.entries,
        config.budget,
        performance.now() - start
      );
      return Promise.resolve({
        entries: cached.entries,
        totalTokens: cached.entries.reduce((sum, e) => sum + e.tokens, 0),
        budget: config.budget,
        droppedEntries: [],
        stats,
      });
    }

    this.cacheMisses++;

    const rawEntries: ContextEntry[] = [];
    for (let i = 0; i < requestedRecords.length; i++) {
      const source = requestedRecords[i].source;
      const entries = this.collectEntries(source);
      for (let j = 0; j < entries.length; j++) {
        const entry = entries[j];
        entry.priority = config.priorities[source.id] ?? source.priority;
        entry.score = this.computeScore(entry, config);
      }
      for (let j = 0; j < entries.length; j++) {
        rawEntries.push(entries[j]);
      }
    }

    const deduplicated = deduplicateEntries(rawEntries);
    const sorted = deduplicated.sort((a, b) => {
      const prioDiff = priorityCompare(a.priority, b.priority);
      if (prioDiff !== 0) return prioDiff;
      return b.score - a.score;
    });

    const selected: ContextEntry[] = [];
    const dropped: DroppedEntry[] = [];
    let tokensUsed = 0;
    const budgetLimit = config.budget;

    for (let i = 0; i < sorted.length; i++) {
      const entry = sorted[i];
      if (tokensUsed + entry.tokens <= budgetLimit) {
        selected.push(entry);
        tokensUsed += entry.tokens;
      } else {
        const reason: ContextDropReason =
          PRIORITY_WEIGHTS[entry.priority] < 3 ? 'low_priority' : 'budget_exceeded';
        dropped.push({
          id: entry.id,
          sourceId: entry.sourceId,
          reason,
        });
      }
    }

    const optimization = config.optimization ?? this.strategy;
    if (optimization === 'compress') {
      for (let i = 0; i < selected.length; i++) {
        const entry = selected[i];
        entry.content = compressContent(entry.content);
        entry.tokens = estimateTokens(entry.content);
      }
    }

    this.cache[cacheKey] = {
      entries: selected,
      cachedAt: now,
      expiresAt: now + 60_000,
    };
    this.cacheKeys.push(cacheKey);

    const elapsed = performance.now() - start;
    const stats = this.buildStats(requestedRecords.length, selected, budgetLimit, elapsed);

    this.totalAssemblies++;
    this.totalTokensUsed += tokensUsed;
    this.totalAssemblyTimeMs += elapsed;

    return Promise.resolve({
      entries: selected,
      totalTokens: tokensUsed,
      budget: budgetLimit,
      droppedEntries: dropped,
      stats,
    });
  }

  preview(config: ContextConfig): Promise<ContextResult> {
    const start = performance.now();
    const sourceRecords = this.getActiveSourceRecords();
    const requestedRecords = sourceRecords.filter((r) =>
      config.sources.includes(r.source.id)
    );

    const rawEntries: ContextEntry[] = [];
    for (let i = 0; i < requestedRecords.length; i++) {
      const source = requestedRecords[i].source;
      const entries = this.collectEntries(source);
      for (let j = 0; j < entries.length; j++) {
        const entry = entries[j];
        entry.priority = config.priorities[source.id] ?? source.priority;
        entry.score = this.computeScore(entry, config);
      }
      for (let j = 0; j < entries.length; j++) {
        rawEntries.push(entries[j]);
      }
    }

    const deduplicated = deduplicateEntries(rawEntries);
    const sorted = deduplicated.sort((a, b) => {
      const prioDiff = priorityCompare(a.priority, b.priority);
      if (prioDiff !== 0) return prioDiff;
      return b.score - a.score;
    });

    const selected: ContextEntry[] = [];
    const dropped: DroppedEntry[] = [];
    let tokensUsed = 0;

    for (let i = 0; i < sorted.length; i++) {
      const entry = sorted[i];
      if (tokensUsed + entry.tokens <= config.budget) {
        selected.push(entry);
        tokensUsed += entry.tokens;
      } else {
        dropped.push({
          id: entry.id,
          sourceId: entry.sourceId,
          reason: 'budget_exceeded',
        });
      }
    }

    const elapsed = performance.now() - start;
    const stats = this.buildStats(requestedRecords.length, selected, config.budget, elapsed);

    return Promise.resolve({
      entries: selected,
      totalTokens: tokensUsed,
      budget: config.budget,
      droppedEntries: dropped,
      stats,
    });
  }

  addSource(source: ContextSource): void {
    const ttl = source.ttl ?? null;
    this.sources[source.id] = {
      source,
      registeredAt: Date.now(),
      expiresAt: ttl !== null ? Date.now() + ttl : null,
    };
    this.invalidateCache();
  }

  removeSource(sourceId: string): void {
    delete this.sources[sourceId];
    this.invalidateCache();
  }

  getBudget(): TokenBudget {
    return this.budget;
  }

  getStats(): ContextEngineStats {
    const activeSources = this.getActiveSources();
    const totalCacheRequests = this.cacheHits + this.cacheMisses;
    return {
      totalAssemblies: this.totalAssemblies,
      averageTokensUsed:
        this.totalAssemblies > 0
          ? Math.round(this.totalTokensUsed / this.totalAssemblies)
          : 0,
      averageAssemblyTimeMs:
        this.totalAssemblies > 0
          ? Math.round(this.totalAssemblyTimeMs / this.totalAssemblies)
          : 0,
      cacheHitRate: totalCacheRequests > 0 ? this.cacheHits / totalCacheRequests : 0,
      sourcesActive: activeSources.length,
    };
  }

  setStrategy(strategy: ContextOptimization): void {
    this.strategy = strategy;
  }

  clearCache(): void {
    this.cache = {};
    this.cacheKeys = [];
  }

  getActiveSources(): ContextSource[] {
    const now = Date.now();
    const result: ContextSource[] = [];
    const keys = Object.keys(this.sources);
    for (let i = 0; i < keys.length; i++) {
      const record = this.sources[keys[i]];
      if (record.expiresAt === null || record.expiresAt > now) {
        result.push(record.source);
      } else {
        delete this.sources[keys[i]];
      }
    }
    return result;
  }

  estimateTokens(text: string): number {
    return estimateTokens(text);
  }

  private getActiveSourceRecords(): SourceRecord[] {
    const now = Date.now();
    const result: SourceRecord[] = [];
    const keys = Object.keys(this.sources);
    for (let i = 0; i < keys.length; i++) {
      const record = this.sources[keys[i]];
      if (record.expiresAt === null || record.expiresAt > now) {
        result.push(record);
      } else {
        delete this.sources[keys[i]];
      }
    }
    return result;
  }

  private collectEntries(source: ContextSource): ContextEntry[] {
    const content = this.resolveContent(source);
    const tokens = estimateTokens(content);
    const id = `${source.id}_entry_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return [
      {
        id,
        sourceId: source.id,
        content,
        tokens,
        priority: source.priority,
        score: 0,
        metadata: source.metadata,
      },
    ];
  }

  private resolveContent(source: ContextSource): string {
    const meta = source.metadata ?? {};
    if (typeof meta['content'] === 'string') {
      return meta['content'];
    }
    if (typeof meta['text'] === 'string') {
      return meta['text'];
    }
    return `[${source.type}:${source.name}]`;
  }

  private computeScore(entry: ContextEntry, config: ContextConfig): number {
    let score = PRIORITY_WEIGHTS[entry.priority];
    const override = config.priorities[entry.sourceId];
    if (override) {
      score = PRIORITY_WEIGHTS[override];
    }
    if (entry.metadata && typeof entry.metadata['relevance'] === 'number') {
      score += (entry.metadata['relevance'] as number) * 0.5;
    }
    return Math.round(score * 100) / 100;
  }

  private buildCacheKey(config: ContextConfig): string {
    const sourceIds = config.sources.slice().sort().join(',');
    return `${sourceIds}:${config.budget}:${JSON.stringify(config.priorities)}`;
  }

  private invalidateCache(): void {
    const now = Date.now();
    const validKeys: string[] = [];
    for (let i = 0; i < this.cacheKeys.length; i++) {
      const key = this.cacheKeys[i];
      const entry = this.cache[key];
      if (entry && entry.expiresAt > now) {
        validKeys.push(key);
      } else {
        delete this.cache[key];
      }
    }
    this.cacheKeys = validKeys;
  }

  private buildStats(
    totalSources: number,
    entries: ContextEntry[],
    budget: number,
    assemblyTimeMs: number
  ): ContextAssemblyStats {
    const tokensUsed = entries.reduce((sum, e) => sum + e.tokens, 0);
    return {
      totalSources,
      selectedEntries: entries.length,
      droppedEntries: 0,
      tokensUsed,
      tokensRemaining: Math.max(0, budget - tokensUsed),
      assemblyTimeMs: Math.round(assemblyTimeMs * 100) / 100,
    };
  }
}
