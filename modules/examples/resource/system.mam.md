---
# MAM Metadata
id: examples-resource
name: Resource System
version: 2.0.0
type: system

author: MAM Team

description: >
  Composes the resource example modules into a runnable system: a composition
  root, a project manifest, and canonical .mam/.mam.md pairs under modules/.

license: MIT

runtime:
  language: python
  version: ">=3.12"

tags:
  - example
  - system
  - resource

dependencies:
  - name: example-resource
    version: ">=2.0.0"

capabilities:
  - observe
  - plan
  - reconcile
  - drift

permissions:
  filesystem:
    - read
---

# Resource System

## Purpose

Entry system for the `resource` example. It composes **Managed Queue** and keeps the folder shape
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

- **Managed Queue** (`example-resource`) — A `resource` is state that the runtime does not own.

## Capabilities

### `observe`

Delegates to **Managed Queue**.

### `plan`

Delegates to **Managed Queue**.

### `reconcile`

Delegates to **Managed Queue**.

### `drift`

Delegates to **Managed Queue**.

## Rules

- The reconciler never deletes messages; an over-target queue is reported as
- A pass produces at most `max_produce` messages regardless of how far behind
- A queue within `tolerance` of the target is converged and the action is
- The provider is the only source of truth for depth; the reconciler never
- A provider that raises propagates the exception; the reconciler does not
- A pass is the only unit of change: an observer polling concurrently must be

## Workflow

```mermaid
flowchart LR
    Input[Input] --> example-resource[Managed Queue]
    example-resource --> Output[Output]
```

## Python

```python
MODULES = ["example-resource"]
CAPABILITIES = ["observe", "plan", "reconcile", "drift"]
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

- [resource README](./README.md)
- [Examples index](../README.md)
- [MAM specification](../../../plan-doc/full-mam.md)
