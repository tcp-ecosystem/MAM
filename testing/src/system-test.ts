/**
 * MAM System Test
 * 
 * Tests complete MAM systems (multi-module).
 */

import { readFile } from 'node:fs/promises';
import { parseMAM } from '@mam/parser';
import { analyzeSemantics } from '@mam/compiler';
import { V2ModuleNode } from '@mam/ast';

// ============================================================================
// Types
// ============================================================================

export interface SystemTestConfig {
  /** System file path */
  file: string;
  /** Test name */
  name?: string;
  /** Expected module count */
  expectedModules?: number;
  /** Expected agents */
  expectedAgents?: string[];
  /** Expected edges */
  expectedEdges?: Array<{ from: string; to: string }>;
}

export interface SystemTestResult {
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
    analyzeTimeMs: number;
    moduleCount: number;
    edgeCount: number;
  };
}

// ============================================================================
// System Test
// ============================================================================

export class SystemTest {
  /**
   * Test a system file
   */
  static async test(config: SystemTestConfig): Promise<SystemTestResult> {
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

      // Analyze semantics
      const analyzeStart = performance.now();
      const semanticResult = analyzeSemantics(parseResult.ast.sections as any);
      const analyzeTimeMs = performance.now() - analyzeStart;

      // Collect semantic errors
      for (const error of semanticResult.errors) {
        errors.push(error.message);
      }
      for (const warning of semanticResult.warnings) {
        warnings.push(warning.message);
      }

      // Check expected modules
      if (config.expectedModules) {
        const actualCount = parseResult.ast.sections.length;
        if (actualCount !== config.expectedModules) {
          errors.push(`Expected ${config.expectedModules} modules, got ${actualCount}`);
        }
      }

      // Count edges
      let edgeCount = 0;
      for (const section of parseResult.ast.sections) {
        // In v2, edges would be in the module nodes
        edgeCount += semanticResult.stats.edgesValidated;
      }

      return {
        name: config.name || config.file,
        success: errors.length === 0,
        errors,
        warnings,
        stats: {
          parseTimeMs,
          analyzeTimeMs,
          moduleCount: parseResult.ast.sections.length,
          edgeCount,
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
          analyzeTimeMs: 0,
          moduleCount: 0,
          edgeCount: 0,
        },
      };
    }
  }

  /**
   * Test multiple systems
   */
  static async testAll(configs: SystemTestConfig[]): Promise<SystemTestResult[]> {
    const results: SystemTestResult[] = [];
    for (const config of configs) {
      results.push(await this.test(config));
    }
    return results;
  }
}