/** Source position information for a parsed MAM node. */
export interface SourceLocation {
  line: number;
  column: number;
  offset: number;
  file: string;
}

/** Standard MAM section kinds plus the explicit custom-section variant. */
export type SectionKind =
  | 'metadata' | 'purpose' | 'inputs' | 'outputs' | 'rules' | 'workflow'
  | 'mermaid' | 'python' | 'prompt' | 'memory' | 'examples' | 'tests'
  | 'references' | 'dependencies' | 'exports' | 'imports' | 'plugins'
  | 'permissions' | 'capabilities' | 'Custom';

export const SECTION_KINDS: readonly SectionKind[] = [
  'metadata', 'purpose', 'inputs', 'outputs', 'rules', 'workflow', 'mermaid',
  'python', 'prompt', 'memory', 'examples', 'tests', 'references', 'dependencies',
  'exports', 'imports', 'plugins', 'permissions', 'capabilities', 'Custom',
] as const;

/** A code fence embedded in a section. */
export interface CodeBlock {
  kind: 'CodeBlock';
  language: string;
  code: string;
  location: SourceLocation;
}

/** A paragraph or plain text node. */
export interface TextNode {
  kind: 'Text';
  text: string;
  location: SourceLocation;
}

/** A heading content node. */
export interface HeadingNode {
  kind: 'Heading';
  level: number;
  text: string;
  location: SourceLocation;
}

/** A Markdown list node. */
export interface ListNode {
  kind: 'List';
  items: string[];
  location: SourceLocation;
}

/** A Markdown table node. */
export interface TableNode {
  kind: 'Table';
  rows: string[][];
  location: SourceLocation;
}

/** A blockquote node. */
export interface BlockquoteNode {
  kind: 'Blockquote';
  text: string;
  location: SourceLocation;
}

/** A horizontal rule node. */
export interface HorizontalRuleNode {
  kind: 'HorizontalRule';
  location: SourceLocation;
}

/** A Markdown link node. */
export interface LinkNode {
  kind: 'Link';
  text: string;
  url: string;
  location: SourceLocation;
}

/** A Markdown image node. */
export interface ImageNode {
  kind: 'Image';
  alt: string;
  url: string;
  location: SourceLocation;
}

/** All supported content node variants. */
export type ContentNode = HeadingNode | ParagraphNode | CodeBlock | ListNode | TableNode |
  BlockquoteNode | HorizontalRuleNode | LinkNode | ImageNode | TextNode;

export interface ParagraphNode {
  kind: 'Paragraph';
  text: string;
  location: SourceLocation;
}

/** Frontmatter values retained in the typed contract. */
export interface FrontMatter {
  schema_version: string;
  name: string;
  version: string;
  description: string;
  authors: string[];
  tags: string[];
  license: string;
  dependencies: string[];
  metadata: Record<string, unknown>;
  raw: string;
  location: SourceLocation;
}

/** A named Markdown section. */
export interface Section {
  kind: SectionKind;
  title: string;
  content: ContentNode[];
  location: SourceLocation;
}

/** Root AST object returned by every successful parse. */
export interface Module {
  frontmatter: FrontMatter | null;
  sections: Section[];
  raw_content: string;
  file_path: string;
  location: SourceLocation;
}

/** Error raised for an input that cannot be parsed. */
export class ParseError extends Error {
  readonly code: string;
  readonly line: number;
  readonly column: number;
  readonly file: string;

  /** Creates a parse error with a stable code and source position. */
  constructor(code: string, message: string, location: SourceLocation) {
    super(message);
    this.name = 'ParseError';
    this.code = code;
    this.line = location.line;
    this.column = location.column;
    this.file = location.file;
  }
}

/** Returns whether a section title is a standard kind. */
export function isSectionKind(value: string): value is SectionKind {
  return SECTION_KINDS.includes(value as SectionKind) && value !== 'Custom';
}

/** Returns the canonical zero-based order index of a standard kind. */
export function sectionKindOrder(kind: SectionKind): number {
  if (kind === 'Custom') return Number.MAX_SAFE_INTEGER;
  return SECTION_KINDS.indexOf(kind);
}

/** Returns a defensive copy of a source location. */
export function cloneLocation(location: SourceLocation): SourceLocation {
  return { ...location };
}

/** Returns the first section of a module with the requested kind. */
export function sectionByKind(module: Module, kind: SectionKind): Section | undefined {
  return module.sections.find((section) => section.kind === kind);
}

/** Returns the first section whose title matches case-insensitively. */
export function sectionByTitle(module: Module, title: string): Section | undefined {
  const wanted = title.trim().toLowerCase();
  return module.sections.find((section) => section.title.trim().toLowerCase() === wanted);
}

/** Returns all code blocks in section and document order. */
export function allCodeBlocks(module: Module): CodeBlock[] {
  return module.sections.flatMap((section) => section.content.filter((node): node is CodeBlock => node.kind === 'CodeBlock'));
}

/** Returns distinct code-block languages in first-seen order. */
export function codeBlockLanguages(module: Module): string[] {
  return [...new Set(allCodeBlocks(module).map((block) => block.language || 'unknown'))];
}

/** Returns the section titles in document order. */
export function sectionTitles(module: Module): string[] {
  return module.sections.map((section) => section.title);
}

/** Returns whether a module contains a section of the requested kind. */
export function hasSection(module: Module, kind: SectionKind): boolean {
  return sectionByKind(module, kind) !== undefined;
}

/** Returns a deep copy of a module without sharing mutable arrays. */
export function cloneModule(module: Module): Module {
  return {
    ...module,
    frontmatter: module.frontmatter ? cloneFrontMatter(module.frontmatter) : null,
    sections: module.sections.map((section) => ({
      ...section,
      content: section.content.map((node) => cloneNode(node)),
    })),
  };
}

/** Returns a deep copy of frontmatter, including its metadata map. */
export function cloneFrontMatter(frontmatter: FrontMatter): FrontMatter {
  return {
    ...frontmatter,
    authors: [...frontmatter.authors],
    tags: [...frontmatter.tags],
    dependencies: [...frontmatter.dependencies],
    metadata: { ...frontmatter.metadata },
    location: cloneLocation(frontmatter.location),
  };
}

/** Returns a deep copy of a content node. */
export function cloneNode(node: ContentNode): ContentNode {
  if (node.kind === 'CodeBlock') return { ...node, location: cloneLocation(node.location) };
  if (node.kind === 'List') return { ...node, items: [...node.items], location: cloneLocation(node.location) };
  if (node.kind === 'Table') return { ...node, rows: node.rows.map((row) => [...row]), location: cloneLocation(node.location) };
  return { ...node, location: cloneLocation(node.location) };
}

/** Returns a safe empty frontmatter value for callers constructing modules. */
export function emptyFrontmatter(file = '<string>'): FrontMatter {
  return {
    schema_version: '', name: '', version: '', description: '', authors: [], tags: [],
    license: '', dependencies: [], metadata: {}, raw: '', location: { line: 1, column: 1, offset: 0, file },
  };
}

/** Returns a simple human-readable module summary. */
export function moduleSummary(module: Module): string {
  const name = module.frontmatter?.name.trim() || '(untitled)';
  return `${name}: ${module.sections.length} sections, ${allCodeBlocks(module).length} code blocks`;
}

/** Returns whether a module is non-null and has a valid frontmatter name. */
export function isValidModule(module: Module | null | undefined): boolean {
  return Boolean(module && module.frontmatter && module.frontmatter.name.trim().length > 0);
}

/** Returns a content node count for a section. */
export function contentNodeCount(section: Section): number {
  return section.content.length;
}

/** Returns a content node count for a complete module. */
export function totalContentNodeCount(module: Module): number {
  return module.sections.reduce((sum, section) => sum + contentNodeCount(section), 0);
}

/** Returns the first section with the requested title, tolerating case. */
export function findSection(module: Module, title: string): Section | undefined {
  return sectionByTitle(module, title);
}

/** Reports whether the module has any code blocks. */
export function hasCodeBlocks(module: Module): boolean {
  return allCodeBlocks(module).length > 0;
}

/** Returns a section's code blocks only. */
export function sectionCodeBlocks(section: Section): CodeBlock[] {
  return section.content.filter((node): node is CodeBlock => node.kind === 'CodeBlock');
}

/** Returns a stable list of section kinds. */
export function sectionKinds(module: Module): SectionKind[] {
  return module.sections.map((section) => section.kind);
}

/** Returns a copy of the raw module content. */
export function rawContent(module: Module): string {
  return module.raw_content;
}

/** Returns a module source path. */
export function filePath(module: Module): string {
  return module.file_path;
}

/** Reports whether a location points to a named file. */
export function hasFileLocation(value: SourceLocation): boolean {
  return Boolean(value.file);
}

/** Creates a zero-based source location. */
export function zeroLocation(file = '<generated>'): SourceLocation {
  return { line: 0, column: 0, offset: 0, file };
}

/** Returns a compact location string. */
export function formatLocation(value: SourceLocation): string {
  return `${value.file}:${value.line}:${value.column}`;
}

/** Returns the highest canonical position in a section list. */
export function latestStandardKind(sections: Section[]): SectionKind {
  return sections.reduce<SectionKind>((latest, section) => sectionKindOrder(section.kind) > sectionKindOrder(latest) ? section.kind : latest, 'Custom');
}

/** Returns whether a section has a content node of a kind. */
export function hasContentKind(section: Section, kind: ContentNode['kind']): boolean {
  return section.content.some((node) => node.kind === kind);
}

/** Returns code blocks whose language is present. */
export function labeledCodeBlocks(module: Module): CodeBlock[] {
  return allCodeBlocks(module).filter((block) => block.language.trim().length > 0);
}

/** Returns a defensive list of frontmatter dependencies. */
export function moduleDependencies(module: Module): string[] {
  return [...(module.frontmatter?.dependencies ?? [])];
}
