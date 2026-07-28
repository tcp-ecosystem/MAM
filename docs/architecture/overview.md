# Architecture Overview

> **High-level system design of MAM.**

---

## System Overview

MAM is a specification-first system that transforms Markdown into executable modules. The architecture follows a pipeline pattern with clear separation of concerns.

---

## High-Level Architecture

```
Human Intent
      │
      ▼
Markdown (.mam.md)
      │
      ▼
MAM Parser (Lexer → Parser)
      │
      ▼
MAM AST (Intermediate Representation)
      │
      ├── Compiler Targets
      │   ├── Python
      │   ├── JavaScript
      │   ├── Go
      │   ├── Rust
      │   ├── OpenAI
      │   ├── LangGraph
      │   ├── CrewAI
      │   └── Claude
      │
      └── Runtime Engine
          ├── Execution Contexts
          ├── Sandboxes
          └── Output Formats
```

---

## Core Components

### 1. Parser

Transforms raw Markdown into structured tokens and AST.

```
┌─────────────────────────────────────────┐
│              Parser                     │
├─────────────────────────────────────────┤
│  Lexer                                 │
│  ├── Tokenizer                         │
│  ├── Token Definitions                 │
│  └── Error Recovery                    │
├─────────────────────────────────────────┤
│  Parser                                │
│  ├── Front Matter Parser               │
│  ├── Section Parser                    │
│  ├── Code Block Parser                 │
│  └── DSL Parser                        │
└─────────────────────────────────────────┘
```

**Responsibilities:**
- Lexing: Tokenize Markdown content
- Parsing: Build AST from tokens
- Section Detection: Identify MAM sections
- Code Block Extraction: Parse embedded code
- Front Matter Processing: Parse YAML metadata
- Error Recovery: Handle malformed input

### 2. AST (Abstract Syntax Tree)

Represents the parsed structure in memory.

```
┌─────────────────────────────────────────┐
│              AST                        │
├─────────────────────────────────────────┤
│  Node Types                            │
│  ├── MAMModule                         │
│  ├── FrontMatter                       │
│  ├── Section                           │
│  ├── CodeBlock                         │
│  ├── Content                           │
│  └── V2 Nodes (Agent, Tool, etc.)      │
├─────────────────────────────────────────┤
│  Utilities                             │
│  ├── Visitor Pattern                   │
│  ├── Traversal                         │
│  ├── Serialization (JSON, YAML)        │
│  └── Source Locations                  │
└─────────────────────────────────────────┘
```

**Responsibilities:**
- Define node types for each section
- Provide traversal utilities
- Support serialization/deserialization
- Maintain source locations
- Enable pattern matching

### 3. Validator

Checks AST correctness against the specification.

```
┌─────────────────────────────────────────┐
│              Validator                  │
├─────────────────────────────────────────┤
│  Rules                                 │
│  ├── Schema Validation                 │
│  ├── Required Field Checks             │
│  ├── Section Ordering                  │
│  ├── Dependency Resolution             │
│  ├── Reference Validation              │
│  └── Custom Rules                      │
├─────────────────────────────────────────┤
│  Reporters                             │
│  ├── Console                           │
│  ├── JSON                              │
│  └── LSP                               │
└─────────────────────────────────────────┘
```

**Responsibilities:**
- Schema validation
- Required field checks
- Section ordering validation
- Dependency resolution
- Reference validation
- Custom rule support

### 4. Compiler

Transforms AST to target languages.

```
┌─────────────────────────────────────────┐
│              Compiler                   │
├─────────────────────────────────────────┤
│  Targets                               │
│  ├── Python                            │
│  ├── JavaScript / TypeScript           │
│  ├── Go                                │
│  ├── Rust                              │
│  ├── OpenAI SDK                        │
│  ├── LangGraph                         │
│  ├── CrewAI                            │
│  ├── Claude SDK                        │
│  └── Docker                            │
├─────────────────────────────────────────┤
│  Features                              │
│  ├── Code Generation                   │
│  ├── Dependency Injection              │
│  ├── Type Mapping                      │
│  └── Optimization                      │
└─────────────────────────────────────────┘
```

**Responsibilities:**
- Transform AST to target language code
- Map MAM types to target types
- Handle dependencies and imports
- Optimize generated code

### 5. Runtime

Executes MAM modules in sandboxed environments.

```
┌─────────────────────────────────────────┐
│              Runtime                    │
├─────────────────────────────────────────┤
│  Execution Contexts                    │
│  ├── Python Context                    │
│  ├── JavaScript Context                │
│  ├── Rust Context (future)             │
│  └── Go Context (future)               │
├─────────────────────────────────────────┤
│  Sandboxes                             │
│  ├── Process Sandbox                   │
│  ├── VM Sandbox                        │
│  └── Docker Sandbox (future)           │
├─────────────────────────────────────────┤
│  Outputs                               │
│  ├── JSON                              │
│  ├── HTML                              │
│  └── Markdown                          │
└─────────────────────────────────────────┘
```

**Responsibilities:**
- Load AST
- Create execution context
- Invoke plugins
- Execute embedded code
- Return outputs
- Manage sandbox

### 6. CLI

Command-line interface for developers.

```
┌─────────────────────────────────────────┐
│              CLI                        │
├─────────────────────────────────────────┤
│  Commands                              │
│  ├── mam init                          │
│  ├── mam build                         │
│  ├── mam validate                      │
│  ├── mam lint                          │
│  ├── mam format                        │
│  ├── mam graph                         │
│  ├── mam ast                           │
│  ├── mam execute                       │
│  ├── mam export                        │
│  ├── mam compile                       │
│  ├── mam doctor                        │
│  ├── mam docs                          │
│  ├── mam test                          │
│  ├── mam serve                         │
│  └── mam publish                       │
└─────────────────────────────────────────┘
```

### 7. Plugin API

Extensibility system for the ecosystem.

```
┌─────────────────────────────────────────┐
│              Plugin API                 │
├─────────────────────────────────────────┤
│  Hook Manager                          │
│  ├── beforeParse                       │
│  ├── afterParse                        │
│  ├── beforeExecute                     │
│  ├── afterExecute                      │
│  └── onError                           │
├─────────────────────────────────────────┤
│  Plugin Registry                       │
│  ├── Discovery                         │
│  ├── Loading                           │
│  ├── Lifecycle                         │
│  └── Enable/Disable                    │
├─────────────────────────────────────────┤
│  Core Plugins                          │
│  ├── YAML                              │
│  ├── Mermaid                           │
│  ├── Python                            │
│  └── Memory                            │
└─────────────────────────────────────────┘
```

### 8. Language Server (LSP)

IDE integration for real-time feedback.

```
┌─────────────────────────────────────────┐
│              LSP                        │
├─────────────────────────────────────────┤
│  Features                              │
│  ├── Autocomplete                      │
│  ├── Diagnostics                       │
│  ├── Validation                        │
│  ├── Hover Information                 │
│  ├── Go to Definition                  │
│  ├── Find References                   │
│  ├── Formatting                        │
│  └── Code Actions                      │
└─────────────────────────────────────────┘
```

### 9. Module Registry

Package management for MAM modules.

```
┌─────────────────────────────────────────┐
│              Registry                   │
├─────────────────────────────────────────┤
│  Features                              │
│  ├── Module Discovery                  │
│  ├── Version Management                │
│  ├── Dependency Resolution             │
│  ├── Authentication                    │
│  ├── Publishing                        │
│  └── Searching                         │
└─────────────────────────────────────────┘
```

---

## Data Flow

```
┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐
│ Markdown │───▶│  Lexer  │───▶│ Parser  │───▶│   AST   │
└─────────┘    └─────────┘    └─────────┘    └─────────┘
                                                       │
                                                       ▼
┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐
│  Output │◀───│ Runtime │◀───│Compiler │◀───│Validator│
└─────────┘    └─────────┘    └─────────┘    └─────────┘
     │
     ├──▶ JSON
     ├──▶ HTML
     ├──▶ Markdown
     └──▶ Target Language Code
```

---

## Error Handling

The system uses a multi-layered error handling approach:

| Layer | Error Type | Response |
|-------|------------|----------|
| Lexer | Token errors | Recovery or abort |
| Parser | Parse errors | Recovery or abort |
| Validator | Validation errors | Report all errors |
| Compiler | Compile errors | Report with context |
| Runtime | Runtime errors | Catch and report |

---

## Security Model

### Sandboxing

All code execution happens in sandboxes:
- Process isolation
- Memory limits
- CPU time limits
- Network restrictions
- Filesystem restrictions

### Permission System

Modules declare required permissions:

```yaml
permissions:
  - network
  - filesystem
  - cpu
  - memory
```

---

## Performance Considerations

| Component | Target | Strategy |
|-----------|--------|----------|
| Lexer | >10K lines/s | Incremental tokenization |
| Parser | >5K modules/s | Streaming parse |
| Validator | >10K checks/s | Parallel validation |
| Compiler | >1K modules/s | Template-based generation |
| Runtime | >100 exec/s | Process pooling |

---

## Scalability

### Horizontal Scaling

- Parser: Stateless, easily parallelized
- Validator: Stateless, easily parallelized
- Compiler: Stateless, easily parallelized
- Runtime: Process isolation enables scaling

### Vertical Scaling

- AST: In-memory, benefits from more RAM
- Registry: Database-backed, benefits from faster storage

---

## References

- [Parser Architecture](./parser.md)
- [AST Architecture](./ast.md)
- [Compiler Architecture](./compiler.md)
- [Runtime Architecture](./runtime.md)
- [Validator Architecture](./validator.md)
- [LSP Architecture](./lsp.md)
- [CLI Architecture](./cli.md)

---

**Last Updated:** 2026-07-24
**MAM Version:** 1.0.0
