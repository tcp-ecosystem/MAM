---
# MAM Metadata
id: examples-scenarios
name: Scenarios System
version: 2.0.0
type: system

author: MAM Team

description: >
  Composes the scenarios example modules into a runnable system: a composition
  root, a project manifest, and canonical .mam/.mam.md pairs under modules/.

license: MIT

runtime:
  language: python
  version: ">=3.12"

tags:
  - example
  - system
  - scenarios

dependencies:
  - name: authentication
    version: ">=2.0.0"
  - name: bug-hunter
    version: ">=2.0.0"
  - name: data-pipeline
    version: ">=2.0.0"
  - name: hello
    version: ">=2.0.0"
  - name: memory-system
    version: ">=2.0.0"
  - name: task-planner
    version: ">=2.0.0"
  - name: prompt-engine
    version: ">=2.0.0"
  - name: rag-module
    version: ">=2.0.0"
  - name: security-scanner
    version: ">=2.0.0"
  - name: data-workflow
    version: ">=2.0.0"

capabilities:
  - generate_token
  - validate_token
  - refresh_access_token
  - hash_password
  - verify_password
  - plan
  - recon
  - analyze
  - report
  - extract
  - apply_transforms
  - validate_schema
  - run
  - register_transform
  - greet
  - store
  - retrieve
  - search
  - delete
  - list_keys
  - add_task
  - validate
  - topological_sort
  - critical_path
  - register
  - interpolate
  - render
  - list_templates
  - index
  - query
  - chunk
  - clear
  - scan_secrets
  - sanitize
  - check_policy
  - rate_limit
  - define
  - register_handler

permissions:
  filesystem:
    - read
---

# Scenarios System

## Purpose

Entry system for the `scenarios` example. It composes 10 modules and keeps the folder shape
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

- **Authentication Module** (`authentication`) — Provide secure user authentication using JWT tokens.
- **BugHunter System** (`bug-hunter`) — Multi-agent security testing system that discovers, analyzes, and reports vulnerabilities.
- **Data Pipeline Module** (`data-pipeline`) — Provides a reusable ETL (Extract-Transform-Load) pipeline framework.
- **Hello** (`hello`) — Return a greeting for a given name.
- **Memory Module** (`memory-system`) — Provides a persistent memory layer for AI agents.
- **Planner Module** (`task-planner`) — Decomposes a high-level goal into an ordered graph of sub-tasks.
- **Prompt Module** (`prompt-engine`) — Manages reusable prompt templates with variable interpolation, few-shot example injection, and chain-of-thoug…
- **RAG Module** (`rag-module`) — Implements a Retrieval-Augmented Generation pipeline: chunk documents into overlapping segments, compute simp…
- **Security Module** (`security-scanner`) — Provides security primitives for MAM modules: secret detection in text, input sanitization, rate limiting, an…
- **Workflow Module** (`data-workflow`) — Orchestrates multi-step workflows as directed acyclic graphs (DAGs).

## Capabilities

### `generate_token`

Delegates to **Authentication Module**.

### `validate_token`

Delegates to **Authentication Module**.

### `refresh_access_token`

Delegates to **Authentication Module**.

### `hash_password`

Delegates to **Authentication Module**.

### `verify_password`

Delegates to **Authentication Module**.

### `plan`

Delegates to 2 composed modules.

### `recon`

Delegates to **BugHunter System**.

### `analyze`

Delegates to **BugHunter System**.

### `report`

Delegates to **BugHunter System**.

### `extract`

Delegates to **Data Pipeline Module**.

### `apply_transforms`

Delegates to **Data Pipeline Module**.

### `validate_schema`

Delegates to **Data Pipeline Module**.

### `run`

Delegates to 2 composed modules.

### `register_transform`

Delegates to **Data Pipeline Module**.

### `greet`

Delegates to **Hello**.

### `store`

Delegates to **Memory Module**.

### `retrieve`

Delegates to **Memory Module**.

### `search`

Delegates to **Memory Module**.

### `delete`

Delegates to **Memory Module**.

### `list_keys`

Delegates to **Memory Module**.

### `add_task`

Delegates to **Planner Module**.

### `validate`

Delegates to 2 composed modules.

### `topological_sort`

Delegates to **Planner Module**.

### `critical_path`

Delegates to **Planner Module**.

### `register`

Delegates to **Prompt Module**.

### `interpolate`

Delegates to **Prompt Module**.

### `render`

Delegates to **Prompt Module**.

### `list_templates`

Delegates to **Prompt Module**.

### `index`

Delegates to **RAG Module**.

### `query`

Delegates to **RAG Module**.

### `chunk`

Delegates to **RAG Module**.

### `clear`

Delegates to **RAG Module**.

### `scan_secrets`

Delegates to **Security Module**.

### `sanitize`

Delegates to **Security Module**.

### `check_policy`

Delegates to **Security Module**.

### `rate_limit`

Delegates to **Security Module**.

### `define`

Delegates to **Workflow Module**.

### `register_handler`

Delegates to **Workflow Module**.

## Rules

- Never expose secrets in logs or error messages
- Use constant-time comparison for token validation
- Rotate secrets every 90 days
- Implement rate limiting on login attempts
- Use secure HTTP-only cookies when possible
- Validate all inputs before processing

## Workflow

```mermaid
flowchart LR
    Input[Input] --> authentication[Authentication Module]
    "authentication" --> "bug-hunter"
    "bug-hunter" --> "data-pipeline"
    "data-pipeline" --> "hello"
    "hello" --> "memory-system"
    "memory-system" --> "task-planner"
    "task-planner" --> "prompt-engine"
    "prompt-engine" --> "rag-module"
    "rag-module" --> "security-scanner"
    "security-scanner" --> "data-workflow"
    data-workflow --> Output[Output]
```

## Python

```python
MODULES = ["authentication", "bug-hunter", "data-pipeline", "hello", "memory-system", "task-planner", "prompt-engine", "rag-module", "security-scanner", "data-workflow"]
CAPABILITIES = ["generate_token", "validate_token", "refresh_access_token", "hash_password", "verify_password", "plan", "recon", "analyze", "report", "extract", "apply_transforms", "validate_schema", "run", "register_transform", "greet", "store", "retrieve", "search", "delete", "list_keys", "add_task", "validate", "topological_sort", "critical_path", "register", "interpolate", "render", "list_templates", "index", "query", "chunk", "clear", "scan_secrets", "sanitize", "check_policy", "rate_limit", "define", "register_handler"]
EDGES = [("authentication", "bug-hunter"), ("bug-hunter", "data-pipeline"), ("data-pipeline", "hello"), ("hello", "memory-system"), ("memory-system", "task-planner"), ("task-planner", "prompt-engine"), ("prompt-engine", "rag-module"), ("rag-module", "security-scanner"), ("security-scanner", "data-workflow")]


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

- [scenarios README](./README.md)
- [Examples index](../README.md)
- [MAM specification](../../../plan-doc/full-mam.md)
