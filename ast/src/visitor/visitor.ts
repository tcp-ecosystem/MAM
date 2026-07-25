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

  visitParagraph(node: Paragraph): Paragraph {
    return node;
  }

  visitList(node: List): List {
    return node;
  }

  visitCodeBlock(node: CodeBlock): CodeBlock {
    return node;
  }

  visitTable(node: Table): Table {
    return node;
  }

  visitMermaid(node: MermaidDiagram): MermaidDiagram {
    return node;
  }

  visitHeading(node: Heading): Heading {
    return node;
  }

  visitBlockquote(node: Blockquote): Blockquote {
    return node;
  }

  visitInline(node: InlineNode): InlineNode {
    return node;
  }

  visitInlineText(node: InlineText): InlineText {
    return node;
  }

  visitInlineCode(node: InlineCode): InlineCode {
    return node;
  }

  visitBold(node: Bold): Bold {
    return node;
  }

  visitItalic(node: Italic): Italic {
    return node;
  }

  visitLink(node: Link): Link {
    return node;
  }

  visitImage(node: Image): Image {
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