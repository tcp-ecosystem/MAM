---
# MAM Metadata
id: examples-extension
name: Extension System
version: 2.0.0
type: system

author: MAM Team

description: >
  Composes the extension example modules into a runnable system: a composition
  root, a project manifest, and canonical .mam/.mam.md pairs under modules/.

license: MIT

runtime:
  language: python
  version: ">=3.12"

tags:
  - example
  - system
  - extension

dependencies:
  - name: example-extension
    version: ">=2.0.0"

capabilities:
  - register
  - resolve
  - list_formatters

permissions:
  filesystem:
    - read
---

# Extension System

## Purpose

Entry system for the `extension` example. It composes **Formatter Extension Point** and keeps the
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

- **Formatter Extension Point** (`example-extension`) — An extension point is a promise that something unknown can be added later without editing the host.

## Capabilities

### `register`

Delegates to **Formatter Extension Point**.

### `resolve`

Delegates to **Formatter Extension Point**.

### `list_formatters`

Delegates to **Formatter Extension Point**.

## Rules

- Format names are unique, lowercase, and match `[a-z][a-z0-9_-]*`.
- Priority is an integer; the highest priority wins and ties are impossible
- Registration order never affects resolution order.
- A rejected registration leaves the registry exactly as it was.
- The catalogue is a copy: mutating it cannot corrupt the registry.
- No filesystem or network access happens during registration or resolution.

## Workflow

```mermaid
flowchart LR
    Input[Input] --> example-extension[Formatter Extension Point]
    example-extension --> Output[Output]
```

## Python

```python
MODULES = ["example-extension"]
CAPABILITIES = ["register", "resolve", "list_formatters"]
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

- [extension README](./README.md)
- [Examples index](../README.md)
- [MAM specification](../../../plan-doc/full-mam.md)
