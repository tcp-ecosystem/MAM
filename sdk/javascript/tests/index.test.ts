import { describe, it, expect } from 'vitest';
import {
  parseMAM,
  MAMModule,
  fromMarkdown,
  validate,
  execute,
  createExecutionHistory,
  loadSDKConfig,
  saveSDKConfig,
  validateSDKConfig,
  mergeSDKConfigs,
  resolveSDKConfigPath,
  ResultCache,
  createResultCache,
  hashCacheKey,
  formatModuleSummary,
  formatValidationReport,
  buildDepGraph,
  topoSortDepGraph,
  getDepNodeNames,
  listStarterKinds,
  getStarterTemplate,
  renderStarter,
  newModuleStarter,
  validateStarterName,
} from '../mam/index.js';

describe('barrel exports', () => {
  it('exports parser', () => {
    expect(parseMAM).toBeTypeOf('function');
    expect(parseMAM('## Purpose\n\nHi.\n').ast.sections).toHaveLength(1);
  });

  it('exports module builder', () => {
    expect(MAMModule).toBeTypeOf('function');
    expect(fromMarkdown).toBeTypeOf('function');
    const mod = fromMarkdown('---\nname: T\nversion: 2.0.0\n---\n\n## Purpose\n\nHi.\n');
    expect(mod.getName()).toBe('T');
  });

  it('exports validator', () => {
    expect(validate).toBeTypeOf('function');
  });

  it('exports runtime', () => {
    expect(execute).toBeTypeOf('function');
    expect(createExecutionHistory).toBeTypeOf('function');
  });

  it('exports config', async () => {
    expect(loadSDKConfig).toBeTypeOf('function');
    expect(saveSDKConfig).toBeTypeOf('function');
    expect(validateSDKConfig).toBeTypeOf('function');
    expect(mergeSDKConfigs).toBeTypeOf('function');
    expect(resolveSDKConfigPath).toBeTypeOf('function');
    expect(validateSDKConfig({ version: '', workDir: '', target: '', verbose: false }).length).toBeGreaterThan(0);
  });

  it('exports cache', () => {
    expect(ResultCache).toBeTypeOf('function');
    const cache = createResultCache();
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
    expect(hashCacheKey(['a'])).toHaveLength(64);
  });

  it('exports format', () => {
    expect(formatModuleSummary).toBeTypeOf('function');
    expect(formatValidationReport).toBeTypeOf('function');
  });

  it('exports graph', () => {
    expect(buildDepGraph).toBeTypeOf('function');
    expect(topoSortDepGraph).toBeTypeOf('function');
    const graph = buildDepGraph(parseMAM('## Purpose\n\nHi.\n').ast);
    expect(getDepNodeNames(graph)).toContain('Purpose');
  });

  it('exports template', () => {
    expect(listStarterKinds).toBeTypeOf('function');
    expect(getStarterTemplate).toBeTypeOf('function');
    expect(renderStarter).toBeTypeOf('function');
    expect(newModuleStarter).toBeTypeOf('function');
    expect(validateStarterName).toBeTypeOf('function');
    expect(newModuleStarter('Demo', 'module')).toContain('## Purpose');
  });
});