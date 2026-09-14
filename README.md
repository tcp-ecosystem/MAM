# MAM — Markdown as Module

> **Describe Systems. Compile Anywhere.**

MAM is a **System Description Language (SDL)** whose reference syntax is Markdown. It transforms Markdown into a universal Intermediate Representation (IR) for AI systems, enabling developers to describe intelligent systems once and compile them to any compliant runtime.

---

## What is MAM?

MAM (Markdown as Module) is not another programming language. It is a **declarative language for describing modular systems**.

Just as:
- SQL describes **data**
- HTML describes **documents**
- CSS describes **presentation**
- Terraform describes **infrastructure**
- Dockerfile describes **containers**

**MAM describes intelligent systems.**

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
Layer 7:  Human (Designer)
Layer 6:  MAM DSL Source (.mam / .mam.md)
Layer 5:  MAM Compiler (mamc)
Layer 4:  MAM AST (Machine Agent Module IR)
Layer 3:  Semantic Analyzer + Validator
Layer 2:  Target Runtime (Python, JS, Go, Rust, OpenAI, LangGraph...)
Layer 1:  Operating System
```

---

## Core Features

| Feature | Description |
|---------|-------------|
| Human-readable | Markdown syntax anyone can understand |
| LLM-native | AI agents can parse and execute directly |
| Modular | Each section is independent and composable |
| Portable | Same module works across all runtimes |
| Deterministic | Same input always produces same output |
| Extensible | Add custom sections via plugins |
| Type-safe | 25+ first-class module types |
| Multi-target | Compile to Python, JS, Go, Rust, and more |

---

## Module Types

MAM supports 25+ module types:

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
git clone https://github.com/tcp-ecosystems/mam.git
cd mam

# Install dependencies
pnpm install

# Build the project
pnpm build
```

### Create Your First Module

```bash
# Initialize a new module
mam init my-module

# Or with a specific template
mam init my-agent --template agent
```

### Example Module

```mam
---
id: authentication
version: 1.0.0
name: Authentication Module
author: LifeJiggy
runtime: python
tags:
  - auth
  - security
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
```

---

## CLI Commands

All 34 commands are implemented and working:

### Module Management

| Command | Description |
|---------|-------------|
| `mam init [name]` | Initialize a new MAM module |
| `mam build <file>` | Build module to AST |
| `mam compile <file> -t <target>` | Compile to target language |
| `mam run <file>` | Run a module |
| `mam execute <file>` | Execute module (v1 compat) |
| `mam validate <file>` | Validate module |
| `mam lint <file>` | Lint module for issues |
| `mam format <file>` | Format module |
| `mam test [file]` | Run module tests |
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
| Python | `mam compile module.mam.md -t python` | `.py` |
| JavaScript | `mam compile module.mam.md -t javascript` | `.js` |
| Go | `mam compile module.mam.md -t go` | `.go` |
| Rust | `mam compile module.mam.md -t rust` | `.rs` |
| C# | `mam compile module.mam.md -t csharp` | `.cs` |
| Java | `mam compile module.mam.md -t java` | `.java` |
| WebAssembly | `mam compile module.mam.md -t wasm` | `.wasm` |
| JSON | `mam compile module.mam.md -t json` | `.json` |
| OpenAI SDK | `mam compile module.mam.md -t openai` | `.json` |
| LangGraph | `mam compile module.mam.md -t langgraph` | `.py` |
| CrewAI | `mam compile module.mam.md -t crewai` | `.py` |
| Gemini | `mam compile module.mam.md -t gemini` | `.py` |
| AutoGen | `mam compile module.mam.md -t autogen` | `.py` |
| Claude SDK | `mam compile module.mam.md -t claude` | `.ts` |
| Kubernetes | `mam compile module.mam.md -t kubernetes` | `.yaml` |
| Terraform | `mam compile module.mam.md -t terraform` | `.tf` |
| Docker | `mam compile module.mam.md -t docker` | `Dockerfile` |

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

## Project Structure

```text
mam/
├── spec/                    # Specification
├── parser/                  # Lexer + Parser (170 tests)
├── ast/                     # Abstract Syntax Tree (482 tests)
├── compiler/                # Multi-target compiler (72 tests)
├── validator/               # Validation rules (131 tests)
├── runtime/                 # Execution engine (406 tests)
├── cli/                     # Command-line interface (34 commands)
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
| Total Tests | 2300+ |
| CLI Commands | 34 |
| Compiler Targets | 16 |
| Module Types | 25+ |
| Development Phases | 15/15 complete |

---

## Philosophy

> **MAM is a language for describing systems.**

Not AI. Not infrastructure. Not applications.

**Systems.**

AI systems are simply one category. MAM provides a unique identity: not a general-purpose language, but a language for designing and orchestrating modular systems.

---

## North Star

> **"Describe Systems. Compile Anywhere."**

---

## License

MIT License

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## Links

- [Specification](spec/SPEC.md)
- [Architecture](ARCHITECTURE.md)
- [Examples](examples/)
- [Plan](plan.md)
- [v2 Plan](plan-doc/plan-v2.md)
- [Changelog](CHANGELOG.md)