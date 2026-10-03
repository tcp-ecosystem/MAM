# MAM — Machine Agent Modules

> **Describe Systems. Compile Anywhere.**

MAM is a **System Description Language (SDL)** whose reference syntax is Markdown. It transforms Markdown into a universal Intermediate Representation (IR) for AI systems, enabling developers to describe intelligent systems once, **execute them natively**, and compile them to any compliant runtime.

Today MAM ships a working implementation: a full parser/AST/transformer/compiler, a **native `.mam` runtime with 22 engines**, **project composition** via `mam.toml`, and compilation to **16 targets** — all from a single, human-readable source.

---

## MAM as Context Subagent

MAM functions as a **concrete context subagent** for AI systems:

| Capability | Description |
|------------|-------------|
| **Context Engine** | Single `.mam` / `.mam.md` files contain complete system context |
| **Knowledge Graph** | Modules define relationships, dependencies, and interactions |
| **Native Execution** | `.mam` runs directly through the MAM runtime (no compiler required) |
| **Runtime Agnostic** | Same context compiles to 16 target environments |
| **Self-Documenting** | Markdown source serves as human-readable documentation |
| **Machine-Readable** | AST and compiled outputs are machine-interpretable |
| **Composable** | Modules compose into systems via `mam.toml` projects |

```text
Human Intent (Markdown) → MAM Parser → AST → Transformer → V2ModuleNode
                          ↑                                    ↓
                    Context Subagent                    Native MAM Runtime
                          │                              /              \
                          │                          Executable Code  22 Engines
                          └──────────── 16 Targets ── (Python, JS, ...)
```

**Why Context Matters:**
- AI agents need structured context to reason about systems
- MAM provides that context in a portable, composable format
- `.mam` can be **executed natively** or compiled to any target
- Every module is a self-contained context unit

---

## What is MAM?

MAM (Machine Agent Modules) is not another programming language. It is a **declarative language for describing modular systems** with built-in context preservation.

Just as:
- SQL describes **data**
- HTML describes **documents**
- CSS describes **presentation**
- Terraform describes **infrastructure**
- Dockerfile describes **containers**

**MAM describes intelligent systems with complete context.**

### Context Subagent Role

MAM acts as a context subagent by:

1. **Capturing Intent** - Markdown naturally expresses human reasoning
2. **Preserving Semantics** - AST maintains meaning through compilation
3. **Enabling Reasoning** - AI agents can parse and reason about MAM modules
4. **Supporting Composition** - Modules build on each other via clear interfaces
5. **Providing Traceability** - Every compiled output traces back to source

---

## Why MAM?

Modern AI systems need more than prompts. They need:

- Context
- Rules
- Memory
- Workflows
- Tool definitions
- Metadata
- Runtime instructions
- Documentation

Instead of scattering these across multiple files, MAM brings them together into one portable module.

```text
Markdown + YAML + Metadata + Python + Mermaid + Rules + Prompts + Memory = MAM
```

---

## Philosophy

> **Everything is a module. Every module exposes capabilities. Modules compose into systems. Systems compile into runtimes.**

- **Context First** — Every module is a self-contained context unit
- **Markdown First** — Markdown is the source of truth
- **Human First** — Never sacrifice readability
- **Machine Friendly** — Every section must be parsable
- **Deterministic** — Same module always produces same AST
- **Modular** — Each section is independent
- **Extensible** — Users can add new section types
- **Runtime Agnostic** — Python, JavaScript, Rust, Go should all execute MAM

---

## Architecture

```text
Layer 8:  Human (Designer) — Provides intent via Markdown
Layer 7:  MAM DSL Source (.mam / .mam.md) — Context-rich source, canonical + source twins
Layer 6:  MAM Parser → AST → Transformer → V2ModuleNode
Layer 5:  MAM Native Runtime — 22 engines, executes .mam directly
Layer 4:  MAM Compiler — 16 targets (Python, JS, Go, Rust, OpenAI, LangGraph, ...)
Layer 3:  Semantic Analyzer + Validator — Context verification
Layer 2:  Target Runtime / Sandbox — Executable context
Layer 1:  Operating System
```

**Two execution paths:**

```text
.mam
 ├─► MAM Native Runtime (executes directly, 22 engines)
 └─► MAM Compiler ──► Python / JS / Go / ... (.mam.py, .mam.js, ...)
```

### Context Flow

```text
┌─────────────────────────────────────────────────────────────┐
│                    MAM Context Pipeline                      │
├─────────────────────────────────────────────────────────────┤
│  Human Intent  →  Markdown Source  →  AST  →  Compiled Code │
│       ↓                ↓              ↓           ↓         │
│  Reasoning      Context        Semantic     Executable     │
│  Purpose        Capture        Meaning      Context        │
└─────────────────────────────────────────────────────────────┘
```

---

## Core Features

| Feature | Description |
|---------|-------------|
| Context-Rich | Every module contains complete system context |
| Human-readable | Markdown syntax anyone can understand |
| LLM-native | AI agents can parse and execute directly |
| Native Execution | `.mam` runs directly through the MAM runtime |
| Project Composition | `mam.toml` projects compose modules into systems |
| Full MAM Spec | structured runtime, permissions, capabilities, dependencies |
| Modular | Each section is independent and composable |
| Portable | Same module works across all runtimes |
| Deterministic | Same input always produces same output |
| Extensible | Add custom sections via plugins |
| Type-safe | 19 first-class module types |
| Multi-target | Compile to Python, JS, Go, Rust, and 12 more |

---

## Module Types

MAM supports 19 module types:

| Type | Description |
|------|-------------|
| `module` | Generic module |
| `agent` | AI agent with role and goals |
| `tool` | Executable tool |
| `memory` | Persistent memory store |
| `workflow` | Process workflow |
| `team` | Agent team |
| `policy` | Behavioral policy |
| `system` | Complete system |
| `service` | Running service |
| `component` | System component |
| `resource` | External resource |
| `interface` | Public contract |
| `contract` | API agreement |
| `plugin` | Extension point |
| `extension` | Domain extension |
| `runtime` | Execution engine |
| `package` | Distributable unit |
| `repository` | Source collection |
| `documentation` | Documentation |

---

## Quick Start

### Installation

```bash
# Clone the repository
git clone https://github.com/tcp-ecosystems/MAM.git
cd MAM

# Install dependencies
pnpm install

# Build the project
pnpm build
```

### Initialize a Project

```bash
mam init                # creates mam.toml + modules/ + system.mam
```

### Create a Module

```bash
mam new basic hello          # minimal module (writes hello.mam + hello.mam.md)
mam new agent researcher     # agent module
mam new workflow pipeline    # workflow module
mam new system platform      # system module
mam templates                # list all 13 templates
```

### Run It Natively

```bash
mam validate            # validate the whole project
mam run                 # run the project entry system natively (no compiler)
mam build               # compile the whole project to targets
```

### Example Module

````mam
---
id: authentication
name: Authentication Module
version: 2.0.0
type: module
author: MAM Team
license: MIT
description: >
  Secure JWT authentication.
runtime:
  language: python
  version: ">=3.12"
tags: [auth, security]
capabilities: [login, verify]
permissions:
  network: [internet]
---

# Authentication Module

## Purpose

Authenticate users securely using JWT tokens.

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| username | string | Yes | User identifier |
| password | string | Yes | User password |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| access_token | string | JWT token |

## Capabilities

### login

Authenticate a user and return a token.

### verify

Verify a JWT token.

## Rules

- Never expose secrets
- Validate all inputs
- Use constant-time comparison

## Python

```python
def login(username: str, password: str) -> dict:
    """Authenticate user and return token."""
    if verify_credentials(username, password):
        return {"access_token": generate_token(username)}
    return {"error": "Invalid credentials"}
```
````

> `.mam` is the canonical artifact and executes natively. `.mam.md` is the
> source-compatible twin — every module ships in both forms.

---

## Native Execution & Project Composition

### Native `.mam` Execution

`mam run system.mam` executes the MAM system model **directly through the MAM
runtime** — it does NOT compile to Python or JavaScript first:

```bash
mam run hello.mam                       # native execution (default)
mam run hello.mam --format json         # JSON output
mam run hello.mam --dry-run             # show execution plan
mam run legacy.mam.md                   # .mam.md also runs natively
mam run hello.mam.py                    # compiled target routes to python
mam run hello.mam.js                    # compiled target routes to node
```

### Project Composition (`mam.toml`)

Multi-file projects compose modules into a system:

```toml
[project]
name = "security-system"
version = "1.0.0"

[build]
entry = "system.mam"
modules = ["modules/**/*.mam", "modules/**/*.mam.md"]
outDir = "dist"
targets = ["python"]
```

```text
my-project/
├── mam.toml              ← project manifest (entry, module globs, targets)
├── system.mam            ← entry system (composes the modules)
├── system.mam.md         ← identical source twin
└── modules/
    ├── hello.mam         ← module in canonical .mam form
    ├── hello.mam.md      ← identical source twin
    ├── authentication.mam
    └── ...
```

All project commands are project-aware (no file argument = whole project):

```bash
mam init          # scaffold a project
mam build         # compile all modules + entry to targets
mam run           # run the entry system natively
mam validate      # validate all modules (dupes, cycles, missing deps)
mam graph         # project dependency graph
mam test          # run tests across all modules
mam info          # project summary
```

Ready-made example projects: `modules/examples/{core,basic,advanced,plugins,security-system}`.
Reusable templates: `modules/templates/` (13 templates).

---

## CLI Commands

All 39 commands are implemented and working:

### Project & Module Management

| Command | Description |
|---------|-------------|
| `mam init` | Initialize a project (`mam.toml` + `modules/` + `system.mam`); `mam init <name>` creates a module |
| `mam new <type> <name>` | Create a module from a template (`.mam` + `.mam.md`) |
| `mam build [file]` | Build a module, or the whole project when no file |
| `mam compile <file> -t <target>` | Compile to target language |
| `mam run [file]` | Run a module or the project entry natively |
| `mam execute <file>` | Execute module (v1 compat) |
| `mam validate [file]` | Validate a module, or the whole project |
| `mam lint <file>` | Lint module for issues |
| `mam format <file>` | Format module |
| `mam test [file]` | Run module tests, or all project tests |
| `mam info [file]` | Show module info, or project summary |
| `mam graph` | Show dependency graph (project-aware) |
| `mam snapshot <file>` | Create module snapshot |
| `mam benchmark <file>` | Benchmark parsing and execution |

### Development

| Command | Description |
|---------|-------------|
| `mam ast <file>` | Display AST |
| `mam diff <file1> <file2>` | Diff two modules |
| `mam graph` | Show dependency graph |
| `mam viz <file>` | Visualize module structure |
| `mam audit <file>` | Security audit |
| `mam check <file>` | Check against spec |
| `mam doctor` | Check environment |
| `mam schema` | Generate JSON schema |
| `mam explain <concept>` | Explain MAM concepts |
| `mam stats [path]` | Show statistics |

### Documentation & Export

| Command | Description |
|---------|-------------|
| `mam docs <file>` | Generate documentation |
| `mam export <file>` | Export to various formats |
| `mam info <file>` | Show module information |

### Package Management

| Command | Description |
|---------|-------------|
| `mam install` | Install dependencies |
| `mam publish <file>` | Publish to registry |
| `mam search <query>` | Search module registry |
| `mam eco` | List ecosystem modules |

### Configuration & Plugins

| Command | Description |
|---------|-------------|
| `mam config` | Manage configuration |
| `mam plugin` | Manage plugins |
| `mam templates` | List templates |
| `mam examples [topic]` | Show examples |
| `mam cache` | Manage cache |

### Development Server

| Command | Description |
|---------|-------------|
| `mam dev` | Start dev server with hot reload |
| `mam serve` | Start development server |
| `mam watch <file>` | Watch modules for changes |
| `mam migrate <file>` | Migrate v1 to v2 |

---

## Compiler Targets

MAM compiles to 16 target languages:

| Target | Command | Extension |
|--------|---------|-----------|
| Python | `mam compile module.mam -t python` | `.py` |
| JavaScript | `mam compile module.mam -t javascript` | `.js` |
| Go | `mam compile module.mam -t go` | `.go` |
| Rust | `mam compile module.mam -t rust` | `.rs` |
| C# | `mam compile module.mam -t csharp` | `.cs` |
| Java | `mam compile module.mam -t java` | `.java` |
| WebAssembly | `mam compile module.mam -t wasm` | `.wasm` |
| JSON | `mam compile module.mam -t json` | `.json` |
| OpenAI SDK | `mam compile module.mam -t openai` | `.json` |
| LangGraph | `mam compile module.mam -t langgraph` | `.py` |
| CrewAI | `mam compile module.mam -t crewai` | `.py` |
| Gemini | `mam compile module.mam -t gemini` | `.py` |
| AutoGen | `mam compile module.mam -t autogen` | `.py` |
| Claude SDK | `mam compile module.mam -t claude` | `.ts` |
| Kubernetes | `mam compile module.mam -t kubernetes` | `.yaml` |
| Terraform | `mam compile module.mam -t terraform` | `.tf` |
| Docker | `mam compile module.mam -t docker` | `Dockerfile` |

---

## v2 DSL Syntax

### Module Declaration

```mam
module Authentication

type:
    service

requires:
    database
    jwt

inputs:
    email: string
    password: string

outputs:
    access_token: string

workflow:
    validate
    authenticate
    issue_token

permissions:
    network: internet
    filesystem: read
```

### Agent Declaration

```mam
module Researcher

type:
    agent

role:
    Reconnaissance

goal:
    Discover attack surfaces

memory:
    type: vector
    backend: sqlite
    scope: workspace

tools:
    - browser
    - python
    - search

handoff:
    - Analyzer
```

### Multi-Agent System

```mam
module BugHunter

type:
    system

agents:
    - Planner
    - Recon
    - Analyzer
    - Reporter

edges:
    Planner -> Recon
    Recon -> Analyzer
    Analyzer -> Reporter

memory:
    shared: SharedMemory

policy:
    SafeExecution
```

---

## Compiled Outputs

The `output/` folder contains compiled examples demonstrating MAM's context preservation:

```text
output/
├── agent/          # AI agent module (16 targets)
├── basic/          # Basic examples (6 modules × 16 targets)
├── examples/       # Advanced examples (7 modules × 16 targets)
├── full/           # Full-featured module
├── minimal/        # Minimal module
└── tool/           # Tool module
```

**Each compiled output:**
- Retains the semantic meaning of the source module
- Is ready to execute in its target environment
- Demonstrates MAM's context preservation across runtimes
- Can be traced back to its `.mam` source

> `output/` is a generated directory. Author in `modules/` instead:
> `mam build` compiles a whole `mam.toml` project, or
> `mam compile <file> -t <target>` compiles a single module.

---

## Project Structure

```text
MAM/
├── spec/                    # Specification
├── parser/                  # Lexer + Parser (176 tests)
├── ast/                     # Abstract Syntax Tree (480+ tests)
├── compiler/                # Multi-target compiler (72 tests, 16 targets)
├── validator/               # Validation rules (130+ tests)
├── runtime/                 # Execution engine
│   └── src/v2/              # Native MAM runtime — 22 engines, ~11,000 lines
│       ├── runtime.ts       #   Core orchestrator (topo sort, type dispatch)
│       ├── state.ts         #   State engine
│       ├── events.ts        #   Event engine
│       ├── permissions.ts   #   Permission engine
│       ├── plugins.ts       #   Plugin registry
│       ├── security.ts      #   Security engine
│       ├── resource-manager.ts  #   Resource manager
│       ├── policy-engine.ts     #   Policy engine
│       ├── context-engine.ts    #   Context engine
│       ├── token-budget.ts      #   Token budget
│       ├── memory-engine.ts     #   Memory engine
│       ├── knowledge-engine.ts  #   Knowledge / RAG
│       ├── model-engine.ts      #   Model engine
│       ├── tool-engine.ts       #   Tool engine
│       ├── agent-engine.ts      #   Agent engine
│       ├── workflow-engine.ts   #   Workflow engine (DAG)
│       ├── module-registry.ts   #   Module registry
│       ├── evaluation-engine.ts #   Evaluation
│       ├── observability.ts     #   Observability
│       └── sandbox.ts           #   Sandboxing
├── cli/                     # Command-line interface (39 commands)
│   └── src/project/         #   mam.toml project composition (TOML, loader, graph)
├── plugins/                 # Plugin system
│   ├── api/                 # Plugin API
│   ├── mermaid/             # Mermaid support
│   ├── memory/              # Memory plugin
│   ├── python/              # Python support
│   └── yaml/                # YAML support
├── lsp/                     # Language Server (65 tests)
├── package-manager/         # Package management - MAMP (45 tests)
├── registry/                # Module registry - MAM Hub
│   ├── client/              # Registry client
│   └── server/              # Registry server
├── testing/                 # Testing framework (60+ tests)
├── visualization/           # Graph visualization (95 tests)
├── reference/               # Reference implementation (238 tests)
├── sdk/                     # Language SDKs
│   ├── javascript/          # JavaScript SDK (96 tests)
│   ├── python/              # Python SDK
│   ├── go/                  # Go SDK
│   └── rust/                # Rust SDK
├── modules/                 # Modules
│   ├── examples/            # Example projects (core, basic, advanced, plugins, security-system)
│   └── templates/           # 13 reusable templates
├── tests/                   # E2E tests (65 tests)
├── tools/                   # Development tools
├── docs/                    # Documentation
└── output/                  # Compiled outputs
```

---

## Development Phases

| Phase | Status | Description |
|-------|--------|-------------|
| 1 | ✅ | Language Philosophy |
| 2 | ✅ | Specification (v2) |
| 3 | ✅ | Grammar (v2) |
| 4 | ✅ | Parser (v2) |
| 5 | ✅ | AST (v2) |
| 6 | ✅ | Semantic Analyzer |
| 7 | ✅ | Compiler (16 targets) |
| 8 | ✅ | Runtime Specification |
| 9 | ✅ | Package Manager (MAMP) |
| 10 | ✅ | Registry (MAM Hub) |
| 11 | ✅ | Language Server (v2) |
| 12 | ✅ | Testing Framework |
| 13 | ✅ | Visualization Engine |
| 14 | ✅ | Reference Implementation |
| 15 | ✅ | SDK (Python, JavaScript, Go, Rust) |
| 16 | ✅ | Native `.mam` execution + V2 runtime (22 engines) |
| 17 | ✅ | Project composition (`mam.toml`) + full MAM spec |

---

## Tools

| Tool | Name | Description |
|------|------|-------------|
| MAM | Machine Agent Modules | The language |
| MAMC | MAM Compiler | Compiler |
| MAMP | MAM Package Manager | Package manager |
| MAM Hub | MAM Registry | Module registry |
| MAM LSP | MAM Language Server | IDE support |
| mam fmt | MAM Formatter | Code formatter |
| mam lint | MAM Linter | Code linter |
| mam build | MAM Builder | Module builder |
| mam run | MAM Runner | Module runner |

---

## Statistics

| Metric | Value |
|--------|-------|
| Total Packages | 19 |
| Source TypeScript Files | 225 |
| Test TypeScript Files | 74 |
| Total Tests | 2,000+ |
| CLI Commands | 39 |
| Compiler Targets | 16 |
| V2 Runtime Engines | 22/22 |
| V2 Runtime Lines | ~11,000 |
| Module Types | 19 |
| Templates | 13 |
| Example Projects | 5 (core, basic, advanced, plugins, security-system) |
| Native Execution | ✅ `mam run system.mam` |
| Development Phases | 17/17 complete |

---

## Philosophy

> **MAM is a language for describing systems with complete context.**

Not AI. Not infrastructure. Not applications.

**Systems.**

AI systems are simply one category. MAM provides a unique identity: not a general-purpose language, but a language for designing and orchestrating modular systems with preserved context.

### Context Subagent Value

MAM enables AI agents to:
- **Understand** system intent through human-readable Markdown
- **Reason** about system structure via AST representation
- **Execute** system definitions across multiple runtimes
- **Compose** systems from reusable, context-rich modules
- **Trace** compiled outputs back to their source intent

---

## North Star

> **"Describe Systems with Context. Compile Anywhere."**

---

## License

MIT License

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## Links

- [Specification](spec/SPEC.md)
- [Usage Guide](usage.md)
- [Purpose](purpose.md) · [Goal](goal.md) · [Scope](scope.md) · [Brain](brain.md)
- [Examples](modules/examples/)
- [Templates](modules/templates/)
- [Plan](plan.md)
- [v2 Plan](plan-doc/plan-v2.md)
- [Changelog](CHANGELOG.md)