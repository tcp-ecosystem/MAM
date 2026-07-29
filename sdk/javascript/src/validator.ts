/**
 * MAM Validator for JavaScript
 *
 * Validates MAM ASTs against the specification rules.
 * Supports schema, semantic, and custom validation rules.
 */

import type {
  AST,
  FrontMatter,
  Section,
  ContentNode,
  SourceLocation,
  ParseError,
  ParseWarning,
} from './parser.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ValidationSeverity = 'error' | 'warning' | 'info';

export type ValidationLevel = 'syntax' | 'schema' | 'semantic' | 'strict';

export type ValidationErrorCode =
  | 'FRONTMATTER_MISSING'
  | 'FRONTMATTER_INVALID'
  | 'FIELD_REQUIRED'
  | 'FIELD_INVALID'
  | 'FIELD_FORMAT'
  | 'SECTION_MISSING'
  | 'SECTION_INVALID'
  | 'SECTION_ORDER'
  | 'CODEBLOCK_NO_LANGUAGE'
  | 'CODEBLOCK_EMPTY'
  | 'CODEBLOCK_UNSUPPORTED_LANG'
  | 'DEPENDENCY_INVALID_FORMAT'
  | 'DEPENDENCY_INVALID_VERSION'
  | 'REFERENCE_INVALID_URL'
  | 'CONTENT_EMPTY'
  | 'TABLE_NO_ROWS'
  | 'TABLE_MISMATCHED_COLUMNS'
  | 'CUSTOM_RULE_FAILED';

export interface ValidationIssue {
  rule: string;
  code: ValidationErrorCode;
  message: string;
  severity: ValidationSeverity;
  location?: SourceLocation;
  context?: string;
}

export interface ValidationRule {
  name: string;
  description: string;
  severity: ValidationSeverity;
  check: (ast: AST) => ValidationIssue[];
}

export interface SchemaValidationConfig {
  requiredFields?: string[];
  validRuntimes?: string[];
  idPattern?: RegExp;
  versionPattern?: RegExp;
  requiredSections?: string[];
  supportedLanguages?: string[];
}

export interface ValidatorConfig {
  level?: ValidationLevel;
  schema?: SchemaValidationConfig;
  customRules?: ValidationRule[];
  collectWarnings?: boolean;
  maxErrors?: number;
  strictOrdering?: boolean;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const DEFAULT_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
const VALID_RUNTIMES = ['python', 'javascript', 'typescript', 'rust', 'go', 'shell'];
const SUPPORTED_LANGUAGES = [
  'python', 'javascript', 'js', 'typescript', 'ts',
  'rust', 'go', 'shell', 'bash', 'sh',
  'yaml', 'json', 'mermaid', 'markdown',
  'html', 'css', 'sql', 'ruby', 'java', 'c', 'cpp',
];
const URL_PATTERN = /^https?:\/\/.+/;
const DEPENDENCY_PATTERN = /^[a-zA-Z0-9._-]+(?:\s*[><=~^]+\s*\d[\d.]*(?:[-+][\w.-]+)?)?$/;

const REQUIRED_FIELDS = ['id', 'version', 'name', 'author', 'runtime'];
const REQUIRED_SECTIONS = ['Purpose'];

const RECOMMENDED_ORDER: readonly string[] = [
  'Purpose', 'Inputs', 'Outputs', 'Rules', 'Workflow', 'Mermaid',
  'Python', 'JavaScript', 'Prompt', 'Memory', 'Examples', 'Tests',
  'References', 'Dependencies', 'Exports', 'Imports', 'Plugins',
  'Permissions', 'Capabilities',
];

// ---------------------------------------------------------------------------
// Built-in validation rules
// ---------------------------------------------------------------------------

function validateFrontmatterExists(ast: AST): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!ast.frontmatter) {
    issues.push({
      rule: 'frontmatter-exists',
      code: 'FRONTMATTER_MISSING',
      message: 'Front matter block is required (must start with ---)',
      severity: 'error',
      location: ast.location,
    });
  }
  return issues;
}

function validateRequiredFields(ast: AST, config: SchemaValidationConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!ast.frontmatter) return issues;

  const required = config.requiredFields ?? REQUIRED_FIELDS;
  for (const field of required) {
    if (!(field in ast.frontmatter.data)) {
      issues.push({
        rule: 'required-field',
        code: 'FIELD_REQUIRED',
        message: `Missing required field: "${field}"`,
        severity: 'error',
        location: ast.frontmatter.location,
      });
    }
  }
  return issues;
}

function validateFieldFormats(ast: AST, config: SchemaValidationConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!ast.frontmatter) return issues;
  const fm = ast.frontmatter.data;

  // Validate ID
  if (typeof fm.id === 'string') {
    const idPat = config.idPattern ?? DEFAULT_ID_PATTERN;
    if (!idPat.test(fm.id)) {
      issues.push({
        rule: 'id-format',
        code: 'FIELD_FORMAT',
        message: `Invalid ID format "${fm.id}": must match ${idPat.source}`,
        severity: 'error',
        location: ast.frontmatter.location,
      });
    }
  }

  // Validate version
  if (typeof fm.version === 'string') {
    const verPat = config.versionPattern ?? DEFAULT_VERSION_PATTERN;
    if (!verPat.test(fm.version)) {
      issues.push({
        rule: 'version-format',
        code: 'FIELD_FORMAT',
        message: `Invalid version "${fm.version}": must be valid semver (MAJOR.MINOR.PATCH)`,
        severity: 'error',
        location: ast.frontmatter.location,
      });
    }
  }

  // Validate runtime
  if (typeof fm.runtime === 'string') {
    const validRuntimes = config.validRuntimes ?? VALID_RUNTIMES;
    if (!validRuntimes.includes(fm.runtime)) {
      issues.push({
        rule: 'runtime-valid',
        code: 'FIELD_INVALID',
        message: `Invalid runtime "${fm.runtime}": must be one of [${validRuntimes.join(', ')}]`,
        severity: 'error',
        location: ast.frontmatter.location,
      });
    }
  }

  // Validate tags are array
  if (fm.tags !== undefined && !Array.isArray(fm.tags)) {
    issues.push({
      rule: 'tags-type',
      code: 'FIELD_INVALID',
      message: 'Field "tags" must be an array of strings',
      severity: 'error',
      location: ast.frontmatter.location,
    });
  }

  // Validate permissions are array
  if (fm.permissions !== undefined && !Array.isArray(fm.permissions)) {
    issues.push({
      rule: 'permissions-type',
      code: 'FIELD_INVALID',
      message: 'Field "permissions" must be an array of strings',
      severity: 'error',
      location: ast.frontmatter.location,
    });
  }

  // Validate dependencies are array
  if (fm.dependencies !== undefined && !Array.isArray(fm.dependencies)) {
    issues.push({
      rule: 'dependencies-type',
      code: 'FIELD_INVALID',
      message: 'Field "dependencies" must be an array of strings',
      severity: 'error',
      location: ast.frontmatter.location,
    });
  }

  return issues;
}

function validateRequiredSections(ast: AST, config: SchemaValidationConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const required = config.requiredSections ?? REQUIRED_SECTIONS;
  const sectionNames = new Set(ast.sections.map((s) => s.name));

  for (const rs of required) {
    if (!sectionNames.has(rs)) {
      issues.push({
        rule: 'required-section',
        code: 'SECTION_MISSING',
        message: `Missing required section: "${rs}"`,
        severity: 'error',
      });
    }
  }
  return issues;
}

function validateSectionOrdering(ast: AST): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // For each pair of sections in the document that are in the recommended order,
  // check that their actual positions match the recommended order.
  for (let i = 0; i < ast.sections.length; i++) {
    for (let j = i + 1; j < ast.sections.length; j++) {
      const nameA = ast.sections[i].name;
      const nameB = ast.sections[j].name;
      const recIdxA = RECOMMENDED_ORDER.indexOf(nameA);
      const recIdxB = RECOMMENDED_ORDER.indexOf(nameB);
      // If both are in the recommended order, but A appears after B in the doc
      // while B should come after A in the recommended order, that's a violation.
      if (recIdxA !== -1 && recIdxB !== -1 && recIdxA > recIdxB) {
        issues.push({
          rule: 'section-order',
          code: 'SECTION_ORDER',
          message: `Section "${nameB}" should appear before "${nameA}"`,
          severity: 'warning',
          location: ast.sections[j].location,
        });
      }
    }
  }
  return issues;
}

function validateCodeBlocks(ast: AST, config: SchemaValidationConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const supported = config.supportedLanguages ?? SUPPORTED_LANGUAGES;

  for (const section of ast.sections) {
    for (const node of section.content) {
      if (node.type !== 'CodeBlock') continue;

      // Empty code block
      if (node.value.trim() === '') {
        issues.push({
          rule: 'codeblock-empty',
          code: 'CODEBLOCK_EMPTY',
          message: `Empty code block in section "${section.name}"`,
          severity: 'warning',
          location: node.location,
        });
      }

      // Missing language
      if (!node.language || node.language === '') {
        issues.push({
          rule: 'codeblock-no-language',
          code: 'CODEBLOCK_NO_LANGUAGE',
          message: `Code block in section "${section.name}" missing language identifier`,
          severity: 'warning',
          location: node.location,
        });
      }

      // Unsupported language
      if (node.language && !supported.includes(node.language)) {
        issues.push({
          rule: 'codeblock-unsupported-lang',
          code: 'CODEBLOCK_UNSUPPORTED_LANG',
          message: `Unsupported language "${node.language}" in section "${section.name}"`,
          severity: 'info',
          location: node.location,
        });
      }
    }
  }
  return issues;
}

function validateDependencies(ast: AST): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!ast.frontmatter) return issues;

  const deps = ast.frontmatter.data.dependencies;
  if (!Array.isArray(deps)) return issues;

  for (const dep of deps) {
    if (typeof dep !== 'string') {
      issues.push({
        rule: 'dependency-format',
        code: 'DEPENDENCY_INVALID_FORMAT',
        message: `Dependency must be a string, got ${typeof dep}`,
        severity: 'error',
        location: ast.frontmatter!.location,
      });
      continue;
    }
    if (!DEPENDENCY_PATTERN.test(dep)) {
      issues.push({
        rule: 'dependency-format',
        code: 'DEPENDENCY_INVALID_FORMAT',
        message: `Invalid dependency format: "${dep}"`,
        severity: 'warning',
        location: ast.frontmatter!.location,
      });
    }
  }
  return issues;
}

function validateReferences(ast: AST): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const refsSection = ast.sections.find((s) => s.name === 'References');
  if (!refsSection) return issues;

  for (const node of refsSection.content) {
    if (node.type !== 'Paragraph' && node.type !== 'List') continue;
    // Extract URLs from markdown links: [text](url)
    const urlRegex = /\[([^\]]*)\]\(([^)]+)\)/g;
    let match: RegExpExecArray | null;
    while ((match = urlRegex.exec(node.value)) !== null) {
      const url = match[2];
      if (!URL_PATTERN.test(url)) {
        issues.push({
          rule: 'reference-url',
          code: 'REFERENCE_INVALID_URL',
          message: `Invalid reference URL: "${url}"`,
          severity: 'warning',
          location: node.location,
        });
      }
    }
  }
  return issues;
}

function validateTables(ast: AST): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const section of ast.sections) {
    for (const node of section.content) {
      if (node.type !== 'Table') continue;

      if (!node.rows || node.rows.length === 0) {
        issues.push({
          rule: 'table-empty',
          code: 'TABLE_NO_ROWS',
          message: `Empty table in section "${section.name}"`,
          severity: 'warning',
          location: node.location,
        });
        continue;
      }

      // Check for mismatched columns
      const headerLen = node.rows[0]?.length ?? 0;
      for (let i = 1; i < node.rows.length; i++) {
        if (node.rows[i].length !== headerLen) {
          issues.push({
            rule: 'table-columns',
            code: 'TABLE_MISMATCHED_COLUMNS',
            message: `Table row ${i + 1} has ${node.rows[i].length} columns, expected ${headerLen}`,
            severity: 'warning',
            location: node.location,
          });
        }
      }
    }
  }
  return issues;
}

function runCustomRules(ast: AST, rules: ValidationRule[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const rule of rules) {
    try {
      issues.push(...rule.check(ast));
    } catch (err) {
      issues.push({
        rule: rule.name,
        code: 'CUSTOM_RULE_FAILED',
        message: `Custom rule "${rule.name}" threw an error: ${err instanceof Error ? err.message : String(err)}`,
        severity: 'error',
      });
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Main validate function
// ---------------------------------------------------------------------------

export function validate(
  module: AST,
  config?: ValidatorConfig,
): ValidationIssue[] {
  const cfg: ValidatorConfig = config ?? {};
  const level = cfg.level ?? 'schema';
  const allIssues: ValidationIssue[] = [];

  const addIssue = (issue: ValidationIssue) => {
    if (cfg.maxErrors !== undefined) {
      const errorCount = allIssues.filter((i) => i.severity === 'error').length;
      if (issue.severity === 'error' && errorCount >= cfg.maxErrors) return;
    }
    allIssues.push(issue);
  };

  // --- syntax-level checks (always run) ---
  validateFrontmatterExists(module).forEach(addIssue);

  // --- schema-level checks ---
  if (level === 'schema' || level === 'semantic' || level === 'strict') {
    const schemaCfg = cfg.schema ?? {};
    validateRequiredFields(module, schemaCfg).forEach(addIssue);
    validateFieldFormats(module, schemaCfg).forEach(addIssue);
  }

  // --- semantic-level checks ---
  if (level === 'semantic' || level === 'strict') {
    const schemaCfg = cfg.schema ?? {};
    validateRequiredSections(module, schemaCfg).forEach(addIssue);
    validateCodeBlocks(module, schemaCfg).forEach(addIssue);
    validateDependencies(module).forEach(addIssue);
    validateReferences(module).forEach(addIssue);
    validateTables(module).forEach(addIssue);
  }

  // --- strict-level checks ---
  if (level === 'strict') {
    validateSectionOrdering(module).forEach(addIssue);
  }

  // --- custom rules ---
  if (cfg.customRules && cfg.customRules.length > 0) {
    runCustomRules(module, cfg.customRules).forEach(addIssue);
  }

  // Filter warnings if not collecting them
  if (cfg.collectWarnings === false) {
    return allIssues.filter((i) => i.severity !== 'warning');
  }

  return allIssues;
}

// ---------------------------------------------------------------------------
// Convenience: validate from raw string (parse + validate)
// ---------------------------------------------------------------------------

export function validateContent(
  content: string,
  config?: ValidatorConfig & { parseSource?: string },
): { issues: ValidationIssue[]; parseErrors: ParseError[]; parseWarnings: ParseWarning[] } {
  // Import parseMAM lazily to avoid circular dependency if used in same bundle
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { parseMAM } = require('./parser.js') as typeof import('./parser.js');
  const result = parseMAM(content, { source: config?.parseSource });
  const issues = validate(result.ast, config);
  return {
    issues,
    parseErrors: result.errors,
    parseWarnings: result.warnings,
  };
}
