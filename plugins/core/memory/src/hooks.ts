/**
 * Memory Plugin - Lifecycle Hooks
 */

import type { MAMPlugin } from '@mam/plugin-api';
import type { MAMModule } from '@mam/ast';
import { MemoryStore } from './store.js';
import { parseMemoryContent, mergeMemory } from './parser.js';

export function createAfterParseHook(store: MemoryStore) {
  return async (module: MAMModule): Promise<MAMModule> => {
    const memSection = module.sections.find((s) => s.name === 'Memory');
    if (!memSection) return module;

    const moduleId = (module.frontmatter as unknown as Record<string, unknown>)?.['id'] as string || 'unknown';
    const { flat } = parseMemoryContent(memSection.content);

    const existing = await store.loadFile(moduleId);
    const merged = mergeMemory(existing, flat);

    for (const [key, value] of Object.entries(merged)) {
      store.set(moduleId, key, value);
    }

    await store.saveFile(moduleId, merged);
    return module;
  };
}

export function createBeforeExecutionHook(store: MemoryStore) {
  return async (module: MAMModule): Promise<MAMModule> => {
    const moduleId = (module.frontmatter as unknown as Record<string, unknown>)?.['id'] as string || 'unknown';
    await store.syncFromFile(moduleId);
    return module;
  };
}

export function createMemoryHooks(store: MemoryStore): NonNullable<MAMPlugin['hooks']> {
  return {
    afterParse: createAfterParseHook(store),
    beforeExecution: createBeforeExecutionHook(store),
  };
}
