---
id: system
name: Security System
version: 1.0.0
type: system
author: MAM Team
description: >
  Composes recon, analyzer and reporter into one executable security system.
license: MIT
runtime:
  language: python
  version: ">=3.12"
tags:
  - security
  - system
dependencies:
  - name: recon
    version: ">=1.0.0"
  - name: analyzer
    version: ">=1.0.0"
  - name: reporter
    version: ">=1.0.0"
capabilities:
  - orchestrate
permissions:
  network:
    - internet
  filesystem:
    - read
---

# Security System

## Purpose

Entry system that composes the project modules into a single pipeline:
recon, then analyzer, then reporter.

## Modules

- Recon
- Analyzer
- Reporter

## Capabilities

### orchestrate

Run the composed modules in dependency order.

## Rules

- All modules operate within the declared scope.
- Findings must be validated before reporting.

## Workflow

```mermaid
flowchart LR
    Recon --> Analyzer
    Analyzer --> Reporter
```

## Tests

### Input

```yaml
scope: example.com
```

### Expected

```yaml
report: present
```

## References

- MAM documentation
