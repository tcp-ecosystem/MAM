---
# MAM Metadata
id: examples-contract
name: Contract System
version: 2.0.0
type: system

author: MAM Team

description: >
  Composes the contract example modules into a runnable system: a composition
  root, a project manifest, and canonical .mam/.mam.md pairs under modules/.

license: MIT

runtime:
  language: python
  version: ">=3.12"

tags:
  - example
  - system
  - contract

dependencies:
  - name: example-contract
    version: ">=2.0.0"

capabilities:
  - build_page
  - validate_cursor
  - assess_compatibility

permissions:
  filesystem:
    - read
---

# Contract System

## Purpose

Entry system for the `contract` example. It composes **Cursor Pagination Contract** and keeps the
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

- **Cursor Pagination Contract** (`example-contract`) — A contract is not an implementation, it is an agreement.

## Capabilities

### `build_page`

Delegates to **Cursor Pagination Contract**.

### `validate_cursor`

Delegates to **Cursor Pagination Contract**.

### `assess_compatibility`

Delegates to **Cursor Pagination Contract**.

## Rules

- Every page carries the contract version that produced it.
- A cursor encodes an offset and a limit; both must be non-negative and the
- Cursors are URL-safe base64 with the padding stripped.
- A cursor that cannot be decoded, or that carries the wrong field types, is
- Compatibility is reported as a boolean plus ordered reasons, never as a bare
- No network or filesystem access: the contract is pure and can be audited

## Workflow

```mermaid
flowchart LR
    Input[Input] --> example-contract[Cursor Pagination Contract]
    example-contract --> Output[Output]
```

## Python

```python
MODULES = ["example-contract"]
CAPABILITIES = ["build_page", "validate_cursor", "assess_compatibility"]
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

- [contract README](./README.md)
- [Examples index](../README.md)
- [MAM specification](../../../plan-doc/full-mam.md)
