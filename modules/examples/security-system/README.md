# Security System Example

A composed MAM system of 3 modules.

## Layout

```text
modules/examples/security-system/
├── mam.toml
├── README.md
├── system.mam
├── system.mam.md
└── modules/
    ├── analyzer.mam + analyzer.mam.md
    ├── recon.mam + recon.mam.md
    ├── reporter.mam + reporter.mam.md
```

## Modules

| File | Name | Type | What it does |
|------|------|------|--------------|
| `analyzer.mam` | Analyzer | module | Consumes discovered assets and produces findings ranked by severity. |
| `recon.mam` | Recon | module | Discovers publicly authorized assets within a declared scope and returns a structured asset list for downstream analysis. |
| `reporter.mam` | Reporter | module | Turns ranked findings into a structured report suitable for stakeholders. |

Every module ships as a `.mam` and an identical `.mam.md` pair. The
`system.mam` entry composes the modules into one runnable system.

## Commands

From this directory:

```text
mam validate
mam build
mam run system.mam
```

## What You'll Learn

- `analyze` — Analyzer
- `discover` — Recon
- `report` — Reporter

## Related

- [Examples index](../README.md)
- [Templates for this type](../../templates/security-system/)
- [MAM specification](../../../plan-doc/full-mam.md)
