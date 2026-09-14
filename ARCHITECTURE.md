# MAM Architecture

> **Write once. Read by humans. Execute by agents. Compile anywhere.**

---

## Overview

MAM (Markdown as Module) is a System Description Language (SDL) whose reference syntax is Markdown. The architecture follows a layered design with clear separation of concerns, enabling developers to describe intelligent systems once and compile them to 16 target languages.

**Current Status:** Beta-ready • 19 packages • 2300+ tests • 34 CLI commands • 16 compiler targets

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           MAM System                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌───────────┐   ┌───────────┐   ┌───────────┐   ┌───────────┐         │
│  │    CLI    │   │    SDK    │   │    LSP    │   │  Testing  │         │
│  │  (34 cmd) │   │ (4 langs) │   │  (IDE)    │   │ Framework │         │
│  └─────┬─────┘   └─────┬─────┘   └─────┬─────┘   └─────┬─────┘         │
│        │               │               │               │                │
│        └───────────────┼───────────────┼───────────────┘                │
│                        │               │                                │
│                        ▼               ▼                                │
│               ┌─────────────────────────────┐                          │
│               │         Compiler            │                          │
│               │    (16 Target Backends)     │                          │
│               └─────────────┬───────────────┘                          │
│                             │                                           │
│               ┌─────────────┼─────────────┐                             │
│               │             │             │                             │
│               ▼             ▼             ▼                             │
│       ┌──────────┐  ┌──────────┐  ┌──────────┐                         │
│       │Transformer│  │ Analyzer │  │Validator │                         │
│       └─────┬────┘  └─────┬────┘  └─────┬────┘                         │
│             │             │             │                               │
│             └─────────────┼─────────────┘                               │
│                           │                                             │
│                           ▼                                             │
│                  ┌─────────────────┐                                    │
│                  │   V2ModuleNode  │                                    │
│                  │  (Universal IR) │                                    │
│                  └────────┬────────┘                                    │
│                           │                                             │
│                           ▼                                             │
│                  ┌─────────────────┐                                    │
│                  │      AST        │                                    │
│                  │  (MAMModule)    │                                    │
│                  └────────┬────────┘                                    │
│                           │                                             │
│                           ▼                                             │
│                  ┌─────────────────┐                                    │
│                  │     Parser      │                                    │
│                  │  (Lexer+Parse)  │                                    │
│                  └────────┬────────┘                                    │
│                           │                                             │
│                           ▼                                             │
│                  ┌─────────────────┐                                    │
│                  │  Specification  │                                    │
│                  │   (Language)    │                                    │
│                  └─────────────────┘                                    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow

The complete compilation pipeline:

```
┌──────────────┐
│  .mam.md     │  ← User writes Markdown with YAML frontmatter
│  (Input)     │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│   Lexer      │  ← Tokenizes Markdown (1200+ lines)
│  (Tokens)    │    Handles: headings, lists, tables, code blocks
└──────┬───────┘
       │
       ▼
┌──────────────┐
│   Parser     │  ← Builds MAMModule AST from tokens
│  (MAMModule) │    Sections, frontmatter, content nodes
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Transformer  │  ← Converts MAMModule → V2ModuleNode
│(V2ModuleNode)│    Type inference, field extraction
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  Validator   │  ← Validates against specification
│  (Valid)     │    19 rules, multiple severity levels
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  Compiler    │  ← Generates target code
│  (16 targets)│    Type-specific dispatch
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  Output      │  ← .mam.{py,js,go,rs,cs,java,...}
│  (Target)    │
└──────────────┘
```

---

## Component Details

### 1. Specification (`spec/`)

The specification defines the MAM language standard.

**Files:**
- `spec/SPEC.md` — Formal specification (25KB)
- `spec/schema/` — JSON Schema definitions
- `spec/sections/` — 19 section type definitions
- `spec/grammar/` — BNF grammar (v1 and v2)

**Responsibilities:**
- Define valid syntax
- Define 19 section types
- Define metadata schema
- Define validation rules

---

### 2. Parser (`parser/`)

The parser converts raw Markdown into structured tokens and AST.

**Package:** `@mam/parser` • **Tests:** 170

**Files:**
- `parser/src/lexer/tokenizer.ts` — Tokenizer (1200+ lines)
- `parser/src/lexer/tokens.ts` — Token definitions
- `parser/src/parser/mam.ts` — Main parser
- `parser/src/parser/sections.ts` — Section parser
- `parser/src/parser/frontmatter.ts` — YAML parser
- `parser/src/parser/dsl.ts` — DSL parser (v2)

**Architecture:**

```
Input String
      │
      ▼
┌─────────────┐
│  Tokenizer  │  ← Converts to tokens (50+ types)
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   Parser    │  ← Builds MAMModule AST
└──────┬──────┘
       │
       ▼
    MAMModule
```

**Token Types:** 50+ including HEADING_1-6, BULLET_LIST, TABLE_ROW_CELL, CODE_FENCE, FRONTMATTER_SEPARATOR, YAML_KEY/VALUE, INDENT, NEWLINE

**Key Features:**
- Deterministic parsing (same input → same AST)
- Error recovery (continues after errors)
- Source location tracking
- Indented list support
- MAM edge syntax (`->`) support

---

### 3. AST (`ast/`)

The AST defines the node types and traversal patterns.

**Package:** `@mam/ast` • **Tests:** 482

**Files:**
- `ast/src/nodes/index.ts` — v1 node types (MAMModule)
- `ast/src/nodes/v2.ts` — v2 node types (V2ModuleNode)
- `ast/src/visitor/visitor.ts` — Visitor pattern
- `ast/src/serializer/index.ts` — JSON serializer
- `ast/src/location/index.ts` — Source locations

**Node Types:**

| Node | Description |
|------|-------------|
| `MAMModule` | Root node (v1) |
| `V2ModuleNode` | Universal IR (v2) |
| `FrontMatter` | YAML metadata |
| `Section` | Content section |
| `Paragraph` | Text content |
| `CodeBlock` | Code with language |
| `Table` | Tabular data |
| `List` | Ordered/unordered list |
| `Mermaid` | Diagram definition |
| `Heading` | Section heading |
| `Blockquote` | Quoted content |

**V2ModuleNode Fields:**
```typescript
interface V2ModuleNode {
  id: string;
  name: string;
  version: string;
  type: ModuleType;      // 25+ types
  description?: string;
  inputs?: Field[];
  outputs?: Field[];
  rules?: string[];
  prompts?: string[];
  permissions?: Permission[];
  agents?: AgentDefinition[];
  tools?: ToolDefinition[];
  memory?: MemoryDefinition[];
  workflow?: WorkflowDefinition[];
  // ... more fields
}
```

---

### 4. Transformer (`compiler/src/transformer.ts`)

The transformer converts MAMModule → V2ModuleNode.

**Package:** `@mam/compiler` (included)

**Pipeline:**
```
MAMModule → extractMetadata() → inferType() → extractSections() → V2ModuleNode
```

**Features:**
- Type inference from sections (role+goal → agent, provider → tool)
- Type-specific field extraction
- Table parsing for inputs/outputs
- Rules and prompts extraction

---

### 5. Validator (`validator/`)

The validator checks AST correctness against the specification.

**Package:** `@mam/validator` • **Tests:** 131

**Files:**
- `validator/src/validator.ts` — Main validator
- `validator/src/rules/` — Validation rules
- `validator/src/errors/` — Error types
- `validator/src/reporters/` — Output formatters (console, JSON, LSP)

**Validation Levels:**

| Level | Description |
|-------|-------------|
| `syntax` | Valid Markdown structure |
| `schema` | Valid YAML front matter |
| `semantic` | Correct section content |
| `strict` | All rules enforced |

**Rules:** 19 rules covering required sections, ordering, dependencies, schema, custom rules

---

### 6. Compiler (`compiler/`)

The compiler generates target code from V2ModuleNode.

**Package:** `@mam/compiler` • **Tests:** 72

**Files:**
- `compiler/src/compiler.ts` — Main compiler (13.8KB)
- `compiler/src/transformer.ts` — MAMModule → V2ModuleNode
- `compiler/src/analyzer/` — Semantic analyzer
- `compiler/src/targets/` — 16 target backends

**16 Targets:**

| Target | Extension | Description |
|--------|-----------|-------------|
| python | `.py` | Python runtime |
| javascript | `.js` | JavaScript runtime |
| go | `.go` | Go runtime |
| rust | `.rs` | Rust runtime |
| csharp | `.cs` | C# runtime |
| java | `.java` | Java runtime |
| wasm | `.wasm` | WebAssembly |
| json | `.json` | JSON output |
| openai | `.json` | OpenAI SDK |
| langgraph | `.py` | LangGraph |
| crewai | `.py` | CrewAI |
| gemini | `.py` | Google Gemini |
| autogen | `.py` | AutoGen |
| claude | `.ts` | Claude SDK |
| kubernetes | `.yaml` | K8s manifests |
| terraform | `.tf` | Terraform configs |
| docker | `Dockerfile` | Docker build |

**Type-Specific Dispatch:**
- Agent → agent runtime with tools, memory, handoff
- Tool → tool definition with provider, permissions
- Memory → memory store with format, backend
- Workflow → workflow with steps, edges
- Team → team with members, policy
- Policy → policy with allow/deny rules
- System → system with agents, tools, edges

---

### 7. Runtime (`runtime/`)

The runtime executes MAM modules.

**Package:** `@mam/runtime` • **Tests:** 406

**Files:**
- `runtime/src/runtime.ts` — Main runtime
- `runtime/src/contexts/` — Execution contexts
- `runtime/src/sandboxes/` — Process sandboxes
- `runtime/src/plugins/` — Plugin loading
- `runtime/src/outputs/` — Output formats
- `runtime/src/v2/` — v2 runtime spec

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

**Runtime Features:**
- Sandboxed execution (process isolation)
- Memory persistence (vector, key-value, relational)
- Tool integration (browser, python, search)
- Error recovery (95%+ success rate)
- State management (module, workspace, global)

---

### 8. CLI (`cli/`)

The CLI provides 34 command-line commands.

**Package:** `@mam/cli` • **Tests:** 4

**34 Commands:**

| Category | Commands |
|----------|----------|
| Module Management | init, build, compile, run, execute, validate, lint, format, test, snapshot, benchmark |
| Development | ast, diff, graph, viz, audit, check, doctor, schema, explain, stats |
| Documentation | docs, export, info |
| Package Management | install, publish, search, eco |
| Configuration | config, plugin, templates, examples, cache |
| Server | dev, serve, watch, migrate |

**Key Commands:**
- `mam compile <file> -t <target>` — Compile to any of 16 targets
- `mam init <name>` — Initialize new module
- `mam validate <file>` — Validate against spec
- `mam lint <file>` — Lint for style issues
- `mam run <file>` — Execute module

---

### 9. Language Server (`lsp/`)

The LSP provides IDE support for MAM.

**Package:** `@mam/lsp` • **Tests:** 65

**Files:**
- `lsp/src/server.ts` — LSP server (18.6KB)
- `lsp/src/features/` — Completion, diagnostics, hover, etc.

**Features:**
- Code completion
- Diagnostics (errors, warnings)
- Hover information
- Go to definition
- Find references
- Code formatting
- Code actions

---

### 10. Package Manager (`package-manager/`)

The package manager handles MAM module dependencies.

**Package:** `@mam/package-manager` • **Tests:** 45

**Files:**
- `package-manager/src/package.ts` — Package manager
- `package-manager/src/registry.ts` — Registry client
- `package-manager/src/resolver.ts` — Dependency resolver
- `package-manager/src/lockfile.ts` — Lock file manager

**Commands:**
- `mam install` — Install dependencies
- `mam publish` — Publish to registry
- `mam search` — Search registry

---

### 11. Registry (`registry/`)

The registry is the MAM module hub.

**Packages:** `@mam/registry-client`, `@mam/registry-server` • **Tests:** 63+47

**Files:**
- `registry/server/src/server.ts` — Registry server
- `registry/server/src/store.ts` — Module store
- `registry/server/src/auth.ts` — Authentication
- `registry/server/src/search.ts` — Search engine
- `registry/client/` — Client library

---

### 12. SDKs (`sdk/`)

Language SDKs for MAM integration.

| SDK | Language | Status |
|-----|----------|--------|
| `sdk/javascript/` | TypeScript/JavaScript | ✅ 96 tests |
| `sdk/python/` | Python | ✅ |
| `sdk/go/` | Go | ✅ |
| `sdk/rust/` | Rust | ✅ |

---

### 13. Testing Framework (`testing/`)

The testing framework for MAM modules.

**Package:** `@mam/testing` • **Tests:** 61

**Files:**
- `testing/src/runner.ts` — Test runner
- `testing/src/module-test.ts` — Module tests
- `testing/src/system-test.ts` — System tests
- `testing/src/snapshot.ts` — Snapshot tests

---

### 14. Visualization (`visualization/`)

Graph visualization for MAM modules.

**Package:** `@mam/visualization` • **Tests:** 95

**Files:**
- `visualization/src/graph.ts` — Graph visualizer
- `visualization/src/mermaid.ts` — Mermaid generator
- `visualization/src/ascii.ts` — ASCII art generator
- `visualization/src/html.ts` — HTML renderer
- `visualization/src/dot.ts` — Graphviz DOT format

**Output Formats:** Mermaid, ASCII, HTML, JSON, Graphviz DOT

---

### 15. Plugins (`plugins/`)

The plugin system for extending MAM.

**Package:** `@mam/plugin-api` • **Tests:** 83

**Core Plugins:**
- `plugins/api/` — Plugin API and types
- `plugins/mermaid/` — Mermaid diagram support
- `plugins/memory/` — Memory plugin
- `plugins/python/` — Python support
- `plugins/yaml/` — YAML support

---

## Package Structure

```
mam/
├── spec/                    # Specification
├── parser/                  # Lexer + Parser (170 tests)
├── ast/                     # Abstract Syntax Tree (482 tests)
├── compiler/                # Multi-target compiler (72 tests)
│   ├── src/compiler.ts      # Main compiler
│   ├── src/transformer.ts   # MAMModule → V2ModuleNode
│   └── src/targets/         # 16 target backends
├── validator/               # Validation rules (131 tests)
├── runtime/                 # Execution engine (406 tests)
├── cli/                     # Command-line interface (34 commands)
├── plugins/                 # Plugin system
│   ├── api/                 # Plugin API (83 tests)
│   ├── mermaid/             # Mermaid support
│   ├── memory/              # Memory plugin
│   ├── python/              # Python support
│   └── yaml/                # YAML support
├── lsp/                     # Language Server (65 tests)
├── package-manager/         # Package management (45 tests)
├── registry/                # Module registry (63+47 tests)
├── testing/                 # Testing framework (61 tests)
├── visualization/           # Graph visualization (95 tests)
├── reference/               # Reference implementation (238 tests)
├── sdk/                     # Language SDKs
│   ├── javascript/          # JavaScript SDK (96 tests)
│   ├── python/              # Python SDK
│   ├── go/                  # Go SDK
│   └── rust/                # Rust SDK
├── examples/                # Example modules
│   ├── basic/               # 6 basic examples
│   ├── advanced/            # 7 advanced examples
│   └── plugins/             # 5 plugin examples
├── tests/                   # E2E tests (65 tests)
├── tools/                   # Development tools
├── docs/                    # Documentation
└── output/                  # Compiled outputs (208 files)
```

---

## Technology Stack

| Component | Technology |
|-----------|------------|
| Language | TypeScript |
| Runtime | Node.js 24 |
| Package Manager | pnpm (workspace) |
| Build System | Turbo (monorepo) |
| Testing | Vitest |
| CI/CD | GitHub Actions |
| Version Control | Git |
| Platform | Windows, Linux, macOS |

---

## Design Principles

### 1. Separation of Concerns

Each component has a single responsibility:
- **Parser:** Converts text → AST
- **AST:** Defines structure
- **Transformer:** Converts MAMModule → V2ModuleNode
- **Validator:** Checks correctness
- **Compiler:** Generates target code
- **Runtime:** Executes modules

### 2. Composability

Components can be used independently:
- Use parser without runtime
- Use validator without CLI
- Use AST without parser
- Use compiler without validator

### 3. Extensibility

The plugin system allows:
- Custom section types
- Custom validation rules
- Custom runtimes
- Custom exporters
- Custom visualization formats

### 4. Determinism

Same input always produces:
- Same tokens
- Same AST
- Same V2ModuleNode
- Same validation result
- Same compiled output

### 5. Error Recovery

The parser recovers from errors:
- Continues parsing after errors
- Collects all errors
- Provides helpful messages
- Suggests fixes

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

### Compiler Optimization

- Template caching
- Target-specific optimizations
- Parallel compilation
- Incremental builds

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
- `network` — HTTP access
- `filesystem` — File access
- `environment` — Env vars
- `exec` — Process spawning
- `memory` — Large allocations

### Validation

Security validation includes:
- Input sanitization
- Code analysis
- Dependency checking
- Permission verification

---

## Current System Status

| Component | Package | Tests | Status |
|-----------|---------|-------|--------|
| Parser | `@mam/parser` | 170 | ✅ |
| AST | `@mam/ast` | 482 | ✅ |
| Compiler | `@mam/compiler` | 72 | ✅ |
| Validator | `@mam/validator` | 131 | ✅ |
| Runtime | `@mam/runtime` | 406 | ✅ |
| CLI | `@mam/cli` | 4 | ✅ |
| LSP | `@mam/lsp` | 65 | ✅ |
| Package Manager | `@mam/package-manager` | 45 | ✅ |
| Registry | `@mam/registry-*` | 110 | ✅ |
| Testing | `@mam/testing` | 61 | ✅ |
| Visualization | `@mam/visualization` | 95 | ✅ |
| Plugins | `@mam/plugin-*` | 108 | ✅ |
| SDK (JS) | `@mam/sdk-javascript` | 96 | ✅ |
| Reference | `@mam/reference` | 238 | ✅ |
| E2E Tests | `tests/e2e` | 65 | ✅ |
| **Total** | **19 packages** | **2348** | **✅ All passing** |

---

## Future Architecture

### Phase 1 (Complete ✅)
- Core parser
- AST (v1 and v2)
- Validator
- Compiler (16 targets)
- Runtime
- CLI (34 commands)
- SDKs (4 languages)

### Phase 2 (In Progress 🔄)
- VS Code Extension
- Complete documentation
- More example modules
- Community plugins

### Phase 3 (Planned ⏳)
- Cloud execution
- Enterprise features
- Advanced security
- AI orchestration

---

**Last Updated:** 2026-09-14
**Version:** 0.1.0 (Beta)
**License:** MIT
