/**
 * MAM Completion Provider
 *
 * Context-aware completions for V1 sections, V2 module types,
 * YAML front-matter, code block languages, markdown syntax,
 * and snippet templates.
 */

import {
  CompletionItem,
  CompletionItemKind,
  InsertTextFormat,
} from 'vscode-languageserver-protocol';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { MAMModule } from '@mam/parser';
import {
  V1_SECTIONS,
  V2_MODULE_TYPES,
  V2_SECTIONS,
  YAML_KEYS,
  LANGUAGES,
  MEMORY_FORMATS,
  MEMORY_BACKENDS,
  SCOPE_TYPES,
  PERMISSION_KEYS,
  PERMISSION_VALUES,
  SECTION_DOCS,
  V2_SECTION_DOCS,
  MODULE_TYPE_DOCS,
  VALID_RUNTIMES,
} from '../protocol/mam';

/**
 * Get completion items for the given position.
 */
export function getCompletions(
  uri: string,
  position: { line: number; character: number },
  document: TextDocument,
  ast: MAMModule | null,
): CompletionItem[] {
  const text = document.getText();
  const lines = text.split('\n');
  const line = lines[position.line] || '';

  const items: CompletionItem[] = [];

  // 1. V2 module type completions (after module/agent/tool/etc. keyword)
  if (isAfterModuleKeyword(line)) {
    return getSectionKeywordCompletions();
  }

  // 2. V2 section keyword completions (inside a module block)
  if (isInSectionContext(line, lines, position.line)) {
    items.push(...getSectionKeywordCompletions());
  }

  // 3. V1 section heading completions (## prefix)
  if (isAtSectionHeading(line)) {
    items.push(...getV1SectionCompletions());
  }

  // 4. Type value completions
  if (line.trim().startsWith('type:') || line.trim() === 'type') {
    items.push(...getModuleTypeCompletions());
    return items;
  }

  // 5. Format value completions
  if (line.trim().startsWith('format:')) {
    items.push(...getFormatCompletions());
    return items;
  }

  // 6. Backend value completions
  if (line.trim().startsWith('backend:')) {
    items.push(...getBackendCompletions());
    return items;
  }

  // 7. Scope value completions
  if (line.trim().startsWith('scope:')) {
    items.push(...getScopeCompletions());
    return items;
  }

  // 8. Runtime value completions
  if (line.trim().startsWith('runtime:')) {
    items.push(...getRuntimeCompletions());
    return items;
  }

  // 9. Permission completions
  if (isInPermissionContext(line)) {
    items.push(...getPermissionCompletions(line));
    return items;
  }

  // 10. Language identifier completions (after ```)
  if (line.trim().startsWith('```')) {
    items.push(...getLanguageCompletions());
    return items;
  }

  // 11. YAML key completions (in front-matter)
  if (isInFrontMatter(lines, position.line)) {
    items.push(...getYAMLKeyCompletions());
  }

  // 12. Markdown inline completions
  items.push(...getMarkdownInlineCompletions(line, position.character));

  // 13. Edge arrow completions
  if (line.includes('-') && !line.includes('->')) {
    items.push(getEdgeArrowCompletion());
  }

  // 14. Default completions (module keywords and section snippets)
  if (items.length === 0) {
    items.push(...getDefaultCompletions());
  }

  return items;
}

// ============================================================================
// Context Detection
// ============================================================================

function isAfterModuleKeyword(line: string): boolean {
  const trimmed = line.trim();
  return /^(module|agent|tool|memory|workflow|team|policy|system|service|component|resource|interface|contract|plugin|extension|runtime|package|repository|documentation)\s+\S+$/.test(trimmed);
}

function isAtSectionHeading(line: string): boolean {
  return /^\s*##\s*$/.test(line) || /^\s*##\s+\w*$/.test(line);
}

function isInSectionContext(line: string, lines: string[], currentLine: number): boolean {
  const trimmed = line.trim();
  // If we're indented or in a section body
  if (trimmed === '' && currentLine > 0) {
    // Look back for a section heading
    for (let i = currentLine - 1; i >= Math.max(0, currentLine - 5); i--) {
      if (lines[i]!.match(/^#{1,6}\s+/)) return true;
    }
  }
  return false;
}

function isInFrontMatter(lines: string[], currentLine: number): boolean {
  let inFrontMatter = false;
  let separatorCount = 0;

  for (let i = 0; i <= currentLine; i++) {
    if (lines[i]!.trim() === '---') {
      separatorCount++;
      if (separatorCount === 1) inFrontMatter = true;
      if (separatorCount === 2) inFrontMatter = false;
    }
  }

  return inFrontMatter || separatorCount === 0;
}

function isInPermissionContext(line: string): boolean {
  const trimmed = line.trim().toLowerCase();
  return trimmed.startsWith('permissions:') ||
    trimmed.startsWith('filesystem:') ||
    trimmed.startsWith('network:') ||
    trimmed.startsWith('python:') ||
    trimmed.startsWith('memory:') ||
    trimmed.startsWith('exec:');
}

// ============================================================================
// Completion Generators
// ============================================================================

function getV1SectionCompletions(): CompletionItem[] {
  return V1_SECTIONS.map((name, idx) => ({
    label: name,
    kind: CompletionItemKind.Class,
    detail: 'MAM Section',
    documentation: { kind: 1 as any, value: SECTION_DOCS[name] || '' },
    insertText: `${name}\n\n`,
    sortText: `a${String(idx).padStart(3, '0')}`,
  }));
}

function getSectionKeywordCompletions(): CompletionItem[] {
  return V2_SECTIONS.map((name, idx) => ({
    label: name,
    kind: CompletionItemKind.Property,
    detail: 'Section Keyword',
    documentation: { kind: 1 as any, value: V2_SECTION_DOCS[name] || '' },
    insertText: `${name}: `,
    sortText: `a${String(idx).padStart(3, '0')}`,
  }));
}

function getModuleTypeCompletions(): CompletionItem[] {
  return V2_MODULE_TYPES.map((type, idx) => ({
    label: type,
    kind: CompletionItemKind.Enum,
    detail: 'Module Type',
    documentation: { kind: 1 as any, value: MODULE_TYPE_DOCS[type] || '' },
    sortText: `a${String(idx).padStart(3, '0')}`,
  }));
}

function getFormatCompletions(): CompletionItem[] {
  return MEMORY_FORMATS.map((format, idx) => ({
    label: format,
    kind: CompletionItemKind.Enum,
    detail: 'Memory Format',
    sortText: `a${String(idx).padStart(3, '0')}`,
  }));
}

function getBackendCompletions(): CompletionItem[] {
  return MEMORY_BACKENDS.map((backend, idx) => ({
    label: backend,
    kind: CompletionItemKind.Enum,
    detail: 'Memory Backend',
    sortText: `a${String(idx).padStart(3, '0')}`,
  }));
}

function getScopeCompletions(): CompletionItem[] {
  return SCOPE_TYPES.map((scope, idx) => ({
    label: scope,
    kind: CompletionItemKind.Enum,
    detail: 'Scope',
    sortText: `a${String(idx).padStart(3, '0')}`,
  }));
}

function getRuntimeCompletions(): CompletionItem[] {
  return VALID_RUNTIMES.map((runtime, idx) => ({
    label: runtime,
    kind: CompletionItemKind.Enum,
    detail: 'Runtime',
    sortText: `a${String(idx).padStart(3, '0')}`,
  }));
}

function getPermissionCompletions(line: string): CompletionItem[] {
  const items: CompletionItem[] = [];
  const trimmed = line.trim().toLowerCase();

  // Add permission keys
  for (const key of PERMISSION_KEYS) {
    items.push({
      label: key,
      kind: CompletionItemKind.Property,
      detail: 'Permission Key',
      sortText: `a${key}`,
    });
  }

  // Add permission values for the specific key
  for (const [key, values] of Object.entries(PERMISSION_VALUES)) {
    if (trimmed.includes(key)) {
      for (const value of values) {
        items.push({
          label: value,
          kind: CompletionItemKind.Enum,
          detail: `${key} value`,
          sortText: `b${value}`,
        });
      }
    }
  }

  return items;
}

function getLanguageCompletions(): CompletionItem[] {
  return LANGUAGES.map((lang, idx) => ({
    label: lang,
    kind: CompletionItemKind.Enum,
    detail: 'Language',
    sortText: `a${String(idx).padStart(3, '0')}`,
  }));
}

function getYAMLKeyCompletions(): CompletionItem[] {
  return YAML_KEYS.map((key, idx) => ({
    label: key,
    kind: CompletionItemKind.Property,
    detail: 'YAML Key',
    sortText: `a${String(idx).padStart(3, '0')}`,
  }));
}

function getMarkdownInlineCompletions(line: string, character: number): CompletionItem[] {
  const items: CompletionItem[] = [];
  const beforeCursor = line.slice(0, character);

  // Bold: **
  if (beforeCursor.endsWith('**')) {
    items.push({
      label: '**bold**',
      kind: CompletionItemKind.Snippet,
      detail: 'Bold text',
      insertText: '${1:bold}**',
      insertTextFormat: InsertTextFormat.Snippet,
    });
  }

  // Italic: *
  if (beforeCursor.endsWith('*') && !beforeCursor.endsWith('**')) {
    items.push({
      label: '*italic*',
      kind: CompletionItemKind.Snippet,
      detail: 'Italic text',
      insertText: '${1:italic}*',
      insertTextFormat: InsertTextFormat.Snippet,
    });
  }

  // Code: `
  if (beforeCursor.endsWith('`')) {
    items.push({
      label: '`code`',
      kind: CompletionItemKind.Snippet,
      detail: 'Inline code',
      insertText: '${1:code}`',
      insertTextFormat: InsertTextFormat.Snippet,
    });
  }

  // Link: [
  if (beforeCursor.endsWith('[')) {
    items.push({
      label: '[text](url)',
      kind: CompletionItemKind.Snippet,
      detail: 'Markdown link',
      insertText: '${1:text}](${2:url})',
      insertTextFormat: InsertTextFormat.Snippet,
    });
  }

  // Image: ![
  if (beforeCursor.endsWith('![')) {
    items.push({
      label: '![alt](url)',
      kind: CompletionItemKind.Snippet,
      detail: 'Image',
      insertText: '${1:alt}](${2:url})',
      insertTextFormat: InsertTextFormat.Snippet,
    });
  }

  // Code block: ``` (not inside a code block)
  if (beforeCursor.endsWith('```')) {
    items.push({
      label: '```lang',
      kind: CompletionItemKind.Snippet,
      detail: 'Code block',
      insertText: '${1:python}\n${2:code}\n```',
      insertTextFormat: InsertTextFormat.Snippet,
    });
  }

  return items;
}

function getEdgeArrowCompletion(): CompletionItem {
  return {
    label: '->',
    kind: CompletionItemKind.Operator,
    detail: 'Edge arrow',
    insertText: ' -> ',
  };
}

function getDefaultCompletions(): CompletionItem[] {
  const items: CompletionItem[] = [];

  // Module declarations
  const moduleKeywords = ['module', 'agent', 'tool', 'memory', 'workflow', 'team', 'policy', 'system'];
  for (const keyword of moduleKeywords) {
    items.push({
      label: keyword,
      kind: CompletionItemKind.Keyword,
      detail: 'Module declaration',
      insertText: `${keyword} `,
      sortText: `a${keyword}`,
    });
  }

  // V1 section snippets
  for (const name of V1_SECTIONS) {
    items.push({
      label: `## ${name}`,
      kind: CompletionItemKind.Snippet,
      detail: 'MAM Section',
      insertText: `## ${name}\n\n${name === 'Purpose' ? 'Describe module purpose.\n\n' : ''}`,
      sortText: `b${name}`,
    });
  }

  // Common snippet templates
  items.push({
    label: '---frontmatter---',
    kind: CompletionItemKind.Snippet,
    detail: 'Front matter template',
    insertText: '---\nid: ${1:module-name}\nversion: ${2:1.0.0}\nname: ${3:Module Name}\nauthor: ${4:author}\nruntime: ${5:python}\n---\n',
    insertTextFormat: InsertTextFormat.Snippet,
    sortText: 'c0',
  });

  items.push({
    label: '##agent-block',
    kind: CompletionItemKind.Snippet,
    detail: 'Agent module template',
    insertText: '---\nid: ${1:agent-name}\nversion: ${2:1.0.0}\nname: ${3:Agent Name}\nauthor: ${4:author}\nruntime: ${5:python}\n---\n\n## Purpose\n\n${6:Agent purpose}\n\n## Inputs\n\n| Name | Type | Required | Description |\n|------|------|----------|-------------|\n| ${7:input} | ${8:string} | ${9:true} | ${10:description} |\n\n## Outputs\n\n| Name | Type | Description |\n|------|------|-------------|\n| ${11:output} | ${12:string} | ${13:description} |\n',
    insertTextFormat: InsertTextFormat.Snippet,
    sortText: 'c1',
  });

  return items;
}
