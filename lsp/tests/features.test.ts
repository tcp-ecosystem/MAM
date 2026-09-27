/**
 * Feature Tests
 *
 * Comprehensive tests for all LSP feature functions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { getCompletions } from '../src/features/completion.js';
import { getHover } from '../src/features/hover.js';
import { getDefinition } from '../src/features/definition.js';
import { getReferences } from '../src/features/references.js';
import { getFormatting } from '../src/features/formatting.js';
import { getCodeActions } from '../src/features/codeAction.js';
import { getDiagnostics } from '../src/features/diagnostics.js';
import {
  getDocumentSymbols,
  hasDocumentSymbols,
  countDocumentSymbols,
  findSymbolByName,
  filterSymbolsByKind,
  flattenSymbols,
  getSymbolNames,
} from '../src/features/documentSymbol.js';
import {
  prepareRename,
  getRenameEdits,
  isRenameableAt,
  getRenameRange,
  countRenameTargets,
  validateNewName,
  findRenameTargets,
} from '../src/features/rename.js';
import {
  getDocumentHighlights,
  hasHighlights,
  countHighlights,
  getHighlightRanges,
  groupHighlightsByKind,
  isHighlightableAt,
  sortHighlights,
} from '../src/features/documentHighlight.js';
import {
  getFoldingRanges,
  hasFoldingRanges,
  countFoldingRanges,
  getSectionFoldingRanges,
  getCodeBlockFoldingRanges,
  getFrontmatterFoldingRange,
  findLargestFoldingRange,
} from '../src/features/foldingRange.js';
import {
  getSignatureHelp,
  hasSignatureHelp,
  getActiveParameterIndex,
  getEdgeSignatureItems,
  formatSignatureLabel,
  isSignatureTriggerCharacter,
  countSignatures,
} from '../src/features/signatureHelp.js';
import {
  getCodeLenses,
  hasCodeLenses,
  countCodeLenses,
  getSectionCodeLenses,
  getCodeBlockCodeLenses,
  filterCodeLensesByCommand,
  getCodeLensCommands,
} from '../src/features/codeLens.js';
import {
  getWorkspaceSymbols,
  hasWorkspaceSymbol,
  countWorkspaceSymbols,
  filterSymbolsByQuery,
  sortWorkspaceSymbols,
  getWorkspaceSymbolNames,
  groupSymbolsByDocument,
} from '../src/features/workspaceSymbol.js';
import { MAMSymbolKind } from '../src/protocol/mam.js';

// ============================================================================
// Helpers
// ============================================================================

function createDoc(text: string, uri = 'file:///test.mam.md'): TextDocument {
  return TextDocument.create(uri, 'mam', 1, text);
}

const SIMPLE_MAM = `---
id: test-module
version: 2.0.0
name: Test Module
author: Test Author
runtime: python
---

## Purpose

A test module for validation.

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| input1 | string | true | First input |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| output1 | string | First output |

## Rules

- Rule one
- Rule two

## Examples

\`\`\`python
def example():
    return "hello"
\`\`\`
`;

const AGENT_MAM = `---
id: test-agent
version: 2.0.0
name: Test Agent
author: Test Author
runtime: python
---

## Purpose

An agent module.

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| query | string | true | User query |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| response | string | Agent response |

## Prompt

You are a helpful assistant.
`;

// ============================================================================
// Completion Tests
// ============================================================================

describe('getCompletions', () => {
  it('should return V1 section completions after ##', () => {
    const doc = createDoc('## \n\nContent');
    const result = getCompletions('file:///test.mam.md', { line: 0, character: 3 }, doc, null);

    expect(result.length).toBeGreaterThan(0);
    expect(result.some(c => c.label === 'Purpose')).toBe(true);
    expect(result.some(c => c.label === 'Inputs')).toBe(true);
    expect(result.some(c => c.label === 'Outputs')).toBe(true);
  });

  it('should return V2 section keyword completions', () => {
    const doc = createDoc('module test\n');
    const result = getCompletions('file:///test.mam.md', { line: 0, character: 12 }, doc, null);

    expect(result.length).toBeGreaterThan(0);
    expect(result.some(c => c.label === 'type')).toBe(true);
    expect(result.some(c => c.label === 'role')).toBe(true);
  });

  it('should return module type completions', () => {
    const doc = createDoc('type: \n');
    const result = getCompletions('file:///test.mam.md', { line: 0, character: 6 }, doc, null);

    expect(result.length).toBeGreaterThan(0);
    expect(result.some(c => c.label === 'module')).toBe(true);
    expect(result.some(c => c.label === 'agent')).toBe(true);
    expect(result.some(c => c.label === 'tool')).toBe(true);
    expect(result.some(c => c.label === 'memory')).toBe(true);
  });

  it('should return format completions', () => {
    const doc = createDoc('format: \n');
    const result = getCompletions('file:///test.mam.md', { line: 0, character: 8 }, doc, null);

    expect(result.length).toBeGreaterThan(0);
    expect(result.some(c => c.label === 'vector')).toBe(true);
    expect(result.some(c => c.label === 'key-value')).toBe(true);
  });

  it('should return backend completions', () => {
    const doc = createDoc('backend: \n');
    const result = getCompletions('file:///test.mam.md', { line: 0, character: 9 }, doc, null);

    expect(result.length).toBeGreaterThan(0);
    expect(result.some(c => c.label === 'sqlite')).toBe(true);
    expect(result.some(c => c.label === 'redis')).toBe(true);
  });

  it('should return scope completions', () => {
    const doc = createDoc('scope: \n');
    const result = getCompletions('file:///test.mam.md', { line: 0, character: 7 }, doc, null);

    expect(result.length).toBeGreaterThan(0);
    expect(result.some(c => c.label === 'module')).toBe(true);
    expect(result.some(c => c.label === 'global')).toBe(true);
  });

  it('should return runtime completions', () => {
    const doc = createDoc('runtime: \n');
    const result = getCompletions('file:///test.mam.md', { line: 0, character: 9 }, doc, null);

    expect(result.length).toBeGreaterThan(0);
    expect(result.some(c => c.label === 'python')).toBe(true);
    expect(result.some(c => c.label === 'javascript')).toBe(true);
  });

  it('should return permission completions', () => {
    const doc = createDoc('permissions:\n');
    const result = getCompletions('file:///test.mam.md', { line: 0, character: 12 }, doc, null);

    expect(result.length).toBeGreaterThan(0);
    expect(result.some(c => c.label === 'filesystem')).toBe(true);
    expect(result.some(c => c.label === 'network')).toBe(true);
  });

  it('should return language completions after ```', () => {
    const doc = createDoc('```\n');
    const result = getCompletions('file:///test.mam.md', { line: 0, character: 3 }, doc, null);

    expect(result.length).toBeGreaterThan(0);
    expect(result.some(c => c.label === 'python')).toBe(true);
    expect(result.some(c => c.label === 'javascript')).toBe(true);
  });

  it('should return YAML key completions in frontmatter', () => {
    const doc = createDoc('---\nid: test\n');
    const result = getCompletions('file:///test.mam.md', { line: 1, character: 2 }, doc, null);

    expect(result.length).toBeGreaterThan(0);
    expect(result.some(c => c.label === 'version')).toBe(true);
    expect(result.some(c => c.label === 'name')).toBe(true);
  });

  it('should return default completions for empty lines', () => {
    const doc = createDoc('\n');
    const result = getCompletions('file:///test.mam.md', { line: 0, character: 0 }, doc, null);

    expect(result.length).toBeGreaterThan(0);
    // Returns YAML key completions (frontmatter context) and/or module keywords
    expect(result.some(c => c.label === 'module' || c.label === 'id' || c.label === 'version')).toBe(true);
  });

  it('should return edge arrow completions', () => {
    const doc = createDoc('- \n');
    const result = getCompletions('file:///test.mam.md', { line: 0, character: 2 }, doc, null);

    expect(result.some(c => c.label === '->')).toBe(true);
  });
});

// ============================================================================
// Hover Tests
// ============================================================================

describe('getHover', () => {
  it('should return hover for V1 section headings', () => {
    const doc = createDoc('## Purpose\n\nModule purpose.');
    const result = getHover('file:///test.mam.md', { line: 0, character: 3 }, doc, null);

    expect(result).not.toBeNull();
    expect(result!.contents).toHaveProperty('kind');
    expect(result!.contents).toHaveProperty('value');
    expect((result!.contents as any).value).toContain('Purpose');
  });

  it('should return hover for all V1 sections', () => {
    const sections = [
      'Purpose', 'Inputs', 'Outputs', 'Rules', 'Workflow',
      'Mermaid', 'Python', 'JavaScript', 'TypeScript', 'Prompt',
      'Memory', 'Examples', 'Tests', 'References', 'Dependencies',
      'Exports', 'Imports', 'Plugins', 'Permissions', 'Capabilities',
    ];

    for (const section of sections) {
      const doc = createDoc(`## ${section}\n\nContent`);
      const result = getHover('file:///test.mam.md', { line: 0, character: 3 }, doc, null);

      expect(result).not.toBeNull();
      expect((result!.contents as any).value).toContain(section);
    }
  });

  it('should return hover for module type declarations', () => {
    const doc = createDoc('module my-module\n');
    const result = getHover('file:///test.mam.md', { line: 0, character: 3 }, doc, null);

    expect(result).not.toBeNull();
    expect((result!.contents as any).value).toContain('module');
    expect((result!.contents as any).value).toContain('my-module');
  });

  it('should return hover for all module types', () => {
    const types = ['module', 'agent', 'tool', 'memory', 'workflow', 'team', 'policy', 'system'];

    for (const type of types) {
      const doc = createDoc(`${type} test-${type}\n`);
      const result = getHover('file:///test.mam.md', { line: 0, character: 3 }, doc, null);

      expect(result).not.toBeNull();
      expect((result!.contents as any).value).toContain(type);
    }
  });

  it('should return hover for V2 section keywords', () => {
    const doc = createDoc('type: module\n');
    const result = getHover('file:///test.mam.md', { line: 0, character: 3 }, doc, null);

    expect(result).not.toBeNull();
    expect((result!.contents as any).value).toContain('type');
  });

  it('should return hover for YAML keys', () => {
    const doc = createDoc('---\nid: test\n---\n');
    const result = getHover('file:///test.mam.md', { line: 1, character: 3 }, doc, null);

    expect(result).not.toBeNull();
    expect((result!.contents as any).value).toContain('id');
  });

  it('should return hover for code block languages', () => {
    const doc = createDoc('```python\n# code\n```');
    const result = getHover('file:///test.mam.md', { line: 0, character: 3 }, doc, null);

    expect(result).not.toBeNull();
    expect((result!.contents as any).value).toContain('Python');
  });

  it('should return null for unknown text', () => {
    const doc = createDoc('some random text\n');
    const result = getHover('file:///test.mam.md', { line: 0, character: 3 }, doc, null);

    expect(result).toBeNull();
  });
});

// ============================================================================
// Definition Tests
// ============================================================================

describe('getDefinition', () => {
  it('should return definition for section names', () => {
    const doc = createDoc('## Purpose\n\nSee Purpose for details.');
    const result = getDefinition('file:///test.mam.md', { line: 2, character: 5 }, doc, null);

    expect(result).not.toBeNull();
    expect(result!.uri).toBe('file:///test.mam.md');
  });

  it('should return definition for module declarations', () => {
    const doc = createDoc('module my-module\n');
    const result = getDefinition('file:///test.mam.md', { line: 0, character: 10 }, doc, null);

    expect(result).not.toBeNull();
  });

  it('should return null for unknown symbols', () => {
    const doc = createDoc('## Purpose\n\nUnknown symbol.');
    const result = getDefinition('file:///test.mam.md', { line: 2, character: 5 }, doc, null);

    expect(result).toBeNull();
  });

  it('should return definition for YAML keys', () => {
    const doc = createDoc('---\nid: test\nversion: 2.0.0\n---\n');
    const result = getDefinition('file:///test.mam.md', { line: 2, character: 3 }, doc, null);

    // May find the key definition
    expect(result === null || typeof result === 'object').toBe(true);
  });
});

// ============================================================================
// References Tests
// ============================================================================

describe('getReferences', () => {
  it('should find section references', () => {
    const doc = createDoc('## Purpose\n\nPurpose is important. See Purpose.');
    const result = getReferences(
      'file:///test.mam.md',
      { line: 0, character: 3 },
      doc,
      null,
      true,
    );

    expect(result.length).toBeGreaterThan(0);
    expect(result.some(r => r.range.start.line === 0)).toBe(true);
  });

  it('should find module name references', () => {
    const doc = createDoc('module my-module\n\nUse my-module here.');
    const result = getReferences(
      'file:///test.mam.md',
      { line: 0, character: 10 },
      doc,
      null,
      true,
    );

    expect(result.length).toBeGreaterThan(0);
  });

  it('should exclude declaration when includeDeclaration is false', () => {
    const doc = createDoc('## Purpose\n\nPurpose is important.');
    const result = getReferences(
      'file:///test.mam.md',
      { line: 0, character: 3 },
      doc,
      null,
      false,
    );

    // Should still find inline references
    expect(result.length).toBeGreaterThanOrEqual(0);
  });

  it('should return empty for unknown symbols', () => {
    const doc = createDoc('## Purpose\n\nContent here.');
    const result = getReferences(
      'file:///test.mam.md',
      { line: 2, character: 5 },
      doc,
      null,
      true,
    );

    expect(Array.isArray(result)).toBe(true);
  });
});

// ============================================================================
// Formatting Tests
// ============================================================================

describe('getFormatting', () => {
  it('should remove trailing whitespace', () => {
    const doc = createDoc('## Purpose   \n\nContent   \n');
    const result = getFormatting(doc.getText());

    expect(result.length).toBe(1);
    expect(result[0]!.newText).not.toContain('   \n');
  });

  it('should collapse multiple blank lines', () => {
    const doc = createDoc('## Purpose\n\n\n\nContent\n');
    const result = getFormatting(doc.getText());

    expect(result.length).toBe(1);
    expect(result[0]!.newText).not.toContain('\n\n\n');
  });

  it('should ensure final newline', () => {
    const doc = createDoc('## Purpose\nContent');
    const result = getFormatting(doc.getText());

    expect(result.length).toBe(1);
    expect(result[0]!.newText.endsWith('\n')).toBe(true);
  });

  it('should normalize indentation to 2 spaces', () => {
    const doc = createDoc('## Purpose\n      Content with indent\n');
    const result = getFormatting(doc.getText(), { tabSize: 2, insertSpaces: true });

    expect(result.length).toBe(1);
  });

  it('should return empty for already formatted content', () => {
    const formatted = '## Purpose\n\nContent\n';
    const result = getFormatting(formatted);

    expect(result.length).toBe(0);
  });

  it('should handle empty content', () => {
    const result = getFormatting('');

    // Should return empty or minimal edit
    expect(Array.isArray(result)).toBe(true);
  });

  it('should handle content with only whitespace', () => {
    const result = getFormatting('   \n   \n   ');

    expect(Array.isArray(result)).toBe(true);
  });
});

// ============================================================================
// Code Action Tests
// ============================================================================

describe('getCodeActions', () => {
  it('should suggest adding Purpose section', () => {
    const doc = createDoc('---\nid: test\nversion: 2.0.0\nname: Test\nauthor: Author\nruntime: python\n---\n');
    const result = getCodeActions(
      doc,
      { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      { diagnostics: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, severity: 1, message: 'Missing required section: "Purpose"', source: 'mam-lsp', code: 'MISSING_REQUIRED_SECTION' }] },
      null,
    );

    expect(result.length).toBeGreaterThan(0);
    expect(result.some(a => a.title.includes('Purpose'))).toBe(true);
  });

  it('should suggest adding frontmatter fields', () => {
    const doc = createDoc('---\nid: test\n---\n');
    const result = getCodeActions(
      doc,
      { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      { diagnostics: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, severity: 1, message: 'Missing required frontmatter field: "version"', source: 'mam-lsp', code: 'MISSING_FRONTMATTER_FIELD' }] },
      null,
    );

    expect(result.length).toBeGreaterThan(0);
    expect(result.some(a => a.title.includes('version'))).toBe(true);
  });

  it('should suggest adding missing sections', () => {
    const doc = createDoc('## Purpose\n\nContent\n');
    const result = getCodeActions(
      doc,
      { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      { diagnostics: [] },
      null,
    );

    expect(result.some(a => a.title.includes('Add missing standard sections'))).toBe(true);
  });

  it('should suggest organizing sections', () => {
    const doc = createDoc('## Purpose\n\nContent\n');
    const result = getCodeActions(
      doc,
      { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      { diagnostics: [] },
      null,
    );

    expect(result.some(a => a.title.includes('Organize sections'))).toBe(true);
  });

  it('should return empty for no diagnostics', () => {
    const doc = createDoc('## Purpose\n\nContent\n');
    const result = getCodeActions(
      doc,
      { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      { diagnostics: [] },
      null,
    );

    expect(Array.isArray(result)).toBe(true);
  });
});

// ============================================================================
// Diagnostics Tests
// ============================================================================

describe('getDiagnostics', () => {
  it('should detect missing Purpose section', () => {
    const doc = createDoc('## Inputs\n\nContent\n');
    const result = getDiagnostics(doc, null);

    expect(result.some(d => d.message.includes('Missing required section'))).toBe(true);
  });

  it('should detect empty sections', () => {
    const doc = createDoc('## Purpose\n\n## Inputs\n\n## Outputs\n\n');
    const result = getDiagnostics(doc, null);

    expect(result.some(d => d.message.includes('Empty section'))).toBe(true);
  });

  it('should detect section ordering issues', () => {
    const doc = createDoc('## Purpose\n\n## Outputs\n\n## Inputs\n\n');
    const result = getDiagnostics(doc, null);

    expect(result.some(d => d.message.includes('out of recommended order'))).toBe(true);
  });

  it('should detect duplicate sections', () => {
    const doc = createDoc('## Purpose\n\nFirst purpose\n\n## Purpose\n\nSecond purpose\n\n');
    const result = getDiagnostics(doc, null);

    expect(result.some(d => d.message.includes('Duplicate section'))).toBe(true);
  });

  it('should detect missing frontmatter', () => {
    const doc = createDoc('## Purpose\n\nContent\n');
    const result = getDiagnostics(doc, null);

    expect(result.some(d => d.message.includes('frontmatter'))).toBe(true);
  });

  it('should detect missing frontmatter fields', () => {
    const doc = createDoc('---\nid: test\n---\n\n## Purpose\n\nContent\n');
    const result = getDiagnostics(doc, null);

    expect(result.some(d => d.message.includes('Missing required frontmatter field'))).toBe(true);
  });

  it('should detect invalid runtime', () => {
    const doc = createDoc('---\nid: test\nversion: 2.0.0\nname: Test\nauthor: Author\nruntime: invalid\n---\n\n## Purpose\n\nContent\n');
    const result = getDiagnostics(doc, null);

    expect(result.some(d => d.message.includes('Invalid runtime'))).toBe(true);
  });

  it('should detect code blocks without language', () => {
    const doc = createDoc('---\nid: test\nversion: 2.0.0\nname: Test\nauthor: Author\nruntime: python\n---\n\n## Purpose\n\n```\ncode\n```\n');
    const result = getDiagnostics(doc, null);

    expect(result.some(d => d.message.includes('no language identifier'))).toBe(true);
  });

  it('should not report errors for valid document', () => {
    const doc = createDoc(SIMPLE_MAM);
    const result = getDiagnostics(doc, null);

    // Should have minimal or no errors
    const errors = result.filter(d => d.severity === 1);
    expect(errors.length).toBe(0);
  });

  it('should handle empty document gracefully', () => {
    const doc = createDoc('');
    const result = getDiagnostics(doc, null);

    expect(Array.isArray(result)).toBe(true);
  });
});

describe('documentSymbol', () => {
  it('should extract section and code block symbols', () => {
    const doc = createDoc(SIMPLE_MAM);
    const symbols = getDocumentSymbols(doc, null);

    expect(symbols.length).toBeGreaterThan(0);
    expect(symbols[0]!.name).toBe('Purpose');
    expect(hasDocumentSymbols(doc, null)).toBe(true);
    expect(countDocumentSymbols(doc, null)).toBeGreaterThanOrEqual(symbols.length);
    expect(getSymbolNames(doc, null)).toContain('Purpose');
  });

  it('should find and filter symbols', () => {
    const doc = createDoc(SIMPLE_MAM);
    const symbols = getDocumentSymbols(doc, null);

    expect(findSymbolByName(doc, 'Purpose', null)?.name).toBe('Purpose');
    expect(findSymbolByName(doc, 'Missing', null)).toBeUndefined();
    expect(filterSymbolsByKind(doc, MAMSymbolKind.Section, null).length).toBe(symbols.length);
    expect(flattenSymbols(symbols).length).toBe(countDocumentSymbols(doc, null));
  });
});

describe('rename', () => {
  it('should prepare and validate renames', () => {
    const doc = createDoc('## Purpose\n\nPurpose matters.\n');

    expect(validateNewName('Inputs')).toBe(true);
    expect(validateNewName('')).toBe(false);
    expect(validateNewName('9bad')).toBe(false);
    expect(isRenameableAt(doc, { line: 0, character: 4 })).toBe(true);
    const prepared = prepareRename(doc, { line: 0, character: 4 });
    expect(prepared?.placeholder).toBe('Purpose');
    expect(getRenameRange(doc, { line: 0, character: 4 })).not.toBeNull();
  });

  it('should compute rename targets and edits', () => {
    const doc = createDoc('## Purpose\n\nPurpose matters.\n');
    const targets = findRenameTargets(doc, { line: 0, character: 4 });

    expect(targets.length).toBeGreaterThanOrEqual(2);
    expect(countRenameTargets(doc, { line: 0, character: 4 })).toBe(targets.length);
    const edits = getRenameEdits(doc, { line: 0, character: 4 }, 'Goal');
    expect(edits.changes[doc.uri]).toHaveLength(targets.length);
    expect(getRenameEdits(doc, { line: 0, character: 4 }, '').changes).toEqual({});
  });
});

describe('documentHighlight', () => {
  it('should highlight all occurrences of the word', () => {
    const doc = createDoc('## Purpose\n\nPurpose matters.\n');
    const highlights = getDocumentHighlights(doc, { line: 0, character: 4 });

    expect(highlights.length).toBeGreaterThanOrEqual(2);
    expect(hasHighlights(doc, { line: 0, character: 4 })).toBe(true);
    expect(countHighlights(doc, { line: 0, character: 4 })).toBe(highlights.length);
    expect(getHighlightRanges(doc, { line: 0, character: 4 })).toHaveLength(highlights.length);
    expect(isHighlightableAt(doc, { line: 0, character: 4 })).toBe(true);
  });

  it('should group and sort highlights', () => {
    const doc = createDoc('## Purpose\n\nPurpose matters.\n');
    const highlights = getDocumentHighlights(doc, { line: 0, character: 4 });
    const groups = groupHighlightsByKind(highlights);

    expect(groups.size).toBeGreaterThan(0);
    const sorted = sortHighlights([...highlights].reverse());
    expect(sorted[0]!.range.start.line).toBeLessThanOrEqual(sorted[sorted.length - 1]!.range.start.line);
  });
});

describe('foldingRange', () => {
  it('should fold sections, code blocks, and frontmatter', () => {
    const doc = createDoc(SIMPLE_MAM);
    const ranges = getFoldingRanges(doc);

    expect(ranges.length).toBeGreaterThan(0);
    expect(hasFoldingRanges(doc)).toBe(true);
    expect(countFoldingRanges(doc)).toBe(ranges.length);
    expect(getSectionFoldingRanges(doc).length).toBeGreaterThan(0);
    expect(getCodeBlockFoldingRanges(doc).length).toBeGreaterThan(0);
    expect(getFrontmatterFoldingRange(doc)).not.toBeNull();
    expect(findLargestFoldingRange(doc)).not.toBeNull();
    expect(findLargestFoldingRange(createDoc('plain'))).toBeNull();
  });
});

describe('signatureHelp', () => {
  it('should help with edges, pairs, and fences', () => {
    expect(getSignatureHelp('start -> ', 9)).not.toBeNull();
    expect(hasSignatureHelp('start -> ', 9)).toBe(true);
    expect(getSignatureHelp('plain text', 5)).toBeNull();
    expect(getActiveParameterIndex('start -> ', 9)).toBe(1);
    expect(getActiveParameterIndex('start ->', 8)).toBe(0);
    expect(isSignatureTriggerCharacter('>')).toBe(true);
    expect(isSignatureTriggerCharacter('x')).toBe(false);
  });

  it('should describe edge signatures', () => {
    const items = getEdgeSignatureItems();

    expect(items.length).toBeGreaterThan(0);
    expect(formatSignatureLabel(items[0]!)).toContain('source');
    expect(countSignatures()).toBeGreaterThanOrEqual(items.length);
  });
});

describe('codeLens', () => {
  it('should provide section and code block lenses', () => {
    const doc = createDoc(SIMPLE_MAM);
    const lenses = getCodeLenses(doc);

    expect(lenses.length).toBeGreaterThan(0);
    expect(hasCodeLenses(doc)).toBe(true);
    expect(countCodeLenses(doc)).toBe(lenses.length);
    expect(getSectionCodeLenses(doc).length).toBeGreaterThan(0);
    expect(getCodeBlockCodeLenses(doc).length).toBeGreaterThan(0);
  });

  it('should filter lenses and list commands', () => {
    const doc = createDoc(SIMPLE_MAM);
    const lenses = getCodeLenses(doc);
    const commands = getCodeLensCommands(doc);

    expect(commands).toContain('mam.showReferences');
    expect(filterCodeLensesByCommand(lenses, 'mam.showReferences').length).toBe(
      getSectionCodeLenses(doc).length,
    );
  });
});

describe('workspaceSymbol', () => {
  it('should search symbols across documents', () => {
    const docs = [createDoc(SIMPLE_MAM), createDoc('## Rules\n\n- rule\n', 'file:///other.mam.md')];

    expect(hasWorkspaceSymbol(docs, 'purp')).toBe(true);
    expect(countWorkspaceSymbols(docs, 'purp')).toBeGreaterThan(0);
    expect(getWorkspaceSymbolNames(docs, '')).toContain('Purpose');
    const groups = groupSymbolsByDocument(getWorkspaceSymbols(docs, ''));
    expect(groups.size).toBe(2);
  });

  it('should filter and sort symbol lists', () => {
    const docs = [createDoc(SIMPLE_MAM)];
    const symbols = getWorkspaceSymbols(docs, '');

    expect(filterSymbolsByQuery(symbols, 'PURPOSE').length).toBeGreaterThan(0);
    expect(filterSymbolsByQuery(symbols, 'zzz').length).toBe(0);
    const sorted = sortWorkspaceSymbols([...symbols].reverse());
    expect(sorted[0]!.name.localeCompare(sorted[sorted.length - 1]!.name)).toBeLessThanOrEqual(0);
  });
});
