# MAM Usage Guide

> **Complete guide to using MAM (Markdown as Module)**

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
git clone https://github.com/your-org/mam.git
cd mam

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

### 1. Create a Module

```bash
# Basic module
mam init my-module

# Agent module
mam init my-agent --template agent

# Workflow module
mam init my-workflow --template workflow

# Team module
mam init my-team --template team
```

### 2. Edit the Module

```markdown
---
id: my-module
version: 1.0.0
name: My Module
author: YourName
runtime: python
tags:
  - example
---

# My Module

## Purpose

Describe what this module does.

## Rules

- Rule 1
- Rule 2

## Examples

Example usage here.
```

### 3. Validate

```bash
mam validate my-module.mam.md
```

### 4. Build

```bash
mam build my-module.mam.md
```

### 5. Compile

```bash
# To Python
mam compile my-module.mam.md -t python

# To JavaScript
mam compile my-module.mam.md -t javascript

# To Rust
mam compile my-module.mam.md -t rust
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
version: 1.0.0
name: Module Name
author: Author Name
runtime: python
tags:
  - tag1
  - tag2
description: Module description
permissions:
  - network
  - filesystem
---
```

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

### Module Management

#### Initialize Module

```bash
# Basic module
mam init my-module

# With template
mam init my-agent --template agent

# With specific runtime
mam init my-module --runtime javascript
```

**Templates:**
- `basic` - Simple module with Purpose, Rules, Examples
- `full` - Complete module with all sections
- `agent` - AI agent with tools and memory
- `workflow` - Process workflow definition
- `team` - Multi-agent team

#### Build Module

```bash
# Build to AST
mam build my-module.mam.md

# Build to specific directory
mam build my-module.mam.md --outDir ./build

# Build with minification
mam build my-module.mam.md --minify
```

#### Validate Module

```bash
# Basic validation
mam validate my-module.mam.md

# Strict validation
mam validate my-module.mam.md --level strict

# JSON output
mam validate my-module.mam.md --format json
```

#### Test Module

```bash
# Test single module
mam test my-module.mam.md

# Test all modules in directory
mam test

# Verbose output
mam test --verbose
```

### Development

#### Lint Module

```bash
# Basic linting
mam lint my-module.mam.md

# Error level only
mam lint my-module.mam.md --level error

# JSON output
mam lint my-module.mam.md --format json
```

#### Format Module

```bash
# Check formatting
mam format my-module.mam.md --check

# Format in place
mam format my-module.mam.md --in-place

# Custom indentation
mam format my-module.mam.md --indent 2
```

#### Show Graph

```bash
# Text format
mam graph

# Mermaid format
mam graph --format mermaid

# ASCII art
mam graph --format ascii

# JSON format
mam graph --format json
```

#### Display AST

```bash
# Pretty print
mam ast my-module.mam.md

# JSON format
mam ast my-module.mam.md --format json

# Statistics only
mam ast my-module.mam.md --format stats
```

#### Check Environment

```bash
mam doctor
```

### Execution

#### Run Module

```bash
# Run with defaults
mam run my-module.mam.md

# Run with inputs
mam run my-module.mam.md --inputs '{"key": "value"}'

# Run with timeout
mam run my-module.mam.md --timeout 60000
```

#### Compile Module

```bash
# Compile to Python
mam compile my-module.mam.md -t python

# Compile to JavaScript
mam compile my-module.mam.md -t javascript

# Compile to Go
mam compile my-module.mam.md -t go

# Compile to Rust
mam compile my-module.mam.md -t rust

# Compile to AI SDK
mam compile my-module.mam.md -t openai
mam compile my-module.mam.md -t langgraph
mam compile my-module.mam.md -t crewai

# Compile to Docker
mam compile my-module.mam.md -t docker

# Compile to JSON
mam compile my-module.mam.md -t json
```

### Package Management

#### Install Dependencies

```bash
# Install from mam-package.json
mam install

# Install specific package
mam install @mam/core
```

#### Publish Module

```bash
# Publish to registry
mam publish my-module.mam.md

# Publish with private access
mam publish my-module.mam.md --access private
```

### Documentation

#### Generate Docs

```bash
# Generate Markdown docs
mam docs my-module.mam.md

# Generate with API reference
mam docs my-module.mam.md --api

# Generate to specific directory
mam docs my-module.mam.md --outDir ./docs
```

#### Export Module

```bash
# Export to JSON
mam export my-module.mam.md --format json

# Export to HTML
mam export my-module.mam.md --format html

# Export to Markdown
mam export my-module.mam.md --format markdown

# Export AST
mam export my-module.mam.md --format ast
```

### Utilities

#### Start Dev Server

```bash
# Start on default port
mam serve

# Start on custom port
mam serve --port 8080
```

#### Migrate Module

```bash
# Migrate v1 to v2
mam migrate my-module.mam.md

# Migrate in place
mam migrate my-module.mam.md --in-place

# Dry run (show changes without applying)
mam migrate my-module.mam.md --dry-run
```

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

| Target | Command | Output |
|--------|---------|--------|
| Python | `mam compile -t python` | `.py` |
| JavaScript | `mam compile -t javascript` | `.js` |
| Go | `mam compile -t go` | `.go` |
| Rust | `mam compile -t rust` | `.rs` |
| OpenAI SDK | `mam compile -t openai` | `.py` |
| LangGraph | `mam compile -t langgraph` | `.py` |
| CrewAI | `mam compile -t crewai` | `.py` |
| Claude SDK | `mam compile -t claude` | `.py` |
| Docker | `mam compile -t docker` | `Dockerfile` |
| JSON | `mam compile -t json` | `.json` |

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
mam install

# Publish to registry
mam publish my-package.mam.md

# Search registry
mam search "authentication"
```

---

## Examples

### Example 1: Simple Module

```mam
---
id: hello
version: 1.0.0
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
version: 1.0.0
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
version: 1.0.0
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

## File Structure

```text
my-project/
├── authentication.mam.md
├── database.mam.md
├── api.mam.md
├── security/
│   ├── policy.mam.md
│   └── scanner.mam.md
├── agents/
│   ├── researcher.mam.md
│   └── analyzer.mam.md
├── workflows/
│   └── deploy.mam.md
├── mam-package.json
└── mam.lock
```

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
mam compile my-module.mam.md -t json
```

---

## Resources

- [Specification](../spec/SPEC.md)
- [Architecture](../ARCHITECTURE.md)
- [Examples](../modules/examples/)
- [v2 Plan](../plan-doc/plan-v2.md)