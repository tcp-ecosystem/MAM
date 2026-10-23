# Memory Example

Session Memory — A `memory` module is the part of a system that survives between calls. This one stores the turns of a support conversation so a later agent invocation can remember what was already said, but it is disciplined about what it keeps: every entry is scoped to a session, every entry expires, and a small set of sensitive keys is refused outright rather than encrypted and forgotten.

## Layout

```text
modules/examples/memory/
├── mam.toml
├── README.md
├── system.mam
├── system.mam.md
└── modules/
    ├── memory.mam + memory.mam.md
```

## Modules

| File | Name | Type | What it does |
|------|------|------|--------------|
| `memory.mam` | Session Memory | memory | A `memory` module is the part of a system that survives between calls. This one stores the turns of a support conversation so a later agent invocation can remember what was already said, but it is disciplined about what it keeps: every entry is scoped to a session, every entry expires, and a small set of sensitive keys is refused outright rather than encrypted and forgotten. |

Every module ships as a `.mam` and an identical `.mam.md` pair. The
`system.mam` entry composes the modules into one runnable system.

## Commands

From this directory:

```text
mam validate
mam build
mam run modules/memory.mam
```

## What You'll Learn

- `write` — Session Memory
- `recall` — Session Memory
- `forget` — Session Memory
- `purge_expired` — Session Memory

## Related

- [Examples index](../README.md)
- [Templates for this type](../../templates/memory/)
- [MAM specification](../../../plan-doc/full-mam.md)
