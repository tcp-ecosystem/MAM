/**
 * MAM Validator
 * 
 * Main validator that orchestrates all validation rules.
 */

import { MAMModule, Section, ContentNode } from '@mam/ast';
import {
  ValidationError,
  ValidationWarning,
  ValidationReport,
  ValidationStats,
} from './errors/index.js';
import {
  SchemaValidationConfig,
  validateFrontMatter,
  validateSections,
  validateContent,
  getValidationWarnings,
} from './rules/schema.js';

/**
 * Validation level
 */
export type ValidationLevel = 'syntax' | 'schema' | 'semantic' | 'strict';

/**
 * Validator configuration
 */
export interface ValidatorConfig {
  /** Validation level */
  level?: ValidationLevel;
  /** Schema validation config */
  schema?: SchemaValidationConfig;
  /** Custom validation rules */
  customRules?: ValidationRule[];
  /** Whether to collect warnings */
  collectWarnings?: boolean;
  /** Maximum errors before stopping */
  maxErrors?: number;
}

/**
 * Custom validation rule
 */
export interface ValidationRule {
  /** Rule name */
  name: string;
  /** Rule description */
  description: string;
  /** Rule severity */
  severity: 'error' | 'warning' | 'info';
  /** Rule check function */
  check(ast: MAMModule): ValidationError[];
}

const DEFAULT_CONFIG: ValidatorConfig = {
  level: 'schema',
  collectWarnings: true,
  maxErrors: 100,
};

/**
 * MAM Validator
 */
export class MAMValidator {
  private config: ValidatorConfig;
  private startTime: number = 0;

  constructor(config: ValidatorConfig = DEFAULT_CONFIG) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };
  }

  /**
   * Validate a MAM module
   */
  validate(ast: MAMModule): ValidationReport {
    this.startTime = performance.now();
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    let rulesChecked = 0;

    // Front matter validation
    const frontmatterErrors = validateFrontMatter(
      ast.frontmatter,
      this.config.schema
    );
    errors.push(...frontmatterErrors);
    rulesChecked++;

    // Section validation
    const sectionErrors = validateSections(ast.sections, this.config.schema);
    errors.push(...sectionErrors);
    rulesChecked++;

    // Content validation
    for (const section of ast.sections) {
      const contentErrors = validateContent(
        section.content,
        section.name,
        this.config.schema
      );
      errors.push(...contentErrors);
      rulesChecked++;
    }

    // Semantic validation (if level >= semantic)
    if (this.config.level === 'semantic' || this.config.level === 'strict') {
      const semanticErrors = this.validateSemantic(ast);
      errors.push(...semanticErrors);
      rulesChecked++;
    }

    // Custom rules
    if (this.config.customRules) {
      for (const rule of this.config.customRules) {
        const ruleErrors = rule.check(ast);
        errors.push(...ruleErrors);
        rulesChecked++;
      }
    }

    // Warnings (if enabled)
    if (this.config.collectWarnings) {
      const validationWarnings = getValidationWarnings(
        ast,
        this.config.schema
      );
      warnings.push(...validationWarnings);
    }

    // Enforce max errors
    if (this.config.maxErrors && errors.length > this.config.maxErrors) {
      errors.splice(this.config.maxErrors);
    }

    const stats: ValidationStats = {
      errorCount: errors.length,
      warningCount: warnings.length,
      rulesChecked,
      timeMs: performance.now() - this.startTime,
    };

    return {
      errors,
      warnings,
      valid: errors.length === 0,
      stats,
    };
  }

  /**
   * Semantic validation
   */
  private validateSemantic(ast: MAMModule): ValidationError[] {
    const errors: ValidationError[] = [];

    // Validate section ordering
    const sectionOrder = this.validateSectionOrder(ast);
    errors.push(...sectionOrder);

    // Validate code block contexts
    const codeContexts = this.validateCodeBlockContexts(ast);
    errors.push(...codeContexts);

    // Validate cross-references
    const crossRefs = this.validateCrossReferences(ast);
    errors.push(...crossRefs);

    return errors;
  }

  /**
   * Validate section ordering
   */
  private validateSectionOrder(ast: MAMModule): ValidationError[] {
    const errors: ValidationError[] = [];
    
    const idealOrder = [
      'Purpose',
      'Inputs',
      'Outputs',
      'Rules',
      'Workflow',
      'Mermaid',
      'Python',
      'JavaScript',
      'Prompt',
      'Memory',
      'Examples',
      'Tests',
      'References',
    ];

    let lastIdealIndex = -1;
    
    for (const section of ast.sections) {
      const idealIndex = idealOrder.indexOf(section.name);
      if (idealIndex !== -1) {
        if (idealIndex < lastIdealIndex) {
          // Section is out of order (warning, not error)
        }
        lastIdealIndex = Math.max(lastIdealIndex, idealIndex);
      }
    }

    return errors;
  }

  /**
   * Validate code block contexts
   */
  private validateCodeBlockContexts(ast: MAMModule): ValidationError[] {
    const errors: ValidationError[] = [];

    for (const section of ast.sections) {
      for (const content of section.content) {
        if (content.type === 'CodeBlock') {
          const block = content as { language: string; location: unknown };
          
          // Warn if Python code is in non-Python section
          if (block.language === 'python' && section.name !== 'Python' && section.name !== 'Tests') {
            // This is just a warning, not an error
          }
        }
      }
    }

    return errors;
  }

  /**
   * Validate cross-references
   */
  private validateCrossReferences(ast: MAMModule): ValidationError[] {
    const errors: ValidationError[] = [];

    // Check if dependencies are referenced
    if (ast.frontmatter?.data.dependencies) {
      for (const dep of ast.frontmatter.data.dependencies) {
        // In a full implementation, we would resolve dependencies
        // For now, just check format
        if (!/^[a-z][a-z0-9-]{0,63}$/.test(dep)) {
          errors.push({
            code: 'INVALID_DEPENDENCY_FORMAT' as never,
            message: `Invalid dependency format: "${dep}"`,
            severity: 'error',
            path: 'frontmatter.dependencies',
          });
        }
      }
    }

    return errors;
  }
}

/**
 * Convenience function to validate a MAM module
 */
export function validate(
  ast: MAMModule,
  config?: ValidatorConfig
): ValidationReport {
  const validator = new MAMValidator(config);
  return validator.validate(ast);
}

/**
 * Create a custom validation rule
 */
export function createRule(
  name: string,
  description: string,
  check: (ast: MAMModule) => ValidationError[]
): ValidationRule {
  return {
    name,
    description,
    severity: 'error',
    check,
  };
}