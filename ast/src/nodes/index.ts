/**
 * MAM AST Node Definitions
 * 
 * Complete type definitions for all AST node types in MAM.
 */

import { SourceLocation } from '../location/index.js';

// ============================================================================
// Base Types
// ============================================================================

export type NodeType = 
  | 'MAMModule'
  | 'FrontMatter'
  | 'Section'
  | 'Paragraph'
  | 'List'
  | 'CodeBlock'
  | 'Table'
  | 'Mermaid'
  | 'Heading'
  | 'Blockquote'
  | 'InlineCode'
  | 'Bold'
  | 'Italic'
  | 'Link'
  | 'Image';

export interface BaseNode {
  type: NodeType;
  location: SourceLocation;
}

// ============================================================================
// Module Node
// ============================================================================

export interface MAMModule extends BaseNode {
  type: 'MAMModule';
  frontmatter: FrontMatter | null;
  sections: Section[];
  metadata: ModuleMetadata;
}

export interface ModuleMetadata {
  /** Total number of sections */
  sectionCount: number;
  /** Total number of code blocks */
  codeBlockCount: number;
  /** Languages used in code blocks */
  languages: string[];
  /** Custom sections not in standard list */
  customSections: string[];
  /** Parse timestamp */
  parsedAt?: string;
}

// ============================================================================
// Front Matter
// ============================================================================

export interface FrontMatter extends BaseNode {
  type: 'FrontMatter';
  data: FrontMatterData;
}

export interface FrontMatterData {
  id: string;
  version: string;
  name: string;
  author: string;
  runtime: RuntimeType;
  tags?: string[];
  description?: string;
  dependencies?: string[];
  permissions?: Permission[];
  license?: string;
  repository?: string;
  mam_version?: string;
  [key: string]: unknown;
}

export type RuntimeType = 
  | 'python' 
  | 'javascript' 
  | 'typescript' 
  | 'rust' 
  | 'go' 
  | 'shell';

export type Permission = 
  | 'network' 
  | 'filesystem' 
  | 'environment' 
  | 'exec' 
  | 'memory';

// ============================================================================
// Section Node
// ============================================================================

export interface Section extends BaseNode {
  type: 'Section';
  name: SectionName;
  level: number;
  content: ContentNode[];
  attributes: SectionAttributes;
}

export type SectionName = 
  | 'Purpose'
  | 'Inputs'
  | 'Outputs'
  | 'Rules'
  | 'Workflow'
  | 'Mermaid'
  | 'Python'
  | 'JavaScript'
  | 'TypeScript'
  | 'Prompt'
  | 'Memory'
  | 'Examples'
  | 'Tests'
  | 'References'
  | 'Dependencies'
  | 'Exports'
  | 'Imports'
  | 'Plugins'
  | 'Permissions'
  | 'Capabilities'
  | string; // Allow custom sections

export interface SectionAttributes {
  /** Whether this is a required section */
  required: boolean;
  /** Whether this is a custom section */
  isCustom: boolean;
  /** Content type hints */
  contentTypes: ContentType[];
}

export type ContentType = 
  | 'text'
  | 'list'
  | 'code'
  | 'table'
  | 'diagram'
  | 'mixed';

// ============================================================================
// Content Nodes
// ============================================================================

export type ContentNode = 
  | Paragraph 
  | List 
  | CodeBlock 
  | Table 
  | MermaidDiagram
  | Heading
  | Blockquote;

// ============================================================================
// Paragraph
// ============================================================================

export interface Paragraph extends BaseNode {
  type: 'Paragraph';
  value: string;
  inlineNodes: InlineNode[];
}

// ============================================================================
// Inline Nodes
// ============================================================================

export type InlineNode = 
  | InlineText
  | InlineCode
  | Bold
  | Italic
  | Link
  | Image;

export interface InlineText extends BaseNode {
  type: 'InlineText';
  value: string;
}

export interface InlineCode extends BaseNode {
  type: 'InlineCode';
  value: string;
}

export interface Bold extends BaseNode {
  type: 'Bold';
  content: InlineNode[];
}

export interface Italic extends BaseNode {
  type: 'Italic';
  content: InlineNode[];
}

export interface Link extends BaseNode {
  type: 'Link';
  url: string;
  title?: string;
  content: InlineNode[];
}

export interface Image extends BaseNode {
  type: 'Image';
  url: string;
  alt: string;
  title?: string;
}

// ============================================================================
// List
// ============================================================================

export interface List extends BaseNode {
  type: 'List';
  ordered: boolean;
  items: ListItem[];
}

export interface ListItem {
  content: ContentNode[];
  checked?: boolean;
}

// ============================================================================
// Code Block
// ============================================================================

export interface CodeBlock extends BaseNode {
  type: 'CodeBlock';
  language: Language;
  value: string;
  metadata: CodeMetadata;
  executable: boolean;
}

export type Language = 
  | 'python'
  | 'javascript'
  | 'js'
  | 'typescript'
  | 'ts'
  | 'rust'
  | 'go'
  | 'shell'
  | 'bash'
  | 'yaml'
  | 'json'
  | 'mermaid'
  | string;

export interface CodeMetadata {
  /** Execution timeout */
  timeout?: string;
  /** Memory limit */
  memory?: string;
  /** Required permissions */
  requires?: string[];
  /** Custom metadata */
  [key: string]: string | string[] | undefined;
}

// ============================================================================
// Table
// ============================================================================

export interface Table extends BaseNode {
  type: 'Table';
  headers: TableCell[];
  rows: TableRow[];
  alignments: TableColumnAlignment[];
}

export interface TableCell {
  value: string;
  inlineNodes: InlineNode[];
}

export type TableRow = TableCell[];

export type TableColumnAlignment = 'left' | 'center' | 'right' | 'none';

// ============================================================================
// Mermaid Diagram
// ============================================================================

export interface MermaidDiagram extends BaseNode {
  type: 'Mermaid';
  value: string;
  diagramType?: MermaidDiagramType;
}

export type MermaidDiagramType = 
  | 'flowchart'
  | 'sequence'
  | 'class'
  | 'state'
  | 'er'
  | 'gantt'
  | 'pie'
  | 'unknown';

// ============================================================================
// Heading
// ============================================================================

export interface Heading extends BaseNode {
  type: 'Heading';
  level: 1 | 2 | 3 | 4 | 5 | 6;
  value: string;
  content: InlineNode[];
}

// ============================================================================
// Blockquote
// ============================================================================

export interface Blockquote extends BaseNode {
  type: 'Blockquote';
  value: string;
  children: ContentNode[];
}

// ============================================================================
// Helper Types
// ============================================================================

export const REQUIRED_SECTIONS: SectionName[] = ['Purpose'];

export const STANDARD_SECTIONS: SectionName[] = [
  'Purpose',
  'Inputs',
  'Outputs',
  'Rules',
  'Workflow',
  'Mermaid',
  'Python',
  'JavaScript',
  'TypeScript',
  'Prompt',
  'Memory',
  'Examples',
  'Tests',
  'References',
  'Dependencies',
  'Exports',
  'Imports',
  'Plugins',
  'Permissions',
  'Capabilities',
];

export function isStandardSection(name: string): boolean {
  return STANDARD_SECTIONS.includes(name as SectionName);
}

export function isRequiredSection(name: string): boolean {
  return REQUIRED_SECTIONS.includes(name as SectionName);
}

export function getNodeType(node: BaseNode): NodeType {
  return node.type;
}

export function isNodeType<T extends BaseNode>(
  node: BaseNode, 
  type: T['type']
): node is T {
  return node.type === type;
}