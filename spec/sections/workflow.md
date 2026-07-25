# Workflow Section

## Description
The Workflow section defines the process flow, typically using Mermaid diagrams.

## Syntax
```markdown
## Workflow

```mermaid
flowchart TD
    A[Start] --> B[Process]
    B --> C[End]
```
```

## Rules
- Use Mermaid diagram syntax
- Common diagram types: flowchart, sequence, state

## Example
```markdown
## Workflow

```mermaid
flowchart TD
    A[Receive Request] --> B{Valid Token?}
    B -->|Yes| C[Process]
    B -->|No| D[Return Error]
    C --> E[Return Result]
```
```