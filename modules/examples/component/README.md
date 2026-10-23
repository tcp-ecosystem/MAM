# Component Example

Circuit Breaker — A `component` is a part of a bigger system that other code is allowed to depend on: it has a contract, a state machine, and no opinion about what it protects. This one is the classic circuit breaker. While closed it forwards calls and counts failures; after a threshold it opens and short-circuits every call without touching the dependency; after a cooldown it admits a single half-open probe and closes again if that probe succeeds.

## Layout

```text
modules/examples/component/
├── mam.toml
├── README.md
├── system.mam
├── system.mam.md
└── modules/
    ├── component.mam + component.mam.md
```

## Modules

| File | Name | Type | What it does |
|------|------|------|--------------|
| `component.mam` | Circuit Breaker | component | A `component` is a part of a bigger system that other code is allowed to depend on: it has a contract, a state machine, and no opinion about what it protects. This one is the classic circuit breaker. While closed it forwards calls and counts failures; after a threshold it opens and short-circuits every call without touching the dependency; after a cooldown it admits a single half-open probe and closes again if that probe succeeds. |

Every module ships as a `.mam` and an identical `.mam.md` pair. The
`system.mam` entry composes the modules into one runnable system.

## Commands

From this directory:

```text
mam validate
mam build
mam run modules/component.mam
```

## What You'll Learn

- `call` — Circuit Breaker
- `record_success` — Circuit Breaker
- `record_failure` — Circuit Breaker
- `state_of` — Circuit Breaker

## Related

- [Examples index](../README.md)
- [Templates for this type](../../templates/component/)
- [MAM specification](../../../plan-doc/full-mam.md)
