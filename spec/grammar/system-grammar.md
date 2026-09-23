# MAM System Grammar

## Overview

The MAM System grammar defines how a system is composed from modules, agents, tools, and memory. A system declaration lists its member modules, declares the agents and tools it contains, defines the edges between them, and bounds the whole with permissions and capabilities. The grammar uses the `system` module keyword and the `## Modules`, `## Agents`, and `## Workflow` sections.

## Description

A system declaration describes:

- **Modules**: The modules that make up the system
- **Agents**: The goal directed units in the system
- **Tools**: The operations available to the system
- **Memory**: The shared state across the system
- **Edges**: The flow between system components
- **Policy**: The allow and deny rules that bound the system
- **Permissions**: The resources the system may access

## Syntax

### Module Declaration

A system is declared with the `system` module keyword:

```text
module ResearchSystem

type:
    system

agents:
    - Planner
    - Researcher
    - Writer

edges:
    Planner -> Researcher
    Researcher -> Writer

memory:
    shared: ResearchMemory

policy:
    ReadOnlyPolicy
```

### System Section

A system may also be described with a `## System Definition` section:

```markdown
## System Definition

module ResearchSystem

type:
    system

agents:
    - Planner
    - Researcher
    - Writer

edges:
    Planner -> Researcher
    Researcher -> Writer
```

### Modules Section

```markdown
## Modules

- Recon
- Analyzer
- Reporter
```

### Agents Section

```markdown
## Agents

- Planner
- Researcher
- Writer
```

### Policy Section

```text
module ReadOnlyPolicy

type:
    policy

allow:
    - search
    - python

deny:
    - shell.rm
    - network.internal
    - filesystem.write

permissions:
    filesystem: read
    network: internet
    python: sandbox
```

## Grammar Rules

| Rule | Description |
|------|-------------|
| Members bounded | Members come from declared modules |
| Edges valid | Edge targets are known members |
| Agents named | Agents appear in the agents list |
| Memory shared | Shared memory connects components |
| Policy applied | Policy bounds component actions |
| Permissions scoped | Permissions bound resource access |

## Notes

- The system type may appear in the front matter `type` field or in the declaration body.
- Edges use the `->` arrow syntax.
- Edge conditions may be added in square brackets.
- Memory uses the `shared` and `external` directives.
- Policy modules use allow and deny lists.
- A system composes modules into one executable flow.

## References

- MAM agent grammar
- MAM tool grammar
- MAM memory grammar
- MAM workflow grammar
- MAM AST specification