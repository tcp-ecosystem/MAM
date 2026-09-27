/**
 * MAM References Provider
 *
 * Finds all references to a symbol (section name, function, variable)
 * across the document or workspace.
 */

import { Location, Range } from 'vscode-languageserver-protocol';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { MAMModule } from '@mam/parser';
import {
  findSections,
  findModuleDeclarations,
  findCodeBlocks,
  findVariableReferences,
  getWordAtPosition,
  createLocation,
  createRange,
  V1_SECTIONS,
  V2_SECTIONS,
} from '../protocol/mam';

/**
 * Find all references to the symbol at the given position.
 */
export function getReferences(
  uri: string,
  position: { line: number; character: number },
  document: TextDocument,
  ast: MAMModule | null,
  includeDeclaration: boolean,
): Location[] {
  const text = document.getText();
  const lines = text.split('\n');
  const line = lines[position.line];
  if (!line) return [];

  const word = getWordAtPosition(line, position.character);
  if (!word) return [];

  const references: Location[] = [];

  // 1. Section name references
  const sectionRefs = findSectionReferences(uri, word, text, ast, includeDeclaration);
  references.push(...sectionRefs);

  // 2. Module declaration references
  const moduleRefs = findModuleReferences(uri, word, text, includeDeclaration);
  references.push(...moduleRefs);

  // 3. Function references in code blocks
  const funcRefs = findFunctionReferences(uri, word, text, ast, includeDeclaration);
  references.push(...funcRefs);

  // 4. Variable references
  const varRefs = findVariableReferencesAll(uri, word, text, position, includeDeclaration);
  references.push(...varRefs);

  // Deduplicate by position
  return deduplicateReferences(references);
}

// ============================================================================
// Section References
// ============================================================================

function findSectionReferences(
  uri: string,
  name: string,
  text: string,
  ast: MAMModule | null,
  includeDeclaration: boolean,
): Location[] {
  const refs: Location[] = [];
  const sections = findSections(text);

  for (const section of sections) {
    if (section.name === name) {
      if (includeDeclaration) {
        refs.push(createLocation(uri, section.range));
      }
    }
  }

  // Also search for inline references to section names
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    // References in text: "see Purpose section" or "refer to Inputs"
    if (lines[i]!.includes(name)) {
      const section = sections.find(s => s.name === name);
      // Skip if this is the definition line
      if (section && section.line === i) continue;

      // Find all occurrences of the name in this line
      let startIndex = 0;
      while (startIndex < lines[i]!.length) {
        const idx = lines[i]!.indexOf(name, startIndex);
        if (idx === -1) break;

        // Check word boundaries
        const before = idx > 0 ? lines[i]![idx - 1] : ' ';
        const after = idx + name.length < lines[i]!.length ? lines[i]![idx + name.length] : ' ';

        if (/[\s,;.!?()\[\]{}]/.test(before) && /[\s,;.!?()\[\]{}]/.test(after)) {
          refs.push(createLocation(uri, createRange(i, idx, i, idx + name.length)));
        }

        startIndex = idx + 1;
      }
    }
  }

  // AST-based search for references in content
  if (ast) {
    for (const section of ast.sections) {
      for (const content of section.content) {
        if (content.type === 'paragraph') {
          const para = content as any;
          const value = para.value || '';
          if (value.includes(name)) {
            const startLine = (content.location?.start?.line ?? 1) - 1;
            const lines = value.split('\n');
            for (let li = 0; li < lines.length; li++) {
              if (lines[li]!.includes(name)) {
                const colIdx = lines[li]!.indexOf(name);
                refs.push(createLocation(uri, createRange(
                  startLine + li, colIdx,
                  startLine + li, colIdx + name.length,
                )));
              }
            }
          }
        }
      }
    }
  }

  return refs;
}

// ============================================================================
// Module References
// ============================================================================

function findModuleReferences(
  uri: string,
  name: string,
  text: string,
  includeDeclaration: boolean,
): Location[] {
  const refs: Location[] = [];
  const declarations = findModuleDeclarations(text);

  for (const decl of declarations) {
    if (decl.name === name) {
      if (includeDeclaration) {
        refs.push(createLocation(uri, decl.range));
      }
    }
  }

  // Search for the module name used in other contexts (e.g., dependency references)
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.includes(name)) {
      // Skip declaration lines
      const isDeclaration = declarations.some(d => d.line === i);
      if (isDeclaration) continue;

      let startIndex = 0;
      while (startIndex < lines[i]!.length) {
        const idx = lines[i]!.indexOf(name, startIndex);
        if (idx === -1) break;

        const before = idx > 0 ? lines[i]![idx - 1] : ' ';
        const after = idx + name.length < lines[i]!.length ? lines[i]![idx + name.length] : ' ';

        if (/[\s,;:\/\-.()\[\]{}]/.test(before) && /[\s,;:\/\-.()\[\]{}]/.test(after)) {
          refs.push(createLocation(uri, createRange(i, idx, i, idx + name.length)));
        }

        startIndex = idx + 1;
      }
    }
  }

  return refs;
}

// ============================================================================
// Function References
// ============================================================================

function findFunctionReferences(
  uri: string,
  name: string,
  text: string,
  ast: MAMModule | null,
  includeDeclaration: boolean,
): Location[] {
  const refs: Location[] = [];
  const blocks = findCodeBlocks(text);

  for (const block of blocks) {
    const blockRefs = findFunctionInBlock(text, block.range, name, includeDeclaration);
    refs.push(...blockRefs);
  }

  // Also search AST code blocks
  if (ast) {
    for (const section of ast.sections) {
      for (const content of section.content) {
        if (content.type === 'codeblock') {
          const codeBlock = content as any;
          const codeText = codeBlock.value || '';
          const blockRefs = findFunctionInCodeText(
            uri,
            codeText,
            name,
            codeBlock.location,
            includeDeclaration,
          );
          refs.push(...blockRefs);
        }
      }
    }
  }

  return refs;
}

function findFunctionInBlock(
  uri: string,
  blockRange: Range,
  name: string,
  includeDeclaration: boolean,
): Location[] {
  const refs: Location[] = [];
  // Simple approach: search for the name in the block range
  // In production, you'd parse the code. Here we do pattern matching.
  return refs;
}

function findFunctionInCodeText(
  uri: string,
  codeText: string,
  name: string,
  location: any,
  includeDeclaration: boolean,
): Location[] {
  const refs: Location[] = [];
  const baseLine = (location?.start?.line ?? 1) - 1;

  const patterns = [
    new RegExp(`\\b${escapeRegex(name)}\\b`, 'g'),
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(codeText)) !== null) {
      // Count lines to find position
      const beforeText = codeText.slice(0, match.index);
      const lineOffset = (beforeText.match(/\n/g) || []).length;
      const lastNewline = beforeText.lastIndexOf('\n');
      const col = lastNewline === -1 ? match.index : match.index - lastNewline - 1;

      refs.push(createLocation(uri, createRange(
        baseLine + lineOffset, col,
        baseLine + lineOffset, col + name.length,
      )));
    }
  }

  return refs;
}

// ============================================================================
// Variable References
// ============================================================================

function findVariableReferencesAll(
  uri: string,
  name: string,
  text: string,
  position: { line: number; character: number },
  includeDeclaration: boolean,
): Location[] {
  const refs: Location[] = [];
  const allRefs = findVariableReferences(text);

  for (const ref of allRefs) {
    if (ref.key === name) {
      if (!includeDeclaration && ref.line === position.line) continue;
      refs.push(createLocation(uri, ref.range));
    }
  }

  // Also search for the name in non-YAML contexts (e.g., "use `name`" in markdown)
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.includes(name)) {
      let startIndex = 0;
      while (startIndex < lines[i]!.length) {
        const idx = lines[i]!.indexOf(name, startIndex);
        if (idx === -1) break;

        const before = idx > 0 ? lines[i]![idx - 1] : ' ';
        const after = idx + name.length < lines[i]!.length ? lines[i]![idx + name.length] : ' ';

        if (/[\s,;:!@#%^&*()_+\-=\[\]{}|\\'"<>?/`~]/.test(before) &&
            /[\s,;:!@#%^&*()_+\-=\[\]{}|\\'"<>?/`~]/.test(after)) {
          refs.push(createLocation(uri, createRange(i, idx, i, idx + name.length)));
        }

        startIndex = idx + 1;
      }
    }
  }

  return refs;
}

// ============================================================================
// Helpers
// ============================================================================

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function deduplicateReferences(refs: Location[]): Location[] {
  const seen = new Set<string>();
  const result: Location[] = [];

  for (const ref of refs) {
    const key = `${ref.uri}:${ref.range.start.line}:${ref.range.start.character}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(ref);
    }
  }

  return result;
}

export function countReferences(
  uri: string,
  position: { line: number; character: number },
  document: TextDocument,
  ast: MAMModule | null,
  includeDeclaration: boolean,
): number {
  return getReferences(uri, position, document, ast, includeDeclaration).length;
}

export function hasReferences(
  uri: string,
  position: { line: number; character: number },
  document: TextDocument,
  ast: MAMModule | null,
  includeDeclaration: boolean,
): boolean {
  return countReferences(uri, position, document, ast, includeDeclaration) > 0;
}

export function findWordReferences(
  uri: string,
  word: string,
  document: TextDocument,
  ast: MAMModule | null,
  includeDeclaration: boolean,
): Location[] {
  const text = document.getText();
  const refs: Location[] = [];
  refs.push(...findSectionReferences(uri, word, text, ast, includeDeclaration));
  refs.push(...findModuleReferences(uri, word, text, includeDeclaration));
  refs.push(...findFunctionReferences(uri, word, text, ast, includeDeclaration));
  refs.push(...findVariableReferencesAll(uri, word, text, { line: -1, character: 0 }, includeDeclaration));
  return deduplicateReferences(refs);
}

export function groupReferencesByLine(refs: Location[]): Map<number, Location[]> {
  const groups = new Map<number, Location[]>();
  for (const ref of refs) {
    const line = ref.range.start.line;
    let group = groups.get(line);
    if (group === undefined) {
      group = [];
      groups.set(line, group);
    }
    group.push(ref);
  }
  return groups;
}

export function sortReferencesByPosition(refs: Location[]): Location[] {
  return [...refs].sort((a, b) =>
    a.range.start.line - b.range.start.line ||
    a.range.start.character - b.range.start.character,
  );
}

export function deduplicateLocations(refs: Location[]): Location[] {
  return deduplicateReferences(refs);
}

export function escapeReferencePattern(str: string): string {
  return escapeRegex(str);
}
