# Runtime Architecture

> **How MAM executes modules in sandboxed environments.**

---

## Overview

The runtime engine executes MAM modules in isolated, sandboxed environments. It manages execution contexts, memory, and output formats.

---

## Pipeline

```
MAM AST
   │
   ▼
Runtime Engine
   │
   ├──▶ Execution Context
   │       │
   │       ├──▶ Python Context
   │       ├──▶ JavaScript Context
   │       ├──▶ Rust Context (future)
   │       └──▶ Go Context (future)
   │
   ├──▶ Sandbox
   │       │
   │       ├──▶ Process Sandbox
   │       ├──▶ VM Sandbox
   │       └──▶ Docker Sandbox (future)
   │
   └──▶ Output
           │
           ├──▶ JSON
           ├──▶ HTML
           └──▶ Markdown
```

---

## Runtime Structure

```
┌─────────────────────────────────────────┐
│              Runtime Engine             │
├─────────────────────────────────────────┤
│  Execution Contexts                    │
│  ├── Python Context                    │
│  ├── JavaScript Context                │
│  ├── Rust Context                      │
│  └── Go Context                        │
├─────────────────────────────────────────┤
│  Sandboxes                             │
│  ├── Process Sandbox                   │
│  ├── VM Sandbox                        │
│  └── Docker Sandbox                    │
├─────────────────────────────────────────┤
│  Plugin System                         │
│  ├── Plugin Loader                     │
│  └── Plugin Registry                   │
├─────────────────────────────────────────┤
│  Output Formats                        │
│  ├── JSON                              │
│  ├── HTML                              │
│  └── Markdown                          │
└─────────────────────────────────────────┘
```

---

## Runtime Configuration

```typescript
interface RuntimeConfig {
  sandboxType?: 'process' | 'vm';
  sandboxConfig?: SandboxConfig;
  validateBeforeExecution?: boolean;
  stopOnError?: boolean;
  defaultTimeout?: number;
  defaultMemoryLimit?: number;
}
```

---

## Execution Context

Each code block runs in its own execution context:

```typescript
interface ExecutionContext {
  module: MAMModule;
  inputs: Record<string, unknown>;
  permissions: Permission[];
  sandbox: Sandbox;
  
  execute(code: string, language: string): Promise<ExecutionResult>;
  getMemory(): Record<string, unknown>;
  setMemory(key: string, value: unknown): void;
}
```

### Python Context

Executes Python code in a sandboxed environment:

```typescript
class PythonContext implements ExecutionContext {
  async execute(code: string): Promise<ExecutionResult> {
    // Execute Python code
    // Capture output
    // Return result
  }
}
```

### JavaScript Context

Executes JavaScript/TypeScript code:

```typescript
class JavaScriptContext implements ExecutionContext {
  async execute(code: string): Promise<ExecutionResult> {
    // Execute JavaScript code
    // Capture output
    // Return result
  }
}
```

---

## Sandbox

Isolates code execution for security:

### Process Sandbox

Runs code in separate processes:

```typescript
class ProcessSandbox implements Sandbox {
  async execute(code: string, config: SandboxConfig): Promise<string> {
    // Create child process
    // Execute code
    // Capture output
    // Return result
  }
}
```

### VM Sandbox

Runs code in virtual machines:

```typescript
class VMSandbox implements Sandbox {
  async execute(code: string, config: SandboxConfig): Promise<string> {
    // Create VM
    // Execute code
    // Capture output
    // Return result
  }
}
```

### Sandbox Configuration

```typescript
interface SandboxConfig {
  timeout: number;      // Milliseconds
  memory: number;       // Bytes
  network: boolean;     // Allow network access
  filesystem: boolean;  // Allow filesystem access
  allowedPaths: string[];
  env: Record<string, string>;
}
```

---

## Execution Options

```typescript
interface RuntimeExecutionOptions {
  sections?: string[];
  inputs?: Record<string, unknown>;
  env?: Record<string, string>;
  timeout?: number;
}
```

---

## Execution Result

```typescript
interface ExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  duration: number;
  memoryUsed: number;
}

interface ModuleExecutionResult {
  success: boolean;
  validation?: ValidationReport;
  sectionResults: Map<string, ExecutionResult>;
  output: Record<string, unknown>;
  duration: number;
}
```

---

## Memory System

Modules can maintain state across executions:

```typescript
interface MemoryStore {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  delete(key: string): void;
  clear(): void;
  getAll(): Record<string, unknown>;
}
```

### Memory Persistence

Memory is persisted to disk between runs:

```
.mam/
├── memory/
│   ├── <module-id>/
│   │   ├── state.json
│   │   └── cache/
```

---

## Output Formats

### JSON Output

```typescript
interface JSONOutput {
  module: string;
  version: string;
  sections: Record<string, unknown>;
  execution: {
    success: boolean;
    duration: number;
  };
}
```

### HTML Output

```typescript
interface HTMLOutput {
  html: string;
  css: string;
  metadata: Record<string, unknown>;
}
```

### Markdown Output

```typescript
interface MarkdownOutput {
  markdown: string;
  metadata: Record<string, unknown>;
}
```

---

## Error Handling

### Runtime Errors

```typescript
interface RuntimeError {
  type: 'runtime';
  code: RuntimeErrorCode;
  message: string;
  section?: string;
  stack?: string;
}

enum RuntimeErrorCode {
  EXECUTION_FAILED = 'EXECUTION_FAILED',
  TIMEOUT = 'TIMEOUT',
  MEMORY_EXCEEDED = 'MEMORY_EXCEEDED',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  SANDBOX_VIOLATION = 'SANDBOX_VIOLATION',
}
```

### Error Recovery

1. Catch execution errors
2. Log error with context
3. Continue to next section (if `stopOnError` is false)
4. Return partial results

---

## Plugin Integration

The runtime loads and executes plugins:

```typescript
class PluginManager {
  load(plugin: MAMPlugin): void;
  unload(name: string): void;
  getExecutionContexts(): ExecutionContext[];
  getExporters(): Exporter[];
}
```

---

## Performance

| Operation | Target | Strategy |
|-----------|--------|----------|
| Single execution | <100ms | Process pooling |
| Batch execution | <1s | Parallel execution |
| Memory read/write | <10ms | In-memory cache |

### Optimization

1. **Process Pooling** — Reuse processes across executions
2. **Memory Caching** — Cache frequently accessed data
3. **Lazy Loading** — Load contexts on demand
4. **Parallel Execution** — Execute sections in parallel

---

## Security

### Sandboxing Rules

1. All code runs in isolated environments
2. Network access must be explicitly allowed
3. Filesystem access is restricted to allowed paths
4. Memory and CPU limits are enforced
5. Timeouts prevent infinite loops

### Permission Model

```yaml
permissions:
  - network     # Allow network access
  - filesystem  # Allow filesystem access
  - gpu         # Allow GPU access
```

---

## Example

### Input

```markdown
---
id: hello
version: 1.0.0
name: Hello
runtime: python
---

## Python

```python
def greet(name):
    return f"Hello, {name}!"
```
```

### Execution

```typescript
const runtime = new Runtime();
const result = await runtime.execute(ast, {
  inputs: { name: "World" }
});

console.log(result.output);
// { "greet": "Hello, World!" }
```

---

## References

- [Parser Architecture](./parser.md)
- [AST Architecture](./ast.md)
- [Runtime API](../api/runtime.md)

---

**Last Updated:** 2026-07-24
**MAM Version:** 1.0.0
