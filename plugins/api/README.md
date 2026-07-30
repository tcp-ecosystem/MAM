# @mam/plugin-api

> Type definitions and utilities for building MAM plugins

The Plugin API provides the interface for extending MAM with custom section types, validators, and compilation targets.

## Installation

```bash
npm install @mam/plugin-api
# or
pnpm add @mam/plugin-api
```

## Quick Start

```typescript
import { Plugin, PluginContext } from '@mam/plugin-api';

const myPlugin: Plugin = {
  name: 'my-plugin',
  version: '1.0.0',
  
  onInit(ctx: PluginContext) {
    ctx.registerSectionParser('my-section', parseMySection);
    ctx.registerCompiler('my-target', compileMyTarget);
    ctx.registerValidator('my-rule', validateMyRule);
  }
};
```

## Plugin Interface

```typescript
interface Plugin {
  name: string;
  version: string;
  onInit?(ctx: PluginContext): void;
  onDestroy?(): void;
}
```

## Plugin Context

```typescript
interface PluginContext {
  registerSectionParser(type: string, parser: SectionParser): void;
  registerCompiler(target: string, compiler: TargetCompiler): void;
  registerValidator(rule: string, validator: Validator): void;
  registerTransformer(name: string, transformer: Transformer): void;
  getAST(): MAMAST;
  getConfig(): PluginConfig;
  log(level: LogLevel, message: string): void;
}
```

## Section Parser

```typescript
type SectionParser = {
  parse(content: string, metadata: Record<string, unknown>): SectionNode;
  validate?(content: string): ValidationResult;
};
```

## Target Compiler

```typescript
type TargetCompiler = {
  compile(ast: MAMAST, options: CompileOptions): CompileResult;
  getExtensions(): string[];
  getCapabilities(): string[];
};
```

## Usage Example

```typescript
import { Plugin, PluginContext } from '@mam/plugin-api';

const memoryPlugin: Plugin = {
  name: '@mam/plugin-memory',
  version: '0.1.0',

  onInit(ctx: PluginContext) {
    ctx.registerSectionParser('memory', {
      parse(content) {
        return {
          type: 'MemorySection',
          content: JSON.parse(content)
        };
      }
    });

    ctx.registerValidator('memory-consistency', {
      validate(ast) {
        const memorySections = ast.sections.filter(s => s.type === 'memory');
        return { valid: true, errors: [] };
      }
    });
  }
};
```

## Built-in Plugins

| Plugin | Description |
|--------|-------------|
| `@mam/plugin-memory` | Persistent state management |
| `@mam/plugin-mermaid` | Diagram renderer and validator |
| `@mam/plugin-python` | Python code execution context |
| `@mam/plugin-yaml` | YAML section parser |

## API

```typescript
class PluginManager {
  register(plugin: Plugin): void;
  unregister(name: string): void;
  getPlugin(name: string): Plugin | undefined;
  listPlugins(): Plugin[];
  initAll(): Promise<void>;
  destroyAll(): Promise<void>;
}
```

## License

MIT
