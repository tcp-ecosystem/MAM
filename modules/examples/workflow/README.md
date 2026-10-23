# Workflow Example

Ledger Extract Transform Load — A workflow is a process with an order and a failure policy. This one moves a day of ledger lines from a raw export into a queryable sink. Extract parses, transform normalises and de-duplicates, and load writes. Only the load step talks to a remote sink, so only the load step can fail for reasons outside our control, and only the load step therefore carries a retry policy.

## Layout

```text
modules/examples/workflow/
├── mam.toml
├── README.md
├── system.mam
├── system.mam.md
└── modules/
    ├── workflow.mam + workflow.mam.md
```

## Modules

| File | Name | Type | What it does |
|------|------|------|--------------|
| `workflow.mam` | Ledger Extract Transform Load | workflow | A workflow is a process with an order and a failure policy. This one moves a day of ledger lines from a raw export into a queryable sink. Extract parses, transform normalises and de-duplicates, and load writes. Only the load step talks to a remote sink, so only the load step can fail for reasons outside our control, and only the load step therefore carries a retry policy. |

Every module ships as a `.mam` and an identical `.mam.md` pair. The
`system.mam` entry composes the modules into one runnable system.

## Commands

From this directory:

```text
mam validate
mam build
mam run modules/workflow.mam
```

## What You'll Learn

- `extract` — Ledger Extract Transform Load
- `transform` — Ledger Extract Transform Load
- `load` — Ledger Extract Transform Load
- `run_pipeline` — Ledger Extract Transform Load

## Related

- [Examples index](../README.md)
- [Templates for this type](../../templates/workflow/)
- [MAM specification](../../../plan-doc/full-mam.md)
