---
# MAM Metadata
id: examples-repository
name: Repository System
version: 2.0.0
type: system

author: MAM Team

description: >
  Composes the repository example modules into a runnable system: a composition
  root, a project manifest, and canonical .mam/.mam.md pairs under modules/.

license: MIT

runtime:
  language: python
  version: ">=3.12"

tags:
  - example
  - system
  - repository

dependencies:
  - name: example-repository
    version: ">=2.0.0"

capabilities:
  - commit
  - read_blob
  - checkout

permissions:
  filesystem:
    - read
---

# Repository System

## Purpose

Entry system for the `repository` example. It composes **Document Store Repository** and keeps the
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

- **Document Store Repository** (`example-repository`) — A repository is not a folder, it is a history.

## Capabilities

### `commit`

Delegates to **Document Store Repository**.

### `read_blob`

Delegates to **Document Store Repository**.

### `checkout`

Delegates to **Document Store Repository**.

## Rules

- `trunk` always exists; a commit on a missing line is a `KeyError`.
- `changes` is applied in sorted path order so the resulting tree never depends
- Commits are immutable once written; a commit record is never stored twice.
- A checkout of a commit id ignores which line it was on, because the commit
- Paths are normalised and must be relative, forward-slashed, and free of `.`
- Ownership is checked before the tree is written, so a refused contribution

## Workflow

```mermaid
flowchart LR
    Input[Input] --> example-repository[Document Store Repository]
    example-repository --> Output[Output]
```

## Python

```python
MODULES = ["example-repository"]
CAPABILITIES = ["commit", "read_blob", "checkout"]
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

- [repository README](./README.md)
- [Examples index](../README.md)
- [MAM specification](../../../plan-doc/full-mam.md)
