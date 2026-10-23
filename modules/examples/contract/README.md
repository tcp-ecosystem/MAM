# Contract Example

Cursor Pagination Contract — A contract is not an implementation, it is an agreement. This one fixes the wiring between a producer that serves collections and a consumer that walks them. It defines the shape of a page, the exact encoding of the opaque cursor token, the window of major versions that may interoperate, and the deadline after which a deprecated field is deleted instead of merely discouraged.

## Layout

```text
modules/examples/contract/
├── mam.toml
├── README.md
├── system.mam
├── system.mam.md
└── modules/
    ├── contract.mam + contract.mam.md
```

## Modules

| File | Name | Type | What it does |
|------|------|------|--------------|
| `contract.mam` | Cursor Pagination Contract | contract | A contract is not an implementation, it is an agreement. This one fixes the wiring between a producer that serves collections and a consumer that walks them. It defines the shape of a page, the exact encoding of the opaque cursor token, the window of major versions that may interoperate, and the deadline after which a deprecated field is deleted instead of merely discouraged. |

Every module ships as a `.mam` and an identical `.mam.md` pair. The
`system.mam` entry composes the modules into one runnable system.

## Commands

From this directory:

```text
mam validate
mam build
mam run modules/contract.mam
```

## What You'll Learn

- `build_page` — Cursor Pagination Contract
- `validate_cursor` — Cursor Pagination Contract
- `assess_compatibility` — Cursor Pagination Contract

## Related

- [Examples index](../README.md)
- [Templates for this type](../../templates/contract/)
- [MAM specification](../../../plan-doc/full-mam.md)
