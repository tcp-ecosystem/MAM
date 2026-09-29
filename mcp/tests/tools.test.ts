import { describe, it, expect } from 'vitest';
import { SchemaConverter } from '../src/tools/retrieval.js';
import { ToolsRegistry, DuplicateKeyError } from '../src/tools/store.js';
import { ToolsIndex, toToolsIndexEntry } from '../src/tools/index.js';
import { ToolsLifecycle } from '../src/tools/lifecycle.js';
import {
  createTool,
  createResource,
  createPrompt,
  createJsonSchema,
  isMcpTool,
} from '../src/tools/types.js';

describe('tools', () => {
  it('SchemaConverter.toolFromDefinition builds a JSON Schema inputSchema', () => {
    const converter = new SchemaConverter();
    const tool = converter.toolFromDefinition('echo', 'Echo text back', [
      { name: 'message', type: 'string', required: true, description: 'text to echo' },
      { name: 'times', type: 'number', default: 1 },
    ]);
    expect(tool.name).toBe('echo');
    expect(tool.description).toBe('Echo text back');
    expect(tool.inputSchema.type).toBe('object');
    expect(tool.inputSchema.required).toEqual(['message']);
    expect(tool.inputSchema.properties?.message).toMatchObject({ type: 'string' });
  });

  it('SchemaConverter.validateArgs reports required, type and enum issues', () => {
    const converter = new SchemaConverter();
    const tool = converter.toolFromDefinition('echo', 'Echo', [
      { name: 'message', type: 'string', required: true },
      { name: 'mode', type: 'string', enum: ['fast', 'slow'] },
    ]);

    const missing = converter.validateArgs(tool.inputSchema, {});
    expect(missing.some((issue) => issue.code === 'missing')).toBe(true);

    const wrongType = converter.validateArgs(tool.inputSchema, { message: 42 });
    expect(wrongType.some((issue) => issue.code === 'type')).toBe(true);

    const badEnum = converter.validateArgs(tool.inputSchema, { message: 'hi', mode: 'medium' });
    expect(badEnum.some((issue) => issue.code === 'enum')).toBe(true);

    const ok = converter.validateArgs(tool.inputSchema, { message: 'hi', mode: 'fast' });
    expect(ok).toHaveLength(0);
    expect(converter.accepts(tool.inputSchema, { message: 'hi', mode: 'fast' })).toBe(true);
  });

  it('SchemaConverter resourceFromUri and promptFromName build records', () => {
    const converter = new SchemaConverter();
    const resource = converter.resourceFromUri('file:///a.txt', 'A file', {
      description: 'notes',
      mimeType: 'text/plain',
    });
    expect(resource.uri).toBe('file:///a.txt');
    expect(resource.mimeType).toBe('text/plain');

    const prompt = converter.promptFromName('greet', {
      argumentDefinitions: [{ name: 'name', required: true }],
    });
    expect(prompt.name).toBe('greet');
    expect(prompt.arguments?.[0].name).toBe('name');
    expect(prompt.arguments?.[0].required).toBe(true);
  });

  it('ToolsRegistry registers tools, lists them and looks them up', () => {
    const registry = new ToolsRegistry();
    registry.registerTool(createTool('t1', { type: 'object' }, 'first tool'));
    registry.registerTool(createTool('t2', createJsonSchema({ type: 'object' })));

    expect(registry.size()).toBe(2);
    expect(registry.listTools()).toHaveLength(2);
    expect(registry.getTool('t1')?.name).toBe('t1');
    expect(registry.hasTool('t1')).toBe(true);
    expect(registry.get('tool', 't2')?.name).toBe('t2');
    expect(isMcpTool(registry.getTool('t1'))).toBe(true);

    expect(() => registry.registerTool(createTool('t1', { type: 'object' }))).toThrow(
      DuplicateKeyError,
    );
  });

  it('ToolsRegistry registers resources and prompts', () => {
    const registry = new ToolsRegistry();
    registry.registerResource(createResource('file:///a.txt', 'A file'));
    registry.registerPrompt(createPrompt('greet'));

    expect(registry.size()).toBe(2);
    expect(registry.getResource('file:///a.txt')?.name).toBe('A file');
    expect(registry.getPrompt('greet')).toBeDefined();
    expect(registry.listPrompts()).toHaveLength(1);
    expect(registry.listResources()).toHaveLength(1);
    expect(registry.stats().byKind).toEqual({ tool: 0, resource: 1, prompt: 1 });
  });

  it('ToolsIndex finds entries by kind', () => {
    const index = new ToolsIndex();
    index.indexEntry(toToolsIndexEntry('tool', 'echo'));
    index.indexEntry(toToolsIndexEntry('resource', 'A file', 'file:///a.txt'));
    index.indexEntry(toToolsIndexEntry('prompt', 'greet'));

    expect(index.size()).toBe(3);
    expect(index.findByKind('tool')).toHaveLength(1);
    expect(index.findByKind('resource')).toHaveLength(1);
    expect(index.findByKind('prompt')).toHaveLength(1);
    expect(index.findToolByName('echo')?.kind).toBe('tool');
    expect(index.findResourceByUri('file:///a.txt')).toBeDefined();
    expect(index.findPromptByName('greet')?.kind).toBe('prompt');
  });

  it('ToolsLifecycle registers, validates and prunes in lock-step', () => {
    const converter = new SchemaConverter();
    const lifecycle = new ToolsLifecycle({ maxTools: 0 });
    lifecycle.registerTool(
      converter.toolFromDefinition('a', 'A', [{ name: 'x', type: 'string', required: true }]),
    );
    lifecycle.registerTool(converter.toolFromDefinition('b', 'B', []));
    lifecycle.registerTool(converter.toolFromDefinition('c', 'C', []));

    expect(lifecycle.size()).toBe(3);
    expect(lifecycle.index.size()).toBe(3);

    const removed = lifecycle.prune(['a']);
    expect(removed).toBe(1);
    expect(lifecycle.size()).toBe(2);
    expect(lifecycle.index.size()).toBe(2);

    const toolB = lifecycle.getTool('b');
    const result = lifecycle.validateArgs(toolB!.inputSchema, {});
    expect(result.ok).toBe(true);
    expect(lifecycle.stats().validated).toBe(1);

    expect(lifecycle.start()).toBe(lifecycle);
    expect(lifecycle.running).toBe(true);
    expect(lifecycle.stop()).toBe(lifecycle);
    expect(lifecycle.running).toBe(false);
  });
});