# Runtime API Reference

> **API documentation for the MAM runtime.**

---

## Overview

The runtime executes MAM modules in sandboxed environments. This reference covers all public APIs.

---

## Imports

```typescript
import {
  Runtime,
  RuntimeConfig,
  RuntimeExecutionOptions,
  ModuleExecutionResult
} from '@mam/runtime';
```

---

## Types

### RuntimeConfig

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

### RuntimeExecutionOptions

```typescript
interface RuntimeExecutionOptions {
  sections?: string[];
  inputs?: Record<string, unknown>;
  env?: Record<string, string>;
  timeout?: number;
}
```

### ModuleExecutionResult

```typescript
interface ModuleExecutionResult {
  success: boolean;
  validation?: ValidationReport;
  sectionResults: Map<string, ExecutionResult>;
  output: Record<string, unknown>;
  duration: number;
}

interface ExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  duration: number;
  memoryUsed: number;
}
```

---

## Classes

### Runtime

Main runtime class.

```typescript
class Runtime {
  constructor(config?: RuntimeConfig);
  
  execute(
    ast: MAMModule,
    options?: RuntimeExecutionOptions
  ): Promise<ModuleExecutionResult>;
  
  validate(ast: MAMModule): ValidationReport;
}
```

**Example:**

```typescript
import { Runtime } from '@mam/runtime';
import { parse } from '@mam/parser';

const runtime = new Runtime({
  sandboxType: 'process',
  validateBeforeExecution: true
});

const result = parse(moduleContent);
const execution = await runtime.execute(result.ast, {
  inputs: { name: "World" }
});

console.log(execution.output);
```

---

## Execution Context

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

---

## Sandbox

```typescript
interface Sandbox {
  execute(code: string, config: SandboxConfig): Promise<string>;
}

interface SandboxConfig {
  timeout: number;
  memory: number;
  network: boolean;
  filesystem: boolean;
  allowedPaths: string[];
  env: Record<string, string>;
}
```

---

## Example

```typescript
import { Runtime } from '@mam/runtime';
import { parse } from '@mam/parser';

const moduleContent = `---
id: hello
version: 2.0.0
name: Hello
runtime: python
---

## Python

\`\`\`python
def greet(name):
    return f"Hello, {name}!"
\`\`\`
`;

async function main() {
  const result = parse(moduleContent);
  const runtime = new Runtime();
  
  const execution = await runtime.execute(result.ast, {
    inputs: { name: "World" }
  });
  
  if (execution.success) {
    console.log('Output:', execution.output);
  } else {
    console.error('Error:', execution.sectionResults);
  }
}

main();
```

---

## References

- [Runtime Architecture](../architecture/runtime.md)
- [Parser API](./parser.md)

---

**Last Updated:** 2026-07-24
**MAM Version:** 1.0.0
