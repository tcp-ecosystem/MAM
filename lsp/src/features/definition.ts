/**
 * MAM Definition Provider
 *
 * Resolves go-to-definition for section names, code block functions,
 * variables, and cross-file imports.
 */

import { Location, Range } from 'vscode-languageserver-protocol';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { MAMModule, Section } from '@mam/parser';
import {
  findSections,
  findModuleDeclarations,
  findCodeBlocks,
  getWordAtPosition,
  createLocation,
  createRange,
  V2_SECTIONS,
  V1_SECTIONS,
} from '../protocol/mam.js';

/**
 * Find the definition for the symbol at the given position.
 */
export function getDefinition(
  uri: string,
  position: { line: number; character: number },
  document: TextDocument,
  ast: MAMModule | null,
): Location | null {
  const text = document.getText();
  const lines = text.split('\n');
  const line = lines[position.line];
  if (!line) return null;

  const word = getWordAtPosition(line, position.character);
  if (!word) return null;

  // 1. Try section name definition (## SectionName)
  const sectionDef = findSectionDefinition(uri, word, text, ast);
  if (sectionDef) return sectionDef;

  // 2. Try module declaration definition
  const moduleDef = findModuleDefinition(uri, word, text, ast);
  if (moduleDef) return moduleDef;

  // 3. Try code block function definition
  const funcDef = findFunctionDefinition(uri, word, text, ast);
  if (funcDef) return funcDef;

  // 4. Try variable definition (YAML key or section reference)
  const varDef = findVariableDefinition(uri, word, text, position);
  if (varDef) return varDef;

  return null;
}

// ============================================================================
// Section Definitions
// ============================================================================

function findSectionDefinition(
  uri: string,
  name: string,
  text: string,
  ast: MAMModule | null,
): Location | null {
  // Check V1 standard sections
  if (V1_SECTIONS.includes(name as any)) {
    const sections = findSections(text);
    for (const section of sections) {
      if (section.name === name) {
        return createLocation(uri, section.range);
      }
    }
  }

  // Check V2 section keywords
  if (V2_SECTIONS.includes(name as any)) {
    const sections = findSections(text);
    for (const section of sections) {
      if (section.name === name) {
        return createLocation(uri, section.range);
      }
    }
  }

  // Check custom section names via AST
  if (ast) {
    for (const section of ast.sections) {
      if (section.name === name) {
        return createLocation(uri, {
          start: { line: section.location.start.line - 1, character: section.location.start.column },
          end: { line: section.location.end.line - 1, character: section.location.end.column },
        });
      }
    }
  }

  return null;
}

// ============================================================================
// Module Definitions
// ============================================================================

function findModuleDefinition(
  uri: string,
  name: string,
  text: string,
  ast: MAMModule | null,
): Location | null {
  // Match module declarations: `module name`, `agent name`, etc.
  const declarations = findModuleDeclarations(text);
  for (const decl of declarations) {
    if (decl.name === name) {
      return createLocation(uri, decl.range);
    }
  }

  // Check AST for module-level metadata
  if (ast?.frontmatter?.data) {
    const data = ast.frontmatter.data;
    if (data.id === name || data.name === name) {
      return createLocation(uri, createRange(0, 0, 0, 0));
    }
  }

  return null;
}

// ============================================================================
// Function Definitions (Code Blocks)
// ============================================================================

function findFunctionDefinition(
  uri: string,
  name: string,
  text: string,
  ast: MAMModule | null,
): Location | null {
  const blocks = findCodeBlocks(text);

  for (const block of blocks) {
    // Match function definitions in code blocks
    const funcRange = findFunctionInBlock(text, block.range, name);
    if (funcRange) {
      return createLocation(uri, funcRange);
    }
  }

  // Also check AST code blocks
  if (ast) {
    for (const section of ast.sections) {
      for (const content of section.content) {
        if (content.type === 'codeblock') {
          const codeBlock = content as any;
          const funcRange = findFunctionInText(codeBlock.value, name);
          if (funcRange) {
            return createLocation(uri, {
              start: {
                line: (codeBlock.location?.start?.line ?? 1) - 1 + funcRange.start.line,
                character: funcRange.start.character,
              },
              end: {
                line: (codeBlock.location?.start?.line ?? 1) - 1 + funcRange.end.line,
                character: funcRange.end.character,
              },
            });
          }
        }
      }
    }
  }

  return null;
}

function findFunctionInBlock(
  text: string,
  blockRange: Range,
  name: string,
): Range | null {
  const lines = text.split('\n');
  for (let i = blockRange.start.line; i <= blockRange.end.line && i < lines.length; i++) {
    const line = lines[i]!;
    const range = findFunctionInText(line, name);
    if (range) {
      return createRange(i, range.start.character, i, range.end.character);
    }
  }
  return null;
}

function findFunctionInText(
  text: string,
  name: string,
): { start: { line: number; character: number }; end: { line: number; character: number } } | null {
  // Python: def name(
  const pyPattern = new RegExp(`def\\s+${escapeRegex(name)}\\s*\\(`);
  const pyMatch = text.match(pyPattern);
  if (pyMatch) {
    const idx = text.indexOf(pyMatch[0]);
    return {
      start: { line: 0, character: idx + 4 }, // after "def "
      end: { line: 0, character: idx + 4 + name.length },
    };
  }

  // JS/TS: function name(, const name =, export function name(
  const jsPatterns = [
    new RegExp(`function\\s+${escapeRegex(name)}\\s*\\(`),
    new RegExp(`(?:const|let|var)\\s+${escapeRegex(name)}\\s*=`),
    new RegExp(`export\\s+(?:default\\s+)?function\\s+${escapeRegex(name)}\\s*\\(`),
  ];
  for (const pattern of jsPatterns) {
    const match = text.match(pattern);
    if (match) {
      const idx = text.indexOf(match[0]);
      const nameIdx = match[0].indexOf(name);
      return {
        start: { line: 0, character: idx + nameIdx },
        end: { line: 0, character: idx + nameIdx + name.length },
      };
    }
  }

  return null;
}

// ============================================================================
// Variable Definitions
// ============================================================================

function findVariableDefinition(
  uri: string,
  name: string,
  text: string,
  position: { line: number; character: number },
): Location | null {
  const lines = text.split('\n');

  // Find YAML key definitions: `key: value`
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i]!.match(/^(\s*)([\w-]+)\s*:/);
    if (match && match[2] === name) {
      // Skip if we're at the same position (not a definition, but reference)
      if (i === position.line) continue;

      return createLocation(uri, createRange(i, match[1]!.length, i, match[1]!.length + name.length));
    }
  }

  // Find section references: `## Name` or `# Name`
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i]!.match(/^#{1,6}\s+(.+)/);
    if (match && match[1]!.trim() === name) {
      return createLocation(uri, createRange(i, 0, i, lines[i]!.length));
    }
  }

  return null;
}

// ============================================================================
// Helpers
// ============================================================================

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
