# AST API Reference

> **API documentation for the MAM AST module.**

---

## Overview

The AST module provides node types, traversal utilities, and serialization for MAM abstract syntax trees.

---

## Imports

```typescript
import {
  MAMModule,
  FrontMatter,
  Section,
  ContentNode,
  traverse,
  transform,
  toJSON,
  fromJSON
} from '@mam/ast';
```

---

## Node Types

### MAMModule

Root node of the AST.

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

## Functions

### traverse

Traverse the AST using visitor pattern.

```typescript
function traverse(ast: MAMModule, visitor: ASTVisitor): void;
```

**Example:**

```typescript
import { traverse } from '@mam/ast';

const visitor = {
  visitMAMModule(node) {
    console.log('Module:', node.metadata);
  },
  visitSection(node) {
    console.log('Section:', node.name);
  },
  visitCodeBlock(node) {
    console.log('Code block:', node.language);
  }
};

traverse(ast, visitor);
```

### transform

Transform the AST using transformer pattern.

```typescript
function transform(ast: MAMModule, transformer: ASTTransformer): MAMModule;
```

**Example:**

```typescript
import { transform } from '@mam/ast';

const transformer = {
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
  }
};

const newAst = transform(ast, transformer);
```

### toJSON

Serialize AST to JSON.

```typescript
function toJSON(ast: MAMModule): string;
```

### fromJSON

Deserialize AST from JSON.

```typescript
function fromJSON(json: string): MAMModule;
```

### toYAML

Serialize AST to YAML.

```typescript
function toYAML(ast: MAMModule): string;
```

### fromYAML

Deserialize AST from YAML.

```typescript
function fromYAML(yaml: string): MAMModule;
```

---

## Visitor Interface

```typescript
interface ASTVisitor {
  visitMAMModule?(node: MAMModule): void;
  visitFrontMatter?(node: FrontMatter): void;
  visitSection?(node: Section): void;
  visitParagraph?(node: ParagraphNode): void;
  visitCodeBlock?(node: CodeBlockNode): void;
  visitTable?(node: TableNode): void;
  visitList?(node: ListNode): void;
}
```

---

## Transformer Interface

```typescript
interface ASTTransformer {
  transformMAMModule(node: MAMModule): MAMModule;
  transformFrontMatter(node: FrontMatter): FrontMatter;
  transformSection(node: Section): Section;
  transformContent(node: ContentNode): ContentNode;
}
```

---

## Source Locations

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

## Example

```typescript
import { parse } from '@mam/parser';
import { traverse, toJSON } from '@mam/ast';

const result = parse(input);
const ast = result.ast;

// Find all code blocks
const codeBlocks: string[] = [];
traverse(ast, {
  visitCodeBlock(node) {
    codeBlocks.push(node.language);
  }
});

console.log('Languages:', codeBlocks);

// Serialize to JSON
const json = toJSON(ast);
console.log(json);
```

---

## References

- [AST Architecture](../architecture/ast.md)
- [Parser API](./parser.md)

---

**Last Updated:** 2026-07-24
**MAM Version:** 1.0.0
