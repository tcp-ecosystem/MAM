/**
 * MAM Code Actions Provider
 *
 * Quick fixes, refactoring actions, and source actions for MAM documents.
 */

import {
  CodeAction,
  CodeActionKind,
  Diagnostic,
  Range,
  TextEdit,
} from 'vscode-languageserver-protocol';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { MAMModule } from '@mam/parser';
import {
  createCodeAction,
  createRange,
  findSections,
  findCodeBlocks,
  V1_SECTIONS,
  VALID_RUNTIMES,
} from '../protocol/mam';

/**
 * Get code actions for the given range and context.
 */
export function getCodeActions(
  document: TextDocument,
  range: Range,
  context: { diagnostics: Diagnostic[] },
  ast: MAMModule | null,
): CodeAction[] {
  const uri = document.uri;
  const text = document.getText();
  const actions: CodeAction[] = [];

  // 1. Quick fixes for diagnostics
  actions.push(...getQuickFixes(uri, text, range, context.diagnostics));

  // 2. Refactoring actions
  actions.push(...getRefactorActions(uri, text, range));

  // 3. Source actions
  actions.push(...getSourceActions(uri, text, range));

  return actions;
}

// ============================================================================
// Quick Fix Actions
// ============================================================================

function getQuickFixes(
  uri: string,
  text: string,
  range: Range,
  diagnostics: Diagnostic[],
): CodeAction[] {
  const actions: CodeAction[] = [];

  for (const diagnostic of diagnostics) {
    const code = String(diagnostic.code || '');
    const message = typeof diagnostic.message === 'string' ? diagnostic.message : '';

    switch (code) {
      case 'MISSING_REQUIRED_SECTION':
        actions.push(createAddSectionAction(uri, diagnostic, 'Purpose', '## Purpose\n\nDescribe module purpose.\n\n'));
        break;

      case 'MISSING_FRONTMATTER_FIELD': {
        const fieldMatch = message.match(/Missing required frontmatter field: "(\w+)"/);
        if (fieldMatch) {
          actions.push(createAddFrontmatterFieldAction(uri, diagnostic, fieldMatch[1]!));
        }
        break;
      }

      case 'INVALID_RUNTIME': {
        const runtimeMatch = message.match(/Invalid runtime: "(\w+)"/);
        if (runtimeMatch) {
          actions.push(createFixRuntimeAction(uri, diagnostic, runtimeMatch[1]!));
        }
        break;
      }

      case 'EMPTY_SECTION':
        actions.push(createAddContentAction(uri, diagnostic));
        break;

      case 'MISSING_LANGUAGE':
        actions.push(createAddLanguageAction(uri, diagnostic));
        break;

      case 'TABLE_COLUMN_MISMATCH':
        actions.push(createFixTableAction(uri, text, diagnostic));
        break;

      case 'UNTERMINATED_FRONTMATTER':
        actions.push(createCloseFrontmatterAction(uri, diagnostic));
        break;

      case 'MISSING_FRONTMATTER':
        actions.push(createAddFrontmatterAction(uri, diagnostic));
        break;
    }
  }

  return actions;
}

function createAddSectionAction(
  uri: string,
  diagnostic: Diagnostic,
  sectionName: string,
  content: string,
): CodeAction {
  const range: Range = {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 0 },
  };

  return createCodeAction(
    `Add "${sectionName}" section`,
    uri,
    range,
    content,
    CodeActionKind.QuickFix,
    [diagnostic],
  );
}

function createAddFrontmatterFieldAction(
  uri: string,
  diagnostic: Diagnostic,
  field: string,
): CodeAction {
  const range: Range = {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 0 },
  };

  const examples: Record<string, string> = {
    id: 'id: module-name',
    version: 'version: 1.0.0',
    name: 'name: Module Name',
    author: 'author: Author Name',
    runtime: 'runtime: python',
  };

  return createCodeAction(
    `Add missing "${field}" field`,
    uri,
    range,
    `${examples[field] || field + ': '}\n`,
    CodeActionKind.QuickFix,
    [diagnostic],
  );
}

function createFixRuntimeAction(
  uri: string,
  diagnostic: Diagnostic,
  currentRuntime: string,
): CodeAction {
  const range = diagnostic.range;
  const suggestion = findClosestRuntime(currentRuntime);

  return createCodeAction(
    `Fix runtime: change to "${suggestion}"`,
    uri,
    range,
    suggestion,
    CodeActionKind.QuickFix,
    [diagnostic],
  );
}

function findClosestRuntime(input: string): string {
  const lower = input.toLowerCase();
  const best = VALID_RUNTIMES.find(r => r.toLowerCase() === lower) ||
    VALID_RUNTIMES.find(r => r.toLowerCase().startsWith(lower[0]!)) ||
    'python';
  return best;
}

function createAddContentAction(
  uri: string,
  diagnostic: Diagnostic,
): CodeAction {
  return createCodeAction(
    'Add placeholder content',
    uri,
    diagnostic.range,
    '\n*Content to be added.*\n',
    CodeActionKind.QuickFix,
    [diagnostic],
  );
}

function createAddLanguageAction(
  uri: string,
  diagnostic: Diagnostic,
): CodeAction {
  return createCodeAction(
    'Add language identifier (python)',
    uri,
    diagnostic.range,
    'python',
    CodeActionKind.QuickFix,
    [diagnostic],
  );
}

function createFixTableAction(
  uri: string,
  text: string,
  diagnostic: Diagnostic,
): CodeAction {
  return createCodeAction(
    'Fix table column count',
    uri,
    diagnostic.range,
    '',
    CodeActionKind.QuickFix,
    [diagnostic],
  );
}

function createCloseFrontmatterAction(
  uri: string,
  diagnostic: Diagnostic,
): CodeAction {
  return createCodeAction(
    'Close frontmatter with ---',
    uri,
    diagnostic.range,
    '\n---\n',
    CodeActionKind.QuickFix,
    [diagnostic],
  );
}

function createAddFrontmatterAction(
  uri: string,
  diagnostic: Diagnostic,
): CodeAction {
  const range: Range = {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 0 },
  };

  return createCodeAction(
    'Add frontmatter template',
    uri,
    range,
    '---\nid: module-name\nversion: 1.0.0\nname: Module Name\nauthor: Author\nruntime: python\n---\n\n',
    CodeActionKind.QuickFix,
    [diagnostic],
  );
}

// ============================================================================
// Refactoring Actions
// ============================================================================

function getRefactorActions(
  uri: string,
  text: string,
  range: Range,
): CodeAction[] {
  const actions: CodeAction[] = [];

  // Extract code block to separate file
  const blocks = findCodeBlocks(text);
  for (const block of blocks) {
    if (block.range.start.line >= range.start.line && block.range.start.line <= range.end.line) {
      actions.push(createExtractCodeBlockAction(uri, block));
    }
  }

  return actions;
}

function createExtractCodeBlockAction(
  uri: string,
  block: { language: string; line: number; range: Range },
): CodeAction {
  return {
    title: `Extract ${block.language} code block`,
    kind: CodeActionKind.RefactorExtract as any,
    edit: {
      changes: {
        [uri]: [{
          range: block.range,
          newText: `See: ./extracted-${block.language}-${block.line + 1}.${block.language === 'python' ? 'py' : block.language === 'javascript' ? 'js' : block.language === 'typescript' ? 'ts' : block.language}`,
        }],
      },
    },
  };
}

// ============================================================================
// Source Actions
// ============================================================================

function getSourceActions(
  uri: string,
  text: string,
  range: Range,
): CodeAction[] {
  const actions: CodeAction[] = [];

  // Organize sections
  actions.push({
    title: 'Organize sections by recommended order',
    kind: CodeActionKind.SourceOrganizeImports as any,
    edit: {
      changes: {
        [uri]: getOrganizeEdits(text),
      },
    },
  });

  // Add missing sections
  actions.push({
    title: 'Add missing standard sections',
    kind: CodeActionKind.Source as any,
    edit: {
      changes: {
        [uri]: getAddMissingSectionsEdits(text),
      },
    },
  });

  return actions;
}

function getOrganizeEdits(text: string): TextEdit[] {
  const sections = findSections(text);
  if (sections.length === 0) return [];

  // Group sections by recommended order
  const ordered: typeof sections = [];
  const custom: typeof sections = [];

  for (const section of sections) {
    if (V1_SECTIONS.includes(section.name as any)) {
      ordered.push(section);
    } else {
      custom.push(section);
    }
  }

  // Sort by recommended order
  ordered.sort((a, b) => {
    const aIdx = V1_SECTIONS.indexOf(a.name as any);
    const bIdx = V1_SECTIONS.indexOf(b.name as any);
    return aIdx - bIdx;
  });

  // Build new content
  const lines = text.split('\n');
  const newSections = [...ordered, ...custom];

  // Simple approach: just return empty edits (full reorder is complex)
  // In production, you'd splice sections and rebuild
  return [];
}

function getAddMissingSectionsEdits(text: string): TextEdit[] {
  const sections = findSections(text);
  const existing = new Set(sections.map(s => s.name));

  const missing = V1_SECTIONS.filter(name => !existing.has(name));
  if (missing.length === 0) return [];

  // Add missing sections at the end
  const lastLine = text.split('\n').length;
  const additions = missing.map(name => `\n## ${name}\n\n`).join('');

  return [{
    range: {
      start: { line: lastLine, character: 0 },
      end: { line: lastLine, character: 0 },
    },
    newText: additions,
  }];
}
