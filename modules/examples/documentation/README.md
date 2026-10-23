# Documentation Example

Versioned API Reference — Documentation is a module that happens to be read by people, and it fails the same way code fails: quietly, after the thing it describes has moved on. This one is a versioned reference with three jobs. It indexes the endpoints of a published version, it diffs two published versions so a reader knows what changed, and it reports drift by comparing the fingerprint each endpoint had when the page was written against the fingerprint the code has now.

## Layout

```text
modules/examples/documentation/
├── mam.toml
├── README.md
├── system.mam
├── system.mam.md
└── modules/
    ├── documentation.mam + documentation.mam.md
```

## Modules

| File | Name | Type | What it does |
|------|------|------|--------------|
| `documentation.mam` | Versioned API Reference | documentation | Documentation is a module that happens to be read by people, and it fails the same way code fails: quietly, after the thing it describes has moved on. This one is a versioned reference with three jobs. It indexes the endpoints of a published version, it diffs two published versions so a reader knows what changed, and it reports drift by comparing the fingerprint each endpoint had when the page was written against the fingerprint the code has now. |

Every module ships as a `.mam` and an identical `.mam.md` pair. The
`system.mam` entry composes the modules into one runnable system.

## Commands

From this directory:

```text
mam validate
mam build
mam run modules/documentation.mam
```

## What You'll Learn

- `index_endpoints` — Versioned API Reference
- `compare_versions` — Versioned API Reference
- `report_drift` — Versioned API Reference

## Related

- [Examples index](../README.md)
- [Templates for this type](../../templates/documentation/)
- [MAM specification](../../../plan-doc/full-mam.md)
