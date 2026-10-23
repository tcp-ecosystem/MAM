# Runtime Example

Sandboxed Step Runner — A runtime executes things it does not fully trust. This one runs a single workflow step inside a budget it cannot exceed and reports what the step did, how much it cost, and which phase of its lifecycle it reached. Steps are ordinary Python callables, but the runtime only ever sees them through the `StepContext` it hands in, so a step has no ambient authority beyond its budget.

## Layout

```text
modules/examples/runtime/
├── mam.toml
├── README.md
├── system.mam
├── system.mam.md
└── modules/
    ├── runtime.mam + runtime.mam.md
```

## Modules

| File | Name | Type | What it does |
|------|------|------|--------------|
| `runtime.mam` | Sandboxed Step Runner | runtime | A runtime executes things it does not fully trust. This one runs a single workflow step inside a budget it cannot exceed and reports what the step did, how much it cost, and which phase of its lifecycle it reached. Steps are ordinary Python callables, but the runtime only ever sees them through the `StepContext` it hands in, so a step has no ambient authority beyond its budget. |

Every module ships as a `.mam` and an identical `.mam.md` pair. The
`system.mam` entry composes the modules into one runnable system.

## Commands

From this directory:

```text
mam validate
mam build
mam run modules/runtime.mam
```

## What You'll Learn

- `run_step` — Sandboxed Step Runner
- `enforce_budget` — Sandboxed Step Runner
- `collect_metrics` — Sandboxed Step Runner

## Related

- [Examples index](../README.md)
- [Templates for this type](../../templates/runtime/)
- [MAM specification](../../../plan-doc/full-mam.md)
