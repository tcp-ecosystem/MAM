# AST Architecture

> **The intermediate representation of MAM modules.**

---

## Overview

The AST (Abstract Syntax Tree) is the structured representation of a parsed MAM module. It serves as the intermediate representation between parsing and execution/compilation.

---

## Node Types

### Core Nodes

| Node | Description |
|------|-------------|
| `MAMModule` | Root node of the AST |
| `FrontMatter` | YAML metadata |
| `Section` | Content section |
| `ContentNode` | Content within sections |

### Content Nodes

| Node | Description |
|------|-------------|
| `ParagraphNode` | Text paragraph |
| `ListNode` | Bullet or numbered list |
| `CodeBlockNode` | Fenced code block |
| `TableNode` | Markdown table |
| `HeadingNode` | Section heading |
| `MermaidNode` | Mermaid diagram |

### v2 DSL Nodes

| Node | Description |
|------|-------------|
| `V2ModuleNode` | Module declaration |
| `V2AgentNode` | Agent definition |
| `V2ToolNode` | Tool definition |
| `V2MemoryNode` | Memory definition |
| `V2WorkflowNode` | Workflow definition |
| `V2TeamNode` | Team definition |
| `V2PolicyNode` | Policy definition |
| `V2SystemNode` | System definition |

---

## Node Structure

### MAMModule

```typescript
interface MAMModule {
  type: 'MAMModule';
  frontmatter: FrontMatter | null;
  sections: Section[];
  location: SourceLocation;
  metadata: ModuleMetadata;
}

interface ModuleMetadata {
  sectionCount: number;
  codeBlockCount: number;
  languages: string[];
  customSections: string[];
  parsedAt: string;
}
```

### FrontMatter

```typescript
interface FrontMatter {
  type: 'FrontMatter';
  data: FrontMatterData;
  location: SourceLocation;
}

interface FrontMatterData {
  id: string;
  version: string;
  name: string;
  author: string;
  runtime: string;
  tags?: string[];
  description?: string;
  dependencies?: string[];
  permissions?: string[];
  license?: string;
  repository?: string;
  mam_version?: string;
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

interface SectionAttributes {
  required: boolean;
  isCustom: boolean;
  contentTypes: string[];
}
```

### ContentNode

```typescript
interface ParagraphNode {
  type: 'Paragraph';
  value: string;
  location: SourceLocation;
}

interface ListNode {
  type: 'List';
  items: string[];
  ordered: boolean;
  location: SourceLocation;
}

interface CodeBlockNode {
  type: 'CodeBlock';
  language: string;
  value: string;
  metadata: CodeBlockMetadata;
  location: SourceLocation;
}

interface TableNode {
  type: 'Table';
  headers: string[];
  rows: string[][];
  location: SourceLocation;
}
```

---

## Visitor Pattern

Traverse and transform the AST using the visitor pattern:

```typescript
interface ASTVisitor {
  visitMAMModule(node: MAMModule): void;
  visitFrontMatter(node: FrontMatter): void;
  visitSection(node: Section): void;
  visitParagraph(node: ParagraphNode): void;
  visitCodeBlock(node: CodeBlockNode): void;
  visitTable(node: TableNode): void;
  visitList(node: ListNode): void;
}

function traverse(ast: MAMModule, visitor: ASTVisitor): void;
```

### Example Visitor

```typescript
const codeBlockCollector: ASTVisitor = {
  codeBlocks: [] as CodeBlockNode[],
  
  visitMAMModule(node) {
    node.sections.forEach(s => s.content.forEach(c => {
      if (c.type === 'CodeBlock') {
        this.codeBlocks.push(c);
      }
    }));
  },
  
  visitFrontMatter() {},
  visitSection() {},
  visitParagraph() {},
  visitCodeBlock() {},
  visitTable() {},
  visitList() {},
};

traverse(ast, codeBlockCollector);
console.log(codeBlockCollector.codeBlocks);
```

---

## Transformer

Modify the AST using the transformer:

```typescript
interface ASTTransformer {
  transformMAMModule(node: MAMModule): MAMModule;
  transformSection(node: Section): Section;
  transformContent(node: ContentNode): ContentNode;
}

function transform(ast: MAMModule, transformer: ASTTransformer): MAMModule;
```

### Example Transformer

```typescript
const sectionRenamer: ASTTransformer = {
  transformMAMModule(node) {
    return {
      ...node,
      sections: node.sections.map(s => this.transformSection(s))
    };
  },
  
  transformSection(node) {
    return {
      ...node,
      name: node.name.toLowerCase()
    };
  },
  
  transformContent(node) {
    return node;
  },
};
```

---

## Collector

Gather information from the AST:

```typescript
interface ASTCollector<T> {
  collect(ast: MAMModule): T;
}
```

### Example Collector

```typescript
const languageCollector: ASTCollector<string[]> = {
  collect(ast) {
    const languages = new Set<string>();
    
    ast.sections.forEach(section => {
      section.content.forEach(content => {
        if (content.type === 'CodeBlock') {
          languages.add(content.language);
        }
      });
    });
    
    return Array.from(languages);
  }
};

const languages = languageCollector.collect(ast);
```

---

## Serialization

### JSON Serialization

```typescript
import { toJSON, fromJSON } from '@mam/ast';

// Serialize
const json = toJSON(ast);

// Deserialize
const ast = fromJSON(json);
```

### YAML Serialization

```typescript
import { toYAML, fromYAML } from '@mam/ast';

// Serialize
const yaml = toYAML(ast);

// Deserialize
const ast = fromYAML(yaml);
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
  line: number;    // 1-indexed
  column: number;  // 0-indexed
  offset: number;  // 0-indexed
}
```

---

## AST Statistics

```typescript
interface ASTStats {
  totalNodes: number;
  totalSections: number;
  totalCodeBlocks: number;
  languages: string[];
  customSections: string[];
  maxDepth: number;
}
```

---

## Example

### Input Module

```markdown
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

```python
def greet(name):
    return f"Hello, {name}!"
```
```

### AST Output

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
    },
    "location": {
      "start": { "line": 1, "column": 0, "offset": 0 },
      "end": { "line": 8, "column": 3, "offset": 50 }
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
          "value": "A simple hello module.",
          "location": {
            "start": { "line": 10, "column": 0, "offset": 52 },
            "end": { "line": 10, "column": 22, "offset": 74 }
          }
        }
      ],
      "location": {
        "start": { "line": 9, "column": 0, "offset": 51 },
        "end": { "line": 10, "column": 22, "offset": 74 }
      }
    },
    {
      "type": "Section",
      "name": "Python",
      "level": 2,
      "content": [
        {
          "type": "CodeBlock",
          "language": "python",
          "value": "def greet(name):\n    return f\"Hello, {name}!\"",
          "metadata": {
            "exec": false
          },
          "location": {
            "start": { "line": 12, "column": 0, "offset": 76 },
            "end": { "line": 15, "column": 3, "offset": 131 }
          }
        }
      ],
      "location": {
        "start": { "line": 11, "column": 0, "offset": 75 },
        "end": { "line": 15, "column": 3, "offset": 131 }
      }
    }
  ],
  "location": {
    "start": { "line": 1, "column": 0, "offset": 0 },
    "end": { "line": 15, "column": 3, "offset": 131 }
  },
  "metadata": {
    "sectionCount": 2,
    "codeBlockCount": 1,
    "languages": ["python"],
    "customSections": [],
    "parsedAt": "2026-07-24T00:00:00Z"
  }
}
```

---

## References

- [Parser Architecture](./parser.md)
- [AST API](../api/ast.md)
- [Specification](../specification/overview.md)

---

**Last Updated:** 2026-07-24
**MAM Version:** 1.0.0
