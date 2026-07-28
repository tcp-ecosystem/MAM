# CLI API Reference

> **API documentation for the MAM CLI.**

---

## Overview

The CLI provides command-line tools for working with MAM modules. This reference covers all commands and options.

---

## Installation

```bash
npm install -g @mam/cli
```

---

## Commands

### mam init

Initialize a new MAM module.

```bash
mam init [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--template <name>` | Template to use (basic, full, agent) |
| `--name <name>` | Module name |
| `--author <name>` | Author name |
| `--runtime <runtime>` | Runtime (python, javascript) |

**Example:**

```bash
mam init --template full --name my-module --author LifeJiggy
```

---

### mam validate

Validate a MAM module.

```bash
mam validate <file> [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--level <level>` | Validation level (syntax, schema, semantic, strict) |
| `--format <format>` | Output format (json, text) |

**Example:**

```bash
mam validate my-module.mam.md --level strict
```

---

### mam build

Build module to AST.

```bash
mam build <file> [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--output <path>` | Output directory |
| `--format <format>` | Output format (json, yaml) |

---

### mam lint

Lint a MAM module.

```bash
mam lint <file> [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--fix` | Auto-fix issues |
| `--format <format>` | Output format |

---

### mam format

Format a MAM module.

```bash
mam format <file> [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--in-place` | Format in place |
| `--check` | Check only, don't modify |

---

### mam ast

Dump AST.

```bash
mam ast <file> [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--format <format>` | Output format (json, yaml, pretty) |
| `--stats` | Show statistics |

---

### mam export

Export to other formats.

```bash
mam export <file> [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--format <format>` | Export format (json, html, markdown) |
| `--output <path>` | Output file |

---

### mam compile

Compile to target language.

```bash
mam compile <file> [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `-t, --target <target>` | Target language |
| `--output <path>` | Output file |

**Targets:**

- `python`
- `javascript`
- `typescript`
- `go`
- `rust`
- `openai`
- `langgraph`
- `crewai`
- `claude`

---

### mam doctor

Check environment.

```bash
mam doctor
```

---

### mam docs

Generate documentation.

```bash
mam docs <file> [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--output <path>` | Output directory |

---

### mam test

Run module tests.

```bash
mam test <file> [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--verbose` | Verbose output |

---

### mam serve

Start development server.

```bash
mam serve [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--port <port>` | Server port |
| `--host <host>` | Server host |

---

### mam install

Install dependencies.

```bash
mam install [options]
```

---

### mam publish

Publish to registry.

```bash
mam publish [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--registry <url>` | Registry URL |
| `--tag <tag>` | Version tag |

---

### mam run

Run module.

```bash
mam run <file> [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--input <data>` | Input data (JSON) |
| `--section <name>` | Specific section to run |

---

### mam migrate

Migrate module to new version.

```bash
mam migrate <file> [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--from <version>` | Source version |
| `--to <version>` | Target version |

---

### mam graph

Show dependency graph.

```bash
mam graph [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--format <format>` | Output format (text, mermaid) |

---

## Global Options

| Option | Description |
|--------|-------------|
| `--help` | Show help |
| `--version` | Show version |
| `--verbose` | Verbose output |
| `--quiet` | Quiet output |

---

## Configuration

### mam.config.json

```json
{
  "defaultRuntime": "python",
  "validationLevel": "schema",
  "sandboxType": "process",
  "outputFormat": "json",
  "plugins": []
}
```

---

## Example Workflow

```bash
# Initialize
mam init --name my-module

# Develop
mam validate my-module.mam.md
mam lint my-module.mam.md

# Build
mam build my-module.mam.md

# Test
mam test my-module.mam.md

# Export
mam export my-module.mam.md --format json

# Publish
mam publish
```

---

## References

- [CLI Architecture](../architecture/cli.md)
- [Writing Modules](../guides/writing-modules.md)

---

**Last Updated:** 2026-07-24
**MAM Version:** 1.0.0
