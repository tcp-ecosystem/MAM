/**
 * MAM Plugin API
 *
 * Main exports for the MAM plugin system.
 */

import { HookManager } from './hooks.js';
import { PluginRegistry } from './registry.js';
import { PluginLifecycleManager } from './lifecycle.js';
import { PluginContextProvider } from './context.js';
import { PluginEventBus } from './events.js';
import { isMAMPlugin, ALL_HOOK_NAMES, ALL_PLUGIN_EVENTS, ALL_PLUGIN_CATEGORIES, type MAMPlugin } from './types.js';

// ─── Types ──────────────────────────────────────────────────────────
export {
  type MAMPlugin,
  type PluginManifest,
  type PluginCategory,
  type SectionDefinition,
  type SectionExample,
  type ContentType,
  type ValidationRule,
  type ValidationResult,
  type ValidationFix,
  type ValidationFixReplacement,
  type PluginHooks,
  type PluginError,
  type ExportOutput,
  type PluginConfig,
  type RuntimeContext,
  type RuntimeCapability,
  type ExecutionContext,
  type ExecutionResult,
  type ExecutionArtifact,
  type Exporter,
  type ExportOptions,
  type ExportOptionDefinition,
  type Renderer,
  type RenderTarget,
  type RenderOptions,
  type Transformer,
  type TransformContext,
  type PluginMiddleware,
  type MiddlewarePhase,
  type HookName,
  type HookRegistration,
  type PluginRegistryEntry,
  type PluginRegistryConfig,
  type PluginEvent,
  type PluginEventData,
  type DeepPartial,
  type PluginMap,
  type RegistryMap,
  type HookMap,
  type EventMap,
  type EventSubscription,
  ALL_HOOK_NAMES,
  ALL_PLUGIN_EVENTS,
  ALL_PLUGIN_CATEGORIES,
  isMAMPlugin,
  isValidationResult,
  isExecutionResult,
  isRuntimeContext,
  isRenderer,
  isExporter,
  isTransformer,
  isPluginManifest,
  isHookName,
  isPluginEvent,
  isPluginCategory,
  isSectionDefinition,
  isValidationRule,
  isPluginMiddleware,
} from './types.js';

// ─── Hook Manager ───────────────────────────────────────────────────
export {
  HookManager,
  type HookExecutionResult,
  type HookManagerStats,
} from './hooks.js';

// ─── Plugin Registry ────────────────────────────────────────────────
export {
  PluginRegistry,
  type RegistryLoadResult,
  type RegistryStats,
} from './registry.js';

// ─── Plugin Loader ──────────────────────────────────────────────────
export {
  loadPluginFromPath,
  discoverPluginPaths,
  discoverPluginsInNodeModules,
  validateManifest,
  resolvePluginPath,
  getPluginNameFromPath,
  getPluginScope,
  compareSemver,
  satisfiesSemver,
  readPluginManifest,
  formatManifestSummary,
  getManifestDependencyNames,
  findRootManifests,
  sortManifestsForLoad,
  type LoadPluginResult,
  type ManifestValidationResult,
  type PluginLoadContext,
} from './loader.js';

// ─── Lifecycle Manager ──────────────────────────────────────────────
export {
  PluginLifecycleManager,
  type PluginState,
  type PluginLifecycleEntry,
  type LifecycleEvent,
} from './lifecycle.js';

// ─── Context Provider ───────────────────────────────────────────────
export {
  PluginContextProvider,
  type PluginContextOptions,
  type ExecutionRecord,
  type ContextMetrics,
  type ResourceSnapshot,
} from './context.js';

// ─── Event Bus ──────────────────────────────────────────────────────
export {
  PluginEventBus,
  type EventHandler,
  type EventStats,
  type EmittedEvent,
} from './events.js';

// ─── Validator ──────────────────────────────────────────────────────
export {
  validatePluginManifest,
  validatePluginIntegrity,
  validatePluginCompatibility,
  getPluginStats,
  getCapabilityMatrix,
  listCapabilities,
  findDuplicateNames,
  findUnknownManifestFields,
  summarizeIntegrity,
  compareIntegrity,
  formatIntegrityReport,
  type PluginIntegrityReport,
  type PluginIntegrityStats,
  type CompatibilityResult,
} from './validator.js';

// ─── Barrel Utilities ───────────────────────────────────────────────

/** Version of this package's public API surface. */
export const PLUGIN_API_VERSION = '0.1.0';

/** The managers returned by {@link createPluginApi}. */
export interface PluginApi {
  version: string;
  events: PluginEventBus;
  hooks: HookManager;
  registry: PluginRegistry;
  lifecycle: PluginLifecycleManager;
  context: PluginContextProvider;
  /** Releases everything the facade owns. Safe to call more than once. */
  dispose(): void;
}

/**
 * Assembles the five managers into one wired-up instance.
 *
 * The registry shares this facade's hook manager, so hooks registered through
 * the facade are the same instances the registry registers against. Anything
 * can still be built by hand when the wiring needs to differ.
 */
export function createPluginApi(options?: {
  searchPaths?: string[];
  context?: ConstructorParameters<typeof PluginContextProvider>[0];
  maxLogSize?: number;
}): PluginApi {
  const events = new PluginEventBus({ maxLogSize: options?.maxLogSize });
  const hooks = new HookManager();
  const registry = new PluginRegistry(hooks, { searchPaths: options?.searchPaths ?? [] });
  const lifecycle = new PluginLifecycleManager();
  const context = new PluginContextProvider(options?.context);

  let disposed = false;
  return {
    version: PLUGIN_API_VERSION,
    events,
    hooks,
    registry,
    lifecycle,
    context,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      registry.clear();
      lifecycle.clear();
      context.destroy();
      events.clear();
      hooks.clear();
    },
  };
}

/**
 * Orders two API version strings: negative if `a < b`, positive if `a > b`.
 *
 * Returns NaN for unparsable input, matching the semver helpers in the loader.
 */
export function compareApiVersions(a: string, b: string): number {
  const parse = (v: string): number[] | null => {
    const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return NaN;
  for (let i = 0; i < 3; i++) {
    if (left[i]! !== right[i]!) return left[i]! - right[i]!;
  }
  return 0;
}

/** Returns true when `version` is at least the minimum required `required`. */
export function isPluginApiCompatible(version: string, required: string): boolean {
  const cmp = compareApiVersions(version, required);
  return !Number.isNaN(cmp) && cmp >= 0;
}

/**
 * Throws unless `value` is a plugin.
 *
 * Preferred over a bare `isMAMPlugin` check at a boundary, because the error
 * names what was received instead of letting a missing field fail later at an
 * unrelated call site.
 */
export function assertMAMPlugin(value: unknown): asserts value is MAMPlugin {
  if (!isMAMPlugin(value)) {
    throw new TypeError('Expected a MAMPlugin, received ' + describeValue(value));
  }
}

function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/** Returns a one-line summary of the API surface, useful in diagnostics. */
export function describePluginApi(): string {
  return `MAM Plugin API v${PLUGIN_API_VERSION} — ${ALL_PLUGIN_CATEGORIES.length} categories, ` +
    `${ALL_PLUGIN_EVENTS.length} events, ${ALL_HOOK_NAMES.length} hooks`;
}
