# MAM Agent Grammar

## Overview

The MAM Agent grammar defines how an agent module is declared. An agent is a goal directed unit with a role, a goal, a set of tools, optional memory, and handoff targets. The grammar specifies the `type: agent` declaration, the role and goal fields, tool and handoff lists, and the permissions and capabilities that bound the agent.

The Agent grammar is expressed through the front matter `type` field, the agent declaration body, and the `## Agent` sections that describe role, goal, tools, memory, and handoff.

## Description

An agent declaration describes:

- **Role**: The function the agent performs
- **Goal**: The objective the agent pursues
- **Tools**: The operations available to the agent
- **Memory**: Shared or local state the agent may use
- **Handoff**: The targets to which the agent may delegate
- **Permissions**: The resources the agent may access
- **Capabilities**: The abilities the agent exposes

## Syntax

### Module Declaration

An agent is declared with the `agent` module keyword:

```text
module ResearchAgent

type:
    agent

role:
    Research

goal:
    Gather structured findings for each sub question

memory:
    shared

tools:
    - Search
    - Python

handoff:
    - Writer
```

### Agent Section

An agent may also be described with a `## Agent` section:

```markdown
## Agent: Researcher

module Researcher

type:
    agent

role:
    Research

goal:
    Gather information for each sub question

tools:
    - Search
    - Python

handoff:
    - Writer
```

### Tool Section

Tools are declared with the `tool` module keyword:

```text
module SearchTool

type:
    tool

provider:
    search-api

permissions:
    network: internet

capabilities:
    - search
    - summarize
```

### Memory Section

Memory is declared with the `memory` module keyword:

```text
module ResearchMemory

type:
    memory

format:
    vector

backend:
    sqlite

scope:
    workspace

ttl:
    12h
```

## Grammar Rules

| Rule | Description |
|------|-------------|
| Role required | Every agent declares a role |
| Goal required | Every agent declares a goal |
| Tools bounded | Tools come from declared tool modules |
| Handoff valid | Handoff targets are known agents |
| Memory typed | Memory declares format, backend, and scope |
| Permissions scoped | Permissions bound resource access |

## Notes

- The agent type may appear in the front matter `type` field or in the declaration body.
- Role and goal are mandatory for an agent.
- Tools must reference declared tool modules.
- Handoff targets should reference known agents.
- Shared memory connects agents in a system.
- Policies bound agent actions through allow and deny lists.

## References

- MAM system grammar
- MAM tool grammar
- MAM memory grammar
- MAM AST specification