---
id: system
name: Basic System
version: 1.0.0
type: system
author: MAM Team
description: >
  Composes the basic utility modules into one executable system.
license: MIT
runtime:
  language: python
  version: ">=3.12"
tags:
  - example
  - system
dependencies:
  - name: hello-world
    version: ">=1.0.0"
  - name: calculator
    version: ">=1.0.0"
  - name: password-gen
    version: ">=1.0.0"
  - name: string-utils
    version: ">=1.0.0"
  - name: temperature
    version: ">=1.0.0"
  - name: text-transform
    version: ">=1.0.0"
capabilities:
  - orchestrate
permissions:
  filesystem:
    - read
---

# Basic System

## Purpose

Entry system that composes the project modules into a single utility set:
hello world, calculator, password generator, string utilities, temperature
converter, and text transform.

## Modules

- Hello World
- Calculator
- Password Generator
- String Utilities
- Temperature Converter
- Text Transform

## Capabilities

### orchestrate

Run the composed modules in dependency order.

## Rules

- All modules operate within the declared scope.
- Results must be validated before use.

## Workflow

```mermaid
flowchart LR
    HelloWorld --> Output
    Calculator --> Output
    PasswordGen --> Output
    StringUtils --> Output
    Temperature --> Output
    TextTransform --> Output
```

## Tests

### Input

```yaml
name: World
```

### Expected

```yaml
output: present
```

## References

- MAM documentation