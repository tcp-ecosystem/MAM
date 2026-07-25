# MAM Architecture

> **Write once. Read by humans. Execute by agents.**

---

## Overview

MAM (Markdown as Module) is a specification-first project that transforms Markdown into a universal Intermediate Representation (IR) for AI systems. The architecture follows a layered design with clear separation of concerns.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          MAM System                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐             │
│  │    CLI      │    │    SDK      │    │    LSP      │             │
│  │  (Command)  │    │  (Library)  │    │  (IDE)      │             │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘             │
│         │                  │                  │                     │
│         └──────────────────┼──────────────────┘                     │
│                            │                                        │
│                            ▼                                        │
│                   ┌─────────────────┐                               │
│                   │     Runtime     │                               │
│                   │   (Execution)   │                               │
│                   └────────┬────────┘                               │
│                            │                                        │
│              ┌─────────────┼─────────────┐                          │
│              │             │             │                          │
│              ▼             ▼             ▼                          │
│      ┌──────────┐  ┌──────────┐  ┌──────────┐                      │
│      │ Context  │  │ Sandbox  │  │ Plugins  │                      │
│      └──────────┘  └──────────┘  └──────────┘                      │
│                                                                     │
│                            │                                        │
│                            ▼                                        │
│                   ┌─────────────────┐                               │
│                   │    Validator    │                               │
│                   │  (Validation)   │                               │
│                   └────────┬────────┘                               │
│                            │                                        │
│                            ▼                                        │
│                   ┌─────────────────┐                               │
│                   │      AST        │                               │
│                   │ (Abstract Tree) │                               │
│                   └────────┬────────┘                               │
│                            │                                        │
│                            ▼                                        │
│                   ┌─────────────────┐                               │
│                   │     Parser      │                               │
│                   │  (Lexer+Parse)  │                               │
│                   └────────┬────────┘                               │
│                            │                                        │
│                            ▼                                        │
│                   ┌─────────────────┐                               │
│                   │  Specification  │                               │
│                   │   (Language)    │                               │
│                   └─────────────────┘                               │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow

```
┌──────────────┐
│  .mam.md     │  ← User writes Markdown
│  (Input)     │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│   Lexer      │  ← Tokenizes Markdown
│  (Tokens)    │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│   Parser     │  ← Builds AST from tokens
│  (AST)       │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  Validator   │  ← Validates AST against spec
│  (Valid)     │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│   Runtime    │  ← Executes module
│  (Output)    │
└──────────────┘
```

---

## Component Details

### 1. Specification (`spec/`)

The specification defines the MAM language standard.

**Files:**
- `spec/SPEC.md` - Formal specification document
- `spec/schema/` - JSON Schema definitions
- `spec/sections/` - Section type definitions
- `spec/grammar/` - BNF grammar

**Responsibilities:**
- Define valid syntax
- Define section types
- Define metadata schema
- Define validation rules

---

### 2. Parser (`parser/`)

The parser converts raw Markdown into structured tokens and AST.

**Files:**
- `parser/src/lexer/` - Tokenizer
- `parser/src/parser/` - Parser
- `parser/src/utils/` - Utilities

**Architecture:**

```
Input String
      │
      ▼
┌─────────────┐
│   Tokenizer │  ← Converts to tokens
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   Parser    │  ← Builds AST from tokens
└──────┬──────┘
       │
       ▼
    AST
```

**Key Classes:**
- `Tokenizer` - Lexical analysis
- `MAMParser` - Syntax analysis

---

### 3. AST (`ast/`)

The AST defines the node types and traversal patterns.

**Files:**
- `ast/src/nodes/` - Node definitions
- `ast/src/visitor/` - Visitor pattern
- `ast/src/serializer/` - Serialization
- `ast/src/location/` - Source locations

**Node Types:**

| Node | Description |
|------|-------------|
| `MAMModule` | Root node |
| `FrontMatter` | YAML metadata |
| `Section` | Content section |
| `Paragraph` | Text content |
| `CodeBlock` | Code with language |
| `Table` | Tabular data |
| `List` | Ordered/unordered list |
| `Mermaid` | Diagram definition |
| `Heading` | Section heading |
| `Blockquote` | Quoted content |

---

### 4. Validator (`validator/`)

The validator checks AST correctness against the specification.

**Files:**
- `validator/src/rules/` - Validation rules
- `validator/src/errors/` - Error types
- `validator/src/reporters/` - Output formatters

**Validation Levels:**

| Level | Description |
|-------|-------------|
| `syntax` | Valid Markdown structure |
| `schema` | Valid YAML front matter |
| `semantic` | Correct section content |
| `strict` | All rules enforced |

---

### 5. Runtime (`runtime/`)

The runtime executes MAM modules.

**Files:**
- `runtime/src/contexts/` - Execution contexts
- `runtime/src/sandboxes/` - Isolation sandboxes
- `runtime/src/plugins/` - Plugin loading
- `runtime/src/outputs/` - Output formats

**Architecture:**

```
┌─────────────┐
│   Module    │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   Runtime   │
└──────┬──────┘
       │
       ├─────────────┐
       │             │
       ▼             ▼
┌──────────┐  ┌──────────┐
│ Context  │  │ Sandbox  │
└──────────┘  └──────────┘
```

---

### 6. CLI (`cli/`)

The CLI provides command-line interface.

**Commands:**
- `mam validate` - Validate modules
- `mam ast` - Display AST
- `mam execute` - Execute modules
- `mam format` - Format modules
- `mam lint` - Lint modules
- `mam init` - Initialize modules

---

## Package Structure

```
mam-workspace/
├── packages/
│   ├── spec/           # Specification
│   ├── parser/         # Parser (@mam/parser)
│   ├── ast/            # AST (@mam/ast)
│   ├── validator/      # Validator (@mam/validator)
│   ├── runtime/        # Runtime (@mam/runtime)
│   ├── cli/            # CLI (@mam/cli)
│   ├── sdk/            # SDK packages
│   ├── plugins/        # Plugin system
│   └── lsp/            # Language Server
├── pnpm-workspace.yaml
├── turbo.json
└── tsconfig.json
```

---

## Technology Stack

| Component | Technology |
|-----------|------------|
| Language | TypeScript |
| Runtime | Node.js 20+ |
| Package Manager | pnpm |
| Build System | Turbo |
| Testing | Vitest |
| Linting | ESLint |
| Formatting | Prettier |
| CI/CD | GitHub Actions |

---

## Design Principles

### 1. Separation of Concerns

Each component has a single responsibility:
- Parser: Converts text to AST
- AST: Defines structure
- Validator: Checks correctness
- Runtime: Executes code

### 2. Composability

Components can be used independently:
- Use parser without runtime
- Use validator without CLI
- Use AST without parser

### 3. Extensibility

The plugin system allows:
- Custom section types
- Custom validation rules
- Custom runtimes
- Custom exporters

### 4. Determinism

Same input always produces:
- Same tokens
- Same AST
- Same validation result

### 5. Error Recovery

The parser recovers from errors:
- Continues parsing after errors
- Collects all errors
- Provides helpful messages

---

## Performance Considerations

### Parser Optimization

- Lazy tokenization
- Incremental parsing
- Memory pooling
- Source map support

### AST Optimization

- Structural sharing
- Lazy evaluation
- Efficient traversal
- Minimal allocations

### Runtime Optimization

- Code caching
- Context reuse
- Parallel execution
- Resource limits

---

## Security Model

### Sandboxing

All code execution is sandboxed:
- Process isolation
- Memory limits
- CPU time limits
- Network restrictions
- Filesystem restrictions

### Permissions

Modules declare required permissions:
- `network` - HTTP access
- `filesystem` - File access
- `environment` - Env vars
- `exec` - Process spawning
- `memory` - Large allocations

### Validation

Security validation includes:
- Input sanitization
- Code analysis
- Dependency checking
- Permission verification

---

## Future Architecture

### Phase 1 (Current)
- Core parser
- Basic AST
- Simple validation
- Node.js runtime

### Phase 2
- Multi-language support
- Plugin system
- CLI tools
- SDK packages

### Phase 3
- Language Server
- Module Registry
- Cloud execution
- Advanced security

---

**Last Updated:** 2026-07-24
**Version:** 1.0.0