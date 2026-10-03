/**
 * Memory Plugin - Lifecycle Hooks
 *
 * Keeps a module's persisted memory in step with the `Memory` section across
 * the parse/execute cycle, and can write memory back into the section.
 */

import type { MAMPlugin, ExecutionResult, PluginError } from '@mam/plugin-api';
import type { MAMModule } from '@mam/ast';
import { MemoryStore } from './store.js';
import { parseMemoryContent, mergeMemory, deepMerge, formatMemory, type MemoryDiff, type MemoryParseOptions } from './parser.js';
import { findMemorySection } from './manifest.js';

export interface MemoryHookOptions {
  /** Frontmatter field holding the module id. Default `id`. */
  moduleIdField?: string;
  /** Parser options used when reading the Memory section. */
  parse?: MemoryParseOptions;
  /** Records hook activity for diagnostics. */
  tracker?: MemoryHookTracker;
  /**
   * Called when a hook fails.
   *
   * Hooks used to let a persistence error escape, which aborted parsing of an
   * otherwise valid module. Without a handler the error is swallowed and the
   * module still parses, matching the previous behaviour.
   */
  onError?: (error: Error, context: { hook: string; moduleId: string }) => void;
  /**
   * Persist only keys whose value actually changed.
   *
   * On by default: a parse that re-runs on every save would otherwise rewrite
   * the file each time, bumping the mtime and invalidating any cache keyed on
   * it, even when nothing changed.
   */
  diffWrites?: boolean;
}

export interface MemoryHookStats {
  parses: number;
  syncs: number;
  writes: number;
  injections: number;
  errors: number;
  lastWriteAt?: Date;
  lastErrorAt?: Date;
}

const DEFAULT_MODULE_ID_FIELD = 'id';

/** Reads a module's id from frontmatter, falling back to `unknown`. */
export function getModuleId(module: MAMModule, field: string = DEFAULT_MODULE_ID_FIELD): string {
  const frontmatter = module.frontmatter as unknown as Record<string, unknown> | undefined;
  const value = frontmatter?.[field];
  return typeof value === 'string' && value.length > 0 ? value : 'unknown';
}

/** Tracks hook activity for diagnostics. */
export class MemoryHookTracker {
  private stats: MemoryHookStats = {
    parses: 0,
    syncs: 0,
    writes: 0,
    injections: 0,
    errors: 0,
  };

  recordParse(): void {
    this.stats.parses++;
  }

  recordSync(): void {
    this.stats.syncs++;
  }

  recordWrite(): void {
    this.stats.writes++;
    this.stats.lastWriteAt = new Date();
  }

  recordInjection(): void {
    this.stats.injections++;
  }

  recordError(): void {
    this.stats.errors++;
    this.stats.lastErrorAt = new Date();
  }

  getStats(): Readonly<MemoryHookStats> {
    return { ...this.stats };
  }

  reset(): void {
    this.stats = { parses: 0, syncs: 0, writes: 0, injections: 0, errors: 0 };
  }
}

/**
 * Runs `fn`, swallowing and reporting a failure instead of propagating it.
 *
 * Keeps one module's persistence problem from aborting a parse of the whole
 * document, which is what an unguarded throw would do.
 */
async function guard<T>(
  options: MemoryHookOptions | undefined,
  hook: string,
  moduleId: string,
  fn: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (options?.onError) {
      options.onError(error as Error, { hook, moduleId });
    }
    return fallback;
  }
}

export interface AfterParseHook {
  (module: MAMModule): Promise<MAMModule>;
  /** The diff the hook wrote, available after the last call. */
  readonly lastDiff?: MemoryDiff;
}

/**
 * Merges the Memory section into the store, then persists the module.
 *
 * Returns the module unchanged when there is no Memory section, so a module
 * that never declares memory costs nothing.
 */
export function createAfterParseHook(
  store: MemoryStore,
  options?: MemoryHookOptions,
): AfterParseHook {
  const hook = async (module: MAMModule): Promise<MAMModule> => {
    const moduleId = getModuleId(module, options?.moduleIdField);
    const section = findMemorySection(module);
    if (!section) return module;

    options?.tracker?.recordParse();
    return guard(options, 'afterParse', moduleId, async () => {
      const { flat } = parseMemoryContent(section.content, options?.parse);
      const existing = await store.loadFile(moduleId);
      const merged = mergeMemory(existing, flat);

      const diff = options?.diffWrites === false
        ? { added: Object.keys(flat), removed: [], changed: Object.keys(flat), unchanged: [] }
        : diffAgainst(existing, merged);

      if (options?.diffWrites !== false && diff.added.length === 0 && diff.changed.length === 0) {
        // Nothing new to persist; keep the in-memory copy current and stop.
        store.setMany(moduleId, flat);
        return module;
      }

      store.setMany(moduleId, merged);
      await store.saveFile(moduleId, merged);
      options?.tracker?.recordWrite();
      (hook as { lastDiff?: MemoryDiff }).lastDiff = diff;
      return module;
    }, module);
  };
  return Object.assign(hook, { lastDiff: undefined as MemoryDiff | undefined });
}

function diffAgainst(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): MemoryDiff {
  const diff: MemoryDiff = { added: [], removed: [], changed: [], unchanged: [] };
  for (const [key, value] of Object.entries(after)) {
    if (!(key in before)) diff.added.push(key);
    else if (!Object.is(before[key], value)) diff.changed.push(key);
    else diff.unchanged.push(key);
  }
  for (const key of Object.keys(before)) {
    if (!(key in after)) diff.removed.push(key);
  }
  return diff;
}

/**
 * Loads persisted memory into the store before execution.
 *
 * File wins over memory: it is the durable copy, and a stale in-memory value
 * from an earlier process is what needs discarding.
 */
export function createBeforeExecutionHook(
  store: MemoryStore,
  options?: MemoryHookOptions,
) {
  return async (module: MAMModule): Promise<MAMModule> => {
    const moduleId = getModuleId(module, options?.moduleIdField);
    options?.tracker?.recordSync();
    return guard(options, 'beforeExecution', moduleId, async () => {
      await store.syncFromFile(moduleId);
      return module;
    }, module);
  };
}

export interface InjectOptions {
  /** Only inject keys carrying this prefix. */
  prefix?: string;
  /** Replace the Memory section text. Off leaves the section untouched. */
  rewrite?: boolean;
  /** Parser options used when re-rendering the section. */
  parse?: MemoryParseOptions;
  /** Records hook activity for diagnostics. */
  tracker?: MemoryHookTracker;
}

/**
 * Writes store values back into a module's Memory section.
 *
 * The reverse of `createAfterParseHook`, for the case where a later stage
 * computed state that should become visible in the source document.
 */
export function createMemoryInjector(
  store: MemoryStore,
  options?: InjectOptions & { moduleIdField?: string },
) {
  return async (module: MAMModule): Promise<MAMModule> => {
    const moduleId = getModuleId(module, options?.moduleIdField);
    const section = findMemorySection(module);
    if (!section) return module;

    return guard(options as MemoryHookOptions, 'inject', moduleId, async () => {
      let data = store.entries(moduleId);
      if (options?.prefix) {
        const prefix = options.prefix;
        data = Object.fromEntries(
          Object.entries(data)
            .filter(([key]) => key.startsWith(prefix))
            .map(([key, value]) => [key.slice(prefix.length), value]),
        );
      }
      if (Object.keys(data).length === 0) return module;

      if (options?.rewrite) {
        // A section carries its text on a content node, not on itself, so the
        // node is replaced rather than a non-existent `value` field assigned.
        (section as { content?: unknown[] }).content = [
          { type: 'Paragraph', value: formatMemory(data, { bullets: true, includeJsonBlock: true }) },
        ];
      }
      options?.tracker?.recordInjection();
      return module;
    }, module);
  };
}

/**
 * Flushes an execution result's `memory` record back to disk.
 *
 * An `ExecutionResult` carries no module id, so one must be supplied; without
 * it there is nothing to attribute the memory to and the hook is a no-op.
 */
export function createAfterExecutionHook(
  store: MemoryStore,
  options?: MemoryHookOptions & { moduleId?: string; tracker?: MemoryHookTracker },
) {
  return async (result: ExecutionResult): Promise<ExecutionResult> => {
    const moduleId = options?.moduleId;
    if (!moduleId) return result;

    return guard(options, 'afterExecution', moduleId, async () => {
      if (result.memory && Object.keys(result.memory).length > 0) {
        store.setMany(moduleId, result.memory);
      }
      await store.persistToFile(moduleId);
      options?.tracker?.recordWrite();
      return result;
    }, result);
  };
}

export type MemoryHookName = 'afterParse' | 'beforeExecution' | 'afterExecution' | 'onError';

/** Builds a subset of the memory hooks, defaulting to parse and execute. */
export function createMemoryHooks(
  store: MemoryStore,
  options?: MemoryHookOptions & { hooks?: MemoryHookName[]; moduleId?: string; tracker?: MemoryHookTracker },
): NonNullable<MAMPlugin['hooks']> {
  const enabled = new Set<MemoryHookName>(options?.hooks ?? ['afterParse', 'beforeExecution']);
  const hooks: NonNullable<MAMPlugin['hooks']> = {};

  if (enabled.has('afterParse')) hooks.afterParse = createAfterParseHook(store, options);
  if (enabled.has('beforeExecution')) hooks.beforeExecution = createBeforeExecutionHook(store, options);
  if (enabled.has('afterExecution')) hooks.afterExecution = createAfterExecutionHook(store, options);
  if (enabled.has('onError')) {
    hooks.onError = (error: PluginError): void => {
      options?.tracker?.recordError();
      options?.onError?.(error.error, {
        hook: 'onError',
        moduleId: error.module ?? options?.moduleId ?? 'unknown',
      });
    };
  }
  return hooks;
}

/** Deep-merges two memory records, preferring the incoming values. */
export function mergeMemoryDeep(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  return deepMerge(existing, incoming);
}
