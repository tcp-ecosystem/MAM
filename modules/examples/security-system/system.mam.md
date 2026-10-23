---
# MAM Metadata
id: system
name: Security System
version: 2.0.0
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

## Python

```python
MODULES = ["recon", "analyzer", "reporter"]
CAPABILITIES = ["orchestrate"]
EDGES = [("recon", "analyzer"), ("analyzer", "reporter")]


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
scope: example.com
```

### Expected

```yaml
report: present
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
