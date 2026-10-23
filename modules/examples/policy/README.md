# Policy Example

Data Access Policy — A `policy` module runs *before* the thing it governs. It answers one question — may this actor touch this record? — and it must answer with a reason, because a deny a human cannot explain is a deny a human will route around.

## Layout

```text
modules/examples/policy/
├── mam.toml
├── README.md
├── system.mam
├── system.mam.md
└── modules/
    ├── policy.mam + policy.mam.md
```

## Modules

| File | Name | Type | What it does |
|------|------|------|--------------|
| `policy.mam` | Data Access Policy | policy | A `policy` module runs *before* the thing it governs. It answers one question — may this actor touch this record? — and it must answer with a reason, because a deny a human cannot explain is a deny a human will route around. |

Every module ships as a `.mam` and an identical `.mam.md` pair. The
`system.mam` entry composes the modules into one runnable system.

## Commands

From this directory:

```text
mam validate
mam build
mam run modules/policy.mam
```

## What You'll Learn

- `evaluate` — Data Access Policy
- `explain` — Data Access Policy
- `redact` — Data Access Policy

## Related

- [Examples index](../README.md)
- [Templates for this type](../../templates/policy/)
- [MAM specification](../../../plan-doc/full-mam.md)
