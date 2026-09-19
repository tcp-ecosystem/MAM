import {
  ToolEngine,
  ToolDefinition,
  ToolParameter,
  ToolHandler,
  ToolSchema,
  ExecutionContext,
  PermissionChecker,
  RetryPolicy,
} from './types.js';

interface ToolEntry {
  tool: ToolDefinition;
  timeoutMs: number | undefined;
  retryPolicy: RetryPolicy | undefined;
  cacheConfig: CacheConfig | undefined;
  capabilities: string[];
}

interface CacheConfig {
  ttlMs: number;
  enabled: boolean;
}

interface CacheEntry {
  result: unknown;
  timestamp: number;
  ttlMs: number;
}

interface ExecutionRecord {
  toolName: string;
  params: Record<string, unknown>;
  result: unknown;
  success: boolean;
  durationMs: number;
  timestamp: number;
  error: string | undefined;
}

interface ToolStats {
  totalExecutions: number;
  successCount: number;
  failureCount: number;
  averageDurationMs: number;
  lastExecutedAt: number | undefined;
  lastError: string | undefined;
  cacheHits: number;
  cacheMisses: number;
}

type PermissionCheckerFn = (toolName: string, context?: ExecutionContext) => boolean;

const DEFAULT_TIMEOUT_MS = 30000;
const MAX_HISTORY_PER_TOOL = 1000;

export class DefaultToolEngine implements ToolEngine {
  private tools: Map<string, ToolEntry> = new Map();
  private history: Map<string, ExecutionRecord[]> = new Map();
  private stats: Map<string, ToolStats> = new Map();
  private cache: Map<string, CacheEntry> = new Map();
  private permissionChecker: PermissionCheckerFn | undefined;
  private mockTools: Map<string, ToolHandler> = new Map();

  register(tool: ToolDefinition): void {
    this.validateToolDefinition(tool);
    const entry: ToolEntry = {
      tool,
      timeoutMs: undefined,
      retryPolicy: undefined,
      cacheConfig: undefined,
      capabilities: this.extractCapabilities(tool),
    };
    this.tools.set(tool.name, entry);
    this.stats.set(tool.name, {
      totalExecutions: 0,
      successCount: 0,
      failureCount: 0,
      averageDurationMs: 0,
      lastExecutedAt: undefined,
      lastError: undefined,
      cacheHits: 0,
      cacheMisses: 0,
    });
    this.history.set(tool.name, []);
  }

  async invoke(
    toolName: string,
    params: Record<string, unknown>,
    context?: ExecutionContext
  ): Promise<unknown> {
    const entry = this.tools.get(toolName);
    if (!entry) {
      throw new Error(`Tool not found: ${toolName}`);
    }

    this.validateParams(toolName, params);

    if (this.permissionChecker) {
      const allowed = this.permissionChecker(toolName, context);
      if (!allowed) {
        throw new Error(`Permission denied for tool: ${toolName}`);
      }
    }

    if (context?.permissions) {
      const result = context.permissions.check(`tool:${toolName}`);
      if (!result.allowed) {
        throw new Error(`Permission denied for tool: ${toolName}: ${result.reason}`);
      }
    }

    const handler = this.mockTools.get(toolName) || entry.tool.handler;
    const timeoutMs = entry.timeoutMs || context?.options?.timeout || DEFAULT_TIMEOUT_MS;
    const retryPolicy = entry.retryPolicy || context?.options?.retryPolicy;

    const cacheKey = this.buildCacheKey(toolName, params);
    if (entry.cacheConfig?.enabled) {
      const cached = this.getFromCache(cacheKey);
      if (cached !== undefined) {
        this.recordCacheHit(toolName);
        return cached;
      }
      this.recordCacheMiss(toolName);
    }

    let lastError: Error | undefined;
    const maxAttempts = retryPolicy ? retryPolicy.maxRetries + 1 : 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const startTime = Date.now();
      try {
        const result = await this.executeWithTimeout(handler, params, context, timeoutMs);
        const duration = Date.now() - startTime;
        this.recordExecution(toolName, params, result, true, duration, undefined);

        if (entry.cacheConfig?.enabled) {
          this.setCache(cacheKey, result, entry.cacheConfig.ttlMs);
        }

        return result;
      } catch (err) {
        const duration = Date.now() - startTime;
        lastError = err instanceof Error ? err : new Error(String(err));
        this.recordExecution(toolName, params, undefined, false, duration, lastError.message);

        if (attempt < maxAttempts - 1 && retryPolicy) {
          const delayMs = this.calculateRetryDelay(retryPolicy, attempt);
          await this.sleep(delayMs);
        }
      }
    }

    throw lastError || new Error(`Tool execution failed: ${toolName}`);
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((entry) => entry.tool);
  }

  getSchema(toolName: string): ToolSchema | undefined {
    const entry = this.tools.get(toolName);
    if (!entry) {
      return undefined;
    }
    return {
      name: entry.tool.name,
      description: entry.tool.description,
      inputSchema: this.buildInputSchema(entry.tool.parameters),
      outputSchema: { type: 'object' },
    };
  }

  unregister(toolName: string): boolean {
    const existed = this.tools.delete(toolName);
    this.history.delete(toolName);
    this.stats.delete(toolName);
    this.mockTools.delete(toolName);
    this.clearCacheForTool(toolName);
    return existed;
  }

  validateParams(toolName: string, params: Record<string, unknown>): void {
    const entry = this.tools.get(toolName);
    if (!entry) {
      throw new Error(`Tool not found: ${toolName}`);
    }

    const errors: string[] = [];

    for (const param of entry.tool.parameters) {
      const value = params[param.name];

      if (param.required && (value === undefined || value === null)) {
        errors.push(`Missing required parameter: ${param.name}`);
        continue;
      }

      if (value === undefined || value === null) {
        if (param.default !== undefined) {
          params[param.name] = param.default;
        }
        continue;
      }

      if (!this.validateParamType(value, param)) {
        errors.push(
          `Invalid type for parameter ${param.name}: expected ${param.type}, got ${typeof value}`
        );
        continue;
      }

      if (param.enum && !param.enum.includes(value)) {
        errors.push(
          `Invalid value for parameter ${param.name}: must be one of [${param.enum.join(', ')}]`
        );
      }
    }

    const definedNames = new Set(entry.tool.parameters.map((p) => p.name));
    for (const key of Object.keys(params)) {
      if (!definedNames.has(key)) {
        errors.push(`Unexpected parameter: ${key}`);
      }
    }

    if (errors.length > 0) {
      throw new Error(`Parameter validation failed for ${toolName}: ${errors.join('; ')}`);
    }
  }

  setPermissionChecker(checker: PermissionCheckerFn): void {
    this.permissionChecker = checker;
  }

  setTimeout(toolName: string, ms: number): void {
    const entry = this.tools.get(toolName);
    if (!entry) {
      throw new Error(`Tool not found: ${toolName}`);
    }
    if (ms <= 0) {
      throw new Error('Timeout must be positive');
    }
    entry.timeoutMs = ms;
  }

  setRetryPolicy(toolName: string, policy: RetryPolicy): void {
    const entry = this.tools.get(toolName);
    if (!entry) {
      throw new Error(`Tool not found: ${toolName}`);
    }
    if (policy.maxRetries < 0) {
      throw new Error('maxRetries must be non-negative');
    }
    if (policy.backoffMs < 0) {
      throw new Error('backoffMs must be non-negative');
    }
    if (policy.backoffMultiplier < 1) {
      throw new Error('backoffMultiplier must be >= 1');
    }
    entry.retryPolicy = { ...policy };
  }

  getExecutionHistory(toolName?: string): ExecutionRecord[] {
    if (toolName) {
      return [...(this.history.get(toolName) || [])];
    }
    const all: ExecutionRecord[] = [];
    for (const records of this.history.values()) {
      all.push(...records);
    }
    return all.sort((a, b) => b.timestamp - a.timestamp);
  }

  getStats(toolName?: string): Map<string, ToolStats> | ToolStats | undefined {
    if (toolName) {
      const s = this.stats.get(toolName);
      return s ? { ...s } : undefined;
    }
    const result = new Map<string, ToolStats>();
    for (const [name, s] of this.stats) {
      result.set(name, { ...s });
    }
    return result;
  }

  search(query: string): ToolDefinition[] {
    const lowerQuery = query.toLowerCase();
    const results: ToolDefinition[] = [];
    for (const entry of this.tools.values()) {
      if (
        entry.tool.name.toLowerCase().includes(lowerQuery) ||
        entry.tool.description.toLowerCase().includes(lowerQuery)
      ) {
        results.push(entry.tool);
      }
    }
    return results;
  }

  getByCapability(capability: string): ToolDefinition[] {
    const lowerCap = capability.toLowerCase();
    const results: ToolDefinition[] = [];
    for (const entry of this.tools.values()) {
      if (entry.capabilities.some((c) => c.toLowerCase() === lowerCap)) {
        results.push(entry.tool);
      }
    }
    return results;
  }

  enableCache(toolName: string, ttlMs: number): void {
    const entry = this.tools.get(toolName);
    if (!entry) {
      throw new Error(`Tool not found: ${toolName}`);
    }
    if (ttlMs <= 0) {
      throw new Error('TTL must be positive');
    }
    entry.cacheConfig = { ttlMs, enabled: true };
  }

  disableCache(toolName: string): void {
    const entry = this.tools.get(toolName);
    if (!entry) {
      throw new Error(`Tool not found: ${toolName}`);
    }
    entry.cacheConfig = undefined;
    this.clearCacheForTool(toolName);
  }

  mockTool(name: string, handler: ToolHandler): void {
    if (!this.tools.has(name)) {
      throw new Error(`Tool not found: ${name}`);
    }
    this.mockTools.set(name, handler);
  }

  private validateToolDefinition(tool: ToolDefinition): void {
    if (!tool.name || typeof tool.name !== 'string') {
      throw new Error('Tool name is required and must be a string');
    }
    if (!tool.description || typeof tool.description !== 'string') {
      throw new Error('Tool description is required and must be a string');
    }
    if (typeof tool.handler !== 'function') {
      throw new Error('Tool handler must be a function');
    }
    if (!Array.isArray(tool.parameters)) {
      throw new Error('Tool parameters must be an array');
    }
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }

    const seen = new Set<string>();
    for (const param of tool.parameters) {
      if (!param.name || typeof param.name !== 'string') {
        throw new Error('Parameter name is required and must be a string');
      }
      if (!param.type || typeof param.type !== 'string') {
        throw new Error(`Parameter type is required for ${param.name}`);
      }
      if (typeof param.required !== 'boolean') {
        throw new Error(`Parameter required flag must be boolean for ${param.name}`);
      }
      if (seen.has(param.name)) {
        throw new Error(`Duplicate parameter name: ${param.name}`);
      }
      seen.add(param.name);
    }
  }

  private validateParamType(value: unknown, param: ToolParameter): boolean {
    switch (param.type) {
      case 'string':
        return typeof value === 'string';
      case 'number':
        return typeof value === 'number' && !isNaN(value);
      case 'boolean':
        return typeof value === 'boolean';
      case 'object':
        return typeof value === 'object' && value !== null && !Array.isArray(value);
      case 'array':
        return Array.isArray(value);
      case 'function':
        return typeof value === 'function';
      default:
        return true;
    }
  }

  private extractCapabilities(tool: ToolDefinition): string[] {
    const caps: string[] = [];
    const nameLower = tool.name.toLowerCase();
    const descLower = tool.description.toLowerCase();

    if (nameLower.includes('search') || descLower.includes('search')) {
      caps.push('search');
    }
    if (nameLower.includes('read') || descLower.includes('read')) {
      caps.push('read');
    }
    if (nameLower.includes('write') || descLower.includes('write')) {
      caps.push('write');
    }
    if (nameLower.includes('delete') || descLower.includes('delete')) {
      caps.push('delete');
    }
    if (nameLower.includes('query') || descLower.includes('query')) {
      caps.push('query');
    }
    if (nameLower.includes('fetch') || descLower.includes('fetch')) {
      caps.push('fetch');
    }
    if (nameLower.includes('parse') || descLower.includes('parse')) {
      caps.push('parse');
    }
    if (nameLower.includes('validate') || descLower.includes('validate')) {
      caps.push('validate');
    }
    if (nameLower.includes('transform') || descLower.includes('transform')) {
      caps.push('transform');
    }
    if (nameLower.includes('compute') || descLower.includes('compute')) {
      caps.push('compute');
    }
    if (caps.length === 0) {
      caps.push('general');
    }
    return caps;
  }

  private buildInputSchema(params: ToolParameter[]): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const param of params) {
      properties[param.name] = {
        type: param.type,
        description: param.description,
        ...(param.enum ? { enum: param.enum } : {}),
        ...(param.default !== undefined ? { default: param.default } : {}),
      };
      if (param.required) {
        required.push(param.name);
      }
    }

    return {
      type: 'object',
      properties,
      required,
    };
  }

  private async executeWithTimeout(
    handler: ToolHandler,
    params: Record<string, unknown>,
    context: ExecutionContext | undefined,
    timeoutMs: number
  ): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Tool execution timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      handler(params, context)
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  private calculateRetryDelay(policy: RetryPolicy, attempt: number): number {
    switch (policy.strategy) {
      case 'exponential':
        return policy.backoffMs * Math.pow(policy.backoffMultiplier, attempt);
      case 'linear':
        return policy.backoffMs * (attempt + 1);
      case 'fixed':
      default:
        return policy.backoffMs;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private recordExecution(
    toolName: string,
    params: Record<string, unknown>,
    result: unknown,
    success: boolean,
    durationMs: number,
    error: string | undefined
  ): void {
    const record: ExecutionRecord = {
      toolName,
      params,
      result,
      success,
      durationMs,
      timestamp: Date.now(),
      error,
    };

    const history = this.history.get(toolName) || [];
    history.push(record);
    if (history.length > MAX_HISTORY_PER_TOOL) {
      history.shift();
    }
    this.history.set(toolName, history);

    const toolStats = this.stats.get(toolName);
    if (toolStats) {
      toolStats.totalExecutions++;
      if (success) {
        toolStats.successCount++;
      } else {
        toolStats.failureCount++;
        toolStats.lastError = error;
      }
      toolStats.averageDurationMs =
        (toolStats.averageDurationMs * (toolStats.totalExecutions - 1) + durationMs) /
        toolStats.totalExecutions;
      toolStats.lastExecutedAt = Date.now();
    }
  }

  private buildCacheKey(toolName: string, params: Record<string, unknown>): string {
    const sorted = Object.keys(params)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = params[key];
        return acc;
      }, {});
    return `${toolName}:${JSON.stringify(sorted)}`;
  }

  private getFromCache(key: string): unknown | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      return undefined;
    }
    if (Date.now() - entry.timestamp > entry.ttlMs) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.result;
  }

  private setCache(key: string, result: unknown, ttlMs: number): void {
    this.cache.set(key, {
      result,
      timestamp: Date.now(),
      ttlMs,
    });
  }

  private clearCacheForTool(toolName: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${toolName}:`)) {
        this.cache.delete(key);
      }
    }
  }

  private recordCacheHit(toolName: string): void {
    const toolStats = this.stats.get(toolName);
    if (toolStats) {
      toolStats.cacheHits++;
    }
  }

  private recordCacheMiss(toolName: string): void {
    const toolStats = this.stats.get(toolName);
    if (toolStats) {
      toolStats.cacheMisses++;
    }
  }
}
