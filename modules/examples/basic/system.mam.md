---
# MAM Metadata
id: system
name: Basic System
version: 2.0.0
type: system

author: MAM Team

description: >
  Composes the basic utility modules into one executable system.

license: MIT

runtime:
  language: python
  version: ">=3.12"

tags:
  - example
  - system

dependencies:
  - name: hello-world
    version: ">=1.0.0"
  - name: calculator
    version: ">=1.0.0"
  - name: password-gen
    version: ">=1.0.0"
  - name: string-utils
    version: ">=1.0.0"
  - name: temperature
    version: ">=1.0.0"
  - name: text-transform
    version: ">=1.0.0"

capabilities:
  - orchestrate

permissions:
  filesystem:
    - read
---

# Basic System

## Purpose

Entry system that composes the project modules into a single utility set:
hello world, calculator, password generator, string utilities, temperature
converter, and text transform.

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| mode | string | No | `demo` runs the composition; `validate` checks wiring |
| payload | object | No | Optional input forwarded to the first module |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| status | string | `ok` when the composition is wired |
| modules | list | Composed module ids in dependency order |
| capabilities | list | Union of the composed modules' capabilities |

## Modules

- Hello World
- Calculator
- Password Generator
- String Utilities
- Temperature Converter
- Text Transform

## Capabilities

### orchestrate

Run the composed modules in dependency order.

## Rules

- All modules operate within the declared scope.
- Results must be validated before use.

## Workflow

```mermaid
flowchart LR
    HelloWorld --> Output
    Calculator --> Output
    PasswordGen --> Output
    StringUtils --> Output
    Temperature --> Output
    TextTransform --> Output
```

## Python

```python
MODULES = ["hello-world", "calculator", "password-gen", "string-utils", "temperature", "text-transform"]
CAPABILITIES = ["orchestrate"]
EDGES = [("hello-world", "calculator"), ("calculator", "password-gen"), ("password-gen", "string-utils"), ("string-utils", "temperature"), ("temperature", "text-transform")]


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
name: World
```

### Expected

```yaml
output: present
```

```python
def test_system_composition():
    result = run_system("demo")
    assert result["status"] == "ok"
    assert result["modules"] == MODULES
    assert result["capabilities"] == CAPABILITIES
```

## Examples

```python
result = run_system("demo", {"target": "example.com"})
print(result["status"], len(result["modules"]))
```

## References

- MAM documentation
