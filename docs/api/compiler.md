# Compiler API Reference

> **API documentation for the MAM compiler.**

---

## Overview

The compiler transforms MAM AST into target languages. This reference covers all public APIs.

---

## Imports

```typescript
import {
  MAMCompiler,
  CompileTarget,
  CompilerConfig,
  CompileResult
} from '@mam/compiler';
```

---

## Types

### CompileTarget

```typescript
type CompileTarget =
  | 'python'
  | 'javascript'
  | 'typescript'
  | 'go'
  | 'rust'
  | 'json'
  | 'yaml'
  | 'openai'
  | 'langgraph'
  | 'crewai'
  | 'claude'
  | 'docker';
```

### CompilerConfig

```typescript
interface CompilerConfig {
  target: CompileTarget;
  indent?: number;
  includeComments?: boolean;
  includeMetadata?: boolean;
  optimize?: boolean;
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| target | CompileTarget | required | Target language |
| indent | number | 2 | Indentation spaces |
| includeComments | boolean | true | Include comments |
| includeMetadata | boolean | true | Include metadata |
| optimize | boolean | false | Enable optimizations |

### CompileResult

```typescript
interface CompileResult {
  success: boolean;
  output: string;
  target: CompileTarget;
  warnings: string[];
  errors: string[];
  stats: CompileStats;
}

interface CompileStats {
  modulesCompiled: number;
  linesGenerated: number;
  timeMs: number;
}
```

---

## Classes

### MAMCompiler

Main compiler class.

```typescript
class MAMCompiler {
  constructor();
  
  compile(
    modules: V2ModuleNode[],
    config: CompilerConfig
  ): CompileResult;
  
  registerTarget(
    name: string,
    handler: CompileTargetHandler
  ): void;
  
  getTargets(): string[];
}
```

**Example:**

```typescript
import { MAMCompiler } from '@mam/compiler';

const compiler = new MAMCompiler();

const result = compiler.compile(modules, {
  target: 'python',
  indent: 4,
  includeComments: true
});

if (result.success) {
  console.log(result.output);
} else {
  console.error(result.errors);
}
```

---

## Target Handlers

### CompileTargetHandler

```typescript
interface CompileTargetHandler {
  name: string;
  compile(modules: V2ModuleNode[], config: CompilerConfig): string;
}
```

### Built-in Handlers

| Handler | Target | Description |
|---------|--------|-------------|
| PythonTargetHandler | python | Python module generation |
| JavaScriptTargetHandler | javascript | JS/TS module generation |
| GoTargetHandler | go | Go package generation |
| RustTargetHandler | rust | Rust crate generation |
| OpenAITargetHandler | openai | OpenAI API config |
| LangGraphTargetHandler | langgraph | LangGraph definition |
| CrewAITargetHandler | crewai | CrewAI agent config |
| ClaudeTargetHandler | claude | Claude tool definition |
| DockerTargetHandler | docker | Dockerfile generation |

---

## Example

```typescript
import { MAMCompiler } from '@mam/compiler';
import { parse } from '@mam/parser';

// Parse module
const result = parse(moduleContent);
const ast = result.ast;

// Compile to Python
const compiler = new MAMCompiler();
const compiled = compiler.compile(
  [ast as V2ModuleNode],
  { target: 'python' }
);

console.log(compiled.output);
```

### Python Output

```python
"""hello module."""

from typing import str

def greet(name: str) -> str:
    """Generate a greeting."""
    return f"Hello, {name}!"

if __name__ == "__main__":
    print(greet("World"))
```

### JavaScript Output

```typescript
/**
 * hello module.
 */

export function greet(name: string): string {
  return `Hello, ${name}!`;
}

if (require.main === module) {
  console.log(greet("World"));
}
```

---

## References

- [Compiler Architecture](../architecture/compiler.md)
- [AST API](./ast.md)

---

**Last Updated:** 2026-07-24
**MAM Version:** 1.0.0
