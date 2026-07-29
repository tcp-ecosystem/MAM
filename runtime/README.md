# @mam/runtime

Execution engine for MAM modules. Runs code blocks in sandboxed contexts, manages plugins, and formats output across JSON, HTML, Markdown, and plain text.

## Installation

```bash
pnpm add @mam/runtime
```

## Quick Start

```ts
import { executeModule } from '@mam/runtime';

// ast is a parsed MAMModule from @mam/parser
const result = await executeModule(ast);

console.log(result.success);  // true
console.log(result.output);   // { Python: ..., JavaScript: ... }
console.log(result.timeMs);   // 42.1
```

## API Reference

### Runtime Engine

```ts
import { MAMRuntime, executeModule } from '@mam/runtime';
```

| Export | Description |
|---|---|
| `MAMRuntime` | Main runtime class -- init, execute, cleanup |
| `executeModule(module, config?, options?)` | Convenience one-shot: init, execute, cleanup |

**MAMRuntime usage:**

```ts
const runtime = new MAMRuntime({
  sandboxType: 'process',     // 'process' | 'vm'
  validateBeforeExecution: true,
  stopOnError: false,
  defaultTimeout: 30000,
  defaultMemoryLimit: 256 * 1024 * 1024,
});

await runtime.init();

const result = await runtime.execute(ast, {
  sections: ['Python', 'JavaScript'],  // limit to specific sections
  inputs: { prompt: 'hello' },
  env: { API_KEY: '...' },
  timeout: 10000,
});

await runtime.cleanup();
```

### Module Executor

Standalone executor that wires the sandbox and contexts without the full `MAMRuntime` lifecycle.

```ts
import { ModuleExecutor } from '@mam/runtime';

const executor = new ModuleExecutor({
  sandboxType: 'vm',
  validateBeforeExecution: true,
  defaultTimeout: 15000,
});

await executor.init();
const result = await executor.execute(ast, {
  sections: ['Python'],
  inputs: { query: 'test' },
});
await executor.cleanup();
```

### Execution Contexts

```ts
import {
  BaseExecutionContext,
  PythonExecutionContext,
  JavaScriptExecutionContext,
  TypeScriptContext,
  RustContext,
  GoContext,
  createExecutionContext,
} from '@mam/runtime';
```

| Export | Description |
|---|---|
| `BaseExecutionContext` | Abstract base class for all contexts |
| `PythonExecutionContext` | Runs Python via child process |
| `JavaScriptExecutionContext` | Runs JS in a Node.js `vm` context |
| `TypeScriptContext` | Compiles TS to JS, then executes via Node |
| `RustContext` | Rust execution stub |
| `GoContext` | Go execution stub |
| `createExecutionContext(runtime)` | Factory: returns the right context for a language |

**Factory:**

```ts
const ctx = createExecutionContext('python');  // PythonExecutionContext
const ctx = createExecutionContext('js');      // JavaScriptExecutionContext
const ctx = createExecutionContext('ts');      // TypeScriptContext
```

### Sandboxes

```ts
import {
  ProcessSandbox,
  VMSandbox,
  DockerSandbox,
  createSandbox,
} from '@mam/runtime';
```

| Export | Description |
|---|---|
| `ProcessSandbox` | Runs code in an isolated child process with env filtering |
| `VMSandbox` | Runs JS in a locked-down `vm` context (no process access) |
| `DockerSandbox` | Runs code in a Docker container |
| `createSandbox(type)` | Factory: `'process'` \| `'vm'` \| `'docker'` |

**Sandbox config:**

```ts
const sandbox = createSandbox('process');
await sandbox.init({
  timeout: 10000,
  memoryLimit: 128 * 1024 * 1024,
  networkHosts: ['api.example.com'],
  filesystemPaths: ['/tmp', '/data'],
  allowedEnvVars: ['PATH', 'HOME'],
  allowProcess: false,
});
```

### Plugins

```ts
import {
  PluginLoader,
  PluginRegistry,
  createPlugin,
} from '@mam/runtime';
```

#### PluginLoader

Manages plugin lifecycle: load, unload, reload, enable, disable, execute hooks.

```ts
const loader = new PluginLoader();

const myPlugin = createPlugin({
  name: 'my-transform',
  version: '1.0.0',
  type: 'transform',
  initialize: async (ctx) => {
    ctx.logger.info('Plugin loaded');
    ctx.memory.config = { mode: 'strict' };
  },
  execute: async (hookName, data) => {
    return transform(data);
  },
  destroy: async () => {
    // cleanup
  },
  hooks: [
    { name: 'transform', phase: 'before', handler: (data) => data },
  ],
});

await loader.load(myPlugin);
await loader.executeHook('transform', inputData);
loader.enable('my-transform');
loader.disable('my-transform');
await loader.unload('my-transform');
```

**Dependency resolution:**

```ts
const order = loader.resolveDependencies();
// Returns plugin names in topological order (deps first)
```

**Queries:**

```ts
loader.get('my-plugin');          // Plugin | undefined
loader.list();                    // Plugin[]
loader.has('my-plugin');          // boolean
loader.getByType('transform');    // Plugin[]
loader.getStats();                // { totalLoaded, enabledCount, byType, memoryUsage, hookCount }
```

#### PluginRegistry

Search and discover registered plugins.

```ts
const registry = new PluginRegistry();
registry.register({ name: 'my-plugin', version: '1.0.0' });

const found = registry.search('my-plugin');
registry.getHooks('my-plugin');
```

### Output Formatters

```ts
import { JSONOutput, HTMLOutput, MarkdownOutput, createFormatter } from '@mam/runtime';
```

| Export | Description |
|---|---|
| `JSONOutput` | JSON formatter with options for indent, location, metadata |
| `HTMLOutput` | Full HTML5 with themes, TOC, code highlighting, responsive tables |
| `MarkdownOutput` | Clean Markdown with YAML frontmatter, TOC, aligned tables |
| `createFormatter(type)` | Factory: `'json'` \| `'html'` \| `'markdown'` \| `'text'` |

**HTML with theme and TOC:**

```ts
const html = new HTMLOutput({
  title: 'My Module',
  theme: 'dark',           // 'default' | 'dark' | 'github' | 'minimal' | 'print'
  tableOfContents: true,
  tocDepth: 3,
  codeHighlight: true,
  css: 'body { font-size: 14px; }',
});

const output = html.format(ast);
// Returns complete HTML5 document
```

**Markdown with frontmatter:**

```ts
const md = new MarkdownOutput({
  headingStyle: 'atx',     // 'atx' | 'setext'
  listMarker: '-',
  includeFrontmatter: true,
  toc: true,
  tocDepth: 2,
});

const output = md.format(ast);
// Returns Markdown with --- frontmatter block
```

**Factory:**

```ts
const formatter = createFormatter('json');
const output = formatter.format(ast);
const mime = formatter.getMimeType();   // 'application/json'
const ext = formatter.getExtension();   // '.json'
```

### V2 Runtime

```ts
import {
  MAMV2Runtime,
  createV2Runtime,
  InMemoryMemoryStore,
  DefaultEventEmitter,
  DefaultStateManager,
  DefaultPermissionChecker,
} from '@mam/runtime';
```

| Export | Description |
|---|---|
| `MAMV2Runtime` | V2 runtime supporting agents, tools, workflows, policies, systems |
| `createV2Runtime(config?)` | Factory that inits and returns a ready runtime |
| `InMemoryMemoryStore` | In-memory key-value store with TTL, tags, stats |
| `DefaultEventEmitter` | Event emitter with wildcard support and history |
| `DefaultStateManager` | State manager with subscriptions and change history |
| `DefaultPermissionChecker` | Pattern-based permission allow/deny checker |

**V2 runtime usage:**

```ts
const runtime = createV2Runtime({
  workingDir: '/workspace',
  defaultTimeout: 30000,
  memoryLimit: 256 * 1024 * 1024,
  logging: true,
  logLevel: 'info',
});

// Execute a single module
const result = await runtime.execute(agentNode, context);

// Execute a full system (topological sort of dependencies)
const systemResult = await runtime.executeSystem(modules, systemNode, context);
console.log(systemResult.executionOrder);
console.log(systemResult.moduleResults);
```

**InMemoryMemoryStore:**

```ts
const memory = new InMemoryMemoryStore();
await memory.set('key', 'value', { ttl: 60, scope: 'local', tags: ['session'] });
const val = await memory.get('key');
await memory.delete('key');
const stats = await memory.stats();
// { totalEntries, memoryUsed, hitRate, evictions }
```

**Event emitter:**

```ts
const events = new DefaultEventEmitter();
events.on('agent:start', (data) => console.log(data));
events.emit('agent:start', { name: 'my-agent' });
events.history(); // [{ name, data, timestamp }]
```

**Permission checker:**

```ts
const perms = new DefaultPermissionChecker({
  filesystem: 'read',
  network: 'internet',
  python: 'sandbox',
  exec: 'denied',
});

perms.check('filesystem:read');  // { allowed: true, policy: 'filesystem:read' }
perms.check('exec:allowed');     // { allowed: false, reason: 'Denied by pattern: exec:*' }
```

## Contributing

```bash
pnpm install
pnpm --filter @mam/runtime build
pnpm --filter @mam/runtime test
pnpm --filter @mam/runtime lint
pnpm --filter @mam/runtime typecheck
```

## License

MIT
