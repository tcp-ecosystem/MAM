# @mam/compiler

> Multi-target code generation compiler for MAM modules

The MAM compiler transforms MAM AST into executable code for Python, JavaScript, TypeScript, OpenAI, LangGraph, and other runtimes.

## Installation

```bash
npm install @mam/compiler
# or
pnpm add @mam/compiler
```

## Quick Start

```typescript
import { Compiler } from '@mam/compiler';
import { Parser } from '@mam/parser';

const parser = new Parser();
const compiler = new Compiler();

const ast = parser.parse(mamSource);
const pythonCode = compiler.compile(ast, { target: 'python' });
const jsCode = compiler.compile(ast, { target: 'javascript' });
```

## Supported Targets

| Target | Language | Output |
|--------|----------|--------|
| `python` | Python 3.10+ | `.py` files |
| `javascript` | ES2022+ | `.js` files |
| `typescript` | TypeScript 5+ | `.ts` files |
| `openai` | OpenAI Assistants API | JSON config |
| `langgraph` | LangGraph | Python graph |
| `go` | Go 1.21+ | `.go` files |
| `rust` | Rust 2021 | `.rs` files |

## Usage Examples

### Basic Compilation

```typescript
import { compile } from '@mam/compiler';

const result = await compile('auth.mam.md', {
  target: 'python',
  outputDir: './dist',
  optimize: true
});
```

### Multi-Target Build

```typescript
import { compileMultiple } from '@mam/compiler';

const results = await compileMultiple('pipeline.mam.md', {
  targets: ['python', 'javascript', 'typescript'],
  sourceMap: true
});
```

### Custom Compiler Options

```typescript
const compiler = new Compiler({
  target: 'python',
  indent: 2,
  includeSourceMap: true,
  optimizeImports: true,
  generateDocstrings: true
});
```

## API

### `Compiler`

```typescript
class Compiler {
  compile(ast: MAMAST, options: CompileOptions): CompileResult;
  compileMultiple(ast: MAMAST, options: MultiCompileOptions): CompileResult[];
  getTarget(target: string): TargetPlugin;
  listTargets(): string[];
}
```

### `CompileOptions`

```typescript
interface CompileOptions {
  target: string;
  outputDir?: string;
  sourceMap?: boolean;
  optimize?: boolean;
  indent?: number;
}
```

### `CompileResult`

```typescript
interface CompileResult {
  files: CompiledFile[];
  diagnostics: Diagnostic[];
  metadata: CompileMetadata;
}
```

## Plugin System

Add custom compilation targets:

```typescript
import { Compiler, TargetPlugin } from '@mam/compiler';

const customTarget: TargetPlugin = {
  name: 'custom',
  compile(ast) {
    // Custom compilation logic
    return { code: '', fileName: '' };
  }
};

const compiler = new Compiler();
compiler.registerTarget(customTarget);
```

## License

MIT
