/**
 * MAM Validator
 * 
 * Validates MAM modules against the specification.
 */

export {
  MAMValidator,
  validate,
  createRule,
  type ValidationLevel,
  type ValidatorConfig,
  type ValidationRule,
} from './validator.js';

export {
  type ValidationError,
  type ValidationWarning,
  type ValidationReport,
  type ValidationStats,
  type Severity,
  ErrorCode,
  WarningCode,
  createValidationError,
  createValidationWarning,
  formatValidationError,
  formatValidationWarning,
} from './errors/index.js';

export {
  type SchemaValidationConfig,
  validateFrontMatter,
  validateSections,
  validateContent,
  getValidationWarnings,
} from './rules/schema.js';