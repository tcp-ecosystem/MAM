---
# MAM Metadata
id: examples-documentation
name: Documentation System
version: 2.0.0
type: system

author: MAM Team

description: >
  Composes the documentation example modules into a runnable system: a composition
  root, a project manifest, and canonical .mam/.mam.md pairs under modules/.

license: MIT

runtime:
  language: python
  version: ">=3.12"

tags:
  - example
  - system
  - documentation

dependencies:
  - name: example-documentation
    version: ">=2.0.0"

capabilities:
  - index_endpoints
  - compare_versions
  - report_drift

permissions:
  filesystem:
    - read
---

# Documentation System

## Purpose

Entry system for the `documentation` example. It composes **Versioned API Reference** and keeps the
folder shape identical to every other example: a composing `system.mam`, a project `mam.toml`, and canonical `.mam`/`.mam.md` pairs under `modules/`.

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| mode | string | No | `demo` runs the composition; `validate` checks the wiring |
| payload | object | No | Optional input forwarded to the first module |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| status | string | `ok` when the composition is wired |
| modules | list | Composed module ids in dependency order |
| capabilities | list | Union of the composed modules' capabilities |

## Modules

- **Versioned API Reference** (`example-documentation`) — Documentation is a module that happens to be read by people, and it fails the same way code fails: quietly, a…

## Capabilities

### `index_endpoints`

Delegates to **Versioned API Reference**.

### `compare_versions`

Delegates to **Versioned API Reference**.

### `report_drift`

Delegates to **Versioned API Reference**.

## Rules

- Endpoint keys are `METHOD /path` with an uppercase method and a leading slash.
- An endpoint is never silently removed from a version; it is deprecated first.
- A summary change is a documentation change and is reported as such, even when
- Drift comparison is a pure function of `code` and `recorded`.
- Every drift entry names an owner, even when the owner is `unassigned`.
- The index never contains duplicates, because a duplicate key is a

## Workflow

```mermaid
flowchart LR
    Input[Input] --> example-documentation[Versioned API Reference]
    example-documentation --> Output[Output]
```

## Python

```python
MODULES = ["example-documentation"]
CAPABILITIES = ["index_endpoints", "compare_versions", "report_drift"]
EDGES = []


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
mode: demo
```

### Expected

```yaml
status: ok
```

```python
def test_system_composition():
    result = run_system("demo")
    assert result["status"] == "ok"
    assert result["modules"] == MODULES
    assert result["capabilities"] == CAPABILITIES
    assert result["edges"] == EDGES


def test_system_rejects_unknown_mode():
    try:
        run_system("deploy")
    except ValueError:
        return
    raise AssertionError("unknown mode must be rejected")
```

## Examples

```python
result = run_system("demo", {"target": "example.com"})
print(result["status"], len(result["modules"]))
```

## References

- [documentation README](./README.md)
- [Examples index](../README.md)
- [MAM specification](../../../plan-doc/full-mam.md)
