# Package Example

Summarizer Package Manifest — A package is a promise about bytes. This manifest states which files are published, what a consumer's environment must look like for those files to work, where each file lands once installed, and a digest per file so that a tampered download can be detected before it is imported.

## Layout

```text
modules/examples/package/
├── mam.toml
├── README.md
├── system.mam
├── system.mam.md
└── modules/
    ├── package.mam + package.mam.md
```

## Modules

| File | Name | Type | What it does |
|------|------|------|--------------|
| `package.mam` | Summarizer Package Manifest | package | A package is a promise about bytes. This manifest states which files are published, what a consumer's environment must look like for those files to work, where each file lands once installed, and a digest per file so that a tampered download can be detected before it is imported. |

Every module ships as a `.mam` and an identical `.mam.md` pair. The
`system.mam` entry composes the modules into one runnable system.

## Commands

From this directory:

```text
mam validate
mam build
mam run modules/package.mam
```

## What You'll Learn

- `resolve` — Summarizer Package Manifest
- `verify` — Summarizer Package Manifest
- `describe` — Summarizer Package Manifest

## Related

- [Examples index](../README.md)
- [Templates for this type](../../templates/package/)
- [MAM specification](../../../plan-doc/full-mam.md)
