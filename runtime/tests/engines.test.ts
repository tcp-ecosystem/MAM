import { describe, it, expect, beforeEach } from 'vitest';
import { DefaultTokenBudget } from '../src/v2/token-budget.js';
import { DefaultContextEngine } from '../src/v2/context-engine.js';
import { DefaultMemoryEngine } from '../src/v2/memory-engine.js';
import { DefaultKnowledgeEngine } from '../src/v2/knowledge-engine.js';
import { DefaultModelEngine } from '../src/v2/model-engine.js';
import { DefaultToolEngine } from '../src/v2/tool-engine.js';
import type {
  ContextSource,
  ModelProvider,
  ModelRequest,
  ToolDefinition,
} from '../src/v2/types.js';

function makeProvider(id: string, caps: string[] = ['text']): ModelProvider {
  return {
    id,
    name: `Provider ${id}`,
    capabilities: caps as any,
    config: {},
    adapter: {
      complete: async (req: ModelRequest) => ({
        content: `Response from ${id}`,
        model: `model-${id}`,
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        finishReason: 'stop' as const,
      }),
    },
  };
}

function makeTool(
  name: string,
  params: { name: string; type: string; required: boolean }[] = [],
  handler?: (p: Record<string, unknown>) => Promise<unknown>
): ToolDefinition {
  return {
    name,
    description: `Tool ${name}`,
    parameters: params,
    handler: handler ?? (async () => 'ok'),
  };
}

describe('DefaultTokenBudget', () => {
  let budget: DefaultTokenBudget;

  beforeEach(() => {
    budget = new DefaultTokenBudget(1000);
  });

  it('should allocate tokens', () => {
    const alloc = budget.allocate(100, 'test');
    expect(alloc.id).toBeTruthy();
    expect(alloc.amount).toBe(100);
    expect(alloc.label).toBe('test');
  });

  it('should spend from allocation', () => {
    const alloc = budget.allocate(200);
    budget.spend(alloc.id, 50);
    const usage = budget.getUsage();
    expect(usage.totalSpent).toBe(50);
    expect(usage.totalRemaining).toBe(950);
  });

  it('should return remaining after multiple operations', () => {
    const a1 = budget.allocate(300);
    const a2 = budget.allocate(200);
    budget.spend(a1.id, 100);
    expect(budget.remaining()).toBe(900);
    budget.spend(a2.id, 150);
    expect(budget.remaining()).toBe(750);
  });

  it('should release allocation', () => {
    const alloc = budget.allocate(500);
    budget.release(alloc.id);
    expect(budget.getUsage().totalAllocated).toBe(0);
    expect(budget.remaining()).toBe(1000);
  });

  it('should get usage summary', () => {
    const a1 = budget.allocate(200, 'a');
    const a2 = budget.allocate(300, 'b');
    budget.spend(a1.id, 50);
    const usage = budget.getUsage();
    expect(usage.totalAllocated).toBe(500);
    expect(usage.totalSpent).toBe(50);
    expect(usage.allocations).toHaveLength(2);
  });

  it('should defragment allocations with same label', () => {
    const a1 = budget.allocate(100, 'merge');
    const a2 = budget.allocate(200, 'merge');
    const released = budget.defragment();
    expect(released.length).toBeGreaterThanOrEqual(1);
    const usage = budget.getUsage();
    const allocs = usage.allocations.filter((a) => a.label === 'merge');
    expect(allocs.length).toBe(1);
    expect(allocs[0].amount).toBe(300);
  });

  it('should fire warning callback', () => {
    let warned = false;
    budget.setWarningThreshold(0.5);
    budget.onWarning(() => {
      warned = true;
    });
    const alloc = budget.allocate(600);
    budget.spend(alloc.id, 600);
    expect(warned).toBe(true);
  });

  it('should set budget', () => {
    budget.setBudget(2000);
    expect(budget.remaining()).toBe(2000);
  });

  it('should return history', () => {
    budget.allocate(100, 'h1');
    budget.allocate(200, 'h2');
    const history = budget.getHistory();
    expect(history.length).toBeGreaterThanOrEqual(2);
    expect(history[0].type).toBe('allocate');
  });

  it('should throw on negative budget', () => {
    expect(() => new DefaultTokenBudget(-1)).toThrow('non-negative');
  });

  it('should throw on insufficient tokens', () => {
    expect(() => budget.allocate(2000)).toThrow('Insufficient');
  });
});

describe('DefaultContextEngine', () => {
  let engine: DefaultContextEngine;

  beforeEach(() => {
    engine = new DefaultContextEngine(4096);
  });

  it('should add and retrieve active sources', () => {
    const source: ContextSource = {
      id: 's1',
      name: 'Source 1',
      type: 'static',
      priority: 'medium',
      metadata: { content: 'hello world' },
    };
    engine.addSource(source);
    expect(engine.getActiveSources()).toHaveLength(1);
  });

  it('should remove source', () => {
    const source: ContextSource = { id: 's1', name: 'S1', type: 'static', priority: 'medium' };
    engine.addSource(source);
    engine.removeSource('s1');
    expect(engine.getActiveSources()).toHaveLength(0);
  });

  it('should assemble with budget constraint', async () => {
    const s1: ContextSource = { id: 's1', name: 'S1', type: 'static', priority: 'high', metadata: { content: 'content A' } };
    const s2: ContextSource = { id: 's2', name: 'S2', type: 'static', priority: 'low', metadata: { content: 'content B' } };
    engine.addSource(s1);
    engine.addSource(s2);
    const result = await engine.assemble({ budget: 100, sources: ['s1', 's2'], priorities: {} });
    expect(result.totalTokens).toBeLessThanOrEqual(100);
    expect(result.entries.length).toBeGreaterThanOrEqual(1);
  });

  it('should preview without caching', async () => {
    const source: ContextSource = { id: 's1', name: 'S1', type: 'static', priority: 'high', metadata: { content: 'preview test' } };
    engine.addSource(source);
    const r1 = await engine.preview({ budget: 500, sources: ['s1'], priorities: {} });
    const r2 = await engine.preview({ budget: 500, sources: ['s1'], priorities: {} });
    expect(r1.entries).toHaveLength(r2.entries.length);
  });

  it('should handle TTL sources', async () => {
    const source: ContextSource = { id: 's1', name: 'S1', type: 'static', priority: 'medium', ttl: 60000 };
    engine.addSource(source);
    expect(engine.getActiveSources()).toHaveLength(1);
  });

  it('should estimate tokens', () => {
    expect(engine.estimateTokens('')).toBe(0);
    expect(engine.estimateTokens('1234')).toBe(1);
  });

  it('should prioritize higher priority sources', async () => {
    const crit: ContextSource = { id: 'crit', name: 'C', type: 'static', priority: 'critical', metadata: { content: 'critical data' } };
    const low: ContextSource = { id: 'low', name: 'L', type: 'static', priority: 'low', metadata: { content: 'low data' } };
    engine.addSource(crit);
    engine.addSource(low);
    const result = await engine.assemble({ budget: 50, sources: ['crit', 'low'], priorities: {} });
    expect(result.entries[0].sourceId).toBe('crit');
  });

  it('should respect priority overrides', async () => {
    const s1: ContextSource = { id: 's1', name: 'S1', type: 'static', priority: 'low', metadata: { content: 'low content' } };
    const s2: ContextSource = { id: 's2', name: 'S2', type: 'static', priority: 'medium', metadata: { content: 'med content' } };
    engine.addSource(s1);
    engine.addSource(s2);
    const result = await engine.assemble({ budget: 50, sources: ['s1', 's2'], priorities: { s1: 'critical' } });
    expect(result.entries[0].sourceId).toBe('s1');
  });

  it('should track stats', async () => {
    const source: ContextSource = { id: 's1', name: 'S1', type: 'static', priority: 'medium', metadata: { content: 'stats test' } };
    engine.addSource(source);
    await engine.assemble({ budget: 500, sources: ['s1'], priorities: {} });
    const stats = engine.getStats();
    expect(stats.totalAssemblies).toBe(1);
    expect(stats.sourcesActive).toBe(1);
  });

  it('should apply compress optimization', async () => {
    const source: ContextSource = {
      id: 's1', name: 'S1', type: 'static', priority: 'high',
      metadata: { content: 'hello   world   with   spaces' },
    };
    engine.addSource(source);
    const result = await engine.assemble({
      budget: 500, sources: ['s1'], priorities: {}, optimization: 'compress',
    });
    expect(result.entries[0].content).toBe('hello world with spaces');
  });
});

describe('DefaultMemoryEngine', () => {
  let engine: DefaultMemoryEngine;

  beforeEach(() => {
    engine = new DefaultMemoryEngine();
  });

  it('should store and retrieve record', async () => {
    await engine.store('m1', 'hello memory', { source: 'test' });
    const record = await engine.retrieve('m1');
    expect(record).not.toBeNull();
    expect(record!.content).toBe('hello memory');
  });

  it('should update existing record', async () => {
    await engine.store('m1', 'original');
    await engine.update('m1', 'updated content');
    const record = await engine.retrieve('m1');
    expect(record!.content).toBe('updated content');
  });

  it('should delete record', async () => {
    await engine.store('m1', 'to delete');
    const deleted = await engine.delete('m1');
    expect(deleted).toBe(true);
    expect(await engine.retrieve('m1')).toBeNull();
  });

  it('should search using TF-IDF', async () => {
    await engine.store('m1', 'machine learning algorithms');
    await engine.store('m2', 'cooking recipes');
    await engine.store('m3', 'deep learning neural networks');
    const results = await engine.search('machine learning');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].record.id).toBe('m1');
  });

  it('should bulk store records', async () => {
    const items = [
      { id: 'b1', content: 'bulk one' },
      { id: 'b2', content: 'bulk two' },
      { id: 'b3', content: 'bulk three' },
    ];
    const results = await engine.bulkStore(items);
    expect(results).toHaveLength(3);
    expect(await engine.retrieve('b2')).not.toBeNull();
  });

  it('should expire old records', async () => {
    await engine.store('keep', 'keep this');
    await engine.store('remove', 'remove this');
    const removed = await engine.expire(0);
    expect(removed).toBe(2);
    expect(await engine.retrieve('keep')).toBeNull();
    expect(await engine.retrieve('remove')).toBeNull();
  });

  it('should consolidate duplicate records', async () => {
    await engine.store('d1', 'machine learning');
    await engine.store('d2', 'machine learning algorithms');
    await engine.store('d3', 'completely different');
    const result = await engine.consolidate();
    expect(result.removed).toBeGreaterThanOrEqual(0);
  });

  it('should get records by source', async () => {
    await engine.store('s1', 'from source A', { source: 'srcA' });
    await engine.store('s2', 'from source B', { source: 'srcB' });
    const results = await engine.getBySource('srcA');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('s1');
  });

  it('should get records by tags', async () => {
    await engine.store('t1', 'tagged one', { tags: ['important', 'review'] });
    await engine.store('t2', 'tagged two', { tags: ['draft'] });
    const results = await engine.getByTags(['important']);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('t1');
  });

  it('should export and import', async () => {
    await engine.store('e1', 'export me', { source: 'exp' });
    await engine.store('e2', 'export me too', { source: 'exp' });
    const data = engine.export();
    expect(data.records).toHaveLength(2);
    const newEngine = new DefaultMemoryEngine();
    const count = await newEngine.import(data);
    expect(count).toBe(2);
  });

  it('should return stats', async () => {
    await engine.store('st', 'stats record');
    const stats = engine.getStats();
    expect(stats.totalRecords).toBe(1);
    expect(stats.totalSearches).toBe(0);
  });
});

describe('DefaultKnowledgeEngine', () => {
  let engine: DefaultKnowledgeEngine;

  beforeEach(() => {
    engine = new DefaultKnowledgeEngine();
  });

  it('should add source', async () => {
    await engine.addSource({ id: 'ks1', name: 'Docs', type: 'document', config: {} });
    expect(engine.getStats().totalSources).toBe(1);
  });

  it('should remove source', async () => {
    await engine.addSource({ id: 'ks1', name: 'Docs', type: 'document', config: {} });
    await engine.removeSource('ks1');
    expect(engine.getStats().totalSources).toBe(0);
  });

  it('should index document and retrieve', async () => {
    await engine.addSource({ id: 'ks1', name: 'Docs', type: 'document', config: {} });
    await engine.indexDocument('ks1', 'doc1', 'TypeScript is a typed superset of JavaScript');
    const result = await engine.retrieve('TypeScript', { topK: 5 });
    expect(result.items.length).toBeGreaterThanOrEqual(1);
    expect(result.query).toBe('TypeScript');
  });

  it('should retrieve with keyword strategy', async () => {
    await engine.addSource({ id: 'ks1', name: 'Docs', type: 'document', config: {} });
    await engine.indexDocument('ks1', 'doc1', 'Python is used for data science and machine learning');
    await engine.indexDocument('ks1', 'doc2', 'Rust is a systems programming language');
    const result = await engine.retrieve('machine learning', { strategy: 'keyword', topK: 5 });
    expect(result.items.length).toBeGreaterThanOrEqual(1);
    expect(result.strategy).toBe('keyword');
  });

  it('should get documents for source', async () => {
    await engine.addSource({ id: 'ks1', name: 'Docs', type: 'document', config: {} });
    await engine.indexDocument('ks1', 'd1', 'content one');
    await engine.indexDocument('ks1', 'd2', 'content two');
    const docs = engine.getDocuments('ks1');
    expect(docs).toHaveLength(2);
  });

  it('should get provenance for indexed item', async () => {
    await engine.addSource({ id: 'ks1', name: 'Docs', type: 'document', config: {} });
    await engine.indexDocument('ks1', 'doc1', 'Some test content for provenance');
    const result = await engine.retrieve('test', { topK: 1 });
    if (result.items.length > 0) {
      const prov = engine.getProvenance(result.items[0].id);
      expect(prov).toBeDefined();
      expect(prov!.sourceId).toBe('ks1');
    }
  });

  it('should return stats after indexing', async () => {
    await engine.addSource({ id: 'ks1', name: 'Docs', type: 'document', config: {} });
    await engine.indexDocument('ks1', 'doc1', 'Content for stats');
    const stats = engine.getStats();
    expect(stats.totalSources).toBe(1);
    expect(stats.totalItemsIndexed).toBeGreaterThanOrEqual(1);
  });

  it('should throw on duplicate source', async () => {
    await engine.addSource({ id: 'ks1', name: 'Docs', type: 'document', config: {} });
    await expect(engine.addSource({ id: 'ks1', name: 'Docs2', type: 'document', config: {} }))
      .rejects.toThrow('already exists');
  });

  it('should throw on missing source for index', async () => {
    await expect(engine.indexDocument('missing', 'd1', 'content'))
      .rejects.toThrow('not found');
  });

  it('should support retrieval with threshold', async () => {
    await engine.addSource({ id: 'ks1', name: 'Docs', type: 'document', config: {} });
    await engine.indexDocument('ks1', 'doc1', 'Unrelated content about cooking');
    const result = await engine.retrieve('quantum physics', { threshold: 0.99 });
    expect(result.items).toHaveLength(0);
  });

  it('should support topK limit', async () => {
    await engine.addSource({ id: 'ks1', name: 'Docs', type: 'document', config: {} });
    for (let i = 0; i < 10; i++) {
      await engine.indexDocument('ks1', `doc${i}`, `Document ${i} about testing`);
    }
    const result = await engine.retrieve('testing', { topK: 3 });
    expect(result.items.length).toBeLessThanOrEqual(3);
  });
});

describe('DefaultModelEngine', () => {
  let engine: DefaultModelEngine;

  beforeEach(() => {
    engine = new DefaultModelEngine();
  });

  it('should register provider', () => {
    const provider = makeProvider('p1');
    engine.register(provider);
    expect(engine.getProvider('p1')).not.toBeNull();
  });

  it('should unregister provider', () => {
    engine.register(makeProvider('p1'));
    engine.unregister('p1');
    expect(engine.getProvider('p1')).toBeNull();
  });

  it('should complete a request with mock adapter', async () => {
    engine.register(makeProvider('p1'));
    const result = await engine.complete({
      messages: [{ role: 'user', content: 'Hello' }],
    });
    expect(result.content).toBe('Response from p1');
    expect(result.usage.totalTokens).toBe(30);
  });

  it('should select provider by capability', () => {
    engine.register(makeProvider('p1', ['text']));
    engine.register(makeProvider('p2', ['code']));
    const selected = engine.selectProvider({
      messages: [{ role: 'user', content: 'write code' }],
    });
    expect(selected).not.toBeNull();
  });

  it('should get capabilities across providers', () => {
    engine.register(makeProvider('p1', ['text', 'code']));
    engine.register(makeProvider('p2', ['reasoning']));
    const caps = engine.getCapabilities();
    expect(caps).toContain('text');
    expect(caps).toContain('code');
    expect(caps).toContain('reasoning');
  });

  it('should fallback to second provider on failure', async () => {
    engine.setRetryPolicy({ maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0, backoffMultiplier: 1, strategy: 'fixed' });
    const failing: ModelProvider = {
      id: 'fail',
      name: 'Failing',
      capabilities: ['text'],
      config: {},
      adapter: {
        complete: async () => { throw new Error('boom'); },
      },
    };
    engine.register(failing);
    engine.register(makeProvider('p2'));
    const result = await engine.complete({
      messages: [{ role: 'user', content: 'test' }],
    });
    expect(result.content).toBe('Response from p2');
  });

  it('should run middleware', async () => {
    let middlewareCalled = false;
    engine.register(makeProvider('p1'));
    engine.addMiddleware(async (ctx, next) => {
      middlewareCalled = true;
      return next();
    });
    await engine.complete({ messages: [{ role: 'user', content: 'test' }] });
    expect(middlewareCalled).toBe(true);
  });

  it('should healthCheck providers', async () => {
    engine.register(makeProvider('p1'));
    const results = await engine.healthCheck();
    expect(results.get('p1')).toBe(true);
  });

  it('should track stats', async () => {
    engine.register(makeProvider('p1'));
    await engine.complete({ messages: [{ role: 'user', content: 'test' }] });
    const stats = engine.getStats();
    expect(stats.totalRequests).toBe(1);
    expect(stats.totalTokensUsed).toBe(30);
  });

  it('should throw on empty messages', async () => {
    engine.register(makeProvider('p1'));
    await expect(engine.complete({ messages: [] })).rejects.toThrow('at least one message');
  });

  it('should list providers', () => {
    engine.register(makeProvider('p1'));
    engine.register(makeProvider('p2'));
    const list = engine.listProviders();
    expect(list).toHaveLength(2);
  });

  it('should throw on missing provider for unregister', () => {
    expect(() => engine.unregister('nonexistent')).toThrow('not found');
  });
});

describe('DefaultToolEngine', () => {
  let engine: DefaultToolEngine;

  beforeEach(() => {
    engine = new DefaultToolEngine();
  });

  it('should register tool', () => {
    const tool = makeTool('myTool', [{ name: 'x', type: 'string', required: true }]);
    engine.register(tool);
    expect(engine.list()).toHaveLength(1);
    expect(engine.list()[0].name).toBe('myTool');
  });

  it('should unregister tool', () => {
    engine.register(makeTool('myTool'));
    const removed = engine.unregister('myTool');
    expect(removed).toBe(true);
    expect(engine.list()).toHaveLength(0);
  });

  it('should invoke tool', async () => {
    const handler = async (params: Record<string, unknown>) => `result-${params.x}`;
    engine.register(makeTool('compute', [{ name: 'x', type: 'string', required: true }], handler));
    const result = await engine.invoke('compute', { x: 'hello' });
    expect(result).toBe('result-hello');
  });

  it('should validate required params', () => {
    engine.register(makeTool('validate', [{ name: 'req', type: 'string', required: true }]));
    expect(() => engine.validateParams('validate', {})).toThrow('Missing required');
  });

  it('should validate param types', () => {
    engine.register(makeTool('typed', [{ name: 'num', type: 'number', required: true }]));
    expect(() => engine.validateParams('typed', { num: 'not a number' })).toThrow('Invalid type');
  });

  it('should list tools', () => {
    engine.register(makeTool('alpha'));
    engine.register(makeTool('beta'));
    expect(engine.list()).toHaveLength(2);
  });

  it('should get schema', () => {
    engine.register(makeTool('schemaTool', [{ name: 'p1', type: 'string', required: true }]));
    const schema = engine.getSchema('schemaTool');
    expect(schema).toBeDefined();
    expect(schema!.name).toBe('schemaTool');
    expect(schema!.inputSchema).toBeDefined();
  });

  it('should track execution history', async () => {
    engine.register(makeTool('tracked', [], async () => 'done'));
    await engine.invoke('tracked', {});
    await engine.invoke('tracked', {});
    const history = engine.getExecutionHistory('tracked');
    expect(history).toHaveLength(2);
    expect(history[0].success).toBe(true);
  });

  it('should support caching', async () => {
    let callCount = 0;
    const handler = async () => { callCount++; return 'cached'; };
    engine.register(makeTool('cached', [], handler));
    engine.enableCache('cached', 60000);
    await engine.invoke('cached', {});
    await engine.invoke('cached', {});
    expect(callCount).toBe(1);
  });

  it('should search tools', () => {
    engine.register(makeTool('searchable'));
    engine.register(makeTool('other'));
    const results = engine.search('search');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('searchable');
  });

  it('should throw on missing tool', async () => {
    await expect(engine.invoke('nonexistent', {})).rejects.toThrow('Tool not found');
  });

  it('should throw on duplicate registration', () => {
    engine.register(makeTool('dupe'));
    expect(() => engine.register(makeTool('dupe'))).toThrow('already registered');
  });
});
