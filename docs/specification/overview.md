# Specification Overview

> **The formal definition of the MAM language.**

---

## What is the MAM Specification?

The MAM specification defines a standard for transforming Markdown documents into structured, executable modules. It ensures that any MAM-compliant tool can read, validate, and execute any MAM module.

### Why a Specification?

| Benefit | Description |
|---------|-------------|
| Interoperability | Any tool can process any MAM module |
| Predictability | Same input always produces same output |
| Validation | Clear rules for correct modules |
| Extensibility | Defined extension points |
| Versioning | Backward-compatible evolution |

---

## Specification Goals

1. **Markdown First** — Markdown is the source of truth
2. **Human Readable** — Modules are readable without tooling
3. **Machine Parseable** — Every section is extractable
4. **Deterministic** — Same input = same AST
5. **Extensible** — Custom sections via plugins
6. **Runtime Agnostic** — Any language can execute MAM

---

## File Extension

MAM modules use the `.mam.md` extension:

```
<module-name>.mam.md
```

Examples:
- `authentication.mam.md`
- `data-pipeline.mam.md`
- `agent-planner.mam.md`

---

## Document Structure

A MAM document has three layers:

```
┌─────────────────────────────────────────┐
│           YAML Front Matter             │  ← Metadata layer
├─────────────────────────────────────────┤
│           Markdown Body                 │  ← Content layer
│  ┌─────────────────────────────────┐    │
│  │       MAM Sections              │    │  ← Structure layer
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
```

---

## Front Matter

Every MAM module MUST begin with YAML front matter:

```yaml
---
id: authentication
version: 1.0.0
name: Authentication Module
author: LifeJiggy
tags:
  - auth
  - security
runtime: python
dependencies: []
permissions:
  - network
---
```

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier |
| `version` | string | Semantic version |
| `name` | string | Human-readable name |
| `author` | string | Module author |
| `runtime` | string | Primary runtime |

### Optional Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `tags` | string[] | [] | Discovery tags |
| `description` | string | "" | Module description |
| `dependencies` | string[] | [] | Module dependencies |
| `permissions` | string[] | [] | Required permissions |
| `license` | string | "MIT" | License identifier |

### ID Rules

- Lowercase alphanumeric and hyphens only
- Maximum 64 characters
- Must start with a letter
- No consecutive hyphens
- Pattern: `^[a-z][a-z0-9-]{0,63}$`

### Version Rules

- Must follow Semantic Versioning 2.0.0
- Format: `MAJOR.MINOR.PATCH`

---

## Sections

Sections are Markdown headings that define structured content:

```markdown
## SectionName

Content follows until next heading of equal or higher level.
```

### Standard Sections

| Section | Purpose | Required |
|---------|---------|----------|
| `Purpose` | Module objective | Yes |
| `Inputs` | Input parameters | No |
| `Outputs` | Output values | No |
| `Rules` | Behavioral constraints | No |
| `Workflow` | Process definition | No |
| `Mermaid` | Visual diagrams | No |
| `Python` | Python code | No |
| `JavaScript` | JavaScript code | No |
| `Prompt` | LLM instructions | No |
| `Memory` | Persistent state | No |
| `Examples` | Usage examples | No |
| `Tests` | Validation rules | No |
| `References` | External links | No |
| `Dependencies` | Required modules | No |
| `Exports` | Public interface | No |
| `Imports` | Required imports | No |
| `Plugins` | Plugin requirements | No |
| `Permissions` | Security requirements | No |
| `Capabilities` | System capabilities | No |

### Section Ordering

Recommended order (not enforced unless strict mode):

1. Purpose
2. Inputs
3. Outputs
4. Rules
5. Workflow
6. Mermaid
7. Python / JavaScript
8. Prompt
9. Memory
10. Examples
11. Tests
12. References
13. Dependencies
14. Exports
15. Imports
16. Plugins
17. Permissions
18. Capabilities

---

## Code Blocks

Fenced code blocks with language annotation:

```markdown
## Python

```python
def process(data):
    return transformed(data)
```
```

### Language Identifiers

| Identifier | Runtime |
|------------|---------|
| `python` | Python 3.10+ |
| `javascript` / `js` | Node.js 20+ |
| `typescript` / `ts` | TypeScript 5+ |
| `rust` | Rust 1.70+ |
| `go` | Go 1.21+ |
| `shell` / `bash` | Shell |
| `yaml` | Configuration |
| `json` | Data |
| `mermaid` | Diagrams |

### Code Block Metadata

```python
# @mam:exec
# @mam:timeout=30s
# @mam:memory=256MB
# @mam:requires=network
```

---

## AST (Abstract Syntax Tree)

### AST Node Types

```typescript
interface MAMModule {
  type: 'MAMModule';
  frontmatter: FrontMatterNode;
  sections: SectionNode[];
  location: SourceLocation;
}

interface SectionNode {
  type: 'Section';
  name: string;
  level: number;
  content: ContentNode[];
  location: SourceLocation;
}

interface ContentNode {
  type: 'Paragraph' | 'List' | 'CodeBlock' | 'Table' | 'Heading' | 'Mermaid';
  value: string;
  language?: string;
  location: SourceLocation;
}
```

### AST Serialization

- JSON (primary)
- YAML (for inspection)
- Binary (for storage)

### AST Traversal

```typescript
const visitor = {
  visitMAMModule(node: MAMNode) { /* ... */ },
  visitSection(node: SectionNode) { /* ... */ },
  visitCodeBlock(node: ContentNode) { /* ... */ }
};

traverse(ast, visitor);
```

---

## Validation

### Validation Levels

| Level | Description |
|-------|-------------|
| `syntax` | Valid Markdown structure |
| `schema` | Valid YAML front matter |
| `semantic` | Correct section content |
| `strict` | All rules enforced |

### Validation Rules

#### Required Rules

- Front matter must exist
- `id` field must be present
- `version` field must be present
- `Purpose` section must exist

#### Format Rules

- ID must match pattern
- Version must be valid semver
- Code blocks must have language identifier

#### Semantic Rules

- Section names must be from standard list or registered
- Code blocks must be parseable
- References must be valid URLs

### Custom Rules

Plugins can add custom validation rules:

```typescript
interface ValidationRule {
  name: string;
  description: string;
  level: 'error' | 'warning' | 'info';
  check(node: MAMNode): ValidationResult[];
}
```

---

## Plugin System

### Plugin Interface

```typescript
interface MAMPlugin {
  name: string;
  version: string;
  sections?: SectionDefinition[];
  rules?: ValidationRule[];
  contexts?: ExecutionContext[];
  exporters?: Exporter[];
  renderers?: Renderer[];
}
```

### Plugin Loading

Plugins are loaded from:
1. Built-in plugins
2. Project plugins (`.mam/plugins/`)
3. Global plugins (`~/.mam/plugins/`)
4. Registry plugins

---

## Runtime

### Execution Context

```typescript
interface ExecutionContext {
  module: MAMNode;
  inputs: Record<string, unknown>;
  permissions: Permission[];
  sandbox: Sandbox;
  execute(code: string, language: string): Promise<ExecutionResult>;
  getMemory(): Record<string, unknown>;
  setMemory(key: string, value: unknown): void;
}
```

### Sandboxing

All code execution happens in sandboxes:
- Process isolation
- Memory limits
- CPU time limits
- Network restrictions
- Filesystem restrictions

### Output Formats

| Format | Description |
|--------|-------------|
| `json` | Structured data |
| `html` | Rendered HTML |
| `markdown` | Processed Markdown |
| `text` | Plain text |

---

## Conformance

### Conformance Levels

| Level | Requirements |
|-------|--------------|
| `basic` | Parseable, valid front matter |
| `standard` | All standard sections, validation passes |
| `strict` | All rules enforced, no warnings |
| `extended` | Custom sections, plugins |

### Conformance Testing

A conformant implementation must:
1. Parse all valid MAM modules
2. Reject all invalid MAM modules
3. Produce identical AST for identical input
4. Pass all conformance test cases

---

## Versioning

### Specification Versioning

- MAJOR: Incompatible changes
- MINOR: New features (backward compatible)
- PATCH: Clarifications (no normative changes)

### Module Versioning

```yaml
---
version: 1.2.0
mam_version: 1.0.0
---
```

### Compatibility

- Modules conforming to spec v1.x can be read by any v1.y implementation
- Breaking changes require major version bump
- Deprecation requires minor version with warnings

---

## Grammar (BNF)

```bnf
<mam_module>      ::= <front_matter> <sections>
<front_matter>    ::= "---" <yaml_content> "---"
<sections>        ::= <section>*
<section>         ::= "##" <section_name> <content>
<section_name>    ::= <identifier>
<content>         ::= <content_item>*
<content_item>    ::= <paragraph> | <list> | <code_block> | <table> | <mermaid>
<paragraph>       ::= <text_line>+
<list>            ::= <list_item>+
<list_item>       ::= "-" <text>
<code_block>      ::= "```" <language> <code> "```"
<table>           ::= <table_header> <table_row>+
<mermaid>         ::= "```mermaid" <diagram> "```"
```

---

## References

- [Full Specification](../../spec/SPEC.md)
- [JSON Schema](../../spec/schema/mam.schema.json)
- [Section Definitions](../../spec/sections/)
- [Grammar Files](../../spec/grammar/)

---

**Specification Version:** 1.0.0
**Last Updated:** 2026-07-24
**Status:** Stable
