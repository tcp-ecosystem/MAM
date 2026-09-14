# MAM — The Complete System

> **Markdown as Module**
> *The reference syntax for the Machine Agent Module Specification.*

---

## Identity

MAM has two identities:

### Human Identity

> **Markdown as Module**

This is what users write.

### System Identity

> **Machine Agent Modules**

This is what the compiler understands.

```mermaid
graph LR
    A[Human] --> B[Markdown]
    B --> C[MAM Parser]
    C --> D[MAM AST]
    D --> E[Compiler]
    E --> F[Runtime]
    F --> G[Execution]
    
    subgraph "Human Identity"
        B
    end
    
    subgraph "System Identity"
        D
    end
```

---

## The MAM Stack

```text
Layer 7:  Human (Designer)
Layer 6:  MAM DSL Source (.mam / .mam.md)
Layer 5:  MAM Compiler (mamc)
Layer 4:  MAM AST (Machine Agent Module IR)
Layer 3:  Semantic Analyzer + Validator
Layer 2:  Target Runtime (Python, JS, Go, Rust, OpenAI, LangGraph...)
Layer 1:  Operating System
```

```mermaid
graph TB
    subgraph "Layer 7"
        A[Human Designer]
    end
    
    subgraph "Layer 6"
        B[MAM DSL Source]
    end
    
    subgraph "Layer 5"
        C[MAM Compiler]
    end
    
    subgraph "Layer 4"
        D[MAM AST]
    end
    
    subgraph "Layer 3"
        E[Semantic Analyzer]
        F[Validator]
    end
    
    subgraph "Layer 2"
        G[Python Runtime]
        H[JavaScript Runtime]
        I[Go Runtime]
        J[Rust Runtime]
        K[AI SDK Runtime]
    end
    
    subgraph "Layer 1"
        L[Operating System]
    end
    
    A --> B
    B --> C
    C --> D
    D --> E
    E --> F
    F --> G
    F --> H
    F --> I
    F --> J
    F --> K
    G --> L
    H --> L
    I --> L
    J --> L
    K --> L
```

---

## Core Philosophy

> **Everything is a module. Every module exposes capabilities. Modules compose into systems. Systems compile into runtimes.**

```mermaid
graph TB
    A[Everything] --> B[Is a Module]
    B --> C[Exposes Capabilities]
    C --> D[Composes into Systems]
    D --> E[Compiles into Runtimes]
    
    subgraph "MAM Philosophy"
        F[Human First]
        G[Machine Friendly]
        H[System Focused]
        I[Runtime Independent]
    end
    
    B --> F
    C --> G
    D --> H
    E --> I
```

---

## What MAM Describes

Not algorithms. **Systems.**

| Category | Examples |
|----------|----------|
| **AI Systems** | Agents, teams, workflows, memory |
| **Cloud Systems** | Services, APIs, databases, caches |
| **Security Systems** | Scanners, analyzers, reporters |
| **Automation Systems** | Pipelines, triggers, schedules |
| **Infrastructure** | Servers, containers, orchestration |
| **Enterprise** | Processes, policies, governance |

---

## The MAM Ecosystem

```mermaid
graph TB
    subgraph "Core"
        A[Specification]
        B[Parser]
        C[AST]
        D[Validator]
        E[Compiler]
        F[Runtime]
    end
    
    subgraph "Tooling"
        G[CLI]
        H[Package Manager]
        I[Registry]
        J[Language Server]
    end
    
    subgraph "Extensions"
        K[Plugins]
        L[SDKs]
        M[Testing]
        N[Visualization]
    end
    
    subgraph "Targets"
        O[Python]
        P[JavaScript]
        Q[Go]
        R[Rust]
        S[AI SDKs]
        T[Infrastructure]
    end
    
    A --> B
    B --> C
    C --> D
    D --> E
    E --> F
    
    G --> A
    H --> I
    J --> C
    
    K --> A
    L --> F
    M --> E
    N --> C
    
    E --> O
    E --> P
    E --> Q
    E --> R
    E --> S
    E --> T
```

---

## Tool Names

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
| mam test | MAM Test | Test runner |
| mam viz | MAM Visualize | Graph visualization |
| mam audit | MAM Audit | Security audit |

---

## File Types

| Extension | Description |
|-----------|-------------|
| `.mam` | Source module (Markdown syntax) |
| `.mam.md` | Source module (explicit Markdown) |
| `.mamlib` | Library module |
| `.mampkg` | Package (distributable) |
| `.mamlock` | Dependency lock file |

---

## Module Types

```mermaid
graph TB
    A[Module] --> B[Agent]
    A --> C[Tool]
    A --> D[Memory]
    A --> E[Workflow]
    A --> F[Team]
    A --> G[Policy]
    A --> H[System]
    A --> I[Service]
    A --> J[Component]
    A --> K[Resource]
    A --> L[Interface]
    A --> M[Contract]
    A --> N[Extension]
    A --> O[Runtime]
    A --> P[Package]
    A --> Q[Repository]
    A --> R[Documentation]
```

---

## Example: Multi-Agent System

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

module Planner

type:
    agent

role:
    Planning

goal:
    Create execution strategy

memory:
    shared

handoff:
    - Recon

module Recon

type:
    agent

role:
    Reconnaissance

goal:
    Discover attack surfaces

tools:
    - browser
    - python
    - search

handoff:
    - Analyzer

module Analyzer

type:
    agent

role:
    Analysis

goal:
    Analyze vulnerabilities

handoff:
    - Reporter

module Reporter

type:
    agent

role:
    Reporting

goal:
    Generate security reports

module SharedMemory

type:
    memory

format:
    vector

backend:
    sqlite

scope:
    workspace

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

## Compilation Flow

```mermaid
flowchart TD
    A[MAM Source] --> B[Lexer]
    B --> C[Tokens]
    C --> D[Parser]
    D --> E[AST]
    E --> F[Semantic Analyzer]
    F --> G[Validator]
    G --> H{Valid?}
    H -->|Yes| I[Compiler]
    H -->|No| J[Error Report]
    I --> K{Target?}
    K -->|Python| L[.py]
    K -->|JavaScript| M[.js]
    K -->|Go| N[.go]
    K -->|Rust| O[.rs]
    K -->|AI SDK| P[SDK Code]
    K -->|Docker| Q[Dockerfile]
    L --> R[Runtime]
    M --> R
    N --> R
    O --> R
    P --> R
    Q --> R
    R --> S[Execution]
```

---

## The North Star

> **"Describe Systems. Compile Anywhere."**

MAM is not trying to replace Python, JavaScript, or Rust — it occupies the layer above them, where systems are described independently of how they're ultimately implemented.

```mermaid
graph TB
    subgraph "MAM's Role"
        A[Human Intent] --> B[MAM DSL]
        B --> C[System Description]
        C --> D[Compilation]
        D --> E[Runtime Execution]
    end
    
    subgraph "What MAM Answers"
        F[What exists?]
        G[What connects?]
        H[What rules apply?]
        I[What resources?]
    end
    
    C --> F
    C --> G
    C --> H
    C --> I
    
    subgraph "What Programming Answers"
        J[How to implement?]
        K[How to optimize?]
        L[How to scale?]
    end
    
    E --> J
    E --> K
    E --> L
```

---

## Long-Term Vision

```mermaid
graph TB
    subgraph "Today"
        A[MAM Beta]
        B[16 Compiler Targets]
        C[34 CLI Commands]
        D[5 Core Plugins]
        E[4 SDKs]
    end
    
    subgraph "Tomorrow"
        F[Universal Standard]
        G[100+ Modules]
        H[50+ Plugins]
        I[Enterprise Adoption]
    end
    
    subgraph "Future"
        J[AI Orchestration Standard]
        K[System Description Language]
        L[Open Ecosystem]
    end
    
    A --> F
    B --> G
    C --> H
    D --> I
    E --> I
    
    F --> J
    G --> K
    H --> L
    I --> L
```

---

## Summary

MAM is:

- A **declarative language** for describing modular systems
- A **compiler target** for multiple runtimes
- A **package format** for AI and system modules
- An **open standard** for system description
- A **bridge** between human intent and machine execution

MAM is NOT:

- Another programming language
- A replacement for Python/JavaScript/Rust
- A framework-specific configuration
- A prompt engineering tool

---

## The Promise

> **Write once. Describe systems. Compile anywhere.**

MAM enables developers to:

1. **Describe** complex systems in readable Markdown
2. **Compose** modules into larger systems
3. **Compile** to any target runtime
4. **Share** modules across projects and teams
5. **Version** system designs over time

---

## Join the Movement

MAM is an open standard for system description. Whether you're building AI agents, cloud infrastructure, or enterprise workflows, MAM provides a portable, composable, and readable way to describe your systems.

> **"The Language of Systems."**