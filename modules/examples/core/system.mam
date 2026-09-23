---
id: system
name: Core System
version: 1.0.0
type: system
author: MAM Team
description: >
  Composes the core anatomy modules into one executable system.
license: MIT
runtime:
  language: python
  version: ">=3.12"
tags:
  - core
  - system
dependencies:
  - name: metadata
    version: ">=1.0.0"
  - name: configuration
    version: ">=1.0.0"
  - name: module
    version: ">=1.0.0"
  - name: workflow
    version: ">=1.0.0"
capabilities:
  - orchestrate
permissions:
  filesystem:
    - read
---

# Core System

## Purpose

Entry system that composes the core anatomy modules: metadata, configuration, module, and workflow.

## Modules

- Metadata
- Configuration
- Module
- Workflow

## Capabilities

### orchestrate

Run the composed core modules in dependency order.

## Rules

- Compose modules in declared order.
- Validate all module output before reporting.

## Workflow

```mermaid
flowchart LR
    Metadata --> Configuration
    Configuration --> Module
    Module --> Workflow
```

## Tests

### Input

```yaml
name: core
```

### Expected

```yaml
system: ready
```

## References

- MAM documentation