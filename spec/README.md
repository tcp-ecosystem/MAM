# MAM Specification

> The official specification for Markdown as Module (MAM) v1.0.0

This package contains the formal specification for MAM, including grammar definitions, JSON schemas, and section documentation.

## Overview

MAM (Markdown as Module) defines a standard for transforming Markdown documents into structured, executable modules for AI systems.

## Specification Files

| File | Description |
|------|-------------|
| `SPEC.md` | Full specification document |
| `grammar/` | PEG grammar definitions |
| `schema/` | JSON Schema definitions |
| `sections/` | Section type documentation |

## File Structure

A MAM module uses the `.mam.md` extension:

```
module-name.mam.md
```

### Document Layers

```
┌─────────────────────────────────┐
│       YAML Front Matter         │  Metadata layer
├─────────────────────────────────┤
│       Markdown Body             │  Content layer
│  ┌─────────────────────────┐    │
│  │     MAM Sections        │    │  Structure layer
│  └─────────────────────────┘    │
└─────────────────────────────────┘
```

## Core Sections

### Metadata Section

```yaml
---
name: my-module
version: 1.0.0
description: Module description
author: Author Name
tags: [ai, agents]
---
```

### Prompts Section

```markdown
## Prompts

### System Prompt
You are a helpful assistant that...

### User Prompt Template
Please process the following: {{input}}
```

### Code Section

```markdown
## Code

### Python
```python
def process(input):
    return transform(input)
```
```

### Memory Section

```markdown
## Memory

### Conversation Memory
- Persist across sessions
- Maximum 100 entries

### User Preferences
- Theme: dark
- Language: en
```

### Workflow Section

```markdown
## Workflow

### Steps
1. Receive input
2. Validate data
3. Process request
4. Return result
```

## Grammar

The PEG grammar defines the formal syntax:

```peg
Document = FrontMatter? Sections
FrontMatter = '---' YAMLContent '---'
Sections = Section+
Section = '##' SectionType SectionContent
```

## Validation Rules

| Rule | Severity | Description |
|------|----------|-------------|
| `valid-structure` | Error | Document follows MAM structure |
| `valid-yaml` | Error | Front matter is valid YAML |
| `required-fields` | Error | Required metadata present |
| `valid-sections` | Error | Sections use valid types |
| `no-recursion` | Error | No circular references |

## Resources

- [Full Specification](./SPEC.md)
- [Grammar](./grammar/)
- [JSON Schema](./schema/)
- [Section Types](./sections/)
- [Changelog](./CHANGELOG.md)

## License

MIT
