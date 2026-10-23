---
# MAM Metadata
id: examples-memory
name: Memory System
version: 2.0.0
type: system

author: MAM Team

description: >
  Composes the memory example modules into a runnable system: a composition
  root, a project manifest, and canonical .mam/.mam.md pairs under modules/.

license: MIT

runtime:
  language: python
  version: ">=3.12"

tags:
  - example
  - system
  - memory

dependencies:
  - name: example-memory
    version: ">=2.0.0"

capabilities:
  - write
  - recall
  - forget
  - purge_expired

permissions:
  filesystem:
    - read
---

# Memory System

## Purpose

Entry system for the `memory` example. It composes **Session Memory** and keeps the folder shape
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

- **Session Memory** (`example-memory`) — A `memory` module is the part of a system that survives between calls.

## Capabilities

### `write`

Delegates to **Session Memory**.

### `recall`

Delegates to **Session Memory**.

### `forget`

Delegates to **Session Memory**.

### `purge_expired`

Delegates to **Session Memory**.

## Rules

- Entries are scoped to exactly one `session_id`; recall never crosses sessions.
- Entries with a `password`, `token` or `api_key` field are never stored and
- Default retention is 1800 seconds; a per-entry `ttl` overrides it.
- A session holds at most 64 entries; the oldest entry is evicted on overflow.
- `purge_expired` is idempotent: calling it twice removes nothing the second time.
- Recall returns entries in insertion order and never returns an expired entry.

## Workflow

```mermaid
flowchart LR
    Input[Input] --> example-memory[Session Memory]
    example-memory --> Output[Output]
```

## Python

```python
MODULES = ["example-memory"]
CAPABILITIES = ["write", "recall", "forget", "purge_expired"]
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

- [memory README](./README.md)
- [Examples index](../README.md)
- [MAM specification](../../../plan-doc/full-mam.md)
