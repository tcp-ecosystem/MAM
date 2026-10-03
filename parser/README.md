# @mam/parser

MAM (Machine Agent Modules) parser — lexer, parser, and AST generator for `.mam.md` documents.

## Installation

```bash
npm install @mam/parser
```

## Quick Start

```typescript
import { parseMAM } from '@mam/parser';

const result = parseMAM(`---
id: my-agent
version: 2.0.0
name: My Agent
author: Developer
runtime: python
---

## Purpose

An AI agent that greets users.

## Python

\`\`\`python
def greet(name: str) -> str:
    return f"Hello, {name}!"
\`\`\`
`);

if (result.errors.length > 0) {
  console.error(result.errors);
}

console.log(result.ast.sections);   // Section[]
console.log(result.ast.frontmatter); // FrontMatter | null
```

## Lexer API

### `tokenize(input, options?)`

Tokenizes raw Markdown text into a token stream.

```typescript
import { tokenize } from '@mam/parser';

const result = tokenize('# Hello');
console.log(result.tokens);  // Token[]
console.log(result.errors);  // LexerError[]
console.log(result.warnings); // LexerWarning[]
console.log(result.stats);   // TokenizerStats
```

#### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `source` | `string` | `'<input>'` | Source file name for error reporting |
| `maxDepth` | `number` | `100` | Maximum nesting depth |
| `strict` | `boolean` | `false` | Enable strict mode |
| `trackInline` | `boolean` | `true` | Track inline formatting tokens |

### Token Types

The `TokenType` enum defines all token types:

- **Special**: `EOF`, `ERROR`
- **Front Matter**: `FRONTMATTER_SEPARATOR`
- **Headings**: `HEADING_1` through `HEADING_6`, `HEADING_TEXT`
- **Code**: `CODE_FENCE_BACKTICK`, `CODE_FENCE_TILDE`, `CODE_LANGUAGE`, `CODE_CONTENT`, `CODE_METADATA`
- **Lists**: `BULLET_LIST`, `NUMBERED_LIST`, `LIST_ITEM_TEXT`, `TASK_CHECKED`, `TASK_UNCHECKED`
- **Tables**: `TABLE_PIPE`, `TABLE_HYPHEN`, `TABLE_COLON`, `TABLE_HEADER_CELL`, `TABLE_ROW_CELL`
- **Inline**: `BOLD_OPEN/CLOSE`, `ITALIC_OPEN/CLOSE`, `STRIKETHROUGH_OPEN/CLOSE`, `CODE_INLINE`, `LINK_*`, `IMAGE_*`
- **Block**: `BLOCKQUOTE`, `HORIZONTAL_RULE`, `PARAGRAPH_BREAK`
- **YAML**: `YAML_KEY`, `YAML_VALUE`, `YAML_SEPARATOR`, `YAML_LIST_ITEM`
- **Structure**: `NEWLINE`, `INDENT`, `DEDENT`, `WHITESPACE`, `TEXT`

### `createToken(type, value, line, column, offset, metadata?)`

Factory function to create a `Token` object.

```typescript
import { createToken, TokenType } from '@mam/parser';

const token = createToken(TokenType.TEXT, 'hello', 1, 0, 0);
// { type: 'TEXT', value: 'hello', line: 1, column: 0, offset: 0, length: 5 }
```

### `VALID_LANGUAGES`

A `Set<string>` of all supported code block languages (e.g., `'python'`, `'javascript'`, `'mermaid'`).

### `STANDARD_SECTIONS`

A `Set<string>` of all 20 standard MAM section names (e.g., `'Purpose'`, `'Rules'`, `'Python'`).

## Parser API

### `parse(tokens, options?)`

Parses a token stream into a MAM AST.

```typescript
import { tokenize, parse } from '@mam/parser';

const { tokens } = tokenize(input);
const result = parse(tokens);
console.log(result.ast); // MAMModule
```

### `MAMParser` class

```typescript
import { MAMParser } from '@mam/parser';

const parser = new MAMParser(tokens, {
  source: 'example.mam.md',
  strict: true,
  allowUnknownSections: false,
});
const result = parser.parse();
```

#### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `source` | `string` | `'<input>'` | Source file name |
| `maxDepth` | `number` | — | Maximum nesting depth |
| `strict` | `boolean` | `false` | Strict parsing mode |
| `allowUnknownSections` | `boolean` | `true` | Allow non-standard section names |

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

Union type of all content node types:

- `ParagraphNode` — plain text paragraphs with inline nodes
- `ListNode` — ordered/unordered lists with items
- `CodeBlockNode` — fenced code blocks with language and metadata
- `TableNode` — markdown tables with headers and rows
- `MermaidNode` — mermaid diagrams
- `HeadingNode` — inline headings (level 3+)
- `BlockquoteNode` — blockquotes
- `HorizontalRuleNode` — horizontal rules (`---`, `***`, `___`)

### FrontMatter

```typescript
interface FrontMatter {
  type: 'FrontMatter';
  data: FrontMatterData;
  location: SourceLocation;
}
```

### FrontMatterData

```typescript
interface FrontMatterData {
  id: string;        // required
  version: string;   // required, semver
  name: string;      // required
  author: string;    // required
  runtime: string;   // required
  tags?: string[];
  description?: string;
  dependencies?: string[];
  permissions?: string[];
  license?: string;
  repository?: string;
  mam_version?: string;
  [key: string]: unknown; // custom fields
}
```

## V2 DSL Parser

The V2 DSL parser handles module declarations, types, edges, and system descriptions.

```typescript
import { parseDSL } from '@mam/parser/parser/dsl.js';
import { tokenize } from '@mam/parser';

const { tokens } = tokenize(input);
const result = parseDSL(tokens, { source: 'system.mam.md' });
console.log(result.modules); // V2ModuleNode[]
```

### DSL Module Types

- `agent` — AI agent module
- `tool` — Tool/function module
- `memory` — Memory/storage module
- `workflow` — Workflow/pipeline module
- `team` — Team/orchestration module
- `policy` — Policy/constraint module
- `system` — System/container module
- `module` — Generic module

### DSL Sections

| Section | Description |
|---------|-------------|
| `type:` | Module type override |
| `role:` | Agent role description |
| `goal:` | Agent goal |
| `description:` | Module description |
| `provider:` | LLM provider |
| `format:` | Input/output format |
| `backend:` | Backend type |
| `scope:` | Scope level |
| `ttl:` | Time-to-live |
| `memory:` | Memory configuration |
| `requires:` | Dependencies list |
| `inputs:` | Input port definitions |
| `outputs:` | Output port definitions |
| `tools:` | Available tools |
| `members:` | Team members |
| `handoff:` | Handoff targets |
| `allow:` | Allowed actions |
| `deny:` | Denied actions |
| `permissions:` | Permission set |
| `steps:` | Workflow steps |
| `edges:` | Module edges |
| `capabilities:` | Module capabilities |

## Utils

### Range Utilities (`@mam/parser/src/utils/range.ts`)

```typescript
import {
  createPosition, createRange, rangeContains, rangesOverlap,
  rangeMerge, rangeCompare, rangeToString, rangeLength,
  positionBefore, positionAfter, positionEqual,
  expandRange, clipRange,
} from '@mam/parser/src/utils/range.js';
```

Key functions:

- `createRange(start, end)` — create a Range
- `rangeContains(range, position)` — check if position is within range
- `rangesOverlap(a, b)` — check if two ranges overlap
- `rangeMerge(a, b)` — merge two ranges into encompassing range
- `rangeLength(range)` — calculate character length
- `expandRange(range, lines)` — expand by N lines
- `clipRange(range, container)` — clip to container

### Location Utilities (`@mam/parser/src/utils/location.ts`)

```typescript
import {
  createLocation, createSpan, locationBefore, locationAfter,
  locationEqual, spanContains, spansOverlap, spanMerge,
  locationToString, spanToString,
  rangeToLocation, rangeToSpan, locationToRange,
  offsetToLocation, locationToOffset, getLineColumn,
  getLineRange, extractText,
} from '@mam/parser/src/utils/location.js';
```

Key functions:

- `offsetToLocation(text, offset)` — linear offset → SourceLocation
- `locationToOffset(text, loc)` — SourceLocation → linear offset
- `getLineColumn(text, offset)` — get line/column for offset
- `getLineRange(text, line)` — get start/end offset of a line
- `extractText(text, span)` — extract text at a span

## Error Handling

### ParseError

```typescript
class ParseError extends Error {
  source: string;
  line: number;
  column: number;
  code: ParseErrorCode;
  severity: 'error' | 'warning';
  expected?: string[];
  found?: string;
  context?: string;

  toFormattedString(): string;
}
```

### ParseErrorCode

| Code | Description |
|------|-------------|
| `UNEXPECTED_TOKEN` | Unexpected token encountered |
| `EXPECTED_FRONTMATTER` | Expected `---` front matter |
| `EXPECTED_HEADING` | Expected heading |
| `UNTERMINATED_CODE_BLOCK` | Code block missing closing fence |
| `UNTERMINATED_FRONTMATTER` | Front matter missing closing `---` |
| `INVALID_YAML` | Invalid YAML in front matter |
| `DUPLICATE_SECTION` | Duplicate section name |
| `MISSING_REQUIRED_SECTION` | Missing required section |
| `INVALID_SECTION_ORDER` | Sections out of recommended order |
| `MAX_DEPTH_EXCEEDED` | Nesting depth exceeded |
| `INVALID_TABLE_SYNTAX` | Malformed table |
| `MISSING_CLOSING_FENCE` | Missing closing code fence |

### ParseWarning

```typescript
class ParseWarning {
  message: string;
  source: string;
  line: number;
  column: number;
  code: ParseWarningCode;

  toFormattedString(): string;
}
```

### ParseWarningCode

| Code | Description |
|------|-------------|
| `EMPTY_SECTION` | Section has no content |
| `UNKNOWN_SECTION` | Non-standard section name |
| `SECTION_ORDER` | Section out of recommended order |
| `DUPLICATE_HEADING` | Duplicate heading |
| `DEPRECATED_SYNTAX` | Deprecated syntax used |

## Examples

### Parse with strict mode

```typescript
const result = parseMAM(input, {
  source: 'agent.mam.md',
  strict: true,
  allowUnknownSections: false,
});
```

### Extract code blocks

```typescript
import { extractAllCodeBlocks, extractCodeBlocksByLanguage } from '@mam/parser/src/parser/codeblocks.js';

const blocks = extractAllCodeBlocks(input);
const pythonBlocks = extractCodeBlocksByLanguage(blocks, 'python');
```

### Count code blocks

```typescript
import { countCodeBlocks, getCodeBlockLanguages } from '@mam/parser/src/parser/codeblocks.js';

const count = countCodeBlocks(input);
const languages = getCodeBlockLanguages(blocks);
```

### Replace a code block

```typescript
import { replaceCodeBlock } from '@mam/parser/src/parser/codeblocks.js';

const updated = replaceCodeBlock(input, 0, 'new code here');
```

### Wrap code in a fenced block

```typescript
import { wrapCodeBlock } from '@mam/parser/src/parser/codeblocks.js';

const block = wrapCodeBlock('print("hello")', 'python', { timeout: '30s' });
// ```python // @timeout=30s
// print("hello")
// ```
```

## License

MIT
