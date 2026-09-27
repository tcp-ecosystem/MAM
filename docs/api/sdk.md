# SDK Reference

> **Language SDK documentation for MAM.**

---

## Overview

MAM provides SDKs for multiple programming languages. This reference covers the Python and JavaScript SDKs.

---

## Python SDK

### Installation

```bash
pip install mam-sdk
```

### Usage

```python
from mam import Parser, Validator, Runtime

# Parse module
parser = Parser()
ast = parser.parse(module_content)

# Validate
validator = Validator()
report = validator.validate(ast)

# Execute
runtime = Runtime()
result = runtime.execute(ast, inputs={"name": "World"})
```

### Classes

#### Parser

```python
class Parser:
    def parse(self, content: str) -> MAMModule:
        """Parse MAM module content."""
        pass
```

#### Validator

```python
class Validator:
    def __init__(self, level: str = "schema"):
        pass
    
    def validate(self, ast: MAMModule) -> ValidationReport:
        """Validate MAM module."""
        pass
```

#### Runtime

```python
class Runtime:
    def __init__(self, sandbox_type: str = "process"):
        pass
    
    def execute(
        self,
        ast: MAMModule,
        inputs: dict = None
    ) -> ExecutionResult:
        """Execute MAM module."""
        pass
```

### Example

```python
from mam import Parser, Validator, Runtime

module = """
---
id: hello
version: 2.0.0
name: Hello
author: LifeJiggy
runtime: python
---

## Purpose

A simple hello module.

## Python

```python
def greet(name):
    return f"Hello, {name}!"
```
"""

# Parse
parser = Parser()
ast = parser.parse(module)

# Validate
validator = Validator(level="strict")
report = validator.validate(ast)
print(f"Valid: {report.valid}")

# Execute
runtime = Runtime()
result = runtime.execute(ast, inputs={"name": "World"})
print(f"Output: {result.output}")
```

---

## JavaScript SDK

### Installation

```bash
npm install @mam/sdk
```

### Usage

```typescript
import { Parser, Validator, Runtime } from '@mam/sdk';

// Parse module
const parser = new Parser();
const ast = parser.parse(moduleContent);

// Validate
const validator = new Validator({ level: 'schema' });
const report = validator.validate(ast);

// Execute
const runtime = new Runtime();
const result = await runtime.execute(ast, { inputs: { name: "World" } });
```

### Classes

#### Parser

```typescript
class Parser {
  parse(content: string): MAMModule;
}
```

#### Validator

```typescript
class Validator {
  constructor(config?: ValidatorConfig);
  validate(ast: MAMModule): ValidationReport;
}
```

#### Runtime

```typescript
class Runtime {
  constructor(config?: RuntimeConfig);
  execute(
    ast: MAMModule,
    options?: ExecutionOptions
  ): Promise<ExecutionResult>;
}
```

### Example

```typescript
import { Parser, Validator, Runtime } from '@mam/sdk';

const module = `
---
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

// Parse
const parser = new Parser();
const ast = parser.parse(module);

// Validate
const validator = new Validator({ level: 'strict' });
const report = validator.validate(ast);
console.log(`Valid: ${report.valid}`);

// Execute
const runtime = new Runtime();
const result = await runtime.execute(ast, { inputs: { name: "World" } });
console.log(`Output: ${result.output}`);
```

---

## Compiler

### Python

```python
from mam import Compiler

compiler = Compiler()
result = compiler.compile(ast, target="python")
print(result.output)
```

### JavaScript

```typescript
import { Compiler } from '@mam/sdk';

const compiler = new Compiler();
const result = compiler.compile(ast, { target: 'python' });
console.log(result.output);
```

---

## References

- [Parser API](./parser.md)
- [AST API](./ast.md)
- [Runtime API](./runtime.md)
- [Validator API](./validator.md)

---

**Last Updated:** 2026-07-24
**MAM Version:** 1.0.0
