# Resource Example

Managed Queue — A `resource` is state that the runtime does not own. The bytes live in a broker, a bucket or a cluster; the module's job is to describe what that state *should* be and to keep nudging reality towards it. This one manages a work queue held at a desired depth: if the queue is short the reconciler produces work up to the target, if it is long it stops producing and records the surplus, and every pass writes a report describing what changed and why.

## Layout

```text
modules/examples/resource/
├── mam.toml
├── README.md
├── system.mam
├── system.mam.md
└── modules/
    ├── resource.mam + resource.mam.md
```

## Modules

| File | Name | Type | What it does |
|------|------|------|--------------|
| `resource.mam` | Managed Queue | resource | A `resource` is state that the runtime does not own. The bytes live in a broker, a bucket or a cluster; the module's job is to describe what that state *should* be and to keep nudging reality towards it. This one manages a work queue held at a desired depth: if the queue is short the reconciler produces work up to the target, if it is long it stops producing and records the surplus, and every pass writes a report describing what changed and why. |

Every module ships as a `.mam` and an identical `.mam.md` pair. The
`system.mam` entry composes the modules into one runnable system.

## Commands

From this directory:

```text
mam validate
mam build
mam run modules/resource.mam
```

## What You'll Learn

- `observe` — Managed Queue
- `plan` — Managed Queue
- `reconcile` — Managed Queue
- `drift` — Managed Queue

## Related

- [Examples index](../README.md)
- [Templates for this type](../../templates/resource/)
- [MAM specification](../../../plan-doc/full-mam.md)
