/**
 * MAM Linter
 * 
 * Production-grade linter for MAM modules.
 * Checks style, best practices, and potential issues.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseMAM } from '@mam/parser';
import { analyzeSemantics } from '@mam/compiler';
import { V2ModuleNode } from '@mam/ast';

// ============================================================================
// Types
// ============================================================================

export interface LintConfig {
  /** Lint level */
  level: 'error' | 'warning' | 'info';
  /** Enable style rules */
  style: boolean;
  /** Enable best practice rules */
  bestPractices: boolean;
  /** Enable security rules */
  security: boolean;
  /** Max line length */
  maxLineLength: number;
  /** Require description */
  requireDescription: boolean;
  /** Require tests */
  requireTests: boolean;
  /** Require examples */
  requireExamples: boolean;
  /** Allowed section names */
  allowedSections: string[];
}

export interface LintResult {
  /** File path */
  file: string;
  /** Lint issues */
  issues: LintIssue[];
  /** Whether lint passed */
  passed: boolean;
  /** Summary */
  summary: LintSummary;
}

export interface LintIssue {
  /** Issue code */
  code: string;
  /** Issue message */
  message: string;
  /** Issue severity */
  severity: 'error' | 'warning' | 'info';
  /** Line number */
  line: number;
  /** Column number */
  column: number;
  /** Issue rule */
  rule: string;
  /** Fix suggestion */
  fix?: string;
}

export interface LintSummary {
  /** Total issues */
  total: number;
  /** Errors */
  errors: number;
  /** Warnings */
  warnings: number;
  /** Info */
  info: number;
}

// ============================================================================
// Default Config
// ============================================================================

export const DEFAULT_LINT_CONFIG: LintConfig = {
  level: 'warning',
  style: true,
  bestPractices: true,
  security: true,
  maxLineLength: 200,
  requireDescription: false,
  requireTests: false,
  requireExamples: false,
  allowedSections: [
    'Purpose', 'Inputs', 'Outputs', 'Rules', 'Workflow', 'Mermaid',
    'Python', 'JavaScript', 'TypeScript', 'Prompt', 'Memory', 'Examples',
    'Tests', 'References', 'Dependencies', 'Exports', 'Imports', 'Plugins',
    'Permissions', 'Capabilities',
  ],
};

// ============================================================================
// Linter
// ============================================================================

export class MAMLinter {
  private config: LintConfig;

  constructor(config: Partial<LintConfig> = {}) {
    this.config = { ...DEFAULT_LINT_CONFIG, ...config };
  }

  /**
   * Lint a file
   */
  async lintFile(filePath: string): Promise<LintResult> {
    const content = await readFile(resolve(filePath), 'utf-8');
    return this.lint(content, filePath);
  }

  /**
   * Lint content
   */
  lint(content: string, file: string = '<input>'): LintResult {
    const issues: LintIssue[] = [];
    const lines = content.split('\n');

    // Parse module
    const parseResult = parseMAM(content, { source: file });

    // Add parse errors
    for (const error of parseResult.errors) {
      issues.push({
        code: 'PARSE_ERROR',
        message: error.message,
        severity: 'error',
        line: (error as any).line || 0,
        column: (error as any).column || 0,
        rule: 'parse',
      });
    }

    // Add parse warnings
    for (const warning of parseResult.warnings) {
      issues.push({
        code: 'PARSE_WARNING',
        message: warning.message,
        severity: 'warning',
        line: (warning as any).line || 0,
        column: (warning as any).column || 0,
        rule: 'parse',
      });
    }

    // Run style rules
    if (this.config.style) {
      issues.push(...this.checkStyle(lines));
    }

    // Run best practice rules
    if (this.config.bestPractices) {
      issues.push(...this.checkBestPractices(parseResult.ast));
    }

    // Run security rules
    if (this.config.security) {
      issues.push(...this.checkSecurity(parseResult.ast));
    }

    // Run semantic analysis
    const semanticResult = analyzeSemantics(parseResult.ast.sections as unknown as V2ModuleNode[]);
    for (const error of semanticResult.errors) {
      issues.push({
        code: 'SEMANTIC_ERROR',
        message: error.message,
        severity: 'error',
        line: error.location?.line || 0,
        column: error.location?.column || 0,
        rule: 'semantic',
      });
    }

    // Filter by level
    const filteredIssues = issues.filter(issue => {
      if (this.config.level === 'error') return issue.severity === 'error';
      if (this.config.level === 'warning') return issue.severity === 'error' || issue.severity === 'warning';
      return true;
    });

    const summary: LintSummary = {
      total: filteredIssues.length,
      errors: filteredIssues.filter(i => i.severity === 'error').length,
      warnings: filteredIssues.filter(i => i.severity === 'warning').length,
      info: filteredIssues.filter(i => i.severity === 'info').length,
    };

    return {
      file,
      issues: filteredIssues,
      passed: summary.errors === 0,
      summary,
    };
  }

  // ==========================================================================
  // Style Rules
  // ==========================================================================

  private checkStyle(lines: string[]): LintIssue[] {
    const issues: LintIssue[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNum = i + 1;

      // Trailing whitespace
      if (line !== line.replace(/\s+$/, '')) {
        issues.push({
          code: 'TRAILING_WHITESPACE',
          message: 'Line has trailing whitespace',
          severity: 'info',
          line: lineNum,
          column: line.length,
          rule: 'style',
          fix: 'Remove trailing whitespace',
        });
      }

      // Line too long
      if (line.length > this.config.maxLineLength) {
        issues.push({
          code: 'LINE_TOO_LONG',
          message: `Line exceeds ${this.config.maxLineLength} characters`,
          severity: 'info',
          line: lineNum,
          column: this.config.maxLineLength,
          rule: 'style',
          fix: 'Break line into multiple lines',
        });
      }

      // Multiple blank lines
      if (line.trim() === '' && i > 0 && lines[i - 1]?.trim() === '') {
        issues.push({
          code: 'MULTIPLE_BLANK_LINES',
          message: 'Multiple consecutive blank lines',
          severity: 'info',
          line: lineNum,
          column: 0,
          rule: 'style',
          fix: 'Remove extra blank line',
        });
      }
    }

    return issues;
  }

  // ==========================================================================
  // Best Practice Rules
  // ==========================================================================

  private checkBestPractices(ast: any): LintIssue[] {
    const issues: LintIssue[] = [];

    // Check for missing description
    if (this.config.requireDescription && !ast.frontmatter?.data?.description) {
      issues.push({
        code: 'MISSING_DESCRIPTION',
        message: 'Module is missing a description',
        severity: 'warning',
        line: 1,
        column: 0,
        rule: 'best-practice',
        fix: 'Add description to front matter',
      });
    }

    // Check for missing tests
    if (this.config.requireTests) {
      const hasTests = ast.sections?.some((s: any) => s.name === 'Tests');
      if (!hasTests) {
        issues.push({
          code: 'MISSING_TESTS',
          message: 'Module is missing a Tests section',
          severity: 'warning',
          line: 1,
          column: 0,
          rule: 'best-practice',
          fix: 'Add Tests section',
        });
      }
    }

    // Check for missing examples
    if (this.config.requireExamples) {
      const hasExamples = ast.sections?.some((s: any) => s.name === 'Examples');
      if (!hasExamples) {
        issues.push({
          code: 'MISSING_EXAMPLES',
          message: 'Module is missing an Examples section',
          severity: 'info',
          line: 1,
          column: 0,
          rule: 'best-practice',
          fix: 'Add Examples section',
        });
      }
    }

    // Check for unknown sections
    if (ast.sections) {
      for (const section of ast.sections) {
        if (!this.config.allowedSections.includes(section.name)) {
          issues.push({
            code: 'UNKNOWN_SECTION',
            message: `Unknown section: "${section.name}"`,
            severity: 'info',
            line: section.location?.start?.line || 0,
            column: section.location?.start?.column || 0,
            rule: 'best-practice',
          });
        }
      }
    }

    return issues;
  }

  // ==========================================================================
  // Security Rules
  // ==========================================================================

  private checkSecurity(ast: any): LintIssue[] {
    const issues: LintIssue[] = [];

    // Check for hardcoded secrets in code blocks
    if (ast.sections) {
      for (const section of ast.sections) {
        for (const content of section.content || []) {
          if (content.type === 'CodeBlock') {
            const value = content.value || '';
            
            // Check for common secret patterns
            const secretPatterns = [
              /password\s*=\s*['"][^'"]+['"]/i,
              /secret\s*=\s*['"][^'"]+['"]/i,
              /api[_-]?key\s*=\s*['"][^'"]+['"]/i,
              /token\s*=\s*['"][^'"]+['"]/i,
              /AWS_ACCESS_KEY_ID/i,
              /PRIVATE_KEY/i,
            ];

            for (const pattern of secretPatterns) {
              if (pattern.test(value)) {
                issues.push({
                  code: 'HARDCODED_SECRET',
                  message: 'Possible hardcoded secret detected',
                  severity: 'warning',
                  line: content.location?.start?.line || 0,
                  column: content.location?.start?.column || 0,
                  rule: 'security',
                  fix: 'Use environment variables or secret management',
                });
                break;
              }
            }
          }
        }
      }
    }

    return issues;
  }

  /**
   * Get lint config
   */
  getConfig(): LintConfig {
    return { ...this.config };
  }

  /**
   * Update lint config
   */
  updateConfig(config: Partial<LintConfig>): void {
    this.config = { ...this.config, ...config };
  }
}