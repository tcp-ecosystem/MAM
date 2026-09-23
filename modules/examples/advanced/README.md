# Advanced MAM Project

This is a complete multi file MAM project showcasing complex module types:
multi agent systems, workflows with branching and parallel steps, and tool
based architectures. It is structured exactly like the gold standard
`security-system` example.

## Layout

```
modules/examples/advanced/
├── mam.toml
├── README.md
├── system.mam
├── system.mam.md
└── modules/
    ├── agent.mam + agent.mam.md
    ├── api-gateway.mam + api-gateway.mam.md
    ├── data-pipeline.mam + data-pipeline.mam.md
    ├── knowledge-graph.mam + knowledge-graph.mam.md
    ├── monitoring-agent.mam + monitoring-agent.mam.md
    ├── multi-agent-debate.mam + multi-agent-debate.mam.md
    └── workflow.mam + workflow.mam.md
```

## Modules

| Module | Type | Description |
|--------|------|-------------|
| `agent` | system | Multi agent research system with Planner, Researcher, and Writer agents |
| `api-gateway` | system | API gateway with rate limiting, authentication, and routing |
| `data-pipeline` | workflow | ETL pipeline with parallel transform and validate steps |
| `knowledge-graph` | workflow | Text ingestion, entity extraction, and graph queries |
| `monitoring-agent` | system | Metrics collection, anomaly detection, and alerting |
| `multi-agent-debate` | system | Advocate, Opponent, and Judge debate system |
| `workflow` | workflow | Content pipeline with branching and parallel enrichment |

Each module ships as a `.mam` and an identical `.mam.md` pair. The `system.mam`
entry composes the modules into a single demonstration.

## Commands

From this directory:

```text
node C:\Users\USER\LifeJiggy\Prompt_AI-Support\MAM\cli\dist\index.js validate
node C:\Users\USER\LifeJiggy\Prompt_AI-Support\MAM\cli\dist\index.js build
node C:\Users\USER\LifeJiggy\Prompt_AI-Support\MAM\cli\dist\index.js run modules/agent.mam --format json
```

## What You'll Learn

- Defining `module` declarations with `type: system` and `type: workflow`
- Wiring agents together with `handoff` and `edges`
- Defining `type: workflow` with steps, branches, and parallel execution
- Using `type: memory` for shared state across agents
- Using `type: policy` for safety guardrails
- Writing full MAM modules with metadata, capabilities, permissions, and tests