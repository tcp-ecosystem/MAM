# MAM Usage Guide

> **Complete guide to using MAM (Machine Agent Modules)**

---

## Table of Contents

1. [Installation](#installation)
2. [Quick Start](#quick-start)
3. [Module Structure](#module-structure)
4. [CLI Commands](#cli-commands)
5. [v2 DSL Syntax](#v2-dsl-syntax)
6. [Compiler Targets](#compiler-targets)
7. [Package Management](#package-management)
8. [Examples](#examples)

---

## Installation

### From Source

```bash
# Clone the repository
git clone https://github.com/tcp-ecosystems/MAM.git
cd MAM

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Link globally (optional)
npm link
```

### Verify Installation

```bash
# Check MAM is installed
mam --version

# Check environment
mam doctor
```

---

## Quick Start

### 1. Initialize a Project

```bash
mam init                # creates mam.toml + modules/ + system.mam (a complete project)
```

### 2. Create a Module

```bash
mam new basic hello          # minimal module (writes hello.mam + hello.mam.md)
mam new agent researcher     # agent module
mam new workflow pipeline    # workflow module
mam new tool scraper         # tool module
mam new memory store         # memory module
mam new system platform      # system module
mam templates                # list all 19 type templates
```

### 3. Convert What You Already Have

Already have an agent spec (`AGENTS.md`, `CLAUDE.md`, or any markdown agent
file)? Convert it instead of writing a module from scratch:

```bash
mam convert AGENTS.md         # -> AGENTS.mam, type inferred from content
mam convert CLAUDE.md -o claude-agent.mam
mam convert AGENTS.md --dry-run    # print the result without writing
mam convert AGENTS.md --json       # machine-readable summary
```

`mam convert` synthesizes frontmatter (id, name, author, tags), maps markdown
headings to standard sections, and routes fenced code blocks to Python or
JavaScript sections by language tag. The output is written only if it passes
`mam validate`.

### 4. Edit the Module (full MAM spec)

```markdown
---
id: hello
name: Hello
version: 2.0.0
type: module
author: MAM Team
license: MIT
description: >
  A greeting module.
runtime:
  language: python
  version: ">=3.12"
tags: [example]
capabilities: [greet]
permissions:
  filesystem: [read]
---

# Hello

## Purpose

Describe what this module does.

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| name | string | No | Name to greet |

## Capabilities

### greet

Return a greeting.
```

### 5. Validate

```bash
mam validate                  # validate the whole project (mam.toml)
mam validate modules/hello.mam    # validate a single module
mam validate modules          # validate a directory recursively (.mam + .mam.md)
mam validate modules --level strict    # syntax | schema | semantic | strict
```

The directory form prints a `PASS`/`FAIL` line per file and exits non-zero if
any module is invalid — the same mode the bundled CI action uses.

### 6. Run Natively (no compilation)

```bash
mam run                       # run the project entry system natively
mam run modules/hello.mam     # run a single module natively
```

### 7. Build / Compile

```bash
mam build                     # compile the whole project to targets
mam compile modules/hello.mam -t python
mam run modules/hello.mam.py  # run a compiled target with its runtime (python)
```

---

## Module Structure

### File Types

| Extension | Description |
|-----------|-------------|
| `.mam` | Source module (Markdown syntax) |
| `.mam.md` | Source module (explicit Markdown) |
| `.mamlib` | Library module |
| `.mampkg` | Package (distributable) |
| `.mamlock` | Dependency lock file |

### Front Matter (Required)

```yaml
---
id: module-name
name: Module Name
version: 2.0.0
type: module            # module|agent|tool|memory|workflow|team|policy|system|...
author: Author Name
license: MIT
description: >
  Module description.
runtime:
  language: python
  version: ">=3.12"
tags: [tag1, tag2]
dependencies:
  - name: http-client
    version: "^1.2"
capabilities: [fetch, parse]
permissions:
  network: [internet]
  filesystem: [read]
---
```

> The `runtime` may also be the shorthand string `runtime: python >=3.12`.
> Structured permissions, dependency version constraints, and
> `inputs`/`outputs` front-matter arrays are all supported.

### Standard Sections

| Section | Purpose | Required |
|---------|---------|----------|
| Purpose | Module objective | Yes |
| Inputs | Input parameters | No |
| Outputs | Output values | No |
| Rules | Behavioral constraints | No |
| Workflow | Process definition | No |
| Mermaid | Visual diagrams | No |
| Python | Python code | No |
| JavaScript | JavaScript code | No |
| Prompt | LLM instructions | No |
| Memory | Persistent state | No |
| Examples | Usage demonstrations | No |
| Tests | Validation rules | No |
| References | External links | No |
| Dependencies | Required modules | No |
| Exports | Public interface | No |
| Imports | Required imports | No |
| Plugins | Plugin requirements | No |
| Permissions | Security permissions | No |
| Capabilities | System capabilities | No |

---

## CLI Commands

The complete catalogue (45 commands; `mam help` prints this).
Aliases: `eco` → `ecosystem`, `viz` → `visualize`, `fmt` → `format`.

### Project & Module Management

| Command | Description |
|---------|-------------|
| `mam init [name]` | Initialize a project; with a name, creates a module |
| `mam new <type> <name>` | Create a module from a template (`.mam` + `.mam.md`) |
| `mam create <kind> <name>` | Scaffold a module, agent, workflow or project |
| `mam convert <file>` | Convert an existing markdown agent spec to a valid `.mam` module (`-o`, `--dry-run`, `--json`) |
| `mam build [file]` | Build a module, or the whole project when no file |
| `mam compile <file> -t <target>` | Compile to a target language |
| `mam run [file]` | Run a module or the project entry natively (no compiler) |
| `mam execute <file>` | Execute module (v1 compat) |
| `mam validate [file\|dir]` | Validate a module, the whole project, or a directory tree of `.mam`/`.mam.md` files |
| `mam lint <file>` | Lint module for issues |
| `mam format <file>` | Format module |
| `mam test [file]` | Run module tests, or all project tests |
| `mam smoke <file>` | Smoke-test end to end (parse, validate, compile, run) |
| `mam info [file]` | Show module info, or project summary |
| `mam inspect <file>` | Deep inspection report |
| `mam graph` | Show dependency graph (project-aware) |
| `mam snapshot <file>` | Create module snapshot |
| `mam benchmark <file>` | Benchmark parsing and execution |
| `mam migrate <file>` | Migrate v1 to v2 |
| `mam project` | Project-scoped operations |

### Development & Inspection

| Command | Description |
|---------|-------------|
| `mam ast <file>` | Display AST |
| `mam diff <file1> <file2>` | Diff two modules |
| `mam visualize <file>` | Visualize module structure |
| `mam audit <file>` | Security audit |
| `mam check <file>` | Check against spec |
| `mam doctor` | Check environment |
| `mam schema` | Generate JSON schema |
| `mam explain <concept>` | Explain MAM concepts |
| `mam stats [path]` | Show statistics |
| `mam harmony` | Check module-set consistency |

### Documentation & Export

| Command | Description |
|---------|-------------|
| `mam docs <file>` | Generate documentation |
| `mam export <file>` | Export to various formats |

### Package Management & Registry

| Command | Description |
|---------|-------------|
| `mam install [packages...]` | Install a specific module from the Hub, or a manifest's dependencies |
| `mam uninstall` | Remove dependencies |
| `mam update` | Update packages |
| `mam publish <file>` | Publish to the MAM Hub (`--targets npm,python,github` fans out to other ecosystems) |
| `mam search <query>` | Search module registry |
| `mam ecosystem` | List ecosystem modules |

### Configuration, Plugins & Memory

| Command | Description |
|---------|-------------|
| `mam config` | Manage configuration |
| `mam global` | Manage global installation |
| `mam plugin` | Manage plugins |
| `mam memory` | Inspect and manage working memory |
| `mam templates` | List templates |
| `mam examples [topic]` | Show examples |
| `mam cache` | Manage cache |

### Server & Runtime

| Command | Description |
|---------|-------------|
| `mam dev` | Start dev server with hot reload |
| `mam serve` | Start development server |
| `mam watch <file>` | Watch modules for changes |
| `mam system` | Show wired engines |
| `mam optimize <file>` | Optimize prompt token usage |
| `mam version` | Show or update version |

---

## v2 DSL Syntax

### Module Declaration

```mam
module ModuleName

type:
    module | agent | tool | memory | workflow | team | policy | system

description:
    Module description

requires:
    - dependency1
    - dependency2

inputs:
    param1: type
    param2: type

outputs:
    result1: type
    result2: type

permissions:
    network: internet
    filesystem: read
```

### Agent Declaration

```mam
module AgentName

type:
    agent

role:
    Agent Role

goal:
    Agent Goal

memory:
    type: vector
    backend: sqlite
    scope: workspace

tools:
    - tool1
    - tool2

handoff:
    - NextAgent

rules:
    - rule1
    - rule2
```

### Tool Declaration

```mam
module ToolName

type:
    tool

provider:
    provider-name

permissions:
    network: internet

capabilities:
    - capability1
    - capability2
```

### Memory Declaration

```mam
module MemoryName

type:
    memory

format:
    vector | key-value | relational | graph | document

backend:
    sqlite | redis | postgres | mongodb

scope:
    module | workspace | global

ttl:
    24h | 7d | 30d
```

### Workflow Declaration

```mam
module WorkflowName

type:
    workflow

steps:
    - name: Step1
      agent: Agent1
    - name: Step2
      agent: Agent2

edges:
    Step1 -> Step2
    Step2 -> Step3
```

### Team Declaration

```mam
module TeamName

type:
    team

members:
    - Agent1
    - Agent2
    - Agent3

policy:
    SafeExecution
```

### Policy Declaration

```mam
module PolicyName

type:
    policy

allow:
    - browser
    - python
    - search

deny:
    - shell.rm
    - network.internal

permissions:
    filesystem: read
    network: internet
    python: sandbox
```

### System Declaration

```mam
module SystemName

type:
    system

agents:
    - Agent1
    - Agent2

tools:
    - Tool1
    - Tool2

edges:
    Agent1 -> Agent2
    Agent2 -> Tool1

memory:
    shared: SharedMemory

policy:
    SafePolicy
```

---

## Compiler Targets

MAM compiles to 16 target languages:

| Target | Command | Output |
|--------|---------|--------|
| Python | `mam compile -t python` | `.py` |
| JavaScript | `mam compile -t javascript` | `.js` |
| Go | `mam compile -t go` | `.go` |
| Rust | `mam compile -t rust` | `.rs` |
| C# | `mam compile -t csharp` | `.cs` |
| Java | `mam compile -t java` | `.java` |
| WebAssembly | `mam compile -t wasm` | `.wasm` |
| JSON | `mam compile -t json` | `.json` |
| OpenAI SDK | `mam compile -t openai` | `.json` |
| LangGraph | `mam compile -t langgraph` | `.py` |
| CrewAI | `mam compile -t crewai` | `.py` |
| Gemini | `mam compile -t gemini` | `.py` |
| AutoGen | `mam compile -t autogen` | `.py` |
| Claude SDK | `mam compile -t claude` | `.ts` |
| Kubernetes | `mam compile -t kubernetes` | `.yaml` |
| Terraform | `mam compile -t terraform` | `.tf` |
| Docker | `mam compile -t docker` | `Dockerfile` |

---

## Package Management

### mam-package.json

```json
{
  "name": "my-module",
  "version": "1.0.0",
  "description": "My MAM module",
  "author": "Author",
  "license": "MIT",
  "main": "index.mam.md",
  "dependencies": {
    "@mam/core": "^1.0.0"
  }
}
```

### Commands

```bash
# Initialize package
mam init my-package

# Install dependencies
mam install example-agent        # a single module from the Hub
mam install                      # or everything in mam-package.json

# Publish the module (or the whole folder) to the MAM Hub
mam publish my-package.mam.md

# Fan the same module out to other ecosystems
mam publish my-package.mam.md --targets npm,python,github
#   npm    -> dist/npm/<id>/ npm package (published with the real npm CLI)
#   python -> dist/python/  pip package   (built with python -m build + twine)
#   github -> dist/github/  release notes (release created via the gh CLI)
```

---

## Examples

### Example 1: Simple Module

```mam
---
id: hello
version: 2.0.0
name: Hello Module
author: Author
runtime: python
---

# Hello Module

## Purpose

Simple greeting module.

## Python

```python
def greet(name: str) -> str:
    return f"Hello, {name}!"
```

## Examples

```python
result = greet("World")
print(result)  # Hello, World!
```
```

### Example 2: Agent Module

```mam
---
id: researcher
version: 2.0.0
name: Research Agent
author: Author
runtime: python
tags:
  - agent
  - research
---

# Research Agent

## Purpose

Automated research agent for information gathering.

## Prompt

You are a research agent that gathers information from various sources.

## Rules

- Always cite sources
- Verify information accuracy
- Avoid speculation
- Document methodology

## Python

```python
def research(topic: str) -> dict:
    """Research a topic and return findings."""
    return {
        "topic": topic,
        "sources": [],
        "findings": [],
        "confidence": 0.0
    }
```

## Memory

- last_research: null
- research_count: 0
```

### Example 3: Multi-Agent System

```mam
---
id: security-team
version: 2.0.0
name: Security Team
author: Author
runtime: python
tags:
  - security
  - multi-agent
---

# Security Team

## Purpose

Multi-agent security testing system.

## Team Definition

module Planner

type:
    agent

role:
    Planning

goal:
    Create execution strategy

module Recon

type:
    agent

role:
    Reconnaissance

goal:
    Discover attack surfaces

module Analyzer

type:
    agent

role:
    Analysis

goal:
    Analyze vulnerabilities

module Reporter

type:
    agent

role:
    Reporting

goal:
    Generate security reports

## System Definition

module SecuritySystem

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

## Policy

module SafeExecution

type:
    policy

allow:
    - browser
    - python
    - search

deny:
    - shell.rm
    - network.internal
```

---

## Project Structure

A complete MAM project uses `mam.toml` to compose modules into a system:

```text
my-project/
├── mam.toml              ← project manifest (entry, module globs, targets)
├── system.mam            ← entry system (composes the modules)
├── system.mam.md         ← identical source twin
└── modules/
    ├── hello.mam         ← module in canonical .mam form
    ├── hello.mam.md      ← identical source twin
    ├── authentication.mam
    ├── api.mam
    └── ...
```

> `mam init`, `mam build`, `mam run`, `mam validate`, `mam graph`,
> `mam test` and `mam info` all operate on the whole project automatically
> when run inside a directory containing `mam.toml`.

Ready-made example projects live in `modules/examples/`: `core`, `basic`,
`advanced`, `plugins` and `security-system` (each a full `mam.toml` project),
plus one runnable example per module type. 19 reusable type templates live in
`modules/templates/`.

---

## Module Registry (MAM Hub)

The registry is a production service (`registry/`): `@mam/registry-api`
(contract), `@mam/registry-server` (HTTP + GraphQL service), `@mam/registry-client`
(typed client).

```bash
# Publish and discover
mam publish modules/hello.mam
mam search "authentication"
mam install

# Run your own registry (from registry/server)
node -e "import('./dist/index.js').then(async ({ RegistryServer, RegistryHttpServer }) => {
  const server = new RegistryServer({ port: 3000, dataDir: './data',
    authRequired: true, rateLimit: 100, maxUploadSize: 5e6, corsOrigins: [],
    auth: { bootstrapAdmin: { username: 'admin', email: 'a@x.test', password: '...' } } });
  await server.start();
  await new RegistryHttpServer({ server, port: 3000 }).listen();
})"
```

Service properties: persistent users/sessions, atomic writes, per-module locks,
path-traversal-safe storage, inverted-index search, scrypt auth with lockout,
CORS, security headers, body limits, rate limiting, graceful shutdown, real
gzip tarballs with SHA-256 integrity, GraphQL at `/graphql`.

---

## Configuration

### mam.config.json

```json
{
  "runtime": "python",
  "validationLevel": "semantic",
  "outputFormat": "text",
  "formatter": {
    "indent": 4,
    "maxLineLength": 200
  },
  "linter": {
    "level": "warning",
    "style": true,
    "bestPractices": true
  }
}
```

---

## Troubleshooting

### Common Issues

**Module not found**
```bash
# Check file exists
ls *.mam
ls *.mam.md

# Validate module
mam validate my-module.mam.md
```

**Parse errors**
```bash
# Check syntax
mam lint my-module.mam.md

# View detailed errors
mam validate my-module.mam.md --level strict
```

**Compilation fails**
```bash
# Check environment
mam doctor

# Try different target
mam compile my-module.mam -t json
```

---

## Resources

- [Specification](spec/SPEC.md)
- [Purpose](purpose.md)
- [Goal](goal.md)
- [Scope](scope.md)
- [Examples](modules/examples/)
- [Changelog](CHANGELOG.md)
- [v2 Plan](plan-doc/plan-v2.md)