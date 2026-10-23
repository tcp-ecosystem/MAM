# Plugin Example

Report Banner Plugin — A plugin is an extension point that ships. Unlike a standalone extension, a plugin is loaded by a host it did not write, so it has to be a good citizen: it announces which call sites it wants, it cleans up everything it added, and it behaves identically whether it is the only plugin loaded or the tenth.

## Layout

```text
modules/examples/plugin/
├── mam.toml
├── README.md
├── system.mam
├── system.mam.md
└── modules/
    ├── plugin.mam + plugin.mam.md
```

## Modules

| File | Name | Type | What it does |
|------|------|------|--------------|
| `plugin.mam` | Report Banner Plugin | plugin | A plugin is an extension point that ships. Unlike a standalone extension, a plugin is loaded by a host it did not write, so it has to be a good citizen: it announces which call sites it wants, it cleans up everything it added, and it behaves identically whether it is the only plugin loaded or the tenth. |

Every module ships as a `.mam` and an identical `.mam.md` pair. The
`system.mam` entry composes the modules into one runnable system.

## Commands

From this directory:

```text
mam validate
mam build
mam run modules/plugin.mam
```

## What You'll Learn

- `on_load` — Report Banner Plugin
- `intercept` — Report Banner Plugin
- `on_unload` — Report Banner Plugin

## Related

- [Examples index](../README.md)
- [Templates for this type](../../templates/plugin/)
- [MAM specification](../../../plan-doc/full-mam.md)
