/**
 * MAM Memory Plugin
 *
 * Provides persistent memory/state management for MAM modules.
 */

import type { MAMPlugin } from '@mam/plugin-api';
import { MEMORY_MANIFEST, memorySection } from './manifest.js';
import { memoryRule } from './rule.js';
import { MemoryStore } from './store.js';
import { createMemoryHooks } from './hooks.js';

export { MEMORY_MANIFEST, memorySection, getMemorySection } from './manifest.js';
export { parseMemoryContent, mergeMemory, filterMemoryByPrefix } from './parser.js';
export type { MemoryEntry, ParsedMemory } from './parser.js';
export { MemoryStore, createMemoryStore, MEMORY_DIR } from './store.js';
export { memoryRule, createMemoryRule } from './rule.js';
export { createMemoryHooks, createAfterParseHook, createBeforeExecutionHook } from './hooks.js';

const memoryStore = new MemoryStore();
const memoryPlugin: MAMPlugin = {
  manifest: MEMORY_MANIFEST,
  sections: [memorySection],
  rules: [memoryRule],
  hooks: createMemoryHooks(memoryStore),
};

export default memoryPlugin;
