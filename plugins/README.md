# MAM Plugins

Plugins for the MAM (Markdown-Aware Modules) toolchain. A plugin extends MAM with
its own section types, validation rules, render targets or runtime execution
contexts — without changing MAM itself.

## Layout

```
plugins/
├── api/          @mam/plugin-api      the contract every plugin is written against
└── core/
    ├── memory/   @mam/plugin-memory   persistent state across executions
    ├── mermaid/  @mam/plugin-mermaid  Mermaid diagram validation and rendering
    ├── python/   @mam/plugin-python   Python execution context
    └── yaml/     @mam/plugin-yaml     YAML configuration parsing
```

`api` is a **contract** package: it defines the interfaces, type guards and
managers that plugins implement and that the host uses to load them. It has no
behaviour of its own beyond the managers it provides.

`core/*` are **plugins**: concrete implementations of that contract, each
installable on its own.

## Available plugins

| Package | What it does | Notable capability |
|---------|--------------|--------------------|
| [`@mam/plugin-api`](./api) | Types, guards and managers | `PluginRegistry`, `HookManager`, `PluginEventBus`, `PluginLifecycleManager` |
| [`@mam/plugin-memory`](./core/memory) | Per-module key/value state with atomic JSON persistence | TTL expiry, change listeners, versioned files, diff-based writes |
| [`@mam/plugin-mermaid`](./core/mermaid) | Mermaid diagram validation and rendering | 19 diagram types, subgraph balance checks, self-contained HTML output |
| [`@mam/plugin-python`](./core/python) | Runs Python in a child process | Interpreter auto-detection, timeout and output caps, real syntax checking |
| [`@mam/plugin-yaml`](./core/yaml) | YAML configuration parsing and validation | Nesting, sequences, block scalars, anchors, round-trip serialisation |

## Using a plugin

Every core plugin ships a default singleton and a factory. Reach for the factory
when you need more than one instance, or to override behaviour:

```typescript
import mermaidPlugin from '@mam/plugin-mermaid';        // ready-made
import { createMermaidPlugin } from '@mam/plugin-mermaid'; // configured

const plugin = createMermaidPlugin({
  allRules: true,                 // install the full rule family
  severity: 'error',              // re-level every rule
  config: { theme: 'dark' },      // bake config into the HTML renderer
});
```

The default export is an ordinary `MAMPlugin`, so it can be handed to the
registry directly:

```typescript
import { PluginRegistry, HookManager } from '@mam/plugin-api';
import memoryPlugin from '@mam/plugin-memory';

const registry = new PluginRegistry(new HookManager());
await registry.registerPlugin(memoryPlugin);
```

## Writing a plugin

A plugin is a `MAMPlugin` — a manifest plus whichever surfaces it provides. All
of them are optional except the manifest:

```typescript
import type { MAMPlugin } from '@mam/plugin-api';

const myPlugin: MAMPlugin = {
  manifest: {
    name: '@acme/my-plugin',
    version: '0.1.0',
    description: 'What it does',
    author: 'ACME',
    license: 'MIT',
    // Must be satisfiable by the host's @mam/plugin-api version.
    mamVersion: '>=0.1.0',
    main: './dist/index.js',
  },
  sections: [mySectionDefinition],
  rules: [myRule],
  renderers: [myRenderer],
  hooks: { afterParse: myAfterParseHook },
  contexts: [myRuntimeContext],
};
```

### Rules

A rule is synchronous by contract, so anything needing I/O (a subprocess, a
network call) belongs in an async check you call yourself rather than in
`rule.check`. Report every problem found instead of stopping at the first.

```typescript
import type { ValidationRule } from '@mam/plugin-api';

const myRule: ValidationRule = {
  name: 'my-rule',
  description: 'What it checks',
  severity: 'warning',
  check(module) {
    const results = [];
    for (const block of findMyBlocks(module)) {
      results.push({
        valid: isFine(block),
        message: '...',
        severity: 'warning',
        rule: 'my-rule',
        location: { line: block.line, column: 1 },
      });
    }
    return results;
  },
};
```

### Renderers

```typescript
import type { Renderer } from '@mam/plugin-api';

const myRenderer: Renderer = {
  name: 'my-html',
  target: 'html',                 // html | markdown | json | text | svg | pdf
  render(content, options) {
    return `<!-- rendered from ${content.length} nodes -->`;
  },
  getStyles?: () => string,       // optional, hoisted out of the body
  getScripts?: () => string[],
};
```

> **Escape interpolated content.** Diagram sources, config values and code
> blocks are all untrusted input. The Mermaid and YAML plugins show the expected
> approach — escape on the way into HTML, and never emit a raw `<script>` built
> from user data.

## Conventions

These are followed by every plugin in this folder.

**Manifest hygiene.** `mamVersion` must be satisfiable by the `@mam/plugin-api`
in the same workspace, and `main` must point at a file the package actually
ships. `files: ["dist"]` means the entry is `./dist/index.js`, not `./index.js`.
`validatePluginCompatibility` from the API will reject a manifest that fails
either check.

**Naming.** Scoped as `@mam/plugin-<name>`. Sections and content types are
exported as constants (`MERMAID_SECTION_NAME`) rather than inlined strings.

**Additive changes only.** New exports and options are welcome; changing the
meaning of an existing export is a breaking change. When a bug forces a
behaviour change, say so in the changelog rather than leaving callers to notice.

**Never validate by mutating.** A function named `validate` must not write to
the object it was handed. `validateYAMLSchema` had this bug: it applied
defaults straight into the caller's record. Return the defaults, or take an
explicit `applyDefaults` flag.

**Don't sanitise by filtering.** Rejecting a dangerous input beats quietly
rewriting it. `setYAMLPath(data, '__proto__.x', v)` filters the unsafe segment
and writes `data.x` instead — a silent, confusing write to the wrong key. It
now returns `false` and writes nothing.

**Report what you skipped.** Unsupported syntax, dropped tags and ignored
anchors go in a `warnings` array. Silently mis-parsing is worse than an error.

**Round-trip your serialiser.** If you can produce a format, prove you can read
it back. `parseYAML(stringifyYAML(x))` must equal `x` for every value you claim
to support, and there is a test for it.

## Development

Each package is a standard pnpm workspace member:

```bash
pnpm --filter @mam/plugin-mermaid typecheck   # tsc --noEmit
pnpm --filter @mam/plugin-mermaid test       # vitest run
pnpm --filter @mam/plugin-mermaid build      # tsc
pnpm -r typecheck                            # every package
```

Tests must pass with no network access. Suites that genuinely need an external
tool — the Python plugin needs an interpreter — detect it at collection time
and skip rather than fail, so a machine without it still gets useful coverage
from the rest of the suite.

## License

MIT
