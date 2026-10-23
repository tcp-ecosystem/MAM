# Interface Example

Paginated Search Interface — An `interface` is a promise. Callers — possibly in other languages, possibly written years from now — code against the shape of the response and the meaning of its fields, not against how results happen to be produced. This one publishes a versioned search endpoint over a document collection: a required query, a bounded page size, an opaque cursor, and a response envelope that says what version produced it and whether more pages exist.

## Layout

```text
modules/examples/interface/
├── mam.toml
├── README.md
├── system.mam
├── system.mam.md
└── modules/
    ├── interface.mam + interface.mam.md
```

## Modules

| File | Name | Type | What it does |
|------|------|------|--------------|
| `interface.mam` | Paginated Search Interface | interface | An `interface` is a promise. Callers — possibly in other languages, possibly written years from now — code against the shape of the response and the meaning of its fields, not against how results happen to be produced. This one publishes a versioned search endpoint over a document collection: a required query, a bounded page size, an opaque cursor, and a response envelope that says what version produced it and whether more pages exist. |

Every module ships as a `.mam` and an identical `.mam.md` pair. The
`system.mam` entry composes the modules into one runnable system.

## Commands

From this directory:

```text
mam validate
mam build
mam run modules/interface.mam
```

## What You'll Learn

- `search` — Paginated Search Interface
- `describe` — Paginated Search Interface
- `negotiate_version` — Paginated Search Interface

## Related

- [Examples index](../README.md)
- [Templates for this type](../../templates/interface/)
- [MAM specification](../../../plan-doc/full-mam.md)
