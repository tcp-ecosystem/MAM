---
# MAM Metadata
id: examples-workflow
name: Workflow System
version: 2.0.0
type: system

author: MAM Team

description: >
  Composes the workflow example modules into a runnable system: a composition
  root, a project manifest, and canonical .mam/.mam.md pairs under modules/.

license: MIT

runtime:
  language: python
  version: ">=3.12"

tags:
  - example
  - system
  - workflow

dependencies:
  - name: example-workflow
    version: ">=2.0.0"

capabilities:
  - extract
  - transform
  - load
  - run_pipeline

permissions:
  filesystem:
    - read
---

# Workflow System

## Purpose

Entry system for the `workflow` example. It composes **Ledger Extract Transform Load** and keeps the
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

- **Ledger Extract Transform Load** (`example-workflow`) — A workflow is a process with an order and a failure policy.

## Capabilities

### `extract`

Delegates to **Ledger Extract Transform Load**.

### `transform`

Delegates to **Ledger Extract Transform Load**.

### `load`

Delegates to **Ledger Extract Transform Load**.

### `run_pipeline`

Delegates to **Ledger Extract Transform Load**.

## Rules

- A retry never changes the payload: the same `rows` are handed to the sink on
- The load step is the only step allowed to run more than once.
- A refused `extract` or `transform` is never retried; retrying bad data is how
- The sink accumulates rows across batches and never removes them.
- The run record is ordered by step and is complete even for a failed run.
- Amounts are integer cents; the pipeline never converts currency.

## Workflow

```mermaid
flowchart LR
    Input[Input] --> example-workflow[Ledger Extract Transform Load]
    example-workflow --> Output[Output]
```

## Python

```python
MODULES = ["example-workflow"]
CAPABILITIES = ["extract", "transform", "load", "run_pipeline"]
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

- [workflow README](./README.md)
- [Examples index](../README.md)
- [MAM specification](../../../plan-doc/full-mam.md)
