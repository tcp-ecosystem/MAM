# Parser API Reference

> **API documentation for the MAM parser.**

---

## Overview

The parser transforms raw Markdown into a structured AST. This reference covers all public APIs.

---

## Imports

```typescript
import { parse, MAMParser, ParserOptions, ParseResult } from '@mam/parser';
```

---

## Functions

### parse

Main entry point for parsing MAM modules.

```typescript
function parse(
  input: string,
  options?: ParserOptions
): ParseResult;
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| input | string | Yes | Raw Markdown content |
| options | ParserOptions | No | Parser configuration |

**Returns:** `ParseResult`

**Example:**

```typescript
const result = parse(`
---
id: hello
version: 1.0.0
name: Hello
author: LifeJiggy
runtime: python
---

## Purpose

A simple hello module.

## Python

\`\`\`python
def greet(name):
    return f"Hello, {name}!"
\`\`\`
`);

console.log(result.ast);
console.log(result.errors);
console.log(result.warnings);
```

---

## Types

### ParserOptions

```typescript
interface ParserOptions {
  source?: string;
  maxDepth?: number;
  strict?: boolean;
  allowUnknownSections?: boolean;
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| source | string | undefined | Source file path |
| maxDepth | number | 10 | Maximum nesting depth |
| strict | boolean | false | Enable strict mode |
| allowUnknownSections | boolean | true | Allow custom sections |

### ParseResult

```typescript
interface ParseResult {
  ast: MAMModule;
  errors: (ParseError | LexerError)[];
  warnings: (ParseWarning | LexerWarning)[];
  stats: ParserStats;
}
```

### ParserStats

```typescript
interface ParserStats {
  totalSections: number;
  totalCodeBlocks: number;
  totalLines: number;
  parseTimeMs: number;
}
```

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

## Lexer

### Token Types

```typescript
enum TokenType {
  EOF = 'EOF',
  ERROR = 'ERROR',
  FRONTMATTER_SEPARATOR = 'FRONTMATTER_SEPARATOR',
  HEADING_1 = 'HEADING_1',
  HEADING_2 = 'HEADING_2',
  // ... 40+ token types
}
```

### Token

```typescript
interface Token {
  type: TokenType;
  value: string;
  location: SourceLocation;
}
```

---

## Errors

### ParseError

```typescript
interface ParseError {
  type: 'error';
  code: ParseErrorCode;
  message: string;
  location: SourceLocation;
  context?: string;
}
```

### ParseErrorCode

```typescript
enum ParseErrorCode {
  FRONTMATTER_NOT_FOUND = 'FRONTMATTER_NOT_FOUND',
  FRONTMATTER_INVALID = 'FRONTMATTER_INVALID',
  SECTION_EXPECTED = 'SECTION_EXPECTED',
  CODE_BLOCK_UNCLOSED = 'CODE_BLOCK_UNCLOSED',
  INVALID_METADATA = 'INVALID_METADATA',
}
```

---

## Example

```typescript
import { parse } from '@mam/parser';

const input = `---
id: my-module
version: 1.0.0
name: My Module
author: Test
runtime: python
---

## Purpose

My module purpose.

## Python

\`\`\`python
def hello():
    return "world"
\`\`\`
`;

const result = parse(input);

if (result.errors.length > 0) {
  console.error('Parse errors:', result.errors);
} else {
  console.log('AST:', JSON.stringify(result.ast, null, 2));
}
```

---

## References

- [Parser Architecture](../architecture/parser.md)
- [AST Architecture](../architecture/ast.md)

---

**Last Updated:** 2026-07-24
**MAM Version:** 1.0.0
