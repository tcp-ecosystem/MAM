# Compiler Architecture

> **How MAM transforms AST to target languages.**

---

## Overview

The compiler transforms MAM AST into executable code for various target languages and frameworks. MAM never executes directly — it compiles first.

---

## Pipeline

```
MAM AST
   │
   ▼
Analyzer
   │
   ▼
Optimized AST
   │
   ▼
Target Handler
   │
   ▼
Generated Code
```

---

## Supported Targets

| Target | Language | Output |
|--------|----------|--------|
| `python` | Python 3.10+ | Python module |
| `javascript` | JavaScript ES2022 | JS module |
| `typescript` | TypeScript 5+ | TS module |
| `go` | Go 1.21+ | Go package |
| `rust` | Rust 1.70+ | Rust crate |
| `openai` | - | OpenAI API config |
| `langgraph` | Python | LangGraph definition |
| `crewai` | Python | CrewAI agent config |
| `claude` | - | Claude tool definition |
| `docker` | - | Dockerfile |

---

## Compiler Structure

```
┌─────────────────────────────────────────┐
│              MAMCompiler                │
├─────────────────────────────────────────┤
│  Target Handlers                       │
│  ├── PythonTargetHandler               │
│  ├── JavaScriptTargetHandler           │
│  ├── GoTargetHandler                   │
│  ├── RustTargetHandler                 │
│  ├── OpenAITargetHandler               │
│  ├── LangGraphTargetHandler            │
│  ├── CrewAITargetHandler               │
│  ├── ClaudeTargetHandler               │
│  └── DockerTargetHandler               │
├─────────────────────────────────────────┤
│  Analyzer                              │
│  ├── Dependency Analysis               │
│  ├── Type Inference                    │
│  └── Optimization                      │
└─────────────────────────────────────────┘
```

---

## Compiler Configuration

```typescript
interface CompilerConfig {
  target: CompileTarget;
  indent?: number;           // Indentation spaces (default: 2)
  includeComments?: boolean; // Include comments in output
  includeMetadata?: boolean; // Include metadata in output
  optimize?: boolean;        // Enable optimizations
}
```

---

## Compile Result

```typescript
interface CompileResult {
  success: boolean;
  output: string;         // Generated code
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

## Target Handlers

### Python Target

Generates Python modules from MAM AST:

```typescript
class PythonTargetHandler implements CompileTargetHandler {
  name = 'python';
  
  compile(modules: V2ModuleNode[], config: CompilerConfig): string {
    // Generate Python code
  }
}
```

**Output Example:**

```python
from typing import Optional, Dict, Any

def greet(name: str) -> str:
    """Generate a greeting."""
    return f"Hello, {name}!"

if __name__ == "__main__":
    result = greet("World")
    print(result)
```

### JavaScript Target

Generates JavaScript/TypeScript modules:

```typescript
class JavaScriptTargetHandler implements CompileTargetHandler {
  name = 'javascript';
  
  compile(modules: V2ModuleNode[], config: CompilerConfig): string {
    // Generate JS/TS code
  }
}
```

**Output Example:**

```typescript
export function greet(name: string): string {
  return `Hello, ${name}!`;
}

if (require.main === module) {
  console.log(greet("World"));
}
```

### Go Target

Generates Go packages:

```typescript
class GoTargetHandler implements CompileTargetHandler {
  name = 'go';
  
  compile(modules: V2ModuleNode[], config: CompilerConfig): string {
    // Generate Go code
  }
}
```

**Output Example:**

```go
package main

import "fmt"

func Greet(name string) string {
    return fmt.Sprintf("Hello, %s!", name)
}

func main() {
    fmt.Println(Greet("World"))
}
```

### Rust Target

Generates Rust crates:

```typescript
class RustTargetHandler implements CompileTargetHandler {
  name = 'rust';
  
  compile(modules: V2ModuleNode[], config: CompilerConfig): string {
    // Generate Rust code
  }
}
```

### OpenAI Target

Generates OpenAI API configurations:

```typescript
class OpenAITargetHandler implements CompileTargetHandler {
  name = 'openai';
  
  compile(modules: V2ModuleNode[], config: CompilerConfig): string {
    // Generate OpenAI config
  }
}
```

**Output Example:**

```json
{
  "model": "gpt-4",
  "messages": [
    {
      "role": "system",
      "content": "You are a helpful assistant."
    }
  ],
  "functions": [
    {
      "name": "greet",
      "description": "Generate a greeting",
      "parameters": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "description": "Name to greet"
          }
        }
      }
    }
  ]
}
```

### LangGraph Target

Generates LangGraph definitions:

```typescript
class LangGraphTargetHandler implements CompileTargetHandler {
  name = 'langgraph';
  
  compile(modules: V2ModuleNode[], config: CompilerConfig): string {
    // Generate LangGraph code
  }
}
```

### CrewAI Target

Generates CrewAI agent configurations:

```typescript
class CrewAITargetHandler implements CompileTargetHandler {
  name = 'crewai';
  
  compile(modules: V2ModuleNode[], config: CompilerConfig): string {
    // Generate CrewAI config
  }
}
```

### Claude Target

Generates Claude tool definitions:

```typescript
class ClaudeTargetHandler implements CompileTargetHandler {
  name = 'claude';
  
  compile(modules: V2ModuleNode[], config: CompilerConfig): string {
    // Generate Claude config
  }
}
```

---

## Analyzer

The analyzer processes the AST before compilation:

### Dependency Analysis

```typescript
interface DependencyGraph {
  nodes: string[];
  edges: [string, string][];
  roots: string[];
}
```

### Type Inference

Infers types from code blocks and metadata:

```typescript
function inferTypes(ast: MAMModule): TypeMap {
  // Analyze code blocks
  // Infer parameter types
  // Return type map
}
```

### Optimization

Applies optimizations to the AST:

1. Dead code elimination
2. Constant folding
3. Function inlining
4. Import optimization

---

## Example

### Input AST

```json
{
  "type": "MAMModule",
  "frontmatter": {
    "data": {
      "id": "greeting",
      "runtime": "python"
    }
  },
  "sections": [
    {
      "name": "Python",
      "content": [
        {
          "type": "CodeBlock",
          "language": "python",
          "value": "def greet(name):\n    return f'Hello, {name}!'"
        }
      ]
    }
  ]
}
```

### Python Output

```python
"""greeting module."""

from typing import str

def greet(name: str) -> str:
    """Generate a greeting."""
    return f'Hello, {name}!'

if __name__ == "__main__":
    result = greet("World")
    print(result)
```

### JavaScript Output

```typescript
/**
 * greeting module.
 */

export function greet(name: string): string {
  return `Hello, ${name}!`;
}

if (require.main === module) {
  console.log(greet("World"));
}
```

---

## Performance

| Operation | Target | Strategy |
|-----------|--------|----------|
| Single module | <50ms | Template-based |
| Batch (100 modules) | <5s | Parallel compilation |
| Large module (10K lines) | <200ms | Incremental generation |

---

## References

- [AST Architecture](./ast.md)
- [Runtime Architecture](./runtime.md)
- [Compiler API](../api/compiler.md)

---

**Last Updated:** 2026-07-24
**MAM Version:** 1.0.0
