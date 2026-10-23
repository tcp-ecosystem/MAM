# Service Example

Worker Health Service — A `service` is the one module type that owns time. It does not return an answer, it runs: it holds a loop, exposes a health endpoint, and must be able to stop cleanly when the platform asks it to. This one drains a queue with a bounded pool of workers, reports its lifecycle state through `health()`, and finishes in-flight work on shutdown instead of dropping it.

## Layout

```text
modules/examples/service/
├── mam.toml
├── README.md
├── system.mam
├── system.mam.md
└── modules/
    ├── service.mam + service.mam.md
```

## Modules

| File | Name | Type | What it does |
|------|------|------|--------------|
| `service.mam` | Worker Health Service | service | A `service` is the one module type that owns time. It does not return an answer, it runs: it holds a loop, exposes a health endpoint, and must be able to stop cleanly when the platform asks it to. This one drains a queue with a bounded pool of workers, reports its lifecycle state through `health()`, and finishes in-flight work on shutdown instead of dropping it. |

Every module ships as a `.mam` and an identical `.mam.md` pair. The
`system.mam` entry composes the modules into one runnable system.

## Commands

From this directory:

```text
mam validate
mam build
mam run modules/service.mam
```

## What You'll Learn

- `start` — Worker Health Service
- `process` — Worker Health Service
- `health` — Worker Health Service
- `shutdown` — Worker Health Service

## Related

- [Examples index](../README.md)
- [Templates for this type](../../templates/service/)
- [MAM specification](../../../plan-doc/full-mam.md)
