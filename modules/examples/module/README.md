# Module Example

Text Statistics — The simplest interesting example of a `module`: it reads a string, computes a few statistics, and returns them. There is no state between calls, no file or network access, and no dependence on any other module, which makes it safe to retry and trivial to test.

## Layout

```text
modules/examples/module/
├── mam.toml
├── README.md
├── system.mam
├── system.mam.md
└── modules/
    ├── module.mam + module.mam.md
```

## Modules

| File | Name | Type | What it does |
|------|------|------|--------------|
| `module.mam` | Text Statistics | module | The simplest interesting example of a `module`: it reads a string, computes a few statistics, and returns them. There is no state between calls, no file or network access, and no dependence on any other module, which makes it safe to retry and trivial to test. |

Every module ships as a `.mam` and an identical `.mam.md` pair. The
`system.mam` entry composes the modules into one runnable system.

## Commands

From this directory:

```text
mam validate
mam build
mam run modules/module.mam
```

## What You'll Learn

- `analyze` — Text Statistics
- `summarize` — Text Statistics

## Related

- [Examples index](../README.md)
- [Templates for this type](../../templates/module/)
- [MAM specification](../../../plan-doc/full-mam.md)
