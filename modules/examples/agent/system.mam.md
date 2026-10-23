---
# MAM Metadata
id: examples-agent
name: Agent System
version: 2.0.0
type: system

author: MAM Team

description: >
  Composes the agent example modules into a runnable system: a composition
  root, a project manifest, and canonical .mam/.mam.md pairs under modules/.

license: MIT

runtime:
  language: python
  version: ">=3.12"

tags:
  - example
  - system
  - agent

dependencies:
  - name: example-agent
    version: ">=2.0.0"

capabilities:
  - classify
  - assess_urgency
  - plan

permissions:
  filesystem:
    - read
---

# Agent System

## Purpose

Entry system for the `agent` example. It composes **Support Triage Agent** and keeps the folder
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

- **Support Triage Agent** (`example-agent`) — A concrete `agent`: the front desk of a SaaS support queue.

## Capabilities

### `classify`

Delegates to **Support Triage Agent**.

### `assess_urgency`

Delegates to **Support Triage Agent**.

### `plan`

Delegates to **Support Triage Agent**.

## Rules

- The agent must never write to the ticket store; it may only produce a plan.
- Exactly one category is assigned per ticket, chosen by highest keyword hit
- A ticket containing an outage, data loss or "blocked" signal is at least sev2.
- A sev1 or sev2 ticket always escalates and routes to the oncall queue.
- The agent must stop after `max_turns` turns and report `max_turns_reached`.
- The agent must never invent an article; `suggested_article` is empty when no

## Workflow

```mermaid
flowchart LR
    Input[Input] --> example-agent[Support Triage Agent]
    example-agent --> Output[Output]
```

## Python

```python
MODULES = ["example-agent"]
CAPABILITIES = ["classify", "assess_urgency", "plan"]
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

- [agent README](./README.md)
- [Examples index](../README.md)
- [MAM specification](../../../plan-doc/full-mam.md)
