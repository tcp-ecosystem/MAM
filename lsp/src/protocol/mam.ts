/**
 * MAM LSP Protocol Extensions
 *
 * Core type definitions, enums, and helper factories for every LSP feature.
 */

import {
  Diagnostic,
  DiagnosticSeverity,
  CodeAction,
  CodeActionKind,
  Hover,
  MarkupKind,
  CompletionItem,
  CompletionItemKind,
  Location,
  Range,
  Position,
  TextEdit,
  DocumentSymbol,
  SymbolKind,
  TextDocumentEdit,
  CreateFile,
} from 'vscode-languageserver-protocol';
import type { MAMModule } from '@mam/parser';

// ============================================================================
// Constants
// ============================================================================

export const MAM_LANGUAGE_ID = 'mam';

export const MAM_DOCUMENT_SELECTOR = [{ scheme: 'file', pattern: '**/*.mam.md' }];

/** Standard V1 section names in recommended order. */
export const V1_SECTIONS = [
  'Purpose', 'Inputs', 'Outputs', 'Rules', 'Workflow', 'Mermaid',
  'Python', 'JavaScript', 'TypeScript', 'Prompt', 'Memory', 'Examples',
  'Tests', 'References', 'Dependencies', 'Exports', 'Imports', 'Plugins',
  'Permissions', 'Capabilities',
] as const;

/** Valid V2 module type keywords. */
export const V2_MODULE_TYPES = [
  'module', 'agent', 'tool', 'memory', 'workflow', 'team',
  'policy', 'system', 'service', 'component', 'resource',
  'interface', 'contract', 'plugin', 'extension', 'runtime',
  'package', 'repository', 'documentation',
] as const;

/** V2 section keywords. */
export const V2_SECTIONS = [
  'type', 'role', 'goal', 'description', 'provider', 'format',
  'backend', 'scope', 'ttl', 'requires', 'inputs', 'outputs',
  'tools', 'memory', 'handoff', 'members', 'steps', 'edges',
  'allow', 'deny', 'permissions', 'capabilities',
] as const;

/** YAML front-matter keys. */
export const YAML_KEYS = [
  'id', 'version', 'name', 'author', 'runtime', 'tags',
  'description', 'dependencies', 'permissions', 'license',
  'repository', 'mam_version',
] as const;

/** Code-block language identifiers. */
export const LANGUAGES = [
  'python', 'javascript', 'js', 'typescript', 'ts', 'rust',
  'go', 'shell', 'bash', 'yaml', 'json', 'mermaid',
] as const;

export const VALID_RUNTIMES = ['python', 'javascript', 'typescript', 'rust', 'go', 'shell'] as const;

export const MEMORY_FORMATS = ['vector', 'key-value', 'relational', 'graph', 'document'] as const;
export const MEMORY_BACKENDS = ['sqlite', 'redis', 'postgres', 'mongodb', 'memory'] as const;
export const SCOPE_TYPES = ['module', 'workspace', 'global'] as const;
export const PERMISSION_KEYS = ['filesystem', 'network', 'python', 'memory', 'exec'] as const;

export const PERMISSION_VALUES: Record<string, string[]> = {
  filesystem: ['read', 'write', 'none'],
  network: ['internet', 'internal', 'none'],
  python: ['sandbox', 'full', 'none'],
  memory: ['local', 'shared', 'none'],
  exec: ['allowed', 'denied'],
};

// ============================================================================
// Documentation Maps
// ============================================================================

export const SECTION_DOCS: Record<string, string> = {
  Purpose: 'Module objective description. **Required section.**',
  Inputs: 'Expected input parameters in table format (Name, Type, Required, Description).',
  Outputs: 'Expected output values in table format (Name, Type, Description).',
  Rules: 'Behavioral constraints and guidelines. Use bullet list format.',
  Workflow: 'Process definition using Mermaid diagrams.',
  Mermaid: 'Visual diagram definitions using Mermaid syntax.',
  Python: 'Python code blocks for execution. Supports `@mam:` metadata comments.',
  JavaScript: 'JavaScript/TypeScript code blocks for execution.',
  TypeScript: 'TypeScript code blocks for execution.',
  Prompt: 'LLM instructions and prompts for AI agents.',
  Memory: 'Persistent state and knowledge. Use `**key**: value` format.',
  Examples: 'Usage demonstrations with runnable code.',
  Tests: 'Validation rules and test cases.',
  References: 'External links and documentation.',
  Dependencies: 'Required modules and packages.',
  Exports: 'Public interface definitions.',
  Imports: 'Required imports and dependencies.',
  Plugins: 'Required plugins for the module.',
  Permissions: 'Security permissions: network, filesystem, environment, exec, memory.',
  Capabilities: 'System capabilities required by the module.',
};

export const V2_SECTION_DOCS: Record<string, string> = {
  type: 'Module type declaration (agent, tool, memory, workflow, team, policy, system, etc.)',
  role: 'Agent role description',
  goal: 'Agent or module goal',
  description: 'Module description',
  provider: 'Tool or memory provider',
  format: 'Memory format (vector, key-value, relational, graph, document)',
  backend: 'Memory backend (sqlite, redis, postgres, mongodb)',
  scope: 'Memory scope (module, workspace, global)',
  ttl: 'Time-to-live duration (e.g., 24h, 7d)',
  requires: 'Required dependencies',
  inputs: 'Input parameters (name: type)',
  outputs: 'Output values (name: type)',
  tools: 'Available tools',
  memory: 'Memory configuration',
  handoff: 'Handoff targets for agent delegation',
  members: 'Team member agents',
  steps: 'Workflow steps',
  edges: 'Communication edges (source -> target)',
  allow: 'Allowed actions (policy)',
  deny: 'Denied actions (policy)',
  permissions: 'Permission configuration',
  capabilities: 'Module capabilities',
};

export const MODULE_TYPE_DOCS: Record<string, string> = {
  module: 'Generic module definition. The base building block in MAM.',
  agent: 'AI agent with role, goal, and tools. Can reason and take actions.',
  tool: 'Executable tool with provider. Invoked by agents or workflows.',
  memory: 'Persistent memory store. Supports vector, key-value, and graph backends.',
  workflow: 'Process workflow with steps and edges. Orchestrates agent execution.',
  team: 'Agent team with members. Manages collaboration between agents.',
  policy: 'Behavioral policy with allow/deny rules. Enforces constraints.',
  system: 'Complete system with agents and edges. Top-level composition.',
  service: 'Runtime service definition. Provides network-accessible functionality.',
  component: 'Reusable UI or logic component.',
  resource: 'External resource declaration (API, file, database).',
  interface: 'Interface contract definition.',
  contract: 'Formal contract between modules.',
  plugin: 'Plugin module loaded at runtime.',
  extension: 'Extension that augments existing modules.',
  runtime: 'Runtime environment specification.',
  package: 'Package of related modules.',
  repository: 'Repository reference for module lookup.',
  documentation: 'Documentation module.',
};

// ============================================================================
// Interfaces
// ============================================================================

export interface MAMDocumentInfo {
  uri: string;
  version: number;
  text: string;
  language: string;
  lastModified: number;
}

export interface MAMPosition {
  line: number;
  character: number;
}

export interface MAMRange {
  start: MAMPosition;
  end: MAMPosition;
}

export enum MAMSymbolKind {
  Module = 'module',
  Section = 'section',
  CodeBlock = 'codeblock',
  Table = 'table',
  List = 'list',
  Variable = 'variable',
  Function = 'function',
  Class = 'class',
}

export interface MAMCompletionItem {
  label: string;
  kind: CompletionItemKind;
  detail?: string;
  documentation?: string;
  insertText?: string;
  sortText?: string;
}

export interface MAMHoverContent {
  contents: string;
  range?: MAMRange;
}

export interface MAMCodeAction {
  title: string;
  kind: CodeActionKind;
  diagnostics?: Diagnostic[];
  edit?: TextDocumentEdit | { changes: Record<string, TextEdit[]> };
}

export interface MAMReference {
  uri: string;
  range: MAMRange;
  kind: 'definition' | 'reference' | 'import';
}

export interface MAMDocumentSymbol {
  name: string;
  kind: MAMSymbolKind;
  range: MAMRange;
  children: MAMDocumentSymbol[];
}

/** Re-export DiagnosticSeverity for convenience. */
export const MAMDiagnosticSeverity = {
  Error: DiagnosticSeverity.Error,
  Warning: DiagnosticSeverity.Warning,
  Information: DiagnosticSeverity.Information,
  Hint: DiagnosticSeverity.Hint,
} as const;

// ============================================================================
// Helper Factories
// ============================================================================

export function createDiagnostic(
  line: number,
  character: number,
  message: string,
  severity: DiagnosticSeverity = DiagnosticSeverity.Error,
  code?: string,
  endLine?: number,
  endCharacter?: number,
): Diagnostic {
  return {
    range: {
      start: { line, character },
      end: { line: endLine ?? line, character: endCharacter ?? character },
    },
    severity,
    message,
    source: 'mam-lsp',
    ...(code ? { code } : {}),
  };
}

export function createCodeAction(
  title: string,
  uri: string,
  range: Range,
  newText: string,
  kind: CodeActionKind = CodeActionKind.QuickFix,
  diagnostics?: Diagnostic[],
): CodeAction {
  return {
    title,
    kind,
    edit: {
      changes: {
        [uri]: [{ range, newText }],
      },
    },
    ...(diagnostics ? { diagnostics } : {}),
  };
}

export function createHoverContent(
  value: string,
  range?: Range,
): Hover {
  return {
    contents: { kind: MarkupKind.Markdown, value },
    ...(range ? { range } : {}),
  };
}

export function createCompletionItem(
  label: string,
  kind: CompletionItemKind,
  opts: Partial<Pick<MAMCompletionItem, 'detail' | 'documentation' | 'insertText' | 'sortText'>> = {},
): CompletionItem {
  return {
    label,
    kind,
    ...(opts.detail ? { detail: opts.detail } : {}),
    ...(opts.documentation ? { documentation: { kind: MarkupKind.Markdown, value: opts.documentation } } : {}),
    ...(opts.insertText ? { insertText: opts.insertText } : {}),
    ...(opts.sortText ? { sortText: opts.sortText } : {}),
  };
}

export function createLocation(uri: string, range: Range): Location {
  return { uri, range };
}

export function createRange(startLine: number, startChar: number, endLine: number, endChar: number): Range {
  return {
    start: { line: startLine, character: startChar },
    end: { line: endLine, character: endChar },
  };
}

// ============================================================================
// Symbol Extraction Helpers
// ============================================================================

/**
 * Extract the word under the cursor from a line of text.
 */
export function getWordAtPosition(line: string, character: number): string | null {
  if (character < 0 || character > line.length) return null;

  // Expand left and right until non-word character
  let start = character;
  let end = character;

  while (start > 0 && isWordChar(line[start - 1]!)) start--;
  while (end < line.length && isWordChar(line[end]!)) end++;

  if (start === end) return null;
  return line.slice(start, end);
}

function isWordChar(ch: string): boolean {
  return /[a-zA-Z0-9_-]/.test(ch);
}

/**
 * Find all section names and their line numbers in a document.
 */
export function findSections(text: string): Array<{ name: string; line: number; level: number; range: Range }> {
  const sections: Array<{ name: string; line: number; level: number; range: Range }> = [];
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i]!.match(/^(#{1,6})\s+(.+)/);
    if (match) {
      const level = match[1]!.length;
      const name = match[2]!.trim();
      sections.push({
        name,
        line: i,
        level,
        range: createRange(i, 0, i, lines[i]!.length),
      });
    }
  }

  return sections;
}

/**
 * Find all V2 module declarations in a document.
 */
export function findModuleDeclarations(text: string): Array<{ type: string; name: string; line: number; range: Range }> {
  const declarations: Array<{ type: string; name: string; line: number; range: Range }> = [];
  const lines = text.split('\n');
  const pattern = /^(module|agent|tool|memory|workflow|team|policy|system|service|component|resource|interface|contract|plugin|extension|runtime|package|repository|documentation)\s+(\S+)/;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i]!.trim().match(pattern);
    if (match) {
      declarations.push({
        type: match[1]!,
        name: match[2]!,
        line: i,
        range: createRange(i, 0, i, lines[i]!.length),
      });
    }
  }

  return declarations;
}

/**
 * Find all code block positions in a document.
 */
export function findCodeBlocks(text: string): Array<{ language: string; line: number; range: Range }> {
  const blocks: Array<{ language: string; line: number; range: Range }> = [];
  const lines = text.split('\n');
  const fencePattern = /^```(\w*)/;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i]!.trim().match(fencePattern);
    if (match) {
      const language = match[1] || 'unknown';
      // Find closing fence
      let endLine = i;
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j]!.trim().startsWith('```')) {
          endLine = j;
          break;
        }
      }
      blocks.push({
        language,
        line: i,
        range: createRange(i, 0, endLine, lines[endLine]!.length),
      });
    }
  }

  return blocks;
}

/**
 * Find all variable references (key: value patterns in YAML-like content).
 */
export function findVariableReferences(text: string): Array<{ key: string; line: number; range: Range }> {
  const refs: Array<{ key: string; line: number; range: Range }> = [];
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i]!.match(/^(\s*)(\w[\w-]*):/);
    if (match) {
      refs.push({
        key: match[2]!,
        line: i,
        range: createRange(i, match[1]!.length, i, match[1]!.length + match[2]!.length),
      });
    }
  }

  return refs;
}
