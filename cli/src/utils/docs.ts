/**
 * MAM Documentation Generator
 * 
 * Generates documentation from MAM modules.
 * Supports Markdown, HTML, and JSON output formats.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { parseMAM } from '@mam/parser';
import { analyzeSemantics } from '@mam/compiler';
import { V2ModuleNode } from '@mam/ast';

// ============================================================================
// Types
// ============================================================================

export interface DocsConfig {
  /** Output format */
  format: 'markdown' | 'html' | 'json';
  /** Output directory */
  outDir: string;
  /** Include TOC */
  includeTOC: boolean;
  /** Include examples */
  includeExamples: boolean;
  /** Include API reference */
  includeAPI: boolean;
  /** Include dependency graph */
  includeGraph: boolean;
  /** Template directory */
  templateDir?: string;
}

export interface DocsResult {
  /** Generated files */
  files: string[];
  /** Total size */
  totalSize: number;
  /** Generation time */
  timeMs: number;
}

// ============================================================================
// Documentation Generator
// ============================================================================

export class DocsGenerator {
  private config: DocsConfig;

  constructor(config: Partial<DocsConfig> = {}) {
    this.config = {
      format: 'markdown',
      outDir: './docs',
      includeTOC: true,
      includeExamples: true,
      includeAPI: true,
      includeGraph: false,
      ...config,
    };
  }

  /**
   * Generate documentation for a file
   */
  async generate(filePath: string): Promise<DocsResult> {
    const startTime = performance.now();
    const files: string[] = [];

    const content = await readFile(resolve(filePath), 'utf-8');
    const parseResult = parseMAM(content, { source: filePath });
    const semanticResult = analyzeSemantics(parseResult.ast.sections as unknown as V2ModuleNode[]);

    // Create output directory
    await mkdir(resolve(this.config.outDir), { recursive: true });

    // Generate main documentation
    const docContent = this.generateModuleDoc(parseResult.ast, semanticResult);
    const outFile = join(this.config.outDir, `${basename(filePath, '.mam.md')}.md`);
    await writeFile(resolve(outFile), docContent, 'utf-8');
    files.push(outFile);

    // Generate API reference if enabled
    if (this.config.includeAPI) {
      const apiContent = this.generateAPIReference(parseResult.ast);
      const apiFile = join(this.config.outDir, `${basename(filePath, '.mam.md')}-api.md`);
      await writeFile(resolve(apiFile), apiContent, 'utf-8');
      files.push(apiFile);
    }

    // Generate examples if enabled
    if (this.config.includeExamples) {
      const examplesContent = this.generateExamples(parseResult.ast);
      const examplesFile = join(this.config.outDir, `${basename(filePath, '.mam.md')}-examples.md`);
      await writeFile(resolve(examplesFile), examplesContent, 'utf-8');
      files.push(examplesFile);
    }

    return {
      files,
      totalSize: files.length * 1024, // Approximate
      timeMs: performance.now() - startTime,
    };
  }

  /**
   * Generate module documentation
   */
  private generateModuleDoc(ast: any, semanticResult: any): string {
    const lines: string[] = [];
    const fm = ast.frontmatter?.data;

    // Header
    lines.push(`# ${fm?.name || 'Module'}`);
    lines.push('');
    if (fm?.description) {
      lines.push(fm.description);
      lines.push('');
    }

    // Metadata
    lines.push('## Metadata');
    lines.push('');
    lines.push(`| Field | Value |`);
    lines.push(`|-------|-------|`);
    lines.push(`| Name | ${fm?.name || 'N/A'} |`);
    lines.push(`| Version | ${fm?.version || 'N/A'} |`);
    lines.push(`| Author | ${fm?.author || 'N/A'} |`);
    lines.push(`| Runtime | ${fm?.runtime || 'N/A'} |`);
    if (fm?.tags && fm.tags.length > 0) {
      lines.push(`| Tags | ${fm.tags.join(', ')} |`);
    }
    lines.push('');

    // Table of Contents
    if (this.config.includeTOC && ast.sections) {
      lines.push('## Table of Contents');
      lines.push('');
      for (const section of ast.sections) {
        lines.push(`- [${section.name}](#${section.name.toLowerCase()})`);
      }
      lines.push('');
    }

    // Sections
    if (ast.sections) {
      for (const section of ast.sections) {
        lines.push(`## ${section.name}`);
        lines.push('');
        
        for (const content of section.content || []) {
          if (content.type === 'paragraph') {
            lines.push(content.value);
            lines.push('');
          } else if (content.type === 'list') {
            for (const item of content.items || []) {
              lines.push(`- ${item}`);
            }
            lines.push('');
          } else if (content.type === 'codeblock') {
            lines.push('```' + (content.language || ''));
            lines.push(content.value);
            lines.push('```');
            lines.push('');
          } else if (content.type === 'table') {
            if (content.headers) {
              lines.push('| ' + content.headers.join(' | ') + ' |');
              lines.push('|' + content.headers.map(() => '---').join('|') + '|');
              for (const row of content.rows || []) {
                lines.push('| ' + row.join(' | ') + ' |');
              }
              lines.push('');
            }
          }
        }
      }
    }

    // Semantic Analysis
    if (semanticResult.errors.length > 0) {
      lines.push('## Issues');
      lines.push('');
      for (const error of semanticResult.errors) {
        lines.push(`- ❌ ${error.message}`);
      }
      lines.push('');
    }

    if (semanticResult.warnings.length > 0) {
      lines.push('## Warnings');
      lines.push('');
      for (const warning of semanticResult.warnings) {
        lines.push(`- ⚠️ ${warning.message}`);
      }
      lines.push('');
    }

    // Footer
    lines.push('---');
    lines.push('');
    lines.push('*Generated by MAM Documentation Generator*');

    return lines.join('\n');
  }

  /**
   * Generate API reference
   */
  private generateAPIReference(ast: any): string {
    const lines: string[] = [];
    const fm = ast.frontmatter?.data;

    lines.push(`# API Reference: ${fm?.name || 'Module'}`);
    lines.push('');

    // Inputs
    const inputsSection = ast.sections?.find((s: any) => s.name === 'Inputs');
    if (inputsSection) {
      lines.push('## Inputs');
      lines.push('');
      for (const content of inputsSection.content || []) {
        if (content.type === 'table' && content.headers) {
          lines.push('| ' + content.headers.join(' | ') + ' |');
          lines.push('|' + content.headers.map(() => '---').join('|') + '|');
          for (const row of content.rows || []) {
            lines.push('| ' + row.join(' | ') + ' |');
          }
        }
      }
      lines.push('');
    }

    // Outputs
    const outputsSection = ast.sections?.find((s: any) => s.name === 'Outputs');
    if (outputsSection) {
      lines.push('## Outputs');
      lines.push('');
      for (const content of outputsSection.content || []) {
        if (content.type === 'table' && content.headers) {
          lines.push('| ' + content.headers.join(' | ') + ' |');
          lines.push('|' + content.headers.map(() => '---').join('|') + '|');
          for (const row of content.rows || []) {
            lines.push('| ' + row.join(' | ') + ' |');
          }
        }
      }
      lines.push('');
    }

    // Dependencies
    const depsSection = ast.sections?.find((s: any) => s.name === 'Dependencies');
    if (depsSection) {
      lines.push('## Dependencies');
      lines.push('');
      for (const content of depsSection.content || []) {
        if (content.type === 'list') {
          for (const item of content.items || []) {
            lines.push(`- \`${item}\``);
          }
        }
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Generate examples
   */
  private generateExamples(ast: any): string {
    const lines: string[] = [];
    const fm = ast.frontmatter?.data;

    lines.push(`# Examples: ${fm?.name || 'Module'}`);
    lines.push('');

    const examplesSection = ast.sections?.find((s: any) => s.name === 'Examples');
    if (examplesSection) {
      for (const content of examplesSection.content || []) {
        if (content.type === 'paragraph') {
          lines.push(content.value);
          lines.push('');
        } else if (content.type === 'codeblock') {
          lines.push('```' + (content.language || ''));
          lines.push(content.value);
          lines.push('```');
          lines.push('');
        }
      }
    } else {
      lines.push('No examples available for this module.');
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Get config
   */
  getConfig(): DocsConfig {
    return { ...this.config };
  }
}