---
# MAM Metadata
id: examples-plugin
name: Plugin System
version: 2.0.0
type: system

author: MAM Team

description: >
  Composes the plugin example modules into a runnable system: a composition
  root, a project manifest, and canonical .mam/.mam.md pairs under modules/.

license: MIT

runtime:
  language: python
  version: ">=3.12"

tags:
  - example
  - system
  - plugin

dependencies:
  - name: example-plugin
    version: ">=2.0.0"

capabilities:
  - on_load
  - intercept
  - on_unload

permissions:
  filesystem:
    - read
---

# Plugin System

## Purpose

Entry system for the `plugin` example. It composes **Report Banner Plugin** and keeps the folder
shape identical to every other example: a composing `system.mam`, a project `mam.toml`, and canonical `.mam`/`.mam.md` pairs under `modules/`.

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

- **Report Banner Plugin** (`example-plugin`) — A plugin is an extension point that ships.

## Capabilities

### `on_load`

Delegates to **Report Banner Plugin**.

### `intercept`

Delegates to **Report Banner Plugin**.

### `on_unload`

Delegates to **Report Banner Plugin**.

## Rules

- A plugin adds behaviour through the host's registry and its call sites, never
- `before` may only add keyword arguments; it may not replace the callable.
- `after` receives the result and returns the replacement, or the value it was
- Unloading restores the host to the state it had before loading, for
- A plugin is a guest: it declares what it matches and never assumes it is the
- The host is unaffected by plugin failures and stays usable after any of them.

## Workflow

```mermaid
flowchart LR
    Input[Input] --> example-plugin[Report Banner Plugin]
    example-plugin --> Output[Output]
```

## Python

```python
MODULES = ["example-plugin"]
CAPABILITIES = ["on_load", "intercept", "on_unload"]
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

- [plugin README](./README.md)
- [Examples index](../README.md)
- [MAM specification](../../../plan-doc/full-mam.md)
