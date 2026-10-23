---
# MAM Metadata
id: system
name: Core System
version: 2.0.0
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

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| mode | string | No | `demo` runs the composition; `validate` checks wiring |
| payload | object | No | Optional input forwarded to the first module |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| status | string | `ok` when the composition is wired |
| modules | list | Composed module ids in dependency order |
| capabilities | list | Union of the composed modules' capabilities |

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

## Python

```python
MODULES = ["metadata", "configuration", "module", "workflow"]
CAPABILITIES = ["orchestrate"]
EDGES = [("metadata", "configuration"), ("configuration", "module"), ("module", "workflow")]


def run_system(mode="demo", payload=None):
    """Validate the composition and report what the system wires together."""
    if mode not in ("demo", "validate"):
        raise ValueError(f"unknown mode: {mode}")
    if len(set(MODULES)) != len(MODULES):
        return {"status": "error", "reason": "duplicate modules", "modules": MODULES}
    known = set(MODULES)
    dangling = [edge for edge in EDGES if edge[0] not in known or edge[1] not in known]
    if dangling:
        return {"status": "error", "reason": "dangling edge", "modules": MODULES}
    return {
        "status": "ok",
        "mode": mode,
        "modules": MODULES,
        "capabilities": CAPABILITIES,
        "edges": EDGES,
        "payload": payload,
    }
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

```python
def test_system_composition():
    result = run_system("demo")
    assert result["status"] == "ok"
    assert result["modules"] == MODULES
    assert result["capabilities"] == CAPABILITIES
```

## Examples

```python
result = run_system("demo", {"target": "example.com"})
print(result["status"], len(result["modules"]))
```

## References

- MAM documentation
