---
# MAM Metadata
id: examples-module
name: Module System
version: 2.0.0
type: system

author: MAM Team

description: >
  Composes the module example modules into a runnable system: a composition
  root, a project manifest, and canonical .mam/.mam.md pairs under modules/.

license: MIT

runtime:
  language: python
  version: ">=3.12"

tags:
  - example
  - system
  - module

dependencies:
  - name: example-module
    version: ">=2.0.0"

capabilities:
  - analyze
  - summarize

permissions:
  filesystem:
    - read
---

# Module System

## Purpose

Entry system for the `module` example. It composes **Text Statistics** and keeps the folder shape
identical to every other example: a composing `system.mam`, a project `mam.toml`, and canonical `.mam`/`.mam.md` pairs under `modules/`.

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

- **Text Statistics** (`example-module`) — The simplest interesting example of a `module`: it reads a string, computes a few statistics, and returns the…

## Capabilities

### `analyze`

Delegates to **Text Statistics**.

### `summarize`

Delegates to **Text Statistics**.

## Rules

- The module is pure: the same input always produces the same output.
- No file, network or environment access.
- Empty or whitespace-only input returns zeroes rather than raising.
- A word is any whitespace-separated run of non-whitespace characters.

## Workflow

```mermaid
flowchart LR
    Input[Input] --> example-module[Text Statistics]
    example-module --> Output[Output]
```

## Python

```python
MODULES = ["example-module"]
CAPABILITIES = ["analyze", "summarize"]
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

- [module README](./README.md)
- [Examples index](../README.md)
- [MAM specification](../../../plan-doc/full-mam.md)
