---
# MAM Metadata
id: system
name: Advanced System
version: 2.0.0
type: system

author: MAM Team

description: >
  Composes the advanced modules into one executable system that demonstrates
  multi agent coordination, API gateway behavior, data pipelines, knowledge
  graphs, monitoring, and structured debate.

license: MIT

runtime:
  language: python
  version: ">=3.12"

tags:
  - system
  - advanced

dependencies:
  - name: research-agent
    version: ">=1.0.0"
  - name: api-gateway
    version: ">=1.0.0"
  - name: data-pipeline
    version: ">=1.0.0"
  - name: knowledge-graph
    version: ">=1.0.0"
  - name: monitoring-agent
    version: ">=1.0.0"
  - name: multi-agent-debate
    version: ">=1.0.0"
  - name: content-pipeline
    version: ">=1.0.0"

capabilities:
  - orchestrate

permissions:
  filesystem:
    - read
  network:
    - internet
  python:
    - sandbox
---

# Advanced System

## Purpose

Entry system that composes the project modules into a single advanced
demonstration: multi agent research, API gateway behavior, data pipelines,
knowledge graphs, monitoring, and structured debate.

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

- Research Agent System
- API Gateway with Rate Limiting
- ETL Data Pipeline
- Knowledge Graph Builder
- System Monitoring Agent
- Multi-Agent Debate System
- Content Pipeline Workflow

## Capabilities

### orchestrate

Run the composed modules in dependency order.

## Rules

- All modules operate within the declared scope.
- Results must be validated before reporting.
- Permissions are enforced per module.

## Workflow

```mermaid
flowchart LR
    Content[Content Pipeline] --> Data[ETL Data Pipeline]
    Data --> Knowledge[Knowledge Graph]
    Knowledge --> Debate[Multi Agent Debate]
    Debate --> Research[Research Agent]
    Data --> Monitor[Monitoring Agent]
    Monitor --> Gateway[API Gateway]
```

## Python

```python
MODULES = ["research-agent", "api-gateway", "data-pipeline", "knowledge-graph", "monitoring-agent", "multi-agent-debate", "content-pipeline"]
CAPABILITIES = ["orchestrate"]
EDGES = [("research-agent", "api-gateway"), ("api-gateway", "data-pipeline"), ("data-pipeline", "knowledge-graph"), ("knowledge-graph", "monitoring-agent"), ("monitoring-agent", "multi-agent-debate"), ("multi-agent-debate", "content-pipeline")]


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
report: present
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
- plan-doc/full-mam.md
