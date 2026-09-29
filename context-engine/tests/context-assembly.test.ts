import { describe, it, expect } from 'vitest';
import {
  ContextAssemblerAdapter,
  ContextPipeline,
  createContextAssembler,
} from '../src/context-assembly/integration.js';
import { ContextAssemblyStore } from '../src/context-assembly/store.js';
import { AssemblyLifecycle } from '../src/context-assembly/lifecycle.js';
import { ContextAssembler, createAssembler } from '../src/context-assembly/retrieval.js';
import { systemPart, userPart, memoryPart } from '../src/context-assembly/types.js';

describe('context-assembly', () => {
  it('ContextAssembler assembles, orders and builds a prompt', () => {
    const assembler = new ContextAssembler();
    const result = assembler.assemble({
      parts: [
        userPart('Summarise the release notes.'),
        systemPart('Be concise.'),
      ],
    });
    expect(result.parts).toHaveLength(2);
    expect(result.prompt).toBeDefined();
    expect(result.prompt).toContain('<|system|>');
    expect(result.prompt!.indexOf('<|system|>')).toBeLessThan(
      result.prompt!.indexOf('<|user|>'),
    );
    expect(result.stats.parts).toBe(2);
  });

  it('ContextAssembler dedupes identical role+content parts', () => {
    const assembler = new ContextAssembler();
    const result = assembler.assemble({
      parts: [userPart('Hello there'), userPart('Hello there'), systemPart('Hi.')],
    });
    expect(result.stats.deduped).toBe(1);
    expect(result.parts).toHaveLength(2);
  });

  it('ContextAssembler trims to a token budget, keeping protected roles', () => {
    const assembler = new ContextAssembler({ maxTokens: 20 });
    const result = assembler.assemble({
      parts: [
        systemPart('Be concise and always answer in plain text.'),
        memoryPart('User prefers bullet points in every answer.'),
        userPart('Go.'),
      ],
    });
    expect(result.stats.trimmed).toBeGreaterThan(0);
    expect(result.parts.some((part) => part.role === 'system')).toBe(true);
  });

  it('buildPrompt and render produce role-marked fragments', () => {
    const assembler = new ContextAssembler();
    const part = systemPart('Be concise.');
    expect(assembler.render(part)).toBe('<|system|>\nBe concise.');
    const prompt = assembler.buildPrompt([part], { separator: '\n' });
    expect(prompt).toBe('<|system|>\nBe concise.');
  });

  it('ContextAssemblerAdapter caches the last result and exposes stats', () => {
    const adapter = createContextAssembler({ maxTokens: 1024 });
    const result = adapter.assemble({ parts: [systemPart('Hi.')] });
    expect(adapter.lastResult).toBe(result);
    expect(adapter.stats().parts).toBe(1);
    expect(adapter.totals().passes).toBe(1);
  });

  it('createAssembler returns a configured engine', () => {
    const assembler = createAssembler({ maxTokens: 10 });
    expect(assembler).toBeInstanceOf(ContextAssembler);
    expect(assembler.assemble({ parts: [systemPart('a')] }).stats.parts).toBe(1);
  });

  it('ContextAssemblyStore supports CRUD, filters and JSON round-trip', () => {
    const store = new ContextAssemblyStore();
    store.add({ id: 'a', role: 'user', content: 'Hi' });
    store.add({ id: 'b', role: 'tool', content: 'ok', tags: ['tool-x'] });
    store.add({ id: 'c', role: 'memory', content: 'remember this', source: 'mem' });
    expect(store.size).toBe(3);
    expect(store.get('a')?.content).toBe('Hi');
    expect(store.has('b')).toBe(true);
    expect(store.delete('b')).toBe(true);
    expect(store.size).toBe(2);
    expect(store.byRole('user')).toHaveLength(1);
    expect(store.bySource('mem')).toHaveLength(1);
    expect(store.findByTags(['tool-x'])).toHaveLength(0);
    expect(store.filter({ roles: ['memory'] })[0].id).toBe('c');

    const updated = store.update('a', { content: 'Hello' });
    expect(updated?.content).toBe('Hello');
    expect(store.get('a')?.tokens).toBe(2);

    const restored = ContextAssemblyStore.fromJSON(store.toJSON());
    expect(restored.size).toBe(2);
    expect(restored.get('a')?.content).toBe('Hello');
    expect(store.stats().parts).toBe(2);
  });

  it('AssemblyLifecycle prunes parts older than the TTL', () => {
    const store = new ContextAssemblyStore([
      { id: 'old', role: 'user', content: 'old', metadata: { createdAt: 1 } },
      { id: 'fresh', role: 'user', content: 'fresh', metadata: { createdAt: 99_000 } },
    ]);
    const lifecycle = new AssemblyLifecycle(store, {
      ttlMs: 1000,
      now: () => 100_000,
      autoStart: false,
    });
    const pruned = lifecycle.prune();
    expect(pruned).toEqual(['old']);
    expect(store.size).toBe(1);
    expect(lifecycle.stats().pruned).toBe(1);
  });

  it('ContextPipeline.run persists, assembles and observes in one call', () => {
    const pipeline = new ContextPipeline({ assemblyConfig: { maxTokens: 0 } });
    const result = pipeline.run([
      { id: 's', role: 'system', content: 'Be concise.' },
      { id: 'u', role: 'user', content: 'Summarise.' },
    ]);
    expect(result.parts).toHaveLength(2);
    expect(result.prompt).toContain('<|system|>');
    expect(pipeline.size).toBe(2);
    expect(pipeline.store.has('s')).toBe(true);
    expect(pipeline.index.has('u')).toBe(true);
    expect(pipeline.lifecycle.stats().assembled).toBe(1);
    expect(pipeline.lastResult).toBe(result);
    expect(pipeline.storeStats().parts).toBe(2);
    pipeline.lifecycle.stop();
  });
});