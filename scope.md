# MAM Scope — What MAM Covers

> **MAM is a language for describing systems. Not just AI. Not just infrastructure. Systems.**

---

## Scope Definition

MAM occupies a unique position in the technology stack:

```mermaid
graph TB
    subgraph "Application Layer"
        A[Web Apps]
        B[Mobile Apps]
        C[Desktop Apps]
    end
    
    subgraph "System Layer — MAM Lives Here"
        D[AI Agents]
        E[Workflows]
        F[Policies]
        G[Memory]
        H[Tools]
        I[Teams]
    end
    
    subgraph "Infrastructure Layer"
        J[Docker]
        K[Kubernetes]
        L[Terraform]
    end
    
    subgraph "Runtime Layer"
        M[Python]
        N[JavaScript]
        O[Go]
        P[Rust]
    end
    
    A --> D
    B --> E
    C --> F
    D --> J
    E --> K
    F --> L
    J --> M
    K --> N
    L --> O
```

---

## What MAM IS

| Category | MAM Handles |
|----------|-------------|
| **Agents** | AI agent definitions, roles, goals, tools |
| **Workflows** | Process flows, step sequences, handoffs |
| **Policies** | Allow/deny rules, permissions |
| **Memory** | Persistent state, knowledge bases |
| **Tools** | External integrations, capabilities |
| **Teams** | Multi-agent coordination |
| **Systems** | Complete system architectures |
| **Modules** | Reusable components |
| **Dependencies** | Module relationships |
| **Events** | System events and triggers |
| **State** | System state management |
| **Interfaces** | Public contracts |
| **Resources** | External resources |
| **Networks** | Communication patterns |
| **Storage** | Data persistence |

---

## What MAM is NOT

| Category | MAM Does NOT Handle |
|----------|---------------------|
| **Algorithms** | Use Python, Rust, Go |
| **Data Structures** | Use language-native types |
| **Memory Management** | Use language runtime |
| **Concurrency** | Use language features |
| **Hardware** | Use OS/Infrastructure |
| **Networking** | Use language libraries |
| **Database Queries** | Use SQL/ORM |
| **UI Rendering** | Use frontend frameworks |

---

## Scope Boundaries

```mermaid
graph TB
    subgraph "Inside MAM Scope"
        A[Module Definitions]
        B[Agent Configurations]
        C[Workflow Definitions]
        D[Policy Rules]
        E[Memory Schemas]
        F[Tool Integrations]
        G[Team Structures]
        H[System Architectures]
        I[Dependency Graphs]
        J[Permission Models]
    end
    
    subgraph "Outside MAM Scope"
        K[Implementation Code]
        L[Algorithm Logic]
        M[Data Structures]
        N[Memory Management]
        O[Concurrency Control]
        P[Hardware Access]
        Q[Network Protocols]
        R[Database Queries]
    end
    
    A --> K
    B --> K
    C --> K
    D --> K
```

---

## Use Cases

### AI Systems

```mermaid
graph LR
    A[Research Agent] --> B[Analyzer Agent]
    B --> C[Reporter Agent]
    
    subgraph "MAM Defines"
        D[Agent Roles]
        E[Tool Access]
        F[Memory State]
        G[Handoff Rules]
    end
    
    A --- D
    A --- E
    A --- F
    B --- G
```

**MAM defines:** Agent roles, tools, memory, handoffs
**MAM does NOT define:** Agent algorithms, LLM calls, prompt engineering

### Cloud Infrastructure

```mermaid
graph LR
    A[Web Server] --> B[Database]
    B --> C[Cache]
    C --> D[API Gateway]
    
    subgraph "MAM Defines"
        E[Service Dependencies]
        F[Permission Rules]
        G[Scaling Policies]
    end
    
    A --- E
    B --- F
    C --- G
```

**MAM defines:** Service relationships, policies, scaling rules
**MAM does NOT define:** Server config, database queries, cache implementation

### Security Workflows

```mermaid
graph LR
    A[Scanner] --> B[Analyzer]
    B --> C[Reporter]
    C --> D[Remediator]
    
    subgraph "MAM Defines"
        E[Workflow Steps]
        F[Tool Access]
        G[Team Structure]
        H[Security Policies]
    end
    
    A --- E
    A --- F
    B --- G
    C --- H
```

**MAM defines:** Workflow steps, tool access, team structure, policies
**MAM does NOT define:** Scanning algorithms, vulnerability databases, remediation logic

---

## Scope Diagram

```mermaid
graph TB
    subgraph "MAM Ecosystem"
        subgraph "Core"
            A[Specification]
            B[Parser]
            C[AST]
            D[Compiler]
            E[Runtime]
        end
        
        subgraph "Tooling"
            F[CLI]
            G[Package Manager]
            H[Registry]
            I[Language Server]
        end
        
        subgraph "Extensions"
            J[Plugins]
            K[SDKs]
            L[Testing]
            M[Visualization]
        end
    end
    
    A --> B
    B --> C
    C --> D
    D --> E
    
    F --> A
    G --> H
    I --> C
    
    J --> A
    K --> E
    L --> D
    M --> C
```

---

## Scope Matrix

| Dimension | MAM Scope | Out of Scope |
|-----------|-----------|--------------|
| **Abstraction** | System design | Implementation details |
| **Language** | Declarative DSL | Imperative code |
| **Execution** | Compilation target | Runtime internals |
| **State** | System state | Memory management |
| **Communication** | Agent handoffs | Network protocols |
| **Storage** | Memory schemas | Database queries |
| **Security** | Permission rules | Encryption algorithms |
| **Testing** | Test definitions | Test execution |
| **Documentation** | Module docs | API docs |
| **Deployment** | System topology | Container config |

---

## Summary

MAM is the **architecture layer** that sits above implementation:

```text
Human Intent
      │
      ▼
  MAM DSL          ← What exists, what connects, what rules apply
      │
      ▼
  Compiler         ← Translates to target
      │
      ▼
  Runtime          ← Executes the system
      │
      ▼
  Implementation   ← How it actually works
```

> **MAM answers "What?" — Programming languages answer "How?"**