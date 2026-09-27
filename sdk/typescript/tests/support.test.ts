import { describe, expect, it } from 'vitest';
import { createResultCache, defaultSDKConfig, formatModuleSummary, buildDepGraph, getStarterTemplate, newModuleStarter, validate, parseString, PluginRegistry, functionPlugin, executeBlock, parse } from '../mam/index.js';

const module = parse('---\nschema_version: "1"\nname: Support\nversion: "1"\n---\n\n## Metadata\n\nMeta.\n\n## Purpose\n\nPurpose.\n');

describe('support modules', () => {
  it('returns valid default config', () => {
    expect(defaultSDKConfig().target).toBe('typescript');
  });

  it('caches values and tracks misses', () => {
    const cache = createResultCache<number>();
    cache.set('answer', 42);
    expect(cache.get('answer')).toBe(42);
    expect(cache.stats().hits).toBe(1);
  });

  it('formats a module summary', () => {
    expect(formatModuleSummary(module)).toContain('Support');
  });

  it('builds a dependency graph', () => {
    expect(buildDepGraph(module).nodes.length).toBeGreaterThan(0);
  });

  it('renders a starter template', () => {
    expect(newModuleStarter('Demo', 'module')).toContain('## Purpose');
  });

  it('lists starter placeholders', () => {
    expect(getStarterTemplate('agent')).toContain('{{name}}');
  });

  it('validates required sections and frontmatter', () => {
    const report = validate(module);
    expect(report.is_valid).toBe(true);
    expect(report.diagnostics).toHaveLength(0);
  });

  it('dispatches plugins in order', async () => {
    const registry = new PluginRegistry();
    const calls: string[] = [];
    registry.register(functionPlugin('first', ['after_parse'], () => { calls.push('first'); }));
    registry.register(functionPlugin('second', ['after_parse'], () => { calls.push('second'); }));
    await registry.fire('after_parse');
    expect(calls).toEqual(['first', 'second']);
  });

  it('executes a JavaScript block', () => {
    const parsed = parseString('---\nname: X\n---\n\n## Purpose\n\n```javascript\nconsole.log("ok")\n```\n');
    const block = parsed.sections[0].content[0];
    if (block.kind !== 'CodeBlock') throw new Error('expected block');
    expect(executeBlock(block).exit_code).toBe(0);
  });

  it('rejects duplicate plugin names', () => {
    const registry = new PluginRegistry();
    registry.register(functionPlugin('duplicate', [], () => undefined));
    expect(() => registry.register(functionPlugin('duplicate', [], () => undefined))).toThrow();
  });
});
