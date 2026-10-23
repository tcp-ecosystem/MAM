---
# MAM Metadata
id: examples-service
name: Service System
version: 2.0.0
type: system

author: MAM Team

description: >
  Composes the service example modules into a runnable system: a composition
  root, a project manifest, and canonical .mam/.mam.md pairs under modules/.

license: MIT

runtime:
  language: python
  version: ">=3.12"

tags:
  - example
  - system
  - service

dependencies:
  - name: example-service
    version: ">=2.0.0"

capabilities:
  - start
  - process
  - health
  - shutdown

permissions:
  filesystem:
    - read
---

# Service System

## Purpose

Entry system for the `service` example. It composes **Worker Health Service** and keeps the folder
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

- **Worker Health Service** (`example-service`) — A `service` is the one module type that owns time.

## Capabilities

### `start`

Delegates to **Worker Health Service**.

### `process`

Delegates to **Worker Health Service**.

### `health`

Delegates to **Worker Health Service**.

### `shutdown`

Delegates to **Worker Health Service**.

## Rules

- The service must refuse to process before `start` and after `shutdown`.
- Each tick handles at most `batch_size` items and at most `workers` items may
- A handler exception is recorded as a failed result and never stops the loop.
- `health()` reports healthy only in the running state with no failed items.
- `shutdown()` is idempotent: a second call returns the same results and does
- The loop stops after `max_ticks` even if the queue is not empty, and reports

## Workflow

```mermaid
flowchart LR
    Input[Input] --> example-service[Worker Health Service]
    example-service --> Output[Output]
```

## Python

```python
MODULES = ["example-service"]
CAPABILITIES = ["start", "process", "health", "shutdown"]
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

- [service README](./README.md)
- [Examples index](../README.md)
- [MAM specification](../../../plan-doc/full-mam.md)
