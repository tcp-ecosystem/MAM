# @mam/plugin-api

> The contract every MAM plugin is written against

`@mam/plugin-api` defines the interfaces a plugin implements, the type guards
and helpers a plugin author needs, and the managers a host uses to load and
supervise plugins. It is a contract package: importing it does not change any
behaviour on its own.

## Installation

```bash
pnpm add @mam/plugin-api
```

## Quick start

```typescript
import { HookManager, PluginRegistry } from '@mam/plugin-api';
import type { MAMPlugin } from '@mam/plugin-api';

const myPlugin: MAMPlugin = {
  manifest: {
    name: '@acme/my-plugin',
    version: '0.1.0',
    description: 'What it does',
    author: 'ACME',
    license: 'MIT',
    mamVersion: '>=0.1.0',
    main: './dist/index.js',
  },
  rules: [{
    name: 'my-rule',
    description: 'Check something',
    severity: 'warning',
    check: (module) => [{ valid: true, message: 'ok' }],
  }],
};

const hooks = new HookManager();
const registry = new PluginRegistry(hooks);
await registry.registerPlugin(myPlugin);
```

## The plugin contract

```typescript
interface MAMPlugin {
  manifest: PluginManifest;
  sections?: SectionDefinition[];
  rules?: ValidationRule[];
  renderers?: Renderer[];
  hooks?: PluginHooks;
  contexts?: RuntimeContext[];
  transformers?: Transformer[];
  exporters?: Exporter[];
  middleware?: PluginMiddleware[];
}
```

Only `manifest` is required. See [`validatePluginIntegrity`](/src/validator.ts)
to check a plugin against this shape before shipping it.

### `PluginManifest`

```typescript
interface PluginManifest {
  name: string;             // '@acme/my-plugin'
  version: string;          // semver
  description: string;
  author: string;
  license: string;
  main: string;             // must be a file the package actually ships
  mamVersion?: string;      // e.g. '>=0.1.0'
  keywords?: string[];
  dependencies?: string[];
}
```

> `mamVersion` is checked with `validatePluginCompatibility`, which treats it as
> a **minimum**. A manifest requiring `>=1.0.0` cannot load against a `0.1.0`
> API. Several plugins in this repo shipped exactly that bug.

### Sections, rules, renderers

```typescript
interface SectionDefinition {
  name: string;
  description: string;
  required?: boolean;
  contentTypes: ContentType[];              // 'text' | 'list' | 'code' | 'table' | 'diagram' | 'mixed'
  validator?: (content: ContentNode[]) => ValidationResult[];
  examples?: SectionExample[];
}

interface ValidationRule {
  name: string;
  description: string;
  severity: 'error' | 'warning' | 'info';
  check(module: MAMModule): ValidationResult[];   // synchronous
}

interface Renderer {
  name: string;
  target: RenderTarget;                          // 'html' | 'markdown' | 'json' | 'text' | 'svg' | 'pdf'
  render(content: ContentNode[], options?: RenderOptions): string;
  getStyles?(): string;
  getScripts?(): string[];
}
```

`ValidationRule.check` is **synchronous by contract**. A check that needs I/O —
a subprocess, a network call — belongs in a separate async function you await
yourself. `python` shows both halves: a synchronous rule family for style and
security, plus `checkPythonSyntaxRule` for the parts that need an interpreter.

## Managers

These are the runtime pieces a host drives. Each one is constructed directly;
`createPluginApi` bundles all five against a shared event bus and hook manager.

### `PluginRegistry`

Owns the loaded plugins and the dependency graph between them.

```typescript
const registry = new PluginRegistry(hooks, { searchPaths: ['./plugins'] });

await registry.registerPlugin(plugin);
registry.getPluginNames();                  // sorted
registry.enablePlugin('name');
registry.recordLoad('name');                // increments loadCount

registry.getMissingDependencies();          // declared but not loaded
registry.findDependencyCycles();            // for diagnostics
registry.getLoadOrder();                    // dependencies first
await registry.unloadAll();                // reverse order
```

`enableDependencyResolution` defaults to `true`: loading a plugin whose
dependencies are absent fails, rather than loading something that will fail at
first use. The registry refuses to unload a plugin others still depend on.

### `HookManager`

Priority-ordered hook execution with per-plugin registration and recovery.

```typescript
const manager = new HookManager();
const id = manager.register('beforeParse', plugin, handler, 10); // priority 10

await manager.execute('beforeParse', data);
await manager.executeWithTimeout('beforeParse', data, 5000);  // reports, doesn't throw

manager.reprioritize(id, 100);
manager.getHookCounts();
manager.getPriorityBounds('beforeParse');
```

A handler that throws is recorded in `errors` and the chain continues, so one
bad plugin cannot abort a build. `executeWithTimeout` follows the same rule: a
slow hook degrades the result instead of failing it.

### `PluginEventBus`

Pub/sub with wildcard handlers, middleware and a replayable log.

```typescript
const bus = new PluginEventBus({ maxLogSize: 1000 });

const off = bus.on('plugin:loaded', handler, { priority: 10, plugin: 'name' });
bus.onAny(handler);

await bus.emitBatch([{ event: 'a' }, { event: 'b' }]);
bus.getEventsSince(new Date());
bus.getTopEvents(5);

const { events, hooks, registry, lifecycle, context, dispose } = createPluginApi();
```

### `PluginLifecycleManager`

A state machine per plugin: `registered → loading → ready → enabled → … → unloaded`.

```typescript
const lifecycle = new PluginLifecycleManager();
lifecycle.register(plugin, { maxRetries: 3 });

await lifecycle.load('name');
lifecycle.getState('name');                  // 'ready'
lifecycle.getAvailableTransitions('name');   // what it can legally do next
lifecycle.getStuckPlugins(30_000);           // stuck in 'loading' past 30s

await lifecycle.waitForState('name', 'enabled', 5_000);
```

### `PluginContextProvider`

Shared state, execution history and metrics for a run.

```typescript
const provider = new PluginContextProvider({ maxMemory, logLevel: 'debug' });

await provider.withContext(plugin, inputs, async (ctx) => { /* ... */ });
provider.getMetrics('name');        // success rate, average duration
provider.getFailedExecutions('name');
```

`withContext` always removes the context, including when the callback throws, so
a failed execution cannot leave `getActiveContextCount` permanently inflated.

## Validation helpers

```typescript
import {
  validatePluginManifest,   // manifest field checks, returns errors/warnings/info
  validatePluginIntegrity,  // the whole plugin, returns a report
  validatePluginCompatibility,
  getCapabilityMatrix,      // which surfaces are populated
  findDuplicateNames,       // same-named sections, rules, renderers…
  findUnknownManifestFields,
  compareIntegrity,         // rank two reports
} from '@mam/plugin-api';
```

`validatePluginIntegrity` reports everything it finds rather than stopping at the
first problem, and `getPluginStats` gives you the section/rule/hook counts for a
plugin in one call.

## Type guards

Every guard accepts `unknown` and narrows it, so untrusted input is handled
without casts:

```typescript
import { isMAMPlugin, isPluginManifest, isPluginEvent, isSectionDefinition } from '@mam/plugin-api';

if (isPluginManifest(JSON.parse(raw))) { /* ... */ }
```

Runtime constant lists accompany the union types: `ALL_HOOK_NAMES`,
`ALL_PLUGIN_EVENTS`, `ALL_PLUGIN_CATEGORIES`, plus `isPluginEvent`,
`isPluginCategory` and friends.

## Barrel utilities

```typescript
import { compareApiVersions, isPluginApiCompatible, assertMAMPlugin, describePluginApi } from '@mam/plugin-api';

isPluginApiCompatible('0.2.0', '0.1.0');   // true
assertMAMPlugin(value);                     // throws a named TypeError
```

## Notes for plugin authors

- **Escape everything you interpolate.** Section content is untrusted. The
  `mermaid` and `yaml` plugins are the reference implementations.
- **Round-trip your serialisers.** If you emit a format, prove you can read it
  back.
- **Report what you skipped** rather than silently ignoring it.
- **Don't mutate in a validator.** See `validatePluginCompatibility`, which
  takes the manifest by value.

## API surface

**Managers** — `HookManager`, `PluginRegistry`, `PluginLifecycleManager`,
`PluginContextProvider`, `PluginEventBus`, `createPluginApi`

**Types** — `MAMPlugin`, `PluginManifest`, `PluginCategory`,
`SectionDefinition`, `SectionExample`, `ContentType`, `ValidationRule`,
`ValidationResult`, `ValidationFix`, `PluginHooks`, `PluginError`,
`ExportOutput`, `PluginConfig`, `RuntimeContext`, `RuntimeCapability`,
`ExecutionContext`, `ExecutionResult`, `ExecutionArtifact`, `Exporter`,
`ExportOptions`, `Renderer`, `RenderTarget`, `RenderOptions`, `Transformer`,
`TransformContext`, `PluginMiddleware`, `MiddlewarePhase`, `HookName`,
`HookRegistration`, `PluginRegistryEntry`, `PluginRegistryConfig`,
`PluginEvent`, `PluginEventData`, `HookExecutionResult`, `HookManagerStats`,
`PluginState`, `PluginLifecycleEntry`, `LifecycleEvent`, `ContextMetrics`,
`ResourceSnapshot`, `PluginContextOptions`

**Guards** — `isMAMPlugin`, `isPluginManifest`, `isHookName`, `isPluginEvent`,
`isPluginCategory`, `isSectionDefinition`, `isValidationRule`,
`isPluginMiddleware`, `isValidationResult`, `isExecutionResult`,
`isRuntimeContext`, `isRenderer`, `isExporter`, `isTransformer`

**Constants** — `ALL_HOOK_NAMES`, `ALL_PLUGIN_EVENTS`, `ALL_PLUGIN_CATEGORIES`

**Validation** — `validateManifest`, `validatePluginManifest`,
`validatePluginIntegrity`, `validatePluginCompatibility`, `getPluginStats`,
`getCapabilityMatrix`, `listCapabilities`, `findDuplicateNames`,
`findUnknownManifestFields`, `summarizeIntegrity`, `compareIntegrity`,
`formatIntegrityReport`

**Loading** — `loadPluginFromPath`, `discoverPluginPaths`,
`discoverPluginsInNodeModules`, `resolvePluginPath`, `getPluginScope`,
`compareSemver`, `satisfiesSemver`, `readPluginManifest`, `formatManifestSummary`,
`getManifestDependencyNames`, `findRootManifests`, `sortManifestsForLoad`

**Utilities** — `PLUGIN_API_VERSION`, `createPluginApi`, `compareApiVersions`,
`isPluginApiCompatible`, `assertMAMPlugin`, `describePluginApi`

## See also

- [`../README.md`](../README.md) — plugin conventions across the workspace
- [`@mam/plugin-memory`](../core/memory), [`@mam/plugin-mermaid`](../core/mermaid),
  [`@mam/plugin-python`](../core/python), [`@mam/plugin-yaml`](../core/yaml) —
  worked examples of everything described here

## License

MIT
