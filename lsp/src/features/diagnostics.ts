/**
 * MAM Diagnostics Provider
 *
 * Comprehensive diagnostics: parser errors, parser warnings,
 * section ordering validation, empty sections, missing required sections,
 * code block language validity, and table formatting issues.
 */

import {
  Diagnostic,
  DiagnosticSeverity,
} from 'vscode-languageserver-protocol';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { MAMModule, Section } from '@mam/parser';
import { parseMAM } from '@mam/parser';
import {
  V1_SECTIONS,
  LANGUAGES,
  VALID_RUNTIMES,
  createDiagnostic,
  findSections,
  findCodeBlocks,
  MAMDiagnosticSeverity,
} from '../protocol/mam';

/**
 * Get all diagnostics for the document.
 */
export function getDiagnostics(
  document: TextDocument,
  ast: MAMModule | null,
): Diagnostic[] {
  const content = document.getText();
  const uri = document.uri;
  const diagnostics: Diagnostic[] = [];

  // 1. Parse and get parser errors/warnings
  const parseResult = parseMAM(content, { source: uri });
  diagnostics.push(...mapParserErrors(parseResult.errors));
  diagnostics.push(...mapParserWarnings(parseResult.warnings));

  // 2. Section ordering validation
  diagnostics.push(...validateSectionOrdering(content, uri));

  // 3. Empty section check
  diagnostics.push(...validateEmptySections(content, uri));

  // 4. Missing required sections
  diagnostics.push(...validateRequiredSections(content, uri));

  // 5. Code block language validation
  diagnostics.push(...validateCodeBlockLanguages(content, uri));

  // 6. Table formatting validation
  diagnostics.push(...validateTableFormatting(content, uri));

  // 7. Frontmatter validation
  diagnostics.push(...validateFrontmatter(content, uri));

  // 8. Duplicate section check
  diagnostics.push(...validateDuplicateSections(content, uri));

  return diagnostics;
}

// ============================================================================
// Parser Error Mapping
// ============================================================================

function mapParserErrors(errors: any[]): Diagnostic[] {
  return errors.map(err => {
    const line = err.line ?? 0;
    const column = err.column ?? 0;
    const endColumn = column + (err.message?.length ?? 10);

    return createDiagnostic(
      line,
      column,
      err.message || 'Parse error',
      MAMDiagnosticSeverity.Error,
      err.code,
      line,
      Math.min(endColumn, 200),
    );
  });
}

function mapParserWarnings(warnings: any[]): Diagnostic[] {
  return warnings.map(warn => {
    const line = warn.line ?? 0;
    const column = warn.column ?? 0;
    const endColumn = column + (warn.message?.length ?? 10);

    return createDiagnostic(
      line,
      column,
      warn.message || 'Parse warning',
      MAMDiagnosticSeverity.Warning,
      warn.code,
      line,
      Math.min(endColumn, 200),
    );
  });
}

// ============================================================================
// Section Ordering Validation
// ============================================================================

const RECOMMENDED_ORDER = [
  'Purpose', 'Inputs', 'Outputs', 'Rules', 'Workflow', 'Mermaid',
  'Python', 'JavaScript', 'TypeScript', 'Prompt', 'Memory', 'Examples',
  'Tests', 'References', 'Dependencies', 'Exports', 'Imports', 'Plugins',
  'Permissions', 'Capabilities',
];

function validateSectionOrdering(content: string, uri: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const sections = findSections(content);

  let lastOrderIndex = -1;

  for (const section of sections) {
    const orderIndex = RECOMMENDED_ORDER.indexOf(section.name);
    if (orderIndex === -1) continue; // Custom section, skip

    if (orderIndex < lastOrderIndex) {
      diagnostics.push(createDiagnostic(
        section.line,
        0,
        `Section "${section.name}" is out of recommended order. Expected after: ${RECOMMENDED_ORDER[lastOrderIndex]}`,
        MAMDiagnosticSeverity.Information,
        'SECTION_ORDER',
        section.line,
        section.name.length + 3,
      ));
    }

    lastOrderIndex = Math.max(lastOrderIndex, orderIndex);
  }

  return diagnostics;
}

// ============================================================================
// Empty Section Validation
// ============================================================================

function validateEmptySections(content: string, uri: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i]!.match(/^(#{1,6})\s+(.+)/);
    if (!match) continue;

    const level = match[1]!.length;
    const name = match[2]!.trim();

    // Check if next non-empty line is a heading of same or higher level
    let hasContent = false;
    for (let j = i + 1; j < lines.length; j++) {
      const nextLine = lines[j]!.trim();
      if (nextLine === '') continue;

      const nextMatch = nextLine.match(/^(#{1,6})\s+/);
      if (nextMatch && nextMatch[1]!.length <= level) {
        break; // Next heading of same or higher level, section is empty
      }

      hasContent = true;
      break;
    }

    if (!hasContent) {
      diagnostics.push(createDiagnostic(
        i,
        0,
        `Empty section: "${name}"`,
        MAMDiagnosticSeverity.Warning,
        'EMPTY_SECTION',
        i,
        lines[i]!.length,
      ));
    }
  }

  return diagnostics;
}

// ============================================================================
// Required Section Validation
// ============================================================================

function validateRequiredSections(content: string, uri: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const sections = findSections(content);
  const sectionNames = sections.map(s => s.name);

  if (!sectionNames.includes('Purpose')) {
    diagnostics.push(createDiagnostic(
      0,
      0,
      'Missing required section: "Purpose"',
      MAMDiagnosticSeverity.Error,
      'MISSING_REQUIRED_SECTION',
    ));
  }

  return diagnostics;
}

// ============================================================================
// Code Block Language Validation
// ============================================================================

function validateCodeBlockLanguages(content: string, uri: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const blocks = findCodeBlocks(content);

  const validLangs = new Set(LANGUAGES.map(l => l.toLowerCase()));

  for (const block of blocks) {
    if (block.language === 'unknown') {
      diagnostics.push(createDiagnostic(
        block.line,
        3,
        'Code block has no language identifier',
        MAMDiagnosticSeverity.Warning,
        'MISSING_LANGUAGE',
        block.line,
        6,
      ));
    } else if (!validLangs.has(block.language.toLowerCase())) {
      diagnostics.push(createDiagnostic(
        block.line,
        3,
        `Unknown language: "${block.language}". Supported: ${LANGUAGES.join(', ')}`,
        MAMDiagnosticSeverity.Information,
        'UNKNOWN_LANGUAGE',
        block.line,
        3 + block.language.length,
      ));
    }
  }

  return diagnostics;
}

// ============================================================================
// Table Formatting Validation
// ============================================================================

function validateTableFormatting(content: string, uri: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Detect table rows (lines with |)
    if (line.includes('|') && line.trim().startsWith('|')) {
      const cells = line.split('|').filter(c => c.trim() !== '');

      // Check for separator row (---|---|---)
      if (cells.every(c => /^[-:]+$/.test(c.trim()))) {
        // This is a separator row, validate it matches header
        if (i > 0) {
          const headerLine = lines[i - 1]!;
          const headerCells = headerLine.split('|').filter(c => c.trim() !== '');

          if (headerCells.length !== cells.length) {
            diagnostics.push(createDiagnostic(
              i,
              0,
              `Table separator row has ${cells.length} columns but header has ${headerCells.length} columns`,
              MAMDiagnosticSeverity.Warning,
              'TABLE_COLUMN_MISMATCH',
              i,
              line.length,
            ));
          }
        }
      }
    }
  }

  return diagnostics;
}

// ============================================================================
// Frontmatter Validation
// ============================================================================

function validateFrontmatter(content: string, uri: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const lines = content.split('\n');

  // Check for frontmatter separator
  if (lines[0]?.trim() !== '---') {
    diagnostics.push(createDiagnostic(
      0,
      0,
      'Document should start with frontmatter (---)',
      MAMDiagnosticSeverity.Information,
      'MISSING_FRONTMATTER',
    ));
    return diagnostics;
  }

  // Find closing ---
  let closingIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]!.trim() === '---') {
      closingIndex = i;
      break;
    }
  }

  if (closingIndex === -1) {
    diagnostics.push(createDiagnostic(
      0,
      0,
      'Unterminated frontmatter (missing closing ---)',
      MAMDiagnosticSeverity.Error,
      'UNTERMINATED_FRONTMATTER',
    ));
    return diagnostics;
  }

  // Validate required fields
  const frontmatterContent = lines.slice(1, closingIndex).join('\n');
  const requiredFields = ['id', 'version', 'name', 'author', 'runtime'];

  for (const field of requiredFields) {
    if (!frontmatterContent.match(new RegExp(`^${field}\\s*:`, 'm'))) {
      diagnostics.push(createDiagnostic(
        1,
        0,
        `Missing required frontmatter field: "${field}"`,
        MAMDiagnosticSeverity.Error,
        'MISSING_FRONTMATTER_FIELD',
        1,
        field.length + 10,
      ));
    }
  }

  // Validate runtime value
  const runtimeMatch = frontmatterContent.match(/^runtime\s*:\s*(\S+)/m);
  if (runtimeMatch && !VALID_RUNTIMES.includes(runtimeMatch[1] as any)) {
    const runtimeLine = findFieldLine(lines, 'runtime', 1, closingIndex);
    diagnostics.push(createDiagnostic(
      runtimeLine,
      0,
      `Invalid runtime: "${runtimeMatch[1]}". Valid: ${VALID_RUNTIMES.join(', ')}`,
      MAMDiagnosticSeverity.Error,
      'INVALID_RUNTIME',
      runtimeLine,
      runtimeMatch[0]!.length,
    ));
  }

  return diagnostics;
}

function findFieldLine(lines: string[], field: string, start: number, end: number): number {
  for (let i = start; i <= end && i < lines.length; i++) {
    if (lines[i]!.match(new RegExp(`^${field}\\s*:`))) {
      return i;
    }
  }
  return start;
}

// ============================================================================
// Duplicate Section Validation
// ============================================================================

function validateDuplicateSections(content: string, uri: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const sections = findSections(content);
  const seen = new Map<string, number>();

  for (const section of sections) {
    const existingLine = seen.get(section.name);
    if (existingLine !== undefined) {
      diagnostics.push(createDiagnostic(
        section.line,
        0,
        `Duplicate section: "${section.name}" (first at line ${existingLine + 1})`,
        MAMDiagnosticSeverity.Error,
        'DUPLICATE_SECTION',
        section.line,
        section.name.length + 3,
      ));
    } else {
      seen.set(section.name, section.line);
    }
  }

  return diagnostics;
}
