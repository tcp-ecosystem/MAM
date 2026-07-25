# MAM v2 — System Description Language (SDL)

> **Describe Systems. Compile Anywhere.**

---

## The Evolution

```
v1: Markdown as Module (Module format for AI)
         │
         ▼
v2: Machine Agent Module (System Description Language)
         │
         ▼
v3: MAM Language (Universal System Architecture)
```

### What Changed

| Aspect | v1 | v2 |
|--------|----|----|
| Identity | Markdown for AI | System Description Language |
| Scope | AI agents only | All systems (AI, Cloud, Security, IoT, Robotics) |
| Objects | Sections only | 25+ first-class objects |
| File types | `.mam.md` | `.mam`, `.mamlib`, `.mampkg`, `.mamlock` |
| Execution | Runtime executes directly | Compiler translates → Runtime executes |
| Philosophy | "How to compute?" | "What system should exist?" |

---

## Vision Statement

> **MAM is a declarative language for describing modular systems.**

Not AI. Not infrastructure. Not applications.

**Systems.**

AI systems are simply one category.

---

## Philosophy

```
Everything is a System.
Every System is composed of Modules.
Every Module exposes Capabilities.
Capabilities compose into Behaviors.
Behaviors compose into Systems.
Systems compile into Runtime Implementations.

Humans design systems.
Machines execute systems.
MAM is the bridge.
```

---

## MAM Stack (v2)

```
Layer 7:  Human (Designer)
Layer 6:  MAM DSL Source (.mam / .mam.md)
Layer 5:  MAM Compiler (mamc)
Layer 4:  MAM AST (Machine Agent Module IR)
Layer 3:  Semantic Analyzer + Validator
Layer 2:  Target Runtime (Python, JS, Go, Rust, OpenAI, LangGraph...)
Layer 1:  Operating System
```

---

## What MAM Describes

Not algorithms. **Systems.**

### Universal System Model

Every system answers:

```
What exists?
Who owns it?
What can it do?
What resources does it need?
Who communicates with whom?
What events occur?
What state exists?
What policies apply?
What permissions exist?
What dependencies exist?
How is it tested?
How is it monitored?
```

None mention AI. **Systems thinking lasts.**

---

## MAM Core Objects (25+)

Everything is a first-class object:

| Object | Description |
|--------|-------------|
| `module` | Atomic building block |
| `system` | Composed of modules |
| `component` | System component |
| `service` | Running service |
| `resource` | External resource |
| `workflow` | Process definition |
| `task` | Unit of work |
| `policy` | Behavioral rules |
| `capability` | What a module can do |
| `event` | Something that happens |
| `state` | Current condition |
| `dependency` | Required module |
| `interface` | Public contract |
| `contract` | API agreement |
| `permission` | Access control |
| `role` | Identity role |
| `identity` | Who/what |
| `memory` | Persistent state |
| `storage` | Data storage |
| `network` | Communication |
| `tool` | Executable capability |
| `plugin` | Extension point |
| `extension` | Domain extension |
| `runtime` | Execution engine |
| `package` | Distributable unit |
| `repository` | Source collection |
| `documentation` | Documentation |
| `agent` | AI agent (extends module) |

**Agent is one object among many. Never give AI privileged status.**

---

## MAM DSL Syntax Examples

### Module

```mam
module Authentication

type:
    service

requires:
    database
    jwt
    logger

inputs:
    email: string
    password: string

outputs:
    access_token: string
    user: object

workflow:
    validate
    authenticate
    issue_token

permissions:
    network: internet
    filesystem: read
```

### Agent

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

### Tool

```mam
module Browser

type:
    tool

provider:
    chromium

permissions:
    network: internet

capabilities:
    - navigate
    - screenshot
    - extract
```

### Memory

```mam
module SharedMemory

type:
    memory

format:
    vector

backend:
    sqlite

scope:
    workspace

ttl:
    24h
```

### Workflow

```mam
module ReconWorkflow

type:
    workflow

steps:
    - name: Discover
      agent: Recon
    - name: Analyze
      agent: Analyzer
    - name: Report
      agent: Reporter

edges:
    Discover -> Analyze
    Analyze -> Report
```

### Team

```mam
module SecurityTeam

type:
    team

members:
    - Planner
    - Recon
    - Analyzer
    - Reporter

policy:
    SafeExecution
```

### Policy

```mam
module SafeExecution

type:
    policy

allow:
    - browser
    - python

deny:
    - shell.rm
    - network.internal

permissions:
    filesystem: read
    network: internet
    python: sandbox
```

### System (Multi-Agent)

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

## File Types

```
.mam       → source module (Markdown syntax)
.mam.md    → source module (explicit Markdown)
.mamlib    → library module
.mampkg    → package (distributable)
.mamlock   → dependency lock file
```

---

## Compiler Architecture

```
MAM Source
      │
      ▼
   Lexer
      │
      ▼
   Parser
      │
      ▼
   MAM AST (IR)
      │
      ▼
   Semantic Analyzer
      │
      ▼
   Validator
      │
      ▼
   Compiler
      │
      ├──→ Python
      ├──→ JavaScript
      ├──→ Go
      ├──→ Rust
      ├──→ C#
      ├──→ Java
      ├──→ WebAssembly
      ├──→ OpenAI SDK
      ├──→ Claude SDK
      ├──→ Gemini SDK
      ├──→ LangGraph
      ├──→ CrewAI
      ├──→ AutoGen
      ├──→ Kubernetes
      ├──→ Docker
      ├──→ Terraform
      └──→ Custom Runtime
```

**MAM never executes. MAM compiles.**

---

## CLI Commands (v2)

```bash
# Module management
mam init          # Initialize new module
mam build         # Build module to AST
mam run           # Execute module
mam compile       # Compile to target language
mam test          # Run module tests
mam validate      # Validate module
mam lint          # Lint module
mam fmt           # Format module

# Package management
mam install       # Install dependencies
mam publish       # Publish to registry
mam search        # Search registry
mam update        # Update dependencies

# Development
mam graph         # Show dependency graph
mam ast           # Dump AST
mam export        # Export to format
mam doctor        # Check environment
mam docs          # Generate documentation
mam serve         # Start dev server
mam visualize     # Show system graph
```

---

## MAM Tool Names

```
MAM       = Machine Agent Modules (system identity)
MAMC      = MAM Compiler
MAMP      = MAM Package Manager
MAM Hub   = MAM Registry
MAM LSP   = MAM Language Server
mam fmt   = MAM Formatter
mam lint  = MAM Linter
mam build = MAM Builder
mam run   = MAM Runner
```

---

## Development Phases (v2)

### Phase 1: Language Philosophy ✅
- Define MAM as System Description Language
- Define core philosophy: "Everything is a Module"
- Define universal system model
- Define MAM objects (25+)

### Phase 2: Specification (v2) ✅
- Update SPEC.md for SDL
- Define module types (agent, tool, memory, workflow, team, policy, system)
- Define new sections (type, role, goal, tools, handoff, edges, members, allow, deny)
- Update JSON Schema

### Phase 3: Grammar (v2) ✅
- Define new grammar rules for DSL syntax
- Support `module`, `type`, `requires`, `inputs`, `outputs`, `workflow`, `tools`, `memory`, `handoff`, `edges`, `members`, `allow`, `deny`, `permissions`
- Support arrow notation (`->`) for edges
- Support nested structures
- **Deliverable:** `spec/grammar/grammar-v2.bnf` (400+ lines)

### Phase 4: Parser (v2) ✅
- Extend parser for new syntax
- Parse `module` declarations
- Parse `type` declarations
- Parse `requires` / `inputs` / `outputs`
- Parse `workflow` / `steps`
- Parse `tools` / `memory`
- Parse `handoff` / `edges`
- Parse `members` (team)
- Parse `allow` / `deny` (policy)
- Parse `permissions`
- **Deliverable:** `parser/src/parser/dsl.ts` (600+ lines)

### Phase 5: AST (v2) ✅
- Add new AST node types:
  - `ModuleNode` (with `type` field)
  - `AgentNode`
  - `ToolNode`
  - `MemoryNode`
  - `WorkflowNode`
  - `TeamNode`
  - `PolicyNode`
  - `SystemNode`
  - `EdgeNode`
  - `StepNode`
- Support module composition
- Support system graphs
- **Deliverable:** `ast/src/nodes/v2.ts` (500+ lines)

### Phase 6: Semantic Analyzer ✅
- Validate module type consistency
- Validate dependency resolution
- Validate edge connections
- Validate permission inheritance
- Validate workflow step references
- Validate team member references
- **Deliverable:** `compiler/src/analyzer/index.ts` (500+ lines)

### Phase 7: Compiler ✅
- Define compiler interface
- Implement target backends:
  - Python backend
  - JavaScript backend
  - Go backend
  - OpenAI SDK backend
  - LangGraph backend
  - CrewAI backend
- Code generation from AST
- Template-based compilation
- **Deliverables:** `compiler/src/compiler.ts`, `compiler/src/targets/*.ts` (600+ lines)

### Phase 8: Runtime Specification
- Define runtime interface
- Define execution model
- Define memory model
- Define event model
- Define state management
- Define plugin loading

### Phase 9: Package Manager (MAMP)
- `mamp init` - Initialize package
- `mamp install` - Install dependencies
- `mamp publish` - Publish to registry
- `mamp search` - Search registry
- `mamp update` - Update dependencies
- Lock file management

### Phase 10: Registry (MAM Hub)
- Module discovery
- Version management
- Dependency resolution
- Authentication
- Publishing
- Searching

### Phase 11: Language Server (v2) ✅
- Completion for new syntax (module types, sections, permissions)
- Diagnostics for new objects
- Hover for module types and sections
- Go to definition for dependencies
- Find references for modules
- Formatting for DSL
- Code actions for quick fixes
- **Deliverable:** `lsp/src/server.ts` (400+ lines with full v2 support)

### Phase 12: Testing Framework ✅
- Module testing (parse, validate, execute)
- System testing (multi-module)
- Integration testing
- Snapshot testing
- **Deliverables:** `testing/src/runner.ts`, `testing/src/module-test.ts`, `testing/src/system-test.ts`, `testing/src/snapshot.ts` (500+ lines)

### Phase 13: Visualization Engine ✅
- System graph visualization
- Dependency graph
- Workflow visualization
- Mermaid diagram generation
- ASCII art output
- **Deliverables:** `visualization/src/graph.ts`, `visualization/src/mermaid.ts`, `visualization/src/ascii.ts` (500+ lines)

### Phase 14: Reference Implementation ✅
- Complete working compiler with all backends
- Multiple target backends (Python, JS, Go, OpenAI, LangGraph, CrewAI)
- Package manager (MAMP)
- Registry client
- CLI toolchain (mamc)
- **Deliverable:** `reference/src/index.ts` (400+ lines CLI tool)
- Package manager
- Registry

---

## Backward Compatibility

v2 is **backward compatible** with v1:

- `.mam.md` files still work
- Old sections (Purpose, Rules, etc.) still valid
- New sections are additive
- Old parser handles old syntax
- New parser handles both old and new syntax

---

## Success Criteria

A successful MAM v2 feature is:

- Easy for humans to read
- Easy for machines to parse
- Deterministic to compile
- Independent of implementation
- Composable with other modules
- Useful across multiple domains
- Documentable
- Testable
- Future-proof

---

## North Star

> **"The Language of Systems."**

> **"Describe Systems. Compile Anywhere."**

---

## v2 Phases Status

| Phase | Status | Description |
|-------|--------|-------------|
| 1 | ✅ | Language Philosophy |
| 2 | ✅ | Specification (v2) |
| 3 | ✅ | Grammar (v2) |
| 4 | ✅ | Parser (v2) |
| 5 | ✅ | AST (v2) |
| 6 | ✅ | Semantic Analyzer |
| 7 | ✅ | Compiler (6 targets) |
| 8 | ✅ | Runtime Specification |
| 9 | ✅ | Package Manager (MAMP) |
| 10 | ✅ | Registry (MAM Hub) |
| 11 | ✅ | Language Server (v2) |
| 12 | ✅ | Testing Framework |
| 13 | ✅ | Visualization Engine |
| 14 | ✅ | Reference Implementation |

---

**Last Updated:** 2026-07-24
**Version:** 2.0.0
**Status:** All 14 Phases Complete