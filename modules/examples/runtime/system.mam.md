---
# MAM Metadata
id: examples-runtime
name: Runtime System
version: 2.0.0
type: system

author: MAM Team

description: >
  Composes the runtime example modules into a runnable system: a composition
  root, a project manifest, and canonical .mam/.mam.md pairs under modules/.

license: MIT

runtime:
  language: python
  version: ">=3.12"

tags:
  - example
  - system
  - runtime

dependencies:
  - name: example-runtime
    version: ">=2.0.0"

capabilities:
  - run_step
  - enforce_budget
  - collect_metrics

permissions:
  filesystem:
    - read
---

# Runtime System

## Purpose

Entry system for the `runtime` example. It composes **Sandboxed Step Runner** and keeps the folder
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

- **Sandboxed Step Runner** (`example-runtime`) — A runtime executes things it does not fully trust.

## Capabilities

### `run_step`

Delegates to **Sandboxed Step Runner**.

### `enforce_budget`

Delegates to **Sandboxed Step Runner**.

### `collect_metrics`

Delegates to **Sandboxed Step Runner**.

## Rules

- Every step name is unique within a runner; registering twice raises.
- A disposed step cannot be run; running it again raises.
- Output over the ceiling is truncated, not dropped, and the truncation is
- A failing step never aborts the runner; the runner is left usable.
- Metrics are cumulative and are readable after every step.
- The runtime itself performs no I/O; persistence is the caller's business.

## Workflow

```mermaid
flowchart LR
    Input[Input] --> example-runtime[Sandboxed Step Runner]
    example-runtime --> Output[Output]
```

## Python

```python
MODULES = ["example-runtime"]
CAPABILITIES = ["run_step", "enforce_budget", "collect_metrics"]
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

- [runtime README](./README.md)
- [Examples index](../README.md)
- [MAM specification](../../../plan-doc/full-mam.md)
