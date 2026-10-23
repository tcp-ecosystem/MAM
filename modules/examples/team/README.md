# Team Example

Research Team — A `team` is several agents with an explicit shape: who leads, who reports to whom, and what a handoff carries. This team answers a technical question about a codebase. A `Planner` breaks the question into independent sub-questions, two `Researcher` agents each answer the sub-questions they were given, and a `Writer` merges the findings into a single answer with citations.

## Layout

```text
modules/examples/team/
├── mam.toml
├── README.md
├── system.mam
├── system.mam.md
└── modules/
    ├── team.mam + team.mam.md
```

## Modules

| File | Name | Type | What it does |
|------|------|------|--------------|
| `team.mam` | Research Team | team | A `team` is several agents with an explicit shape: who leads, who reports to whom, and what a handoff carries. This team answers a technical question about a codebase. A `Planner` breaks the question into independent sub-questions, two `Researcher` agents each answer the sub-questions they were given, and a `Writer` merges the findings into a single answer with citations. |

Every module ships as a `.mam` and an identical `.mam.md` pair. The
`system.mam` entry composes the modules into one runnable system.

## Commands

From this directory:

```text
mam validate
mam build
mam run modules/team.mam
```

## What You'll Learn

- `plan` — Research Team
- `delegate` — Research Team
- `compose` — Research Team

## Related

- [Examples index](../README.md)
- [Templates for this type](../../templates/team/)
- [MAM specification](../../../plan-doc/full-mam.md)
