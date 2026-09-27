/**
 * MAM AST Serializers
 * 
 * Provides serialization and deserialization for MAM AST.
 */

import {
  MAMModule,
  FrontMatter,
  Section,
  ContentNode,
  CodeBlock,
  Table,
  List,
  Paragraph,
  MermaidDiagram,
  Heading,
  Blockquote,
  InlineNode,
  ListItem,
  TableCell,
} from '../nodes/index.js';

/**
 * Serialization format options
 */
export type SerializationFormat = 'json' | 'compact' | 'yaml-compatible';

/**
 * Serialize MAM AST to JSON
 */
export function serializeToJSON(
  ast: MAMModule, 
  format: SerializationFormat = 'json'
): string {
  if (format === 'compact') {
    return JSON.stringify(ast);
  }
  return JSON.stringify(ast, null, 2);
}

/**
 * Deserialize JSON to MAM AST
 */
export function deserializeFromJSON(json: string): MAMModule {
  const data = JSON.parse(json);
  return validateAndDeserialize(data);
}

function validateAndDeserialize(data: unknown): MAMModule {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid AST: root must be an object');
  }

  const obj = data as Record<string, unknown>;

  if (obj.type !== 'MAMModule') {
    throw new Error('Invalid AST: root type must be MAMModule');
  }

  return {
    type: 'MAMModule',
    frontmatter: obj.frontmatter ? deserializeFrontMatter(obj.frontmatter) : null,
    sections: Array.isArray(obj.sections) 
      ? obj.sections.map(deserializeSection)
      : [],
    location: deserializeLocation(obj.location),
    metadata: deserializeMetadata(obj.metadata),
  };
}

function deserializeFrontMatter(data: unknown): FrontMatter {
  const obj = data as Record<string, unknown>;
  return {
    type: 'FrontMatter',
    data: obj.data as FrontMatter['data'],
    location: deserializeLocation(obj.location),
  };
}

function deserializeSection(data: unknown): Section {
  const obj = data as Record<string, unknown>;
  return {
    type: 'Section',
    name: obj.name as string,
    level: obj.level as number,
    content: Array.isArray(obj.content)
      ? obj.content.map(deserializeContentNode)
      : [],
    location: deserializeLocation(obj.location),
    attributes: obj.attributes as Section['attributes'],
  };
}

function deserializeContentNode(data: unknown): ContentNode {
  const obj = data as Record<string, unknown>;

  switch (obj.type) {
    case 'Paragraph':
      return deserializeParagraph(obj);
    case 'List':
      return deserializeList(obj);
    case 'CodeBlock':
      return deserializeCodeBlock(obj);
    case 'Table':
      return deserializeTable(obj);
    case 'Mermaid':
      return deserializeMermaid(obj);
    case 'Heading':
      return deserializeHeading(obj);
    case 'Blockquote':
      return deserializeBlockquote(obj);
    default:
      throw new Error(`Unknown content node type: ${obj.type}`);
  }
}

function deserializeParagraph(data: Record<string, unknown>): Paragraph {
  return {
    type: 'Paragraph',
    value: data.value as string,
    inlineNodes: Array.isArray(data.inlineNodes)
      ? data.inlineNodes.map(deserializeInlineNode)
      : [],
    location: deserializeLocation(data.location),
  };
}

function deserializeList(data: Record<string, unknown>): List {
  return {
    type: 'List',
    ordered: data.ordered as boolean,
    items: Array.isArray(data.items)
      ? data.items.map(deserializeListItem)
      : [],
    location: deserializeLocation(data.location),
  };
}

function deserializeListItem(data: unknown): ListItem {
  const obj = data as Record<string, unknown>;
  return {
    content: Array.isArray(obj.content)
      ? obj.content.map(deserializeContentNode)
      : [],
    checked: obj.checked as boolean | undefined,
  };
}

function deserializeCodeBlock(data: Record<string, unknown>): CodeBlock {
  return {
    type: 'CodeBlock',
    language: data.language as string,
    value: data.value as string,
    metadata: data.metadata as CodeBlock['metadata'],
    executable: data.executable as boolean,
    location: deserializeLocation(data.location),
  };
}

function deserializeTable(data: Record<string, unknown>): Table {
  return {
    type: 'Table',
    headers: Array.isArray(data.headers)
      ? data.headers.map(deserializeTableCell)
      : [],
    rows: Array.isArray(data.rows)
      ? data.rows.map((row: unknown) =>
          Array.isArray(row) ? row.map(deserializeTableCell) : []
        )
      : [],
    alignments: data.alignments as Table['alignments'],
    location: deserializeLocation(data.location),
  };
}

function deserializeTableCell(data: unknown): TableCell {
  const obj = data as Record<string, unknown>;
  return {
    value: obj.value as string,
    inlineNodes: Array.isArray(obj.inlineNodes)
      ? obj.inlineNodes.map(deserializeInlineNode)
      : [],
  };
}

function deserializeMermaid(data: Record<string, unknown>): MermaidDiagram {
  return {
    type: 'Mermaid',
    value: data.value as string,
    diagramType: data.diagramType as MermaidDiagram['diagramType'],
    location: deserializeLocation(data.location),
  };
}

function deserializeHeading(data: Record<string, unknown>): Heading {
  return {
    type: 'Heading',
    level: data.level as Heading['level'],
    value: data.value as string,
    content: Array.isArray(data.content)
      ? data.content.map(deserializeInlineNode)
      : [],
    location: deserializeLocation(data.location),
  };
}

function deserializeBlockquote(data: Record<string, unknown>): Blockquote {
  return {
    type: 'Blockquote',
    value: data.value as string,
    children: Array.isArray(data.children)
      ? data.children.map(deserializeContentNode)
      : [],
    location: deserializeLocation(data.location),
  };
}

function deserializeInlineNode(data: unknown): InlineNode {
  const obj = data as Record<string, unknown>;

  switch (obj.type) {
    case 'InlineText':
      return {
        type: 'InlineText',
        value: obj.value as string,
        location: deserializeLocation(obj.location),
      };
    case 'InlineCode':
      return {
        type: 'InlineCode',
        value: obj.value as string,
        location: deserializeLocation(obj.location),
      };
    case 'Bold':
      return {
        type: 'Bold',
        content: Array.isArray(obj.content)
          ? obj.content.map(deserializeInlineNode)
          : [],
        location: deserializeLocation(obj.location),
      };
    case 'Italic':
      return {
        type: 'Italic',
        content: Array.isArray(obj.content)
          ? obj.content.map(deserializeInlineNode)
          : [],
        location: deserializeLocation(obj.location),
      };
    case 'Link':
      return {
        type: 'Link',
        url: obj.url as string,
        title: obj.title as string | undefined,
        content: Array.isArray(obj.content)
          ? obj.content.map(deserializeInlineNode)
          : [],
        location: deserializeLocation(obj.location),
      };
    case 'Image':
      return {
        type: 'Image',
        url: obj.url as string,
        alt: obj.alt as string,
        title: obj.title as string | undefined,
        location: deserializeLocation(obj.location),
      };
    default:
      throw new Error(`Unknown inline node type: ${obj.type}`);
  }
}

function deserializeLocation(data: unknown): MAMModule['location'] {
  if (!data || typeof data !== 'object') {
    return {
      start: { line: 0, column: 0, offset: 0 },
      end: { line: 0, column: 0, offset: 0 },
      source: '',
    };
  }

  const obj = data as Record<string, unknown>;
  const start = obj.start as Record<string, number> || { line: 0, column: 0, offset: 0 };
  const end = obj.end as Record<string, number> || { line: 0, column: 0, offset: 0 };

  return {
    start: { line: start.line || 0, column: start.column || 0, offset: start.offset || 0 },
    end: { line: end.line || 0, column: end.column || 0, offset: end.offset || 0 },
    source: (obj.source as string) || '',
  };
}

function deserializeMetadata(data: unknown): MAMModule['metadata'] {
  if (!data || typeof data !== 'object') {
    return {
      sectionCount: 0,
      codeBlockCount: 0,
      languages: [],
      customSections: [],
    };
  }

  const obj = data as Record<string, unknown>;
  return {
    sectionCount: (obj.sectionCount as number) || 0,
    codeBlockCount: (obj.codeBlockCount as number) || 0,
    languages: Array.isArray(obj.languages) ? obj.languages as string[] : [],
    customSections: Array.isArray(obj.customSections) ? obj.customSections as string[] : [],
    parsedAt: obj.parsedAt as string | undefined,
  };
}

/**
 * Pretty print AST for debugging
 */
export function prettyPrint(ast: MAMModule): string {
  const lines: string[] = [];
  
  lines.push('MAMModule');
  
  if (ast.frontmatter) {
    lines.push('  FrontMatter:');
    lines.push(`    id: ${ast.frontmatter.data.id}`);
    lines.push(`    version: ${ast.frontmatter.data.version}`);
    lines.push(`    name: ${ast.frontmatter.data.name}`);
    lines.push(`    author: ${ast.frontmatter.data.author}`);
    lines.push(`    runtime: ${ast.frontmatter.data.runtime}`);
  }
  
  lines.push(`  Sections: ${ast.sections.length}`);
  
  for (const section of ast.sections) {
    lines.push(`    - ${section.name} (${section.content.length} nodes)`);
  }
  
  lines.push(`  Metadata:`);
  lines.push(`    sections: ${ast.metadata.sectionCount}`);
  lines.push(`    codeBlocks: ${ast.metadata.codeBlockCount}`);
  lines.push(`    languages: ${ast.metadata.languages.join(', ')}`);
  
  return lines.join('\n');
}

/**
 * Get AST statistics
 */
export function getASTStats(ast: MAMModule): ASTStats {
  let totalNodes = 0;
  let totalCodeBlocks = 0;
  let totalTables = 0;
  let totalLists = 0;
  const languages = new Set<string>();

  function countNode(node: ContentNode | InlineNode): void {
    totalNodes++;
    
    if (node.type === 'CodeBlock') {
      totalCodeBlocks++;
      languages.add(node.language);
    } else if (node.type === 'Table') {
      totalTables++;
    } else if (node.type === 'List') {
      totalLists++;
    }
  }

  for (const section of ast.sections) {
    for (const content of section.content) {
      countNode(content);
    }
  }

  return {
    totalNodes,
    totalSections: ast.sections.length,
    totalCodeBlocks,
    totalTables,
    totalLists,
    languages: Array.from(languages),
  };
}

export interface ASTStats {
  totalNodes: number;
  totalSections: number;
  totalCodeBlocks: number;
  totalTables: number;
  totalLists: number;
  languages: string[];
}

export function findSectionByName(ast: MAMModule, name: string): Section | undefined {
  return ast.sections.find((section) => section.name === name);
}

export function getSectionSummaries(
  ast: MAMModule,
): Array<{ name: string; level: number; contentCount: number; types: string[] }> {
  return ast.sections.map((section) => ({
    name: section.name,
    level: section.level,
    contentCount: section.content.length,
    types: section.content.map((content) => content.type),
  }));
}

export function collectLanguages(ast: MAMModule): string[] {
  const languages = new Set<string>();
  for (const section of ast.sections) {
    forEachContent(section.content, (node) => {
      if (node.type === 'CodeBlock') {
        languages.add(node.language);
      }
    });
  }
  return Array.from(languages);
}

export function countInlineNodes(ast: MAMModule): number {
  let count = 0;
  const countInlines = (nodes: InlineNode[]): void => {
    for (const inline of nodes) {
      count++;
      if (inline.type === 'Bold' || inline.type === 'Italic' || inline.type === 'Link') {
        countInlines(inline.content);
      }
    }
  };
  for (const section of ast.sections) {
    forEachContent(section.content, (node) => {
      switch (node.type) {
        case 'Paragraph':
          countInlines(node.inlineNodes);
          break;
        case 'Heading':
          countInlines(node.content);
          break;
        case 'Table': {
          for (const cell of node.headers) countInlines(cell.inlineNodes);
          for (const row of node.rows) {
            for (const cell of row) countInlines(cell.inlineNodes);
          }
          break;
        }
        default:
          break;
      }
    });
  }
  return count;
}

export function astOutline(ast: MAMModule): string[] {
  const lines: string[] = ['MAMModule'];
  if (ast.frontmatter) {
    lines.push('  FrontMatter');
  }
  for (const section of ast.sections) {
    lines.push(`  Section(${section.name})`);
    forEachContent(section.content, (node) => {
      lines.push(`    ${node.type}`);
    });
  }
  return lines;
}

export function roundTripClone(ast: MAMModule): MAMModule {
  return deserializeFromJSON(serializeToJSON(ast));
}

export function getASTComplexity(ast: MAMModule): {
  depth: number;
  totalNodes: number;
  sections: number;
  maxSectionContent: number;
  inlineNodes: number;
} {
  const inlineDepth = (nodes: InlineNode[]): number => {
    let max = 0;
    for (const inline of nodes) {
      let current = 1;
      if (inline.type === 'Bold' || inline.type === 'Italic' || inline.type === 'Link') {
        current += inlineDepth(inline.content);
      }
      if (current > max) max = current;
    }
    return max;
  };

  const contentDepth = (node: ContentNode): number => {
    switch (node.type) {
      case 'Paragraph':
        return 1 + inlineDepth(node.inlineNodes);
      case 'Heading':
        return 1 + inlineDepth(node.content);
      case 'List': {
        let max = 1;
        for (const item of node.items) {
          for (const content of item.content) {
            const depth = 2 + contentDepth(content);
            if (depth > max) max = depth;
          }
        }
        return max;
      }
      case 'Table': {
        let max = 1;
        for (const cell of node.headers) {
          const depth = 1 + inlineDepth(cell.inlineNodes);
          if (depth > max) max = depth;
        }
        for (const row of node.rows) {
          for (const cell of row) {
            const depth = 1 + inlineDepth(cell.inlineNodes);
            if (depth > max) max = depth;
          }
        }
        return max;
      }
      case 'Blockquote': {
        let max = 1;
        for (const child of node.children) {
          const depth = 1 + contentDepth(child);
          if (depth > max) max = depth;
        }
        return max;
      }
      default:
        return 1;
    }
  };

  let depth = ast.frontmatter ? 2 : 1;
  let maxSectionContent = 0;
  let contentTotal = 0;

  for (const section of ast.sections) {
    if (section.content.length > maxSectionContent) {
      maxSectionContent = section.content.length;
    }
    forEachContent(section.content, () => {
      contentTotal++;
    });
    let sectionDepth = 0;
    for (const content of section.content) {
      const current = contentDepth(content);
      if (current > sectionDepth) sectionDepth = current;
    }
    const candidate = 2 + sectionDepth;
    if (candidate > depth) depth = candidate;
  }

  const inlineNodes = countInlineNodes(ast);

  return {
    depth,
    totalNodes: 1 + (ast.frontmatter ? 1 : 0) + ast.sections.length + contentTotal + inlineNodes,
    sections: ast.sections.length,
    maxSectionContent,
    inlineNodes,
  };
}

function forEachContent(nodes: ContentNode[], visit: (node: ContentNode) => void): void {
  for (const node of nodes) {
    visit(node);
    if (node.type === 'Blockquote') {
      forEachContent(node.children, visit);
    } else if (node.type === 'List') {
      for (const item of node.items) {
        forEachContent(item.content, visit);
      }
    }
  }
}