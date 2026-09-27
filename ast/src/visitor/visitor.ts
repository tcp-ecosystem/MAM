/**
 * MAM Visitor Pattern
 * 
 * Implements the visitor pattern for traversing and transforming MAM AST nodes.
 */

import {
  MAMModule,
  FrontMatter,
  Section,
  ContentNode,
  Paragraph,
  List,
  CodeBlock,
  Table,
  MermaidDiagram,
  Heading,
  Blockquote,
  InlineNode,
  InlineText,
  InlineCode,
  Bold,
  Italic,
  Link,
  Image,
  ListItem,
  TableCell,
  BaseNode,
} from '../nodes/index.js';

/**
 * Visitor interface for traversing MAM AST
 */
export interface MAMVisitor<T = void> {
  // Module
  visitMAMModule?(node: MAMModule): T;
  
  // Front matter
  visitFrontMatter?(node: FrontMatter): T;
  
  // Sections
  visitSection?(node: Section): T;
  
  // Content
  visitParagraph?(node: Paragraph): T;
  visitList?(node: List): T;
  visitCodeBlock?(node: CodeBlock): T;
  visitTable?(node: Table): T;
  visitMermaid?(node: MermaidDiagram): T;
  visitHeading?(node: Heading): T;
  visitBlockquote?(node: Blockquote): T;
  
  // Inline
  visitInlineText?(node: InlineText): T;
  visitInlineCode?(node: InlineCode): T;
  visitBold?(node: Bold): T;
  visitItalic?(node: Italic): T;
  visitLink?(node: Link): T;
  visitImage?(node: Image): T;
  
  // Generic fallback
  visitNode?(node: BaseNode): T;
}

/**
 * Default visitor that traverses all nodes
 */
export class DefaultMAMVisitor<T> implements MAMVisitor<T | void> {
  visitMAMModule(node: MAMModule): T | void {
    if (node.frontmatter) {
      this.visitFrontMatter(node.frontmatter);
    }
    for (const section of node.sections) {
      this.visitSection(section);
    }
  }

  visitFrontMatter(_node: FrontMatter): T | void {}

  visitSection(node: Section): T | void {
    for (const content of node.content) {
      this.visitContent(content);
    }
  }

  visitContent(node: ContentNode): T | void {
    switch (node.type) {
      case 'Paragraph':
        return this.visitParagraph(node);
      case 'List':
        return this.visitList(node);
      case 'CodeBlock':
        return this.visitCodeBlock(node);
      case 'Table':
        return this.visitTable(node);
      case 'Mermaid':
        return this.visitMermaid(node);
      case 'Heading':
        return this.visitHeading(node);
      case 'Blockquote':
        return this.visitBlockquote(node);
      default:
        return this.visitNode(node);
    }
  }

  visitParagraph(node: Paragraph): T | void {
    for (const inline of node.inlineNodes) {
      this.visitInline(inline);
    }
  }

  visitList(node: List): T | void {
    for (const item of node.items) {
      this.visitListItem(item);
    }
  }

  visitListItem(item: ListItem): T | void {
    for (const content of item.content) {
      this.visitContent(content);
    }
  }

  visitCodeBlock(_node: CodeBlock): T | void {}

  visitTable(node: Table): T | void {
    for (const header of node.headers) {
      this.visitTableCell(header);
    }
    for (const row of node.rows) {
      for (const cell of row) {
        this.visitTableCell(cell);
      }
    }
  }

  visitTableCell(cell: TableCell): T | void {
    for (const inline of cell.inlineNodes) {
      this.visitInline(inline);
    }
  }

  visitMermaid(_node: MermaidDiagram): T | void {}

  visitHeading(node: Heading): T | void {
    for (const inline of node.content) {
      this.visitInline(inline);
    }
  }

  visitBlockquote(node: Blockquote): T | void {
    for (const child of node.children) {
      this.visitContent(child);
    }
  }

  visitInline(node: InlineNode): T | void {
    switch (node.type) {
      case 'InlineText':
        return this.visitInlineText(node);
      case 'InlineCode':
        return this.visitInlineCode(node);
      case 'Bold':
        return this.visitBold(node);
      case 'Italic':
        return this.visitItalic(node);
      case 'Link':
        return this.visitLink(node);
      case 'Image':
        return this.visitImage(node);
      default:
        return this.visitNode(node);
    }
  }

  visitInlineText(_node: InlineText): T | void {}
  visitInlineCode(_node: InlineCode): T | void {}
  
  visitBold(node: Bold): T | void {
    for (const inline of node.content) {
      this.visitInline(inline);
    }
  }
  
  visitItalic(node: Italic): T | void {
    for (const inline of node.content) {
      this.visitInline(inline);
    }
  }
  
  visitLink(node: Link): T | void {
    for (const inline of node.content) {
      this.visitInline(inline);
    }
  }
  
  visitImage(_node: Image): T | void {}
  
  visitNode(_node: BaseNode): T | void {}
}

/**
 * Traverser that walks the AST using a visitor
 */
export function traverse(node: MAMModule, visitor: MAMVisitor): void {
  visitor.visitMAMModule?.(node);
}

/**
 * Transform visitor that can modify the AST
 */
export abstract class MAMTransformer implements MAMVisitor<BaseNode | null> {
  visitMAMModule(node: MAMModule): MAMModule {
    const frontmatter = node.frontmatter 
      ? this.visitFrontMatter(node.frontmatter) as FrontMatter | null
      : null;
    
    const sections = node.sections
      .map(section => this.visitSection(section))
      .filter((s): s is Section => s !== null);

    return {
      ...node,
      frontmatter,
      sections,
    };
  }

  visitFrontMatter(node: FrontMatter): FrontMatter | null {
    return node;
  }

  visitSection(node: Section): Section | null {
    const content = node.content
      .map(c => this.visitContent(c))
      .filter((c): c is ContentNode => c !== null);

    return {
      ...node,
      content,
    };
  }

  abstract visitContent(node: ContentNode): ContentNode | null;

  visitParagraph(node: Paragraph): BaseNode {
    return node;
  }

  visitList(node: List): BaseNode {
    return node;
  }

  visitCodeBlock(node: CodeBlock): BaseNode {
    return node;
  }

  visitTable(node: Table): BaseNode {
    return node;
  }

  visitMermaid(node: MermaidDiagram): BaseNode {
    return node;
  }

  visitHeading(node: Heading): BaseNode {
    return node;
  }

  visitBlockquote(node: Blockquote): BaseNode {
    return node;
  }

  visitInline(node: InlineNode): BaseNode {
    return node;
  }

  visitInlineText(node: InlineText): BaseNode {
    return node;
  }

  visitInlineCode(node: InlineCode): BaseNode {
    return node;
  }

  visitBold(node: Bold): BaseNode {
    return node;
  }

  visitItalic(node: Italic): BaseNode {
    return node;
  }

  visitLink(node: Link): BaseNode {
    return node;
  }

  visitImage(node: Image): BaseNode {
    return node;
  }

  visitNode(node: BaseNode): BaseNode {
    return node;
  }
}

/**
 * Collector visitor that gathers information from the AST
 */
export class MAMCollector<T> extends DefaultMAMVisitor<void> {
  private results: T[] = [];
  private collector: (node: BaseNode) => T | null;

  constructor(collector: (node: BaseNode) => T | null) {
    super();
    this.collector = collector;
  }

  override visitNode(node: BaseNode): void {
    const result = this.collector(node);
    if (result !== null) {
      this.results.push(result);
    }
  }

  getResults(): T[] {
    return this.results;
  }

  reset(): void {
    this.results = [];
  }
}

function walkNode(
  node: BaseNode,
  enter: (node: BaseNode) => void,
  leave?: (node: BaseNode) => void,
): void {
  enter(node);

  switch (node.type) {
    case 'MAMModule': {
      const mod = node as MAMModule;
      if (mod.frontmatter) walkNode(mod.frontmatter, enter, leave);
      for (const section of mod.sections) walkNode(section, enter, leave);
      break;
    }
    case 'Section': {
      const section = node as Section;
      for (const content of section.content) walkNode(content, enter, leave);
      break;
    }
    case 'Paragraph': {
      const paragraph = node as Paragraph;
      for (const inline of paragraph.inlineNodes) walkNode(inline, enter, leave);
      break;
    }
    case 'List': {
      const list = node as List;
      for (const item of list.items) {
        for (const content of item.content) walkNode(content, enter, leave);
      }
      break;
    }
    case 'Table': {
      const table = node as Table;
      for (const cell of table.headers) {
        for (const inline of cell.inlineNodes) walkNode(inline, enter, leave);
      }
      for (const row of table.rows) {
        for (const cell of row) {
          for (const inline of cell.inlineNodes) walkNode(inline, enter, leave);
        }
      }
      break;
    }
    case 'Heading': {
      const heading = node as Heading;
      for (const inline of heading.content) walkNode(inline, enter, leave);
      break;
    }
    case 'Blockquote': {
      const blockquote = node as Blockquote;
      for (const child of blockquote.children) walkNode(child, enter, leave);
      break;
    }
    case 'Bold':
    case 'Italic':
    case 'Link': {
      const inline = node as Bold | Italic | Link;
      for (const child of inline.content) walkNode(child, enter, leave);
      break;
    }
    case 'FrontMatter':
    case 'CodeBlock':
    case 'Mermaid':
    case 'InlineText':
    case 'InlineCode':
    case 'Image':
      break;
  }

  leave?.(node);
}

export function traverseWithHooks(
  ast: MAMModule,
  hooks: {
    enter?: (node: BaseNode) => void;
    leave?: (node: BaseNode) => void;
  },
): void {
  walkNode(
    ast,
    (node) => hooks.enter?.(node),
    (node) => hooks.leave?.(node),
  );
}

export function findFirstNode(
  ast: MAMModule,
  predicate: (node: BaseNode) => boolean,
): BaseNode | undefined {
  let found: BaseNode | undefined;
  walkNode(ast, (node) => {
    if (found === undefined && predicate(node)) {
      found = node;
    }
  });
  return found;
}

export function hasNodeType(ast: MAMModule, type: BaseNode['type']): boolean {
  let match = false;
  walkNode(ast, (node) => {
    if (node.type === type) {
      match = true;
    }
  });
  return match;
}

export function collectNodeTypes(ast: MAMModule): BaseNode['type'][] {
  const seen = new Set<BaseNode['type']>();
  walkNode(ast, (node) => {
    seen.add(node.type);
  });
  return Array.from(seen);
}

export function collectCodeBlockLanguages(ast: MAMModule): string[] {
  const languages = new Set<string>();
  walkNode(ast, (node) => {
    if (node.type === 'CodeBlock') {
      languages.add((node as CodeBlock).language);
    }
  });
  return Array.from(languages);
}

export function mapParagraphValues(
  ast: MAMModule,
  fn: (value: string, paragraph: Paragraph) => string,
): MAMModule {
  return {
    ...ast,
    sections: ast.sections.map((section) => ({
      ...section,
      content: section.content.map((content) => mapContentValue(content, fn)),
    })),
  };
}

function mapContentValue(
  node: ContentNode,
  fn: (value: string, paragraph: Paragraph) => string,
): ContentNode {
  switch (node.type) {
    case 'Paragraph':
      return { ...node, value: fn(node.value, node) };
    case 'List':
      return {
        ...node,
        items: node.items.map((item) => ({
          ...item,
          content: item.content.map((content) => mapContentValue(content, fn)),
        })),
      };
    case 'Blockquote':
      return {
        ...node,
        children: node.children.map((child) => mapContentValue(child, fn)),
      };
    default:
      return node;
  }
}

export class MAMProfiler {
  private readonly counts = new Map<string, number>();

  visitMAMModule(node: MAMModule): void {
    this.profile(node);
  }

  profile(ast: MAMModule): void {
    walkNode(ast, (node) => {
      this.counts.set(node.type, (this.counts.get(node.type) ?? 0) + 1);
    });
  }

  getCount(type: string): number {
    return this.counts.get(type) ?? 0;
  }

  getCounts(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [type, count] of this.counts) {
      result[type] = count;
    }
    return result;
  }

  getTotal(): number {
    let total = 0;
    for (const count of this.counts.values()) {
      total += count;
    }
    return total;
  }

  reset(): void {
    this.counts.clear();
  }
}