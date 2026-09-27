# Parser Architecture

> **How MAM transforms Markdown into structured tokens and AST.**

---

## Overview

The parser is the first stage of the MAM pipeline. It reads raw Markdown and produces a structured AST (Abstract Syntax Tree). The parser consists of two main components: the Lexer and the Parser.

---

## Pipeline

```
Raw Markdown
      │
      ▼
   Lexer
      │
      ▼
   Tokens
      │
      ▼
   Parser
      │
      ▼
   MAM AST
```

---

## Lexer

The lexer tokenizes raw Markdown into meaningful tokens.

### Token Types

The lexer defines 40+ token types:

| Category | Tokens |
|----------|--------|
| Special | `EOF`, `ERROR` |
| Front Matter | `FRONTMATTER_SEPARATOR` |
| Headings | `HEADING_1` through `HEADING_6`, `HEADING_TEXT` |
| Code | `CODE_FENCE_BACKTICK`, `CODE_FENCE_TILDE`, `CODE_LANGUAGE`, `CODE_CONTENT`, `CODE_METADATA` |
| Lists | `BULLET_LIST`, `NUMBERED_LIST`, `LIST_ITEM_TEXT`, `TASK_CHECKED`, `TASK_UNCHECKED` |
| Tables | `TABLE_PIPE`, `TABLE_HYPHEN`, `TABLE_COLON`, `TABLE_HEADER_CELL`, `TABLE_ROW_CELL` |
| Inline | `BOLD_OPEN/CLOSE`, `ITALIC_OPEN/CLOSE`, `CODE_INLINE`, `LINK_*`, `IMAGE_*` |
| Block | `BLOCKQUOTE`, `HORIZONTAL_RULE`, `PARAGRAPH_BREAK` |
| YAML | `YAML_KEY`, `YAML_VALUE`, `YAML_SEPARATOR`, `YAML_LIST_ITEM` |
| Structure | `NEWLINE`, `INDENT`, `DEDENT`, `WHITESPACE` |
| Text | `TEXT`, `NUMBER`, `IDENTIFIER` |
| v2 DSL | `MODULE`, `TYPE`, `AGENT`, `TOOL`, `MEMORY`, `WORKFLOW`, `TEAM`, `POLICY`, `SYSTEM`, `EDGE`, `HANDOFF`, `ALLOW`, `DENY`, `STEPS`, `EDGES`, `MEMBERS` |

### Token Structure

```typescript
interface Token {
  type: TokenType;
  value: string;
  location: SourceLocation;
}
```

### Lexer Configuration

```typescript
interface LexerOptions {
  source?: string;
  maxDepth?: number;
  strict?: boolean;
}
```

### Error Recovery

The lexer recovers from errors by:
1. Skipping invalid characters
2. Inserting missing tokens
3. Continuing to next valid token
4. Reporting all errors found

---

## Parser

The parser builds the AST from tokens.

### Components

| Component | File | Purpose |
|-----------|------|---------|
| Main Parser | `mam.ts` | Orchestrates parsing |
| Front Matter | `frontmatter.ts` | Parses YAML metadata |
| Sections | `sections.ts` | Parses section content |
| Code Blocks | `codeblocks.ts` | Parses embedded code |
| DSL | `dsl.ts` | Parses v2 DSL syntax |

### Parse Flow

```
Tokens
   │
   ├──▶ Front Matter Parser
   │       │
   │       ▼
   │    FrontMatterNode
   │
   └──▶ Section Parser
           │
           ├──▶ Code Block Parser
           │       │
           │       ▼
           │    CodeBlockNode
           │
           └──▶ Content Parser
                   │
                   ▼
                SectionNode
```

### Parser Options

```typescript
interface ParserOptions {
  source?: string;          // Source file path
  maxDepth?: number;        // Maximum nesting depth
  strict?: boolean;         // Strict mode
  allowUnknownSections?: boolean;  // Allow custom sections
}
```

### Parse Result

```typescript
interface ParseResult {
  ast: MAMModule;           // Parsed AST
  errors: ParseError[];     // Errors found
  warnings: ParseWarning[]; // Warnings found
  stats: ParserStats;       // Parse statistics
}

interface ParserStats {
  totalSections: number;
  totalCodeBlocks: number;
  totalLines: number;
  parseTimeMs: number;
}
```

---

## AST Construction

The parser constructs the following AST nodes:

### MAMModule

```typescript
interface MAMModule {
  type: 'MAMModule';
  frontmatter: FrontMatter | null;
  sections: Section[];
  location: SourceLocation;
  metadata: ModuleMetadata;
}
```

### FrontMatter

```typescript
interface FrontMatter {
  type: 'FrontMatter';
  data: FrontMatterData;
  location: SourceLocation;
}
```

### Section

```typescript
interface Section {
  type: 'Section';
  name: string;
  level: number;
  content: ContentNode[];
  location: SourceLocation;
  attributes: SectionAttributes;
}
```

### ContentNode

```typescript
type ContentNode = 
  | ParagraphNode
  | ListNode
  | CodeBlockNode
  | TableNode
  | HeadingNode
  | MermaidNode;
```

---

## Source Locations

Every node tracks its source location:

```typescript
interface SourceLocation {
  start: Position;
  end: Position;
  source: string;
}

interface Position {
  line: number;
  column: number;
  offset: number;
}
```

---

## Error Handling

### Parse Errors

```typescript
interface ParseError {
  type: 'error';
  code: ParseErrorCode;
  message: string;
  location: SourceLocation;
  context?: string;
}
```

### Error Codes

| Code | Description |
|------|-------------|
| `FRONTMATTER_NOT_FOUND` | Missing front matter |
| `FRONTMATTER_INVALID` | Invalid YAML in front matter |
| `SECTION_EXPECTED` | Expected section heading |
| `CODE_BLOCK_UNCLOSED` | Unclosed code block |
| `INVALID_METADATA` | Invalid code metadata |

### Parse Warnings

```typescript
interface ParseWarning {
  type: 'warning';
  code: ParseWarningCode;
  message: string;
  location: SourceLocation;
}
```

---

## Performance

### Optimization Strategies

1. **Incremental Parsing** — Parse only changed sections
2. **Token Caching** — Cache tokens for repeated parsing
3. **Lazy Evaluation** — Parse code blocks only when needed
4. **Parallel Processing** — Parse sections in parallel

### Benchmarks

| Operation | Target | Actual |
|-----------|--------|--------|
| Lex 1K lines | <10ms | ~8ms |
| Parse 1K lines | <50ms | ~35ms |
| Full pipeline | <100ms | ~75ms |

---

## Example

### Input

```markdown
---
id: hello
version: 2.0.0
name: Hello
author: LifeJiggy
runtime: python
---

## Purpose

A simple hello module.

## Python

```python
def greet(name):
    return f"Hello, {name}!"
```
```

### Output AST

```json
{
  "type": "MAMModule",
  "frontmatter": {
    "type": "FrontMatter",
    "data": {
      "id": "hello",
      "version": "1.0.0",
      "name": "Hello",
      "author": "LifeJiggy",
      "runtime": "python"
    }
  },
  "sections": [
    {
      "type": "Section",
      "name": "Purpose",
      "level": 2,
      "content": [
        {
          "type": "Paragraph",
          "value": "A simple hello module."
        }
      ]
    },
    {
      "type": "Section",
      "name": "Python",
      "level": 2,
      "content": [
        {
          "type": "CodeBlock",
          "language": "python",
          "value": "def greet(name):\n    return f\"Hello, {name}!\""
        }
      ]
    }
  ]
}
```

---

## References

- [AST Architecture](./ast.md)
- [Specification](../specification/overview.md)
- [Parser API](../api/parser.md)

---

**Last Updated:** 2026-07-24
**MAM Version:** 1.0.0
