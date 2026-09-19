import {
  ModelEngine,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ModelCapability,
  ModelEngineStats,
  ModelAdapter,
  ModelProviderConfig,
  ModelMessage,
  ModelUsage,
} from './types.js';

interface MiddlewareContext {
  request: ModelRequest;
  providerId: string;
  timestamp: number;
  attempt: number;
}

interface MiddlewareFn {
  (ctx: MiddlewareContext, next: () => Promise<ModelResponse>): Promise<ModelResponse>;
}

interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

interface RateLimitEntry {
  maxRequests: number;
  windowMs: number;
  timestamps: number[];
}

interface ProviderEntry {
  provider: ModelProvider;
  isMock: boolean;
  registeredAt: number;
  lastHealthCheck?: number;
  healthy: boolean;
  errorCount: number;
  requestCount: number;
  totalLatencyMs: number;
  totalTokens: ModelUsage;
  rateLimit?: RateLimitEntry;
}

interface RequestLog {
  timestamp: number;
  providerId: string;
  model: string;
  latencyMs: number;
  success: boolean;
  usage: ModelUsage;
  error?: string;
}

const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
};

const CAPABILITY_PRIORITY: Record<ModelCapability, number> = {
  text: 0,
  code: 1,
  reasoning: 2,
  structured_output: 3,
  function_calling: 4,
  multimodal: 5,
  embedding: 6,
};

export class DefaultModelEngine implements ModelEngine {
  private providers = new Map<string, ProviderEntry>();
  private fallbackOrder: string[] = [];
  private middleware: MiddlewareFn[] = [];
  private requestLogs: RequestLog[] = [];
  private retryPolicy: RetryPolicy = { ...DEFAULT_RETRY_POLICY };
  private totalRequests = 0;
  private totalTokensUsed = 0;
  private totalLatencyMs = 0;
  private errorsByProvider = new Map<string, number>();
  private requestsByProvider = new Map<string, number>();

  register(provider: ModelProvider): void {
    if (!provider.id || provider.id.trim().length === 0) {
      throw new Error('Provider id is required');
    }
    if (!provider.name || provider.name.trim().length === 0) {
      throw new Error('Provider name is required');
    }
    if (!provider.adapter) {
      throw new Error('Provider adapter is required');
    }
    if (!provider.capabilities || provider.capabilities.length === 0) {
      throw new Error('Provider must have at least one capability');
    }

    const existing = this.providers.get(provider.id);
    if (existing) {
      this.providers.set(provider.id, {
        ...existing,
        provider,
        healthy: true,
        errorCount: 0,
        lastHealthCheck: undefined,
      });
    } else {
      this.providers.set(provider.id, {
        provider,
        isMock: false,
        registeredAt: Date.now(),
        healthy: true,
        errorCount: 0,
        requestCount: 0,
        totalLatencyMs: 0,
        totalTokens: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      });
    }

    if (!this.fallbackOrder.includes(provider.id)) {
      this.fallbackOrder.push(provider.id);
    }
  }

  unregister(providerId: string): void {
    if (!this.providers.has(providerId)) {
      throw new Error(`Provider "${providerId}" not found`);
    }
    this.providers.delete(providerId);
    this.fallbackOrder = this.fallbackOrder.filter((id) => id !== providerId);
    this.errorsByProvider.delete(providerId);
    this.requestsByProvider.delete(providerId);
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    if (!request.messages || request.messages.length === 0) {
      throw new Error('Request must include at least one message');
    }

    const requiredCapabilities = this.inferRequiredCapabilities(request);
    const selectedProvider = this.selectProvider(request);

    if (!selectedProvider) {
      throw new Error(
        `No provider available for capabilities: [${requiredCapabilities.join(', ')}]`
      );
    }

    const chain = this.buildFallbackChain(requiredCapabilities, selectedProvider.id);
    let lastError: Error | null = null;

    for (const providerId of chain) {
      const entry = this.providers.get(providerId);
      if (!entry || !entry.healthy) {
        continue;
      }

      if (this.isRateLimited(providerId)) {
        continue;
      }

      const result = await this.executeWithRetry(request, entry);
      if (result.success) {
        return result.response!;
      }
      lastError = result.error!;
    }

    throw lastError || new Error('All providers failed');
  }

  getCapabilities(): ModelCapability[] {
    const caps = new Set<ModelCapability>();
    const entries = Array.from(this.providers.values());
    for (const entry of entries) {
      if (entry.healthy) {
        for (const cap of entry.provider.capabilities) {
          caps.add(cap);
        }
      }
    }
    return Array.from(caps).sort(
      (a, b) => (CAPABILITY_PRIORITY[a] ?? 99) - (CAPABILITY_PRIORITY[b] ?? 99)
    );
  }

  getStats(): ModelEngineStats {
    const requestsByProvider: Record<string, number> = {};
    const errorsByProvider: Record<string, number> = {};

    Array.from(this.requestsByProvider.entries()).forEach(([id, count]) => {
      requestsByProvider[id] = count;
    });
    Array.from(this.errorsByProvider.entries()).forEach(([id, count]) => {
      errorsByProvider[id] = count;
    });

    return {
      totalRequests: this.totalRequests,
      totalTokensUsed: this.totalTokensUsed,
      averageLatencyMs:
        this.totalRequests > 0 ? this.totalLatencyMs / this.totalRequests : 0,
      requestsByProvider,
      errorsByProvider,
    };
  }

  selectProvider(request: ModelRequest): ModelProvider | null {
    const required = this.inferRequiredCapabilities(request);
    let bestId: string | null = null;
    let bestScore = -1;

    for (const providerId of this.fallbackOrder) {
      const entry = this.providers.get(providerId);
      if (!entry || !entry.healthy || this.isRateLimited(providerId)) {
        continue;
      }

      const caps = entry.provider.capabilities;
      const score = this.scoreProvider(caps, required);
      if (score > bestScore) {
        bestScore = score;
        bestId = providerId;
      }
    }

    if (!bestId) return null;
    return this.providers.get(bestId)!.provider;
  }

  setFallbackOrder(providerIds: string[]): void {
    const unique = new Set(providerIds);
    const validIds = Array.from(unique).filter((id) => this.providers.has(id));
    const existingIds = this.fallbackOrder.filter((id) => !unique.has(id));
    this.fallbackOrder = [...validIds, ...existingIds];
  }

  addMiddleware(fn: MiddlewareFn): void {
    this.middleware.push(fn);
  }

  getProvider(id: string): ModelProvider | null {
    return this.providers.get(id)?.provider ?? null;
  }

  listProviders(): ModelProvider[] {
    return Array.from(this.providers.values()).map((entry) => entry.provider);
  }

  async healthCheck(providerId?: string): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();
    const targets = providerId ? [providerId] : Array.from(this.providers.keys());

    for (const id of targets) {
      const entry = this.providers.get(id);
      if (!entry) {
        results.set(id, false);
        continue;
      }

      try {
        const testRequest: ModelRequest = {
          messages: [{ role: 'user', content: 'ping' }],
          maxTokens: 1,
          temperature: 0,
        };
        const start = Date.now();
        await entry.provider.adapter.complete(testRequest, entry.provider.config);
        const latencyMs = Date.now() - start;

        entry.healthy = true;
        entry.lastHealthCheck = Date.now();
        entry.totalLatencyMs += latencyMs;
        results.set(id, true);
      } catch {
        entry.healthy = false;
        entry.lastHealthCheck = Date.now();
        results.set(id, false);
      }
    }

    return results;
  }

  setRetryPolicy(policy: Partial<RetryPolicy>): void {
    this.retryPolicy = {
      ...this.retryPolicy,
      ...policy,
    };
    if (this.retryPolicy.maxAttempts < 1) {
      this.retryPolicy.maxAttempts = 1;
    }
    if (this.retryPolicy.baseDelayMs < 0) {
      this.retryPolicy.baseDelayMs = 0;
    }
    if (this.retryPolicy.maxDelayMs < this.retryPolicy.baseDelayMs) {
      this.retryPolicy.maxDelayMs = this.retryPolicy.baseDelayMs;
    }
    if (this.retryPolicy.backoffMultiplier < 1) {
      this.retryPolicy.backoffMultiplier = 1;
    }
  }

  getUsageByProvider(): Record<string, ModelUsage> {
    const usage: Record<string, ModelUsage> = {};
    Array.from(this.providers.entries()).forEach(([id, entry]) => {
      usage[id] = { ...entry.totalTokens };
    });
    return usage;
  }

  setRateLimit(
    providerId: string,
    limit: { maxRequests: number; windowMs: number }
  ): void {
    const entry = this.providers.get(providerId);
    if (!entry) {
      throw new Error(`Provider "${providerId}" not found`);
    }
    entry.rateLimit = {
      maxRequests: limit.maxRequests,
      windowMs: limit.windowMs,
      timestamps: [],
    };
  }

  mockProvider(provider: ModelProvider): void {
    if (!provider.id || !provider.adapter) {
      throw new Error('Mock provider requires valid id and adapter');
    }

    this.providers.set(provider.id, {
      provider,
      isMock: true,
      registeredAt: Date.now(),
      healthy: true,
      errorCount: 0,
      requestCount: 0,
      totalLatencyMs: 0,
      totalTokens: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    });

    if (!this.fallbackOrder.includes(provider.id)) {
      this.fallbackOrder.push(provider.id);
    }
  }

  private inferRequiredCapabilities(request: ModelRequest): ModelCapability[] {
    const caps: ModelCapability[] = ['text'];
    if (request.tools && request.tools.length > 0) {
      caps.push('function_calling');
    }
    if (request.responseFormat === 'json' || request.responseFormat === 'json_schema') {
      caps.push('structured_output');
    }
    return caps;
  }

  private scoreProvider(
    providerCaps: ModelCapability[],
    required: ModelCapability[]
  ): number {
    let score = 0;
    for (const req of required) {
      if (providerCaps.includes(req)) {
        score += (CAPABILITY_PRIORITY[req] ?? 0) + 1;
      } else {
        return -1;
      }
    }
    score += providerCaps.length * 0.1;
    return score;
  }

  private buildFallbackChain(
    required: ModelCapability[],
    preferredId: string
  ): string[] {
    const chain: string[] = [preferredId];
    for (const id of this.fallbackOrder) {
      if (id === preferredId) continue;
      const entry = this.providers.get(id);
      if (!entry) continue;
      const score = this.scoreProvider(entry.provider.capabilities, required);
      if (score >= 0) {
        chain.push(id);
      }
    }
    return chain;
  }

  private isRateLimited(providerId: string): boolean {
    const entry = this.providers.get(providerId);
    if (!entry || !entry.rateLimit) return false;

    const now = Date.now();
    const limit = entry.rateLimit;

    entry.rateLimit.timestamps = entry.rateLimit.timestamps.filter(
      (ts) => now - ts < limit.windowMs
    );

    return entry.rateLimit.timestamps.length >= limit.maxRequests;
  }

  private recordRateLimitHit(providerId: string): void {
    const entry = this.providers.get(providerId);
    if (!entry || !entry.rateLimit) return;
    entry.rateLimit.timestamps.push(Date.now());
  }

  private async executeWithRetry(
    request: ModelRequest,
    entry: ProviderEntry
  ): Promise<{ success: boolean; response?: ModelResponse; error?: Error }> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.retryPolicy.maxAttempts; attempt++) {
      if (attempt > 0) {
        const delay = this.calculateDelay(attempt);
        await this.sleep(delay);
      }

      if (this.isRateLimited(entry.provider.id)) {
        this.recordRateLimitHit(entry.provider.id);
        lastError = new Error(`Rate limited for provider "${entry.provider.id}"`);
        continue;
      }

      this.recordRateLimitHit(entry.provider.id);

      const ctx: MiddlewareContext = {
        request,
        providerId: entry.provider.id,
        timestamp: Date.now(),
        attempt,
      };

      try {
        const response = await this.executeMiddleware(ctx, entry);
        this.recordSuccess(entry, response);
        return { success: true, response };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        this.recordError(entry, lastError);
      }
    }

    return { success: false, error: lastError! };
  }

  private async executeMiddleware(
    ctx: MiddlewareContext,
    entry: ProviderEntry
  ): Promise<ModelResponse> {
    const pipeline = [...this.middleware];
    let index = 0;

    const next = async (): Promise<ModelResponse> => {
      if (index < pipeline.length) {
        const fn = pipeline[index++];
        return fn(ctx, next);
      }
      return entry.provider.adapter.complete(ctx.request, entry.provider.config);
    };

    return next();
  }

  private recordSuccess(entry: ProviderEntry, response: ModelResponse): void {
    entry.requestCount++;
    entry.totalTokens.promptTokens += response.usage.promptTokens;
    entry.totalTokens.completionTokens += response.usage.completionTokens;
    entry.totalTokens.totalTokens += response.usage.totalTokens;
    entry.errorCount = Math.max(0, entry.errorCount - 1);

    this.totalRequests++;
    this.totalTokensUsed += response.usage.totalTokens;
    this.totalLatencyMs += Date.now() - (entry.lastHealthCheck ?? Date.now());

    const count = this.requestsByProvider.get(entry.provider.id) ?? 0;
    this.requestsByProvider.set(entry.provider.id, count + 1);

    this.requestLogs.push({
      timestamp: Date.now(),
      providerId: entry.provider.id,
      model: response.model,
      latencyMs: Date.now() - (entry.lastHealthCheck ?? Date.now()),
      success: true,
      usage: response.usage,
    });

    if (this.requestLogs.length > 1000) {
      this.requestLogs = this.requestLogs.slice(-500);
    }
  }

  private recordError(entry: ProviderEntry, error: Error): void {
    entry.errorCount++;
    const count = this.errorsByProvider.get(entry.provider.id) ?? 0;
    this.errorsByProvider.set(entry.provider.id, count + 1);

    this.requestLogs.push({
      timestamp: Date.now(),
      providerId: entry.provider.id,
      model: '',
      latencyMs: 0,
      success: false,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      error: error.message,
    });

    if (entry.errorCount >= 5) {
      entry.healthy = false;
    }

    if (this.requestLogs.length > 1000) {
      this.requestLogs = this.requestLogs.slice(-500);
    }
  }

  private calculateDelay(attempt: number): number {
    const delay =
      this.retryPolicy.baseDelayMs *
      Math.pow(this.retryPolicy.backoffMultiplier, attempt);
    const jitter = delay * 0.1 * (Math.random() * 2 - 1);
    return Math.min(delay + jitter, this.retryPolicy.maxDelayMs);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
