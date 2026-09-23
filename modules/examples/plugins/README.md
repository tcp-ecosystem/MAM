# MAM Plugins Project

This directory contains a complete MAM project that demonstrates how to
extend MAM with custom plugins through the MAM Plugin API.

## Structure

```
modules/examples/plugins/
├── mam.toml
├── README.md
├── system.mam            (entry system, composes the plugins)
├── system.mam.md         (identical copy)
└── modules/
    ├── custom-section.mam      + custom-section.mam.md
    ├── export-plugin.mam       + export-plugin.mam.md
    ├── memory-plugin.mam       + memory-plugin.mam.md
    ├── runtime-plugin.mam      + runtime-plugin.mam.md
    └── validation-plugin.mam   + validation-plugin.mam.md
```

## Contents

| Module            | Type     | Description                                             |
|-------------------|----------|---------------------------------------------------------|
| Custom Section    | plugin   | Adds a custom diagram section type for Mermaid content  |
| Export Plugin     | plugin   | Registers HTML, PDF and DOCX export formats             |
| Memory Plugin     | plugin   | Registers Redis, PostgreSQL and in memory backends      |
| Runtime Plugin    | plugin   | Registers Deno, Bun and WebAssembly runtime contexts    |
| Validation Plugin | plugin   | Registers custom validation and security rules          |

## Plugin Architecture

MAM plugins can:

- **Add new section types** — define novel sections beyond the built-in set
- **Add validators** — custom validation rules for your sections
- **Add runtimes** — execute code in new languages or environments
- **Add exporters** — render MAM modules to new output formats
- **Add renderers** — custom HTML or markdown rendering for sections

Every plugin module is declared with `type: plugin`, a TypeScript runtime,
structured permissions and a set of declared capabilities. A `## Python`
section provides a working placeholder implementation for each plugin.

## Usage

Run the following commands from this directory:

```text
mam validate
mam build
mam run modules/custom-section.mam
mam run modules/export-plugin.mam
mam run modules/memory-plugin.mam
mam run modules/runtime-plugin.mam
mam run modules/validation-plugin.mam
```

## Validation

```text
mam validate   -> prints "Project valid"
mam build      -> writes dist/*.mam.py
```

Each module in `modules/` also has a `.mam.md` twin that is byte identical
to its `.mam` form.