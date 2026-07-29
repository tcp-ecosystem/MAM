# Plugin Examples

This directory contains example MAM modules that demonstrate how to extend MAM with custom plugins and section types.

## Contents

| Module | Description |
|--------|-------------|
| `custom-section/` | Example of defining a custom section type via the Plugin API |
| `validation-plugin/` | Custom validation rules plugin — business rules, security scanning, cross-references |
| `export-plugin/` | Custom export format plugin — HTML, PDF, and DOCX output |
| `runtime-plugin/` | Custom runtime plugin — Deno, Bun, and WebAssembly execution |
| `memory-plugin/` | Memory backend plugin — Redis, PostgreSQL, and in-memory storage with TTL |

## Plugin Architecture

MAM plugins can:

- **Add new section types** — Define novel sections beyond the built-in set
- **Add validators** — Custom validation rules for your sections
- **Add runtimes** — Execute code in new languages or environments
- **Add exporters** — Render MAM modules to new output formats
- **Add renderers** — Custom HTML/markdown rendering for sections

## Quick Start

```typescript
import { MAMPlugin, SectionDefinition } from "@mam/plugin-api";

const myPlugin: MAMPlugin = {
  name: "my-custom-section",
  version: "1.0.0",
  sections: [
    {
      name: "custom",
      validate: (node) => { /* ... */ },
      render: (node) => { /* ... */ },
    },
  ],
};
```

See `plugins/api/src/` for the full plugin type definitions.
