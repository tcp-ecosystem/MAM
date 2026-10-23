---
# MAM Metadata
id: examples-policy
name: Policy System
version: 2.0.0
type: system

author: MAM Team

description: >
  Composes the policy example modules into a runnable system: a composition
  root, a project manifest, and canonical .mam/.mam.md pairs under modules/.

license: MIT

runtime:
  language: python
  version: ">=3.12"

tags:
  - example
  - system
  - policy

dependencies:
  - name: example-policy
    version: ">=2.0.0"

capabilities:
  - evaluate
  - explain
  - redact

permissions:
  filesystem:
    - read
---

# Policy System

## Purpose

Entry system for the `policy` example. It composes **Data Access Policy** and keeps the folder shape
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

- **Data Access Policy** (`example-policy`) — A `policy` module runs *before* the thing it governs.

## Capabilities

### `evaluate`

Delegates to **Data Access Policy**.

### `explain`

Delegates to **Data Access Policy**.

### `redact`

Delegates to **Data Access Policy**.

## Rules

- The rule list is ordered and the first match decides; later rules are not
- `delete` is always denied for every role.
- `export` is denied for the `contractor` role regardless of classification.
- A role may only read a record whose classification rank is at or below the
- The terminal rule is `default-deny`; no request may pass without a rule.
- Every verdict must carry a non-empty reason and the identifier of the rule

## Workflow

```mermaid
flowchart LR
    Input[Input] --> example-policy[Data Access Policy]
    example-policy --> Output[Output]
```

## Python

```python
MODULES = ["example-policy"]
CAPABILITIES = ["evaluate", "explain", "redact"]
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

- [policy README](./README.md)
- [Examples index](../README.md)
- [MAM specification](../../../plan-doc/full-mam.md)
