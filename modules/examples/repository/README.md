# Repository Example

Document Store Repository — A repository is not a folder, it is a history. This one stores documents by content address: a document is named by the SHA-256 of its own bytes, so an unchanged document is stored once no matter how many commits mention it, and a corrupted blob cannot masquerade as a good one.

## Layout

```text
modules/examples/repository/
├── mam.toml
├── README.md
├── system.mam
├── system.mam.md
└── modules/
    ├── repository.mam + repository.mam.md
```

## Modules

| File | Name | Type | What it does |
|------|------|------|--------------|
| `repository.mam` | Document Store Repository | repository | A repository is not a folder, it is a history. This one stores documents by content address: a document is named by the SHA-256 of its own bytes, so an unchanged document is stored once no matter how many commits mention it, and a corrupted blob cannot masquerade as a good one. |

Every module ships as a `.mam` and an identical `.mam.md` pair. The
`system.mam` entry composes the modules into one runnable system.

## Commands

From this directory:

```text
mam validate
mam build
mam run modules/repository.mam
```

## What You'll Learn

- `commit` — Document Store Repository
- `read_blob` — Document Store Repository
- `checkout` — Document Store Repository

## Related

- [Examples index](../README.md)
- [Templates for this type](../../templates/repository/)
- [MAM specification](../../../plan-doc/full-mam.md)
