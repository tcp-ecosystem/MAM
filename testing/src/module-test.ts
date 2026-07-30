/**
 * MAM Module Test
 * 
 * Tests individual MAM modules.
 */

import { readFile } from 'node:fs/promises';
import { parseMAM } from '@mam/parser';
import { validate } from '@mam/validator';

// ============================================================================
// Types
// ============================================================================

export interface ModuleTestConfig {
  /** Module file path */
  file: string;
  /** Test name */
  name?: string;
  /** Validate before testing */
  validateFirst?: boolean;
  /** Expected sections */
  expectedSections?: string[];
  /** Expected module type */
  expectedType?: string;
}

export interface ModuleTestResult {
  /** Test name */
  name: string;
  /** Test success */
  success: boolean;
  /** Test errors */
  errors: string[];
  /** Test warnings */
  warnings: string[];
  /** Test stats */
  stats: {
    parseTimeMs: number;
    validateTimeMs: number;
    sectionCount: number;
    codeBlockCount: number;
  };
}

// ============================================================================
// Module Test
// ============================================================================

export class ModuleTest {
  /**
   * Test a module file
   */
  static async test(config: ModuleTestConfig): Promise<ModuleTestResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const startTime = performance.now();

    try {
      const content = await readFile(config.file, 'utf-8');
      
      // Parse
      const parseStart = performance.now();
      const parseResult = parseMAM(content, { source: config.file });
      const parseTimeMs = performance.now() - parseStart;

      // Collect parse errors
      for (const error of parseResult.errors) {
        errors.push(error.message);
      }

      // Validate
      let validateTimeMs = 0;
      if (config.validateFirst !== false) {
        const validateStart = performance.now();
        const validationResult = validate(parseResult.ast as any);
        validateTimeMs = performance.now() - validateStart;

        for (const error of validationResult.errors) {
          errors.push(error.message);
        }
        for (const warning of validationResult.warnings) {
          warnings.push(warning.message);
        }
      }

      // Check expected sections
      if (config.expectedSections) {
        const actualSections = parseResult.ast.sections.map(s => s.name);
        for (const expected of config.expectedSections) {
          if (!actualSections.includes(expected)) {
            errors.push(`Missing expected section: ${expected}`);
          }
        }
      }

      // Check module type
      if (config.expectedType) {
        const moduleType = parseResult.ast.frontmatter?.data.runtime;
        if (moduleType !== config.expectedType) {
          warnings.push(`Expected runtime "${config.expectedType}", got "${moduleType}"`);
        }
      }

      return {
        name: config.name || config.file,
        success: errors.length === 0,
        errors,
        warnings,
        stats: {
          parseTimeMs,
          validateTimeMs,
          sectionCount: parseResult.ast.sections.length,
          codeBlockCount: parseResult.ast.metadata.codeBlockCount,
        },
      };
    } catch (error) {
      return {
        name: config.name || config.file,
        success: false,
        errors: [(error as Error).message],
        warnings,
        stats: {
          parseTimeMs: 0,
          validateTimeMs: 0,
          sectionCount: 0,
          codeBlockCount: 0,
        },
      };
    }
  }

  /**
   * Test multiple modules
   */
  static async testAll(configs: ModuleTestConfig[]): Promise<ModuleTestResult[]> {
    const results: ModuleTestResult[] = [];
    for (const config of configs) {
      results.push(await this.test(config));
    }
    return results;
  }
}