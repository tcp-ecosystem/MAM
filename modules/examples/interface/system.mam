---
# MAM Metadata
id: examples-interface
name: Interface System
version: 2.0.0
type: system

author: MAM Team

description: >
  Composes the interface example modules into a runnable system: a composition
  root, a project manifest, and canonical .mam/.mam.md pairs under modules/.

license: MIT

runtime:
  language: python
  version: ">=3.12"

tags:
  - example
  - system
  - interface

dependencies:
  - name: example-interface
    version: ">=2.0.0"

capabilities:
  - search
  - describe
  - negotiate_version

permissions:
  filesystem:
    - read
---

# Interface System

## Purpose

Entry system for the `interface` example. It composes **Paginated Search Interface** and keeps the
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

- **Paginated Search Interface** (`example-interface`) — An `interface` is a promise.

## Capabilities

### `search`

Delegates to **Paginated Search Interface**.

### `describe`

Delegates to **Paginated Search Interface**.

### `negotiate_version`

Delegates to **Paginated Search Interface**.

## Rules

- `query` must be a non-empty string after trimming; otherwise `ValueError`.
- `page_size` must be an integer between 1 and 100 inclusive; otherwise
- An unrecognised or malformed cursor must raise `ValueError`, never be
- Callers must treat `next_cursor` as opaque and pass it back unchanged.
- `next_cursor` is null on the last page and `has_more` agrees with it.
- New response fields may be added within a major version; existing fields may

## Workflow

```mermaid
flowchart LR
    Input[Input] --> example-interface[Paginated Search Interface]
    example-interface --> Output[Output]
```

## Python

```python
MODULES = ["example-interface"]
CAPABILITIES = ["search", "describe", "negotiate_version"]
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

- [interface README](./README.md)
- [Examples index](../README.md)
- [MAM specification](../../../plan-doc/full-mam.md)
