# MAM v2 Design Document

> **Status: 90% Implemented** (2026-07-24)

---

## Implementation Summary

### From Section 1: Roadmap ✅
| Concept | Status | Implementation |
|---------|--------|----------------|
| MAM Specification | ✅ | `spec/SPEC.md` (600+ lines) |
| MAM Parser | ✅ | `parser/src/` (12 files) |
| MAM Runtime | ✅ | `runtime/src/` (7 files) |
| MAM DSL | ✅ | `parser/src/parser/dsl.ts` (600+ lines) |
| MAM Language | ✅ | Full DSL syntax support |

### From Section 2: DSL ✅
| Concept | Status | Implementation |
|---------|--------|----------------|
| Module syntax | ✅ | `ast/src/nodes/v2.ts` |
| Agent syntax | ✅ | `ast/src/nodes/v2.ts` |
| Tool syntax | ✅ | `ast/src/nodes/v2.ts` |
| Memory syntax | ✅ | `ast/src/nodes/v2.ts` |
| Workflow syntax | ✅ | `ast/src/nodes/v2.ts` |
| Team syntax | ✅ | `ast/src/nodes/v2.ts` |
| Policy syntax | ✅ | `ast/src/nodes/v2.ts` |
| Edge syntax (`->`) | ✅ | `parser/src/parser/dsl.ts` |
| Compiler targets | ✅ | `compiler/src/targets/` (16 targets) |

### From Section 3: System ✅
| Concept | Status | Implementation |
|---------|--------|----------------|
| MAM AST | ✅ | `ast/src/nodes/v2.ts` (500+ lines) |
| Dual identity | ✅ | Implemented |
| Tool names (MAMC, MAMP, etc.) | ✅ | CLI commands |

### From Section 4: Deep System ✅
| Concept | Status | Implementation |
|---------|--------|----------------|
| System objects (25+) | ✅ | `ast/src/nodes/v2.ts` |
| Extension system | ✅ | Plugin API |
| Universal System Model | ✅ | Runtime v2 |
| Philosophy | ✅ | Core design |

---

## SECTION 1

I think that's a fascinating direction, but I'd encourage you to think about it in stages.

**I wouldn't start by calling MAM a programming language.** I'd build it as a **specification** first, then evolve it into a **domain-specific language (DSL)** if it naturally grows in that direction.

A roadmap could look like this:

```
Markdown
      │
      ▼
MAM Specification
      │
      ▼
MAM Parser
      │
      ▼
MAM Runtime
      │
      ▼
MAM DSL
      │
      ▼
MAM Language
```

If MAM becomes a language, it shouldn't compete with Python, Rust, or JavaScript. Those languages excel at computation. MAM would excel at **describing intelligent systems**.

For example, instead of writing procedural code, you describe capabilities:

```mam
module Authentication

requires:
    database
    jwt
    logger

inputs:
    email
    password

workflow:
    validate
    authenticate
    issue_token

output:
    access_token
```

The runtime could compile that into Python, JavaScript, Go, or another target.

That would make MAM a **declarative language**, similar in spirit to:

* SQL for databases
* Terraform for infrastructure
* Dockerfile for containers
* GitHub Actions YAML for CI/CD

MAM would occupy a different niche:

> **A declarative language for AI agents and autonomous workflows.**

Imagine describing an agent:

```mam
agent Researcher

memory:
    persistent

tools:
    search
    browser
    python

goal:
    collect_information

rules:
    verify_sources
    cite_references
    avoid_speculation

handoff:
    Writer
```

Or an entire multi-agent system:

```mam
system BugHunter

agent Planner
agent Recon
agent Analyzer
agent Reporter

Planner -> Recon
Recon -> Analyzer
Analyzer -> Reporter
```

A compiler could transform that into executable code for LangGraph, OpenAI Agents SDK, CrewAI, AutoGen, or your own runtime.

## What MAM could become

I see five layers:

1. **MAM Spec** — defines the format.
2. **MAM Parser** — converts files into an AST.
3. **MAM Runtime** — executes modules.
4. **MAM Compiler** — transpiles to Python, JavaScript, Go, etc.
5. **MAM Language** — a standalone DSL for agentic systems.

Eventually, you might even define dedicated file types:

```
.mam      → source module
.mamlib   → library
.mampkg   → package
.mamlock  → dependency lock
```

with commands like:

```bash
mam init
mam build
mam run
mam compile
mam test
mam publish
mam install
```

## Where I think MAM could stand out

Most languages answer the question:

> "How do I compute something?"

MAM could answer a different question:

> "How do I describe an intelligent system?"

That distinction is important. Rather than replacing existing programming languages, MAM would sit one level higher, expressing **agents, memory, tools, workflows, policies, permissions, prompts, and orchestration**. Existing languages would remain the execution engines beneath it.

That gives MAM a unique identity: not a general-purpose language, but a language for designing and orchestrating AI-native systems.


## SECTION 2 DSL


I actually think this is the stronger vision.

Don't market MAM as **"another programming language."**

Market it as an **AI-Orchestration DSL**.

Just as:

* SQL describes **data**
* HTML describes **documents**
* CSS describes **presentation**
* Terraform describes **infrastructure**
* Dockerfile describes **containers**

**MAM describes intelligent systems.**

That immediately gives it a unique identity.

---

# MAM DSL

> **A declarative language for designing AI systems.**

Notice the wording.

Not for programming.

For **designing**.

Programming still happens underneath.

```text
              Human Intent
                    │
                    ▼
              MAM DSL Source
                    │
                    ▼
             MAM Compiler
                    │
      ┌─────────────┼──────────────┐
      ▼             ▼              ▼
   Python      JavaScript      Rust
      ▼             ▼              ▼
   Runtime      Runtime        Runtime
```

MAM becomes the **architecture layer**.

---

# Think in Layers

Instead of writing Python directly:

```python
agent = Agent(...)
memory = Memory(...)
tool = SearchTool(...)
workflow = Planner(...)
```

You describe the system.

```mam
agent Researcher

goal:
    discover vulnerabilities

memory:
    persistent

tools:
    browser
    python
    search

handoff:
    Reporter
```

Python becomes an implementation detail.

---

# MAM Stack

```text
Layer 7
Human

↓

Layer 6
MAM DSL

↓

Layer 5
Compiler

↓

Layer 4
AST

↓

Layer 3
Plugin System

↓

Layer 2
Target Runtime

↓

Layer 1
Operating System
```

Every existing language stays exactly where it belongs.

---

# What does MAM describe?

Not algorithms.

Systems.

For example...

---

## Agents

```mam
agent Planner

role:
    Planning

goal:
    Create execution strategy

memory:
    shared
```

---

## Tools

```mam
tool Browser

provider:
    chromium

permissions:
    internet
```

---

## Memory

```mam
memory Shared

type:
    vector

backend:
    sqlite

scope:
    workspace
```

---

## Workflows

```mam
workflow Recon

steps:

- Discover

- Crawl

- Analyze

- Validate

- Report
```

---

## Teams

```mam
team Security

members:

- Planner

- Recon

- Analyzer

- Reporter
```

---

## Communication

```mam
Planner

-> Recon

-> Analyzer

-> Reporter
```

---

## Policies

```mam
policy SafeExecution

allow:

- browser

- python

deny:

- shell.rm

- network.internal
```

---

## Permissions

```mam
permissions

filesystem:
    read

network:
    internet

python:
    sandbox

memory:
    shared
```

---

# Modules

Everything is a module.

```text
planner.mam

researcher.mam

browser.mam

memory.mam

policy.mam

workflow.mam

prompt.mam

rag.mam

security.mam
```

Nothing special.

Everything composes.

---

# Packages

```text
security/

planner/

memory/

rag/

prompt/

tools/
```

Like npm.

Like PyPI.

But for AI modules.

---

# Compiler Targets

The compiler doesn't execute.

It translates.

```text
MAM

↓

Python

↓

JavaScript

↓

Go

↓

Rust

↓

OpenAI SDK

↓

Claude SDK

↓

Hermes

↓

CrewAI

↓

LangGraph

↓

AutoGen

↓

Custom Runtime
```

One specification.

Many runtimes.

---

# The AST

This is where I think MAM becomes powerful.

Everything becomes nodes.

```text
Module

├── Metadata

├── Agent

├── Tool

├── Memory

├── Workflow

├── Prompt

├── Rules

├── Tests

├── Python

├── Mermaid

└── Plugins
```

Every runtime consumes the AST.

---

# Philosophy

Python answers

> How?

MAM answers

> What?

Python

```python
for url in urls:
    scan(url)
```

MAM

```mam
goal:
    Scan targets
```

Python implements.

MAM describes.

---

# The Future

This is where I think MAM could become genuinely influential.

Imagine if every AI framework accepted MAM:

```text
OpenAI

Claude

Gemini

Grok

CrewAI

LangGraph

AutoGen

Hermes

OpenCode

MimoCode

KiloCode

Ghost

...
```

Every one of them could read the same `.mam` module, build the same AST, and execute it using their own runtime. That means developers define an AI system once and choose the execution engine later.

That's analogous to how HTML isn't tied to a single browser. HTML is a standard; Chrome, Firefox, and Safari each implement it differently. MAM could aim for a similar role in the AI ecosystem: **a portable, declarative language for describing intelligent systems**, leaving execution details to the underlying runtime. If you can keep the specification open, deterministic, and implementation-independent, you'll have something much more enduring than a framework-specific configuration format.


## SECTION 3 SYSTEM

I actually think you've stumbled onto something that many language projects miss.

The **heart of MAM isn't Markdown**.

The heart is **the Module**.

Markdown is simply the best human syntax for expressing it.

That leads to an architecture like this:

```text
          MAM
(Markdown as Module)
               │
               ▼
        MAM Specification
               │
        ┌──────┴──────┐
        ▼             ▼
 Markdown Syntax   Future Syntaxes
 (.mam.md)         (.mam.json)
                   (.mam.yaml)
                   (.mam.toml)
                   (.mam.bin)
        │             │
        └──────┬──────┘
               ▼
            MAM AST
               ▼
        MAM Compiler
               ▼
      Python • JS • Go • Rust
```

This is exactly how HTML has the DOM, or Protocol Buffers have a schema and multiple language bindings.

## So should the name stay?

I actually think **yes**.

**Markdown as Module** is what makes people stop and think.

It's memorable.

It immediately communicates:

> "Wait... you're turning Markdown into executable architecture?"

That's a powerful first impression.

Then, internally, you can evolve the meaning.

For example:

> **MAM**
>
> **Markdown as Module**
>
> *The reference syntax for the Machine Agent Module Specification.*

Notice what happened.

You didn't rename it.

You expanded it.

Now MAM has two identities.

### Human Identity

> Markdown as Module

This is what users write.

### System Identity

> Machine Agent Modules

This is what the compiler understands.

That means your documentation can naturally say:

> MAM uses **Markdown as Module** as its canonical authoring format. Every MAM document is compiled into the **Machine Agent Module** intermediate representation (MAM AST), which any compliant runtime can execute.

I really like that because it avoids choosing one interpretation over the other—they reinforce each other.

## Even the acronym grows with the ecosystem

Today:

> **MAM = Markdown as Module**

Compiler:

> **MAM IR = Machine Agent Module Intermediate Representation**

Specification:

> **MAM Spec**

Language:

> **MAM DSL**

Compiler:

> **MAMC**

Package manager:

> **MAMP**

Registry:

> **MAM Hub**

Language Server:

> **MAM LSP**

Formatter:

> **mam fmt**

Linter:

> **mam lint**

Builder:

> **mam build**

Runner:

> **mam run**

Publish:

> **mam publish**

Everything stays consistent.

---

### One idea I would strongly encourage

Don't define MAM around AI.

Define it around **systems**.

Then AI becomes the first major application.

Your philosophy becomes:

> **Everything is a module. Every module describes a capability. Every capability composes into a system.**

That vision is broader and more durable. Today those systems may be AI agents. Tomorrow they could include automation pipelines, security workflows, robotics, distributed services, or infrastructure orchestration—all expressed through the same modular language. AI becomes a powerful use case rather than the sole purpose of MAM.

## SECTION 4 DEEP SYSTEM
I think this is the right evolution.

Many projects become obsolete because they're built around today's technology ("AI"). Systems thinking lasts much longer.

Instead of saying:

> **MAM is a language for AI.**

Say:

> **MAM is a language for describing systems.**

AI systems are simply one category.

---

# The MAM Philosophy

## Everything is a System

Everything can be modeled as a system.

A web application.

A security workflow.

A Kubernetes cluster.

A robot.

A CI/CD pipeline.

A business process.

An operating system.

A multi-agent AI.

A compiler.

A database.

A human organization.

Everything is composed of modules.

---

# Everything is a Module

Modules describe capabilities.

```text
Authentication

Database

Memory

Search

Logging

Planning

Monitoring

Billing

Analytics

API

Filesystem

Network

Cache
```

None of these are AI-specific.

They're reusable system components.

---

# Systems are Graphs

Every system is simply:

Nodes

Connections

Dependencies

State

Events

Policies

Resources

Goals

```text
Authentication
        │
        ▼
Database

        │
        ▼
Cache

        │
        ▼
API

        │
        ▼
Client
```

MAM should naturally describe this graph.

---

# Universal System Model

Every system can answer the same questions.

```text
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

Notice...

None mention AI.

---

# MAM Core Objects

Instead of "AI Objects"

Define "System Objects"

```text
Module

System

Component

Service

Resource

Workflow

Task

Policy

Capability

Event

State

Dependency

Interface

Contract

Permission

Role

Identity

Memory

Storage

Network

Tool

Plugin
```

AI Agents become just another object.

```text
Agent

extends

Module
```

---

# Example

Instead of

```mam
agent Researcher
```

You can write

```mam
module Researcher

type:
    agent
```

or

```mam
module PostgreSQL

type:
    database
```

or

```mam
module Kubernetes

type:
    orchestrator
```

Everything becomes consistent.

---

# AI becomes an Extension

Core MAM

↓

Systems

↓

Extensions

```text
Core

↓

AI Extension

↓

Cloud Extension

↓

Security Extension

↓

Robotics Extension

↓

IoT Extension

↓

Game Development Extension

↓

Operating Systems Extension
```

Core never changes.

Extensions evolve.

---

# The Compiler

The compiler shouldn't know AI.

It should know modules.

Example

```text
Module

↓

AST Node

↓

Compiler

↓

Runtime
```

Whether the runtime is

Python

Docker

Terraform

LangGraph

Kubernetes

OpenAI

is irrelevant.

---

# New Vision Statement

## MAM

> **A declarative language for describing modular systems.**

Not AI.

Not infrastructure.

Not applications.

Systems.

---

## Mission

> **Enable humans to describe complex systems in a readable, portable, and executable way.**

---

## Philosophy

> **Everything is a module. Every module exposes capabilities. Modules compose into systems. Systems compile into runtimes.**

That becomes the foundation of the language.

---

# Long-Term Ecosystem

```text
               Human
                  │
                  ▼
             MAM Source
                  │
                  ▼
             MAM Parser
                  │
                  ▼
              MAM AST
                  │
        ┌─────────┼──────────┐
        ▼         ▼          ▼
     AI Runtime  Cloud     Robotics
        ▼         ▼          ▼
     OpenAI    Kubernetes   ROS
        ▼         ▼          ▼
   Security    IoT       Enterprise
```

The important shift is that **MAM doesn't know or care what the target is**. It describes systems in a technology-neutral way. A compiler or runtime can then map those system descriptions to AI frameworks, cloud platforms, robotics stacks, security tools, or future technologies.

I think that's a stronger long-term vision because it makes MAM a **general system description language**. AI is no longer the definition of MAM—it's one of the first ecosystems that can benefit from it. That gives the project room to grow without redefining its core purpose every time the technology landscape changes.
