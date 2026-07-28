---
id: {{name}}
version: 0.1.0
name: {{name}}
author: {{author}}
runtime: python
tags:
  - agent
---

# {{name}}

## Purpose

Describe the agent's role and responsibilities.

## Workflow

```mermaid
flowchart TD
    A[Receive Task] --> B[Analyze]
    B --> C[Execute]
    C --> D[Report]
```

## Python

```python
class Agent:
    def __init__(self):
        self.name = "{{name}}"
    
    def execute(self, task: str) -> dict:
        """Execute the agent's task."""
        return {"status": "completed", "result": task}
```

## Examples

### Example 1

Describe how to use this agent.
