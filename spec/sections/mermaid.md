# Mermaid Section

## Description
The Mermaid section contains visual diagrams for architecture and reasoning.

## Supported Diagram Types
- flowchart / graph
- sequenceDiagram
- classDiagram
- stateDiagram
- erDiagram
- gantt
- pie
- mindmap
- timeline

## Example
```markdown
## Mermaid

```mermaid
flowchart LR
    subgraph Frontend
        A[UI] --> B[API Client]
    end
    subgraph Backend
        C[API Server] --> D[Database]
    end
    B --> C
```
```