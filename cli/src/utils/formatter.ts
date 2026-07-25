/**
 * MAM Formatter
 * 
 * Production-grade formatter for MAM modules.
 * Handles v1 sections, v2 DSL syntax, and edge cases.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// ============================================================================
// Types
// ============================================================================

export interface FormatConfig {
  /** Indentation size */
  indent: number;
  /** Use spaces or tabs */
  useSpaces: boolean;
  /** Max line length */
  maxLineLength: number;
  /** Trim trailing whitespace */
  trimTrailing: boolean;
  /** Ensure final newline */
  ensureFinalNewline: boolean;
  /** Collapse multiple blank lines */
  collapseBlankLines: boolean;
  /** Sort sections alphabetically */
  sortSections: boolean;
  /** Format YAML front matter */
  formatYAML: boolean;
  /** Format code blocks */
  formatCodeBlocks: boolean;
}

export interface FormatResult {
  /** Original content */
  original: string;
  /** Formatted content */
  formatted: string;
  /** Whether content changed */
  changed: boolean;
  /** Number of changes */
  changeCount: number;
}

// ============================================================================
// Default Config
// ============================================================================

export const DEFAULT_FORMAT_CONFIG: FormatConfig = {
  indent: 4,
  useSpaces: true,
  maxLineLength: 120,
  trimTrailing: true,
  ensureFinalNewline: true,
  collapseBlankLines: true,
  sortSections: false,
  formatYAML: true,
  formatCodeBlocks: false,
};

// ============================================================================
// Formatter
// ============================================================================

export class MAMFormatter {
  private config: FormatConfig;

  constructor(config: Partial<FormatConfig> = {}) {
    this.config = { ...DEFAULT_FORMAT_CONFIG, ...config };
  }

  /**
   * Format a file
   */
  async formatFile(filePath: string, inPlace: boolean = false): Promise<FormatResult> {
    const content = await readFile(resolve(filePath), 'utf-8');
    const result = this.format(content);

    if (inPlace && result.changed) {
      await writeFile(filePath, result.formatted, 'utf-8');
    }

    return result;
  }

  /**
   * Format content
   */
  format(content: string): FormatResult {
    const lines = content.split('\n');
    const formattedLines: string[] = [];
    let changeCount = 0;
    let lastEmpty = false;
    let inCodeBlock = false;
    let inFrontMatter = false;
    let frontMatterLineCount = 0;

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i]!;

      // Track code blocks
      if (line.trimStart().startsWith('```')) {
        inCodeBlock = !inCodeBlock;
        formattedLines.push(line);
        continue;
      }

      // Don't format inside code blocks
      if (inCodeBlock) {
        formattedLines.push(line);
        continue;
      }

      // Track front matter
      if (i === 0 && line.trim() === '---') {
        inFrontMatter = true;
        formattedLines.push(line);
        continue;
      }

      if (inFrontMatter) {
        if (line.trim() === '---' && frontMatterLineCount > 0) {
          inFrontMatter = false;
          formattedLines.push(line);
          continue;
        }
        frontMatterLineCount++;

        // Format YAML
        if (this.config.formatYAML) {
          line = this.formatYAMLLine(line);
        }

        formattedLines.push(line);
        continue;
      }

      // Trim trailing whitespace
      if (this.config.trimTrailing) {
        const trimmed = line.replace(/\s+$/, '');
        if (trimmed !== line) {
          changeCount++;
          line = trimmed;
        }
      }

      // Collapse multiple blank lines
      if (this.config.collapseBlankLines) {
        if (line.trim() === '') {
          if (lastEmpty) {
            changeCount++;
            continue;
          }
          lastEmpty = true;
        } else {
          lastEmpty = false;
        }
      }

      // Ensure proper spacing around headings
      if (line.startsWith('## ') && formattedLines.length > 0) {
        const lastLine = formattedLines[formattedLines.length - 1];
        if (lastLine && lastLine.trim() !== '' && !lastLine.startsWith('---')) {
          formattedLines.push('');
          changeCount++;
        }
      }

      // Ensure proper spacing around code blocks
      if (line.trimStart().startsWith('```') && formattedLines.length > 0) {
        const lastLine = formattedLines[formattedLines.length - 1];
        if (lastLine && lastLine.trim() !== '' && !lastLine.startsWith('```')) {
          formattedLines.push('');
          changeCount++;
        }
      }

      formattedLines.push(line);
    }

    // Ensure final newline
    let result = formattedLines.join('\n');
    if (this.config.ensureFinalNewline && !result.endsWith('\n')) {
      result += '\n';
      changeCount++;
    }

    // Remove trailing blank lines before final newline
    result = result.replace(/\n+$/, '\n');

    return {
      original: content,
      formatted: result,
      changed: result !== content,
      changeCount,
    };
  }

  /**
   * Format YAML line
   */
  private formatYAMLLine(line: string): string {
    // Ensure consistent indentation
    const trimmed = line.trimStart();
    const indent = line.length - trimmed.length;
    const normalizedIndent = Math.floor(indent / 2) * this.config.indent;

    return ' '.repeat(normalizedIndent) + trimmed;
  }

  /**
   * Check if content needs formatting
   */
  needsFormatting(content: string): boolean {
    const result = this.format(content);
    return result.changed;
  }

  /**
   * Get format config
   */
  getConfig(): FormatConfig {
    return { ...this.config };
  }

  /**
   * Update format config
   */
  updateConfig(config: Partial<FormatConfig>): void {
    this.config = { ...this.config, ...config };
  }
}