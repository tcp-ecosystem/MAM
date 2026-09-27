# CLI Architecture

> **Command-line interface for MAM.**

---

## Overview

The CLI provides a comprehensive set of commands for working with MAM modules. It's built with Commander.js and follows a modular architecture.

---

## Commands

| Command | Description |
|---------|-------------|
| `mam init` | Initialize a new MAM module |
| `mam build` | Build module to AST |
| `mam validate` | Validate a MAM module |
| `mam lint` | Lint a MAM module |
| `mam format` | Format a MAM module |
| `mam graph` | Show dependency graph |
| `mam ast` | Dump AST |
| `mam execute` | Execute module |
| `mam export` | Export to other formats |
| `mam compile` | Compile to target language |
| `mam doctor` | Check environment |
| `mam docs` | Generate documentation |
| `mam test` | Run module tests |
| `mam serve` | Start development server |
| `mam install` | Install dependencies |
| `mam publish` | Publish to registry |
| `mam run` | Run module |
| `mam migrate` | Migrate module |

---

## CLI Structure

```
┌─────────────────────────────────────────┐
│              CLI Entry Point            │
├─────────────────────────────────────────┤
│  Commands                              │
│  ├── init                              │
│  ├── build                             │
│  ├── validate                          │
│  ├── lint                              │
│  ├── format                            │
│  ├── graph                             │
│  ├── ast                               │
│  ├── execute                           │
│  ├── export                            │
│  ├── compile                           │
│  ├── doctor                            │
│  ├── docs                              │
│  ├── test                              │
│  ├── serve                             │
│  ├── install                           │
│  └── publish                           │
├─────────────────────────────────────────┤
│  Utilities                             │
│  ├── config                            │
│  ├── logger                            │
│  └── spinner                           │
├─────────────────────────────────────────┤
│  Templates                             │
│  ├── basic                             │
│  ├── full                              │
│  └── agent                             │
└─────────────────────────────────────────┘
```

---

## Entry Point

```typescript
#!/usr/bin/env node

import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf-8'));

const program = new Command();

program
  .name('mam')
  .description('MAM — Markdown as Module CLI')
  .version(pkg.version);

// Register commands
// ...

program.parse();
```

---

## Command Architecture

Each command follows a consistent pattern:

```typescript
interface CommandOptions {
  file?: string;
  target?: string;
  format?: string;
  verbose?: boolean;
  quiet?: boolean;
}

async function commandHandler(options: CommandOptions): Promise<void> {
  // 1. Parse options
  // 2. Load configuration
  // 3. Execute command
  // 4. Output results
  // 5. Handle errors
}
```

---

## Utilities

### Config

Manages configuration loading and saving:

```typescript
interface Config {
  defaultRuntime: string;
  validationLevel: string;
  sandboxType: string;
  outputFormat: string;
  plugins: string[];
}

function loadConfig(): Config;
function saveConfig(config: Config): void;
```

### Logger

Provides colored output:

```typescript
class Logger {
  info(message: string): void;
  success(message: string): void;
  warning(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}
```

### Spinner

Shows progress for long operations:

```typescript
class Spinner {
  start(message: string): void;
  update(message: string): void;
  succeed(message: string): void;
  fail(message: string): void;
  stop(): void;
}
```

---

## Templates

### Basic Template

```markdown
---
id: ${name}
version: 2.0.0
name: ${name}
author: ${author}
runtime: python
---

## Purpose

Describe your module here.

## Python

```python
def process():
    pass
```
```

### Full Template

Includes all standard sections with examples.

### Agent Template

Includes Prompt and Memory sections for AI agents.

---

## Error Handling

```typescript
try {
  await commandHandler(options);
} catch (error) {
  if (error instanceof MAMError) {
    logger.error(error.message);
    if (options.verbose) {
      logger.debug(error.stack);
    }
    process.exit(1);
  } else {
    logger.error('Unexpected error');
    logger.debug(error);
    process.exit(2);
  }
}
```

---

## Example Usage

### Initialize Module

```bash
mam init
# ? Module name: my-module
# ? Author: LifeJiggy
# ? Runtime: python
# ✓ Created my-module.mam.md
```

### Validate Module

```bash
mam validate my-module.mam.md
# ✓ Validation passed
```

### Build Module

```bash
mam build my-module.mam.md
# ✓ Module built successfully
```

### Export Module

```bash
mam export my-module.mam.md --format json
# ✓ Exported to my-module.json
```

---

## Performance

| Operation | Target | Strategy |
|-----------|--------|----------|
| Startup | <50ms | Lazy loading |
| Validation | <100ms | Incremental |
| Build | <200ms | Parallel processing |

---

## References

- [CLI API](../api/cli.md)
- [Architecture Overview](./overview.md)

---

**Last Updated:** 2026-07-24
**MAM Version:** 1.0.0
