---
# MAM Metadata
id: examples-package
name: Package System
version: 2.0.0
type: system

author: MAM Team

description: >
  Composes the package example modules into a runnable system: a composition
  root, a project manifest, and canonical .mam/.mam.md pairs under modules/.

license: MIT

runtime:
  language: python
  version: ">=3.12"

tags:
  - example
  - system
  - package

dependencies:
  - name: example-package
    version: ">=2.0.0"

capabilities:
  - resolve
  - verify
  - describe

permissions:
  filesystem:
    - read
---

# Package System

## Purpose

Entry system for the `package` example. It composes **Summarizer Package Manifest** and keeps the
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

- **Summarizer Package Manifest** (`example-package`) — A package is a promise about bytes.

## Capabilities

### `resolve`

Delegates to **Summarizer Package Manifest**.

### `verify`

Delegates to **Summarizer Package Manifest**.

### `describe`

Delegates to **Summarizer Package Manifest**.

## Rules

- Every path in `contents` must have a digest in `digests`, and every digest
- A path listed twice in the contents is a manifest error, not a merge.
- Resolution is pure: it never mutates the manifest or the environment.
- Resolution reports all conflicts, not just the first.
- Verification compares digests case-insensitively but reports them lowercase.
- The manifest is valid only if it passes verification; that is what `resolve`

## Workflow

```mermaid
flowchart LR
    Input[Input] --> example-package[Summarizer Package Manifest]
    example-package --> Output[Output]
```

## Python

```python
MODULES = ["example-package"]
CAPABILITIES = ["resolve", "verify", "describe"]
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

- [package README](./README.md)
- [Examples index](../README.md)
- [MAM specification](../../../plan-doc/full-mam.md)
