# Core Concepts

> **Understand the fundamental building blocks of MAM.**

---

## What is MAM?

MAM (Markdown as Module) transforms Markdown into a universal Intermediate Representation (IR) for AI systems. It treats Markdown as an executable knowledge module that both humans and machines can understand.

### The Problem MAM Solves

| Problem | MAM Solution |
|---------|--------------|
| Markdown is just text | MAM makes it structured and executable |
| AI needs context | MAM provides metadata + code + instructions |
| Tools can't interoperate | MAM is runtime-agnostic |
| Documentation drifts from code | MAM keeps them in one file |
| No standard for AI modules | MAM defines a universal spec |

---

## Core Principles

### 1. Markdown First

Markdown is always the source of truth. No proprietary syntax, no hidden formats.

```markdown
## Purpose

This is readable by humans AND parseable by machines.
```

### 2. Human First

Never sacrifice readability. If a human can't read it, it's not a valid module.

```markdown
## Rules

- Keep it simple
- Be explicit
- Document everything
```

### 3. Machine Friendly

Every section must be extractable as structured data. The parser can extract any section programmatically.

### 4. Deterministic

Same module always produces the same AST. No randomness, no side effects during parsing.

### 5. Modular

Each section is independent. You can add, remove, or modify sections without affecting others.

### 6. Extensible

Users can add new section types via the plugin system.

### 7. Runtime Agnostic

Python, JavaScript, Rust, Go, Java, C# should all be able to execute MAM modules.

---

## Module Structure

Every MAM module has three layers:

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

### Front Matter

The metadata layer. Contains module identity, version, runtime, and configuration.

```yaml
---
id: my-module
version: 1.0.0
name: My Module
author: Your Name
runtime: python
---
```

### Sections

Structured content areas defined by Markdown headings:

```markdown
## Purpose

What this module does.

## Inputs

What the module expects.

## Outputs

What the module produces.
```

### Code Blocks

Executable code embedded in sections:

```markdown
## Python

```python
def process(data):
    return transformed(data)
```
```

---

## Section Types

MAM defines 19 standard section types:

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

---

## The AST (Abstract Syntax Tree)

When you parse a MAM module, it produces an AST — a tree structure representing the document:

```
MAMModule
├── FrontMatter
│   ├── id: "my-module"
│   ├── version: "1.0.0"
│   └── runtime: "python"
├── Section: "Purpose"
│   └── Content: "What this module does."
├── Section: "Python"
│   └── CodeBlock: "python"
│       └── "def process(data): ..."
└── Section: "Examples"
    └── CodeBlock: "python"
        └── "result = process(input)"
```

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
```

---

## Parsing Pipeline

The flow from Markdown to executable output:

```
Markdown (.mam.md)
      │
      ▼
   Lexer ──────────────────────────────────┐
      │                                     │
      ▼                                     │
   Parser ─────────────────────────────────┐│
      │                                     ││
      ▼                                     ││
   AST Construction ──────────────────────┐││
      │                                    │││
      ▼                                    │││
   Validator ────────────────────────────┐│││
      │                                    ││││
      ▼                                    ││││
   Runtime ──────────────────────────────┐││││
      │                                    │││││
      ▼                                    │││││
   Output (JSON, HTML, Executable)        │││││
                                          │││││
   Error Handling ◄───────────────────────┘││││
   Logging ◄───────────────────────────────┘│││
   Security ◄───────────────────────────────┘││
   Memory ◄──────────────────────────────────┘│
   Caching ◄──────────────────────────────────┘
```

---

## Compilation

MAM never executes directly. It compiles to target languages:

| Target | Output |
|--------|--------|
| Python | Python module |
| JavaScript | JS/TS module |
| Go | Go package |
| Rust | Rust crate |
| OpenAI | API config |
| LangGraph | Graph definition |
| CrewAI | Agent config |
| Claude | Tool definition |
| Docker | Container config |

---

## Runtime Contexts

Each code block runs in its own execution context:

| Context | Language | Requirements |
|---------|----------|--------------|
| Python | Python 3.10+ | python3 installed |
| JavaScript | Node.js 20+ | node installed |
| Rust | Rust 1.70+ | cargo installed |
| Go | Go 1.21+ | go installed |

---

## Sandboxing

All code execution happens in sandboxes:

- **Process isolation** — Each block runs in a separate process
- **Memory limits** — Configurable memory caps
- **CPU time limits** — Prevent infinite loops
- **Network restrictions** — Control outbound access
- **Filesystem restrictions** — Control file access

---

## Plugin System

Extend MAM with plugins:

```typescript
interface MAMPlugin {
  name: string;
  version: string;
  sections?: SectionDefinition[];
  rules?: ValidationRule[];
  contexts?: ExecutionContext[];
  exporters?: Exporter[];
}
```

### Plugin Types

| Type | Purpose |
|------|---------|
| Section plugins | Add new section types |
| Validation plugins | Add custom validation rules |
| Runtime plugins | Add execution contexts |
| Export plugins | Add output formats |

---

## Validation Levels

| Level | What It Checks |
|-------|----------------|
| `syntax` | Valid Markdown structure |
| `schema` | Valid YAML front matter |
| `semantic` | Correct section content |
| `strict` | All rules enforced |

---

## Memory System

Modules can maintain state across executions:

```markdown
## Memory

```yaml
user_preferences:
  language: en
  theme: dark
session_count: 0
```
```

Memory is persisted between runs and shared across sections.

---

## Summary

| Concept | Description |
|---------|-------------|
| Module | A `.mam.md` file with front matter + sections |
| Front Matter | YAML metadata at the top of the file |
| Section | Content area defined by `##` heading |
| AST | Parsed tree representation of the module |
| Compiler | Transforms AST to target language |
| Runtime | Executes compiled modules |
| Sandbox | Isolated execution environment |
| Plugin | Extension that adds capabilities |

---

## Next Steps

- [Specification](../specification/overview.md) — Formal language spec
- [Architecture](../architecture/overview.md) — System design
- [Writing Modules](../guides/writing-modules.md) — Hands-on guide

---

**Last Updated:** 2026-07-24
**MAM Version:** 1.0.0
