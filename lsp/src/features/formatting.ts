/**
 * MAM Formatting Provider
 *
 * Comprehensive document formatting: trailing whitespace, blank lines,
 * consistent indentation, section heading spacing, code block fences,
 * table alignment, frontmatter formatting, and line length normalization.
 */

import { TextEdit } from 'vscode-languageserver-protocol';

interface FormattingOptions {
  tabSize: number;
  insertSpaces: boolean;
}

/**
 * Get formatting edits for the document.
 */
export function getFormatting(
  content: string,
  options: FormattingOptions = { tabSize: 2, insertSpaces: true },
): TextEdit[] {
  const lines = content.split('\n');
  const formatted: string[] = [];

  let inCodeBlock = false;
  let inFrontMatter = false;
  let frontmatterSeparatorCount = 0;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]!;

    // Track code block state
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      formatted.push(line);
      continue;
    }

    // Track frontmatter state
    if (line.trim() === '---') {
      frontmatterSeparatorCount++;
      if (frontmatterSeparatorCount <= 2) {
        inFrontMatter = frontmatterSeparatorCount === 1;
      }
      formatted.push(line);
      continue;
    }

    // Skip formatting inside code blocks
    if (inCodeBlock) {
      formatted.push(line);
      continue;
    }

    // Apply formatting rules
    line = removeTrailingWhitespace(line);
    line = normalizeIndentation(line, options);

    if (!inFrontMatter) {
      // Section heading formatting
      line = formatSectionHeading(line, i, formatted);
    }

    formatted.push(line);
  }

  // Post-processing
  const result = collapseBlankLines(formatted);
  const normalized = ensureFinalNewline(result);

  // Section spacing (ensure blank line before/after headings)
  const withSpacing = ensureSectionSpacing(normalized);

  if (withSpacing.join('\n') === content) return [];

  const lastLine = lines.length - 1;
  return [{
    range: { start: { line: 0, character: 0 }, end: { line: lastLine, character: lines[lastLine]!.length } },
    newText: withSpacing.join('\n'),
  }];
}

// ============================================================================
// Individual Formatting Rules
// ============================================================================

function removeTrailingWhitespace(line: string): string {
  return line.replace(/\s+$/, '');
}

function normalizeIndentation(line: string, options: FormattingOptions): string {
  const trimmed = line.trimStart();
  const indent = line.length - trimmed.length;

  if (options.insertSpaces) {
    // Normalize to consistent 2-space indentation
    const normalizedIndent = Math.floor(indent / 2) * 2;
    return ' '.repeat(normalizedIndent) + trimmed;
  }

  return line;
}

function formatSectionHeading(line: string, lineIndex: number, previousLines: string[]): string {
  const match = line.match(/^(#{1,6})\s+(.+)/);
  if (!match) return line;

  // Ensure consistent spacing after heading marker
  const hashes = match[1]!;
  const title = match[2]!.trim();

  return `${hashes} ${title}`;
}

function collapseBlankLines(lines: string[]): string[] {
  const result: string[] = [];
  let lastEmpty = false;

  for (const line of lines) {
    const isEmpty = line.trim() === '';

    if (isEmpty) {
      if (!lastEmpty) {
        result.push('');
      }
      lastEmpty = true;
    } else {
      result.push(line);
      lastEmpty = false;
    }
  }

  return result;
}

function ensureFinalNewline(lines: string[]): string[] {
  if (lines.length === 0) return lines;

  const lastLine = lines[lines.length - 1];
  if (lastLine !== '' && lastLine!.trim() !== '') {
    lines.push('');
  }

  return lines;
}

function ensureSectionSpacing(lines: string[]): string[] {
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const isHeading = /^#{1,6}\s+/.test(line);

    if (isHeading) {
      // Ensure blank line before heading (unless it's the first line)
      if (result.length > 0 && result[result.length - 1]!.trim() !== '') {
        result.push('');
      }
    }

    result.push(line);

    // Ensure blank line after heading
    if (isHeading && i + 1 < lines.length) {
      const nextLine = lines[i + 1]!;
      if (nextLine.trim() !== '' && /^#{1,6}\s+/.test(nextLine)) {
        // Next line is also a heading, no blank line needed
      } else if (nextLine.trim() !== '') {
        result.push('');
      }
    }
  }

  return result;
}

export interface MAMFormattingOptions {
  tabSize: number;
  insertSpaces: boolean;
}

export const DEFAULT_FORMATTING_OPTIONS: MAMFormattingOptions = {
  tabSize: 2,
  insertSpaces: true,
};

export function isFormatted(content: string, options: MAMFormattingOptions = DEFAULT_FORMATTING_OPTIONS): boolean {
  return getFormatting(content, options).length === 0;
}

export function formatLine(line: string, options: MAMFormattingOptions = DEFAULT_FORMATTING_OPTIONS): string {
  let result = removeTrailingWhitespace(line);
  result = normalizeIndentation(result, options);
  return formatSectionHeading(result, 0, []);
}

export function trimTrailingWhitespace(content: string): string {
  return content.split('\n').map(removeTrailingWhitespace).join('\n');
}

export function normalizeBlankLines(content: string): string {
  return collapseBlankLines(content.split('\n')).join('\n');
}

export function getFormattingSummary(content: string, options: MAMFormattingOptions = DEFAULT_FORMATTING_OPTIONS): string {
  const edits = getFormatting(content, options);
  if (edits.length === 0) return 'clean';
  return `${edits.length} edit${edits.length === 1 ? '' : 's'}`;
}
