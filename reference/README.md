# @mam/reference

Reference implementation and CLI tool for the **MAM (Markdown Agent Module)** ecosystem.

This package provides the complete MAM toolchain — a compiler, package manager, and registry client for building, validating, and deploying agent modules defined in Markdown.

## Installation

```bash
npm install -g @mam/reference
```

Or as a project dependency:

```bash
npm install --save-dev @mam/reference
```

### Prerequisites

- Node.js 18+
- A MAM module file (`.mam.md`)

## Quick Start

```bash
# Initialize a new MAM package
mamc init my-agent

# Validate a MAM module
mamc validate my-module.mam.md

# Build to Python
mamc build my-module.mam.md --target python

# Generate a dependency graph
mamc graph my-module.mam.md -f mermaid
```

## CLI Commands

### `mamc build <file>`

Compile a MAM module to a target language.

| Option | Description | Default |
|---|---|---|
| `-t, --target <target>` | Compilation target | `python` |
| `-o, --outDir <outDir>` | Output directory | `./dist` |
| `--validate` | Validate before building | `true` |
| `--analyze` | Run semantic analysis | `true` |
| `-v, --verbose` | Verbose output | `false` |

**Targets:** `python`, `javascript`, `typescript`, `go`, `rust`, `json`, `yaml`, `openai`, `langgraph`, `crewai`, `csharp`, `java`, `wasm`, `gemini`, `autogen`, `kubernetes`, `terraform`

```bash
mamc build my-module.mam.md --target python --outDir ./output
```

### `mamc validate <file>`

Validate a MAM module for syntax, structure, and semantic correctness.

| Option | Description | Default |
|---|---|---|
| `-l, --level <level>` | Validation level | `semantic` |

**Levels:** `syntax`, `structural`, `semantic`, `strict`

```bash
mamc validate my-module.mam.md --level strict
```

### `mamc analyze <file>`

Run semantic analysis and display module statistics.

```bash
mamc analyze my-module.mam.md
```

### `mamc graph <file>`

Generate a system dependency graph.

| Option | Description | Default |
|---|---|---|
| `-f, --format <format>` | Output format | `mermaid` |
| `-o, --outDir <outDir>` | Output directory | _(stdout)_ |

**Formats:** `mermaid`, `ascii`, `json`

```bash
mamc graph my-module.mam.md -f mermaid -o ./docs
```

### `mamc init [name]`

Initialize a new MAM package.

| Option | Description | Default |
|---|---|---|
| `-d, --dir <dir>` | Target directory | `.` |

```bash
mamc init my-agent --dir ./packages
```

### `mamc install`

Install MAM package dependencies.

| Option | Description | Default |
|---|---|---|
| `-d, --dir <dir>` | Package directory | `.` |

```bash
mamc install --dir ./my-agent
```

## Configuration

Create a `mam.config.json` in your project root:

```json
{
  "version": "1",
  "project": {
    "name": "my-agent",
    "version": "1.0.0",
    "description": "My MAM agent module",
    "runtime": "python"
  },
  "build": {
    "target": "python",
    "output": "./dist",
    "sourceMap": false,
    "minify": false,
    "optimize": true,
    "includeComments": true,
    "indent": 2
  },
  "registry": {
    "url": "https://registry.mam.dev"
  },
  "plugins": [],
  "targets": {
    "python": {
      "minify": true
    }
  }
}
```

### Config Fields

| Field | Description |
|---|---|
| `version` | Config schema version (required) |
| `project.name` | Package name (required) |
| `project.version` | Semver version |
| `build.target` | Default compilation target |
| `build.output` | Output directory |
| `build.sourceMap` | Generate source maps |
| `build.minify` | Minify generated code |
| `build.optimize` | Enable optimizations |
| `build.includeComments` | Include comments in output |
| `build.indent` | Indent size |
| `registry.url` | Registry server URL |
| `registry.auth` | Auth token or credentials path |
| `registry.scope` | Package scope (e.g. `@myorg`) |
| `plugins` | Plugin configurations |
| `targets` | Per-target build overrides |

### Config Search Order

1. Explicit `--config` path
2. `mam.config.json` / `mam.config.yaml` / `.mamrc` in current directory
3. `mam` field in `package.json`
4. Walk up parent directories
5. Fall back to defaults

## Plugin System

Plugins extend the CLI with custom commands and lifecycle hooks.

### Creating a Plugin

```typescript
import { createPlugin, PluginManager } from '@mam/reference';

const myPlugin = createPlugin({
  name: 'my-plugin',
  version: '1.0.0',
  description: 'Adds a lint command',
  commands: [
    {
      name: 'lint',
      description: 'Lint MAM files',
      options: [
        { name: 'fix', short: 'f', description: 'Auto-fix issues' },
      ],
      handler: async (args, ctx) => {
        ctx.logger.info('Linting...');
        // implementation
      },
    },
  ],
  hooks: {
    beforeBuild: async (ctx) => {
      ctx.logger.info('Pre-build hook triggered');
    },
    afterBuild: async (ctx, result) => {
      ctx.logger.info(`Build completed: ${result.success}`);
    },
  },
});
```

### Available Hooks

| Hook | Arguments | When |
|---|---|---|
| `onInit` | `ctx` | CLI startup |
| `onExit` | `ctx` | CLI exit |
| `beforeBuild` | `ctx` | Before build pipeline |
| `afterBuild` | `ctx, result` | After build pipeline |
| `beforeValidate` | `ctx` | Before validation |
| `afterValidate` | `ctx, results` | After validation |

### Plugin Manager API

```typescript
const manager = new PluginManager();

manager.loadPlugin(myPlugin);           // Register a plugin
manager.unloadPlugin('my-plugin');      // Unregister by name
manager.getPlugins();                   // List all plugins
manager.getCommands();                  // List all commands
manager.findCommand('lint');            // Find a command by name
await manager.executeHook('beforeBuild', ctx);  // Execute a hook
manager.size;                           // Number of loaded plugins
```

## Error Handling

The package provides a structured error hierarchy:

```typescript
import {
  MAMError,
  ParseError,
  ValidationError,
  CompileError,
  ConfigError,
  RegistryError,
  PluginError,
  PackageError,
  ErrorCollector,
} from '@mam/reference';
```

### Error Classes

| Class | Default Code | Use Case |
|---|---|---|
| `MAMError` | `MAM_ERROR` | Base error |
| `ParseError` | `PARSE_ERROR` | Parse failures |
| `ValidationError` | `VALIDATION_ERROR` | Validation failures |
| `CompileError` | `COMPILE_ERROR` | Compilation failures |
| `ConfigError` | `CONFIG_ERROR` | Config loading/saving |
| `RegistryError` | `REGISTRY_ERROR` | Registry operations |
| `PluginError` | `PLUGIN_ERROR` | Plugin system |
| `PackageError` | `PACKAGE_ERROR` | Package management |

### Error Properties

All errors extend `Error` and include:

- `code` — Machine-readable error code
- `cause` — Underlying error
- `context` — Additional context object
- `path` — File path where error occurred
- `line` / `column` — Location in source

```typescript
const err = new ParseError('unexpected token', {
  path: 'module.mam.md',
  line: 42,
  column: 5,
  context: { token: '>>>' },
});

console.log(err.format());  // "at module.mam.md:42:5\nunexpected token"
console.log(err.toJSON());  // Serializable object
```

### Error Collector

Aggregate multiple errors during a pipeline:

```typescript
const collector = new ErrorCollector();

collector.addError(new MAMError('something failed'));
collector.addWarning(new MAMError('deprecation notice'));

collector.hasErrors();      // true
collector.hasWarnings();    // true
collector.errorCount;       // 1
collector.warningCount;     // 1

console.log(collector.format());
// error [MAM_ERROR]: something failed
// warn  [MAM_ERROR]: deprecation notice

collector.toResult();       // { errors: [...], warnings: [...] }
collector.clear();          // Reset
```

## API Reference

### Types (`types.ts`)

Core type definitions for the MAM ecosystem:

- **CLI Types:** `CLIOptions`, `CLIContext`, `OutputFormat`
- **Config Types:** `MAMConfig`, `ProjectConfig`, `BuildConfig`, `RegistryConfig`, `PluginConfig`
- **Build Types:** `BuildOptions`, `BuildResult`, `BuildStats`
- **Validation Types:** `ValidationOptions`, `ValidationDetail`
- **Graph Types:** `Graph`, `GraphNode`, `GraphEdge`, `GraphMetadata`, `GraphOptions`
- **Analysis Types:** `AnalysisOptions`, `AnalysisResult`, `ModuleInfo`, `DependencyInfo`, `AnalysisStats`
- **Package Types:** `PackageInitOptions`, `PackageManifest`, `PackageDependency`
- **Registry Types:** `RegistryPublishOptions`, `RegistrySearchOptions`, `RegistryPackageInfo`
- **Constants:** `TARGET_EXTENSIONS`, `SUPPORTED_TARGETS`

### Logger (`logger.ts`)

```typescript
import { Logger, createLogger } from '@mam/reference';

const logger = new Logger({
  level: 'info',      // 'debug' | 'info' | 'warn' | 'error' | 'silent'
  color: true,
  timestamp: false,
  prefix: 'mamc',
});

logger.info('building...');
logger.success('done!');
logger.setLevel('debug');
logger.getLevel();    // 'debug'

const child = logger.child('compiler');
child.info('compiling');  // [mamc:compiler] compiling
```

### Plugin System (`plugin.ts`)

```typescript
import { PluginManager, createPlugin } from '@mam/reference';

const plugin = createPlugin({ name: 'p', version: '1.0.0' });
const manager = new PluginManager();
manager.loadPlugin(plugin);
```

### Config (`config.ts`)

```typescript
import {
  loadConfig,
  saveConfig,
  validateConfig,
  mergeConfigs,
  getConfigForTarget,
  resolveConfigPath,
  DEFAULT_CONFIG,
} from '@mam/reference';

const config = await loadConfig('.', 'mam.config.json');
const errors = validateConfig(config);
const merged = mergeConfigs(DEFAULT_CONFIG, { version: '1' });
const targetConfig = getConfigForTarget(config, 'python');
const path = resolveConfigPath('/base', 'custom.json');
await saveConfig(config, '/path/to/config.json');
```

### Utilities (`utils.ts`)

```typescript
import {
  getExtension,
  formatSize,
  formatDuration,
  slugify,
  truncate,
  indent,
  dedent,
  pick,
  omit,
  sleep,
  randomHex,
  timestamp,
  fileExists,
  ensureDir,
  readFile,
  writeFile,
} from '@mam/reference';

getExtension('python');        // 'py'
formatSize(1024);              // '1.0 KB'
formatDuration(5500);          // '5.50s'
slugify('Hello World');        // 'hello-world'
truncate('hello world', 5);   // 'hell…'
indent('a\nb', 2);            // '  a\n  b'
dedent('  a\n  b');           // 'a\nb'
pick({ a: 1, b: 2 }, ['a']);  // { a: 1 }
omit({ a: 1, b: 2 }, ['a']);  // { b: 2 }
await sleep(100);
randomHex(8);                  // 'a1b2c3d4e5f6g7h8'
timestamp();                   // '14:30:25.123'
await fileExists('./file');    // true/false
await ensureDir('./new/dir');
await readFile('./file');      // string
await writeFile('./file', 'content');
```

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Type-check
npm run typecheck

# Build
npm run build
```

## License

MIT
