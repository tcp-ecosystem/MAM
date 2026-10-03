/**
 * MAM Memory Plugin
 *
 * Provides persistent memory/state management for MAM modules: a namespaced
 * key-value store with atomic JSON persistence, a parser that turns a
 * `Memory` section into flat addressable state, a rule family to validate
 * it, and hooks that keep the two in step across a parse/execute cycle.
 */

import type { MAMPlugin, ValidationRule } from '@mam/plugin-api';
import { MEMORY_MANIFEST, memorySection, MEMORY_SECTION_NAME, MEMORY_LIMITS, MEMORY_EXAMPLE } from './manifest.js';
import { MEMORY_RULES, memoryRule, type MemorySeverity } from './rule.js';
import { MemoryStore, createMemoryStore, MEMORY_DIR, type MemoryStoreOptions } from './store.js';
import { createMemoryHooks, MemoryHookTracker, type MemoryHookOptions, type MemoryHookName } from './hooks.js';

// ─── Manifest ──────────────────────────────────────────────────────
export {
  MEMORY_MANIFEST,
  memorySection,
  getMemorySection,
  createMemoryManifest,
  validateMemoryContent,
  findMemorySection,
  hasMemorySection,
  isValidMemoryKey,
  MEMORY_SECTION_NAME,
  MEMORY_CONTENT_TYPES,
  MEMORY_LIMITS,
  MEMORY_EXAMPLE,
  MEMORY_KEY_PATTERN,
  RESERVED_MEMORY_PREFIX,
} from './manifest.js';

// ─── Parser ────────────────────────────────────────────────────────
export {
  parseMemoryContent,
  parseMemoryValue,
  isCoercible,
  mergeMemory,
  deepMerge,
  diffMemory,
  flattenMemory,
  unflattenMemory,
  getPath,
  setPath,
  deletePath,
  splitPath,
  pickMemory,
  groupByPrefix,
  filterMemoryByPrefix,
  namespaceMemory,
  formatMemory,
} from './parser.js';
export type {
  MemoryEntry,
  MemoryEntrySource,
  MemoryConflict,
  MemoryParseError,
  ParsedMemory,
  MemoryParseOptions,
  MemoryDiff,
  FormatMemoryOptions,
} from './parser.js';

// ─── Store ─────────────────────────────────────────────────────────
export {
  MemoryStore,
  createMemoryStore,
  MemoryLimitError,
  MEMORY_DIR,
  MEMORY_FILE_VERSION,
} from './store.js';
export type {
  MemoryStoreOptions,
  MemorySetOptions,
  MemoryChange,
  MemoryChangeType,
  MemoryChangeListener,
  MemoryFileEnvelope,
  MemoryStats,
} from './store.js';

// ─── Rules ─────────────────────────────────────────────────────────
export {
  MEMORY_RULES,
  memoryRule,
  createMemoryRule,
  createMemoryRules,
  configureMemoryRules,
  resetMemoryRuleConfig,
  runMemoryRules,
  formatRuleSummary,
  readMemory,
  hasMemorySection as ruleHasMemorySection,
  duplicateKeysRule,
  emptyValueRule,
  keyFormatRule,
  keyLengthRule,
  valueLengthRule,
  entryCountRule,
  reservedPrefixRule,
  nestingDepthRule,
  requiredKeysRule,
  MEMORY_KEY_PATTERN as RULE_MEMORY_KEY_PATTERN,
} from './rule.js';
export type { MemoryRuleOptions, MemorySeverity } from './rule.js';

// ─── Hooks ─────────────────────────────────────────────────────────
export {
  createMemoryHooks,
  createAfterParseHook,
  createBeforeExecutionHook,
  createAfterExecutionHook,
  createMemoryInjector,
  getModuleId,
  mergeMemoryDeep as mergeMemoryDeepHooks,
  MemoryHookTracker,
} from './hooks.js';
export type {
  MemoryHookOptions,
  MemoryHookName,
  MemoryHookStats,
  InjectOptions,
  AfterParseHook,
} from './hooks.js';

// ─── Plugin Factory ────────────────────────────────────────────────

import { MemoryStore as Store } from './store.js';
import { memorySection as section } from './manifest.js';
import { createMemoryHooks as buildHooks } from './hooks.js';

export const MEMORY_PLUGIN_VERSION = '0.1.0';

export interface MemoryPluginOptions {
  /** Reuse an existing store, or leave unset to create one. */
  store?: MemoryStore;
  /** Options for the store created when `store` is unset. */
  storeOptions?: MemoryStoreOptions;
  /** Which hooks to install. Defaults to afterParse and beforeExecution. */
  hooks?: MemoryHookName[];
  /** Hook behaviour and error handling. */
  hookOptions?: MemoryHookOptions;
  /** Install the full rule family instead of just the composite rule. */
  allRules?: boolean;
  /** Re-level every installed rule. */
  severity?: MemorySeverity;
  /** Manifest fields to override. */
  manifest?: Partial<typeof MEMORY_MANIFEST>;
}

/** Builds a memory plugin with its own store and hook set. */
export function createMemoryPlugin(options: MemoryPluginOptions = {}): MAMPlugin {
  const store = options.store ?? createMemoryStore(options.storeOptions);
  const rules: ValidationRule[] = options.allRules
    ? MEMORY_RULES.map((rule) =>
        options.severity ? { ...rule, severity: options.severity } : { ...rule },
      )
    : [options.severity ? { ...memoryRule, severity: options.severity } : memoryRule];

  return {
    manifest: { ...MEMORY_MANIFEST, ...options.manifest },
    sections: [section],
    rules,
    hooks: buildHooks(store, {
      ...options.hookOptions,
      hooks: options.hooks,
      tracker: options.hookOptions?.tracker,
    }),
  };
}

/** The store backing the default export, exposed so hosts can seed state. */
export const memoryStore = new Store();

/** The default singleton plugin, for callers that just want the plugin. */
export const memoryPlugin: MAMPlugin = {
  manifest: MEMORY_MANIFEST,
  sections: [section],
  rules: [memoryRule],
  hooks: buildHooks(memoryStore),
};

/** Returns the default plugin's store. */
export function getMemoryStore(): MemoryStore {
  return memoryStore;
}

/** Returns a fresh tracker for observing hook activity. */
export function createMemoryHookTracker(): MemoryHookTracker {
  return new MemoryHookTracker();
}

export interface MemoryApi {
  version: string;
  store: MemoryStore;
  sectionName: string;
  rules: ValidationRule[];
  limits: typeof MEMORY_LIMITS;
  example: string;
  /** Releases in-memory state. Persisted files are left alone. */
  dispose(): void;
}

/**
 * Bundles the store, rules and limits behind one object.
 *
 * For hosts that want memory state without the full plugin wiring, such as a
 * test fixture or a CLI inspecting a module's memory.
 */
export function createMemoryApi(options: { store?: MemoryStore; storeOptions?: MemoryStoreOptions } = {}): MemoryApi {
  const store = options.store ?? createMemoryStore(options.storeOptions);
  return {
    version: MEMORY_PLUGIN_VERSION,
    store,
    sectionName: MEMORY_SECTION_NAME,
    rules: [...MEMORY_RULES],
    limits: { ...MEMORY_LIMITS },
    example: MEMORY_EXAMPLE,
    dispose(): void {
      store.clear();
    },
  };
}

/** One-line summary of the plugin's surface, for diagnostics. */
export function describeMemoryPlugin(): string {
  return `MAM Memory Plugin v${MEMORY_PLUGIN_VERSION} — section "${MEMORY_SECTION_NAME}", ` +
    `${MEMORY_RULES.length} rules, store at ${MEMORY_DIR}`;
}

export default memoryPlugin;
