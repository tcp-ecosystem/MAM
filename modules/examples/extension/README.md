# Extension Example

Formatter Extension Point — An extension point is a promise that something unknown can be added later without editing the host. Here the host renders tabular reports and leaves the actual formatting to whatever the user installs. The extension point states what a formatter is (a name, a media type, a render function), how it is discovered (declared through the registry, never imported by the host), and which host API versions it is allowed to load against.

## Layout

```text
modules/examples/extension/
├── mam.toml
├── README.md
├── system.mam
├── system.mam.md
└── modules/
    ├── extension.mam + extension.mam.md
```

## Modules

| File | Name | Type | What it does |
|------|------|------|--------------|
| `extension.mam` | Formatter Extension Point | extension | An extension point is a promise that something unknown can be added later without editing the host. Here the host renders tabular reports and leaves the actual formatting to whatever the user installs. The extension point states what a formatter is (a name, a media type, a render function), how it is discovered (declared through the registry, never imported by the host), and which host API versions it is allowed to load against. |

Every module ships as a `.mam` and an identical `.mam.md` pair. The
`system.mam` entry composes the modules into one runnable system.

## Commands

From this directory:

```text
mam validate
mam build
mam run modules/extension.mam
```

## What You'll Learn

- `register` — Formatter Extension Point
- `resolve` — Formatter Extension Point
- `list_formatters` — Formatter Extension Point

## Related

- [Examples index](../README.md)
- [Templates for this type](../../templates/extension/)
- [MAM specification](../../../plan-doc/full-mam.md)
