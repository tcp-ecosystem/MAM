---
id: system
name: Plugins
version: 2.0.0
type: system
author: MAM Examples
description: >
  Composes the plugin extension examples into one executable system.
license: MIT
runtime:
  language: typescript
  version: ">=5.0"
tags:
  - system
  - plugins
dependencies:
  - name: custom-section
    version: ">=1.0.0"
  - name: export-plugin
    version: ">=1.0.0"
  - name: memory-plugin
    version: ">=1.0.0"
  - name: runtime-plugin
    version: ">=1.0.0"
  - name: validation-plugin
    version: ">=1.0.0"
capabilities:
  - orchestrate
permissions:
  filesystem:
    - read
---

# Plugins

## Purpose

Entry system that composes the plugin examples into a single extension set:
custom sections, exporters, memory backends, runtimes and validation rules.

## Modules

- Custom Section
- Export Plugin
- Memory Plugin
- Runtime Plugin
- Validation Plugin

## Capabilities

### orchestrate

Run the composed plugins in dependency order.

## Rules

- All plugins operate within the declared scope.
- Each plugin exposes only its declared capabilities.

## Workflow

```mermaid
flowchart LR
    Validation --> Custom
    Custom --> Export
    Memory --> Runtime
```

## Tests

### Input

```yaml
scope: plugins
```

### Expected

```yaml
system: valid
```

## References

- MAM Plugin API documentation
- MAM documentation