import { describe, it, expect } from 'vitest';
import { createToolDefinition } from '../src/discovery/types.js';
import { ToolRegistry } from '../src/discovery/store.js';
import { ToolIndex } from '../src/discovery/index.js';
import { ToolSearcher } from '../src/discovery/retrieval.js';
import { DiscoveryLifecycle } from '../src/discovery/lifecycle.js';
import { createToolDiscovery } from '../src/discovery/integration.js';

const httpGet = createToolDefinition({
  name: 'http.get',
  description: 'Perform an HTTP GET request',
  handler: async () => ({}),
  parameters: [{ name: 'url', type: 'string', required: true }],
  tags: ['network'],
  capabilities: ['http.request'],
});

const fsRead = createToolDefinition({
  name: 'fs.read',
  description: 'Read a file from disk',
  handler: async () => ({}),
  parameters: [{ name: 'path', type: 'string', required: true }],
  tags: ['filesystem'],
  capabilities: ['filesystem.read'],
});

describe('discovery', () => {
  it('ToolRegistry registers, lists and emits schemas', () => {
    const registry = new ToolRegistry();
    expect(registry.register(httpGet)).toBeUndefined();
    expect(registry.register(fsRead)).toBeUndefined();
    expect(registry.size).toBe(2);
    expect(registry.has('http.get')).toBe(true);
    expect(registry.get('http.get')?.name).toBe('http.get');
    expect(registry.list()).toHaveLength(2);

    const schema = registry.getSchema('http.get');
    expect(schema?.name).toBe('http.get');
    expect(schema?.parameters).toHaveLength(1);
    expect((schema as Record<string, unknown> | undefined)?.handler).toBeUndefined();
  });

  it('ToolSearcher searches, filters by capability and by tag', () => {
    const index = new ToolIndex();
    index.indexTool(httpGet);
    index.indexTool(fsRead);
    const searcher = new ToolSearcher(index);

    const hits = searcher.search('http');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].tool.name).toBe('http.get');
    expect(hits[0].score).toBeGreaterThan(0);

    const caps = searcher.byCapability('http.request');
    expect(caps.map((r) => r.tool.name)).toContain('http.get');

    const tags = searcher.byTag('network');
    expect(tags.map((r) => r.tool.name)).toContain('http.get');
    expect(tags.map((r) => r.tool.name)).not.toContain('fs.read');
  });

  it('ToolDiscovery registers, searches and exposes a catalog', () => {
    const discovery = createToolDiscovery();
    discovery.register(httpGet);
    discovery.register(fsRead);
    expect(discovery.size).toBe(2);

    const hits = discovery.search('http');
    expect(hits[0].tool.name).toBe('http.get');

    expect(discovery.getSchema('fs.read')).toBeDefined();
    expect(discovery.byCapability('http.request').map((r) => r.tool.name)).toContain('http.get');
    expect(discovery.byTag('network').map((r) => r.tool.name)).toContain('http.get');
    expect(discovery.catalog.list()).toHaveLength(2);
    expect(discovery.catalog.byCapability('http.request')).toContain('http.get');
  });

  it('DiscoveryLifecycle keeps the index in sync and prunes in bulk', () => {
    const registry = new ToolRegistry();
    const index = new ToolIndex();
    const lifecycle = new DiscoveryLifecycle(registry, index);

    lifecycle.register(httpGet);
    lifecycle.register(fsRead);
    lifecycle.register(createToolDefinition({
      name: 'fs.write',
      description: 'Write a file to disk',
      handler: async () => ({}),
      tags: ['filesystem'],
      capabilities: ['filesystem.write'],
    }));
    expect(registry.size).toBe(3);
    expect(index.has('fs.write')).toBe(true);

    const removed = lifecycle.prune(['http.get', 'fs.read']);
    expect(removed).toBe(2);
    expect(registry.size).toBe(1);
    expect(index.has('http.get')).toBe(false);
    expect(index.has('fs.write')).toBe(true);

    expect(lifecycle.isRunning()).toBe(false);
    expect(lifecycle.start()).toBe(true);
    expect(lifecycle.isRunning()).toBe(true);
    expect(lifecycle.stop()).toBe(true);
    expect(lifecycle.isRunning()).toBe(false);
  });
});