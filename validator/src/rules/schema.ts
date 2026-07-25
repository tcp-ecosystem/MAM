/**
 * MAM Schema Validation Rules
 * 
 * Validates MAM AST against the schema specification.
 */

import {
  MAMModule,
  FrontMatterData,
  Section,
  ContentNode,
  CodeBlock,
  Table,
  STANDARD_SECTIONS,
  isStandardSection,
} from '@mam/ast';
import {
  ValidationError,
  ValidationWarning,
  ErrorCode,
  WarningCode,
  createValidationError,
  createValidationWarning,
} from '../errors/index.js';

/**
 * Schema validation configuration
 */
export interface SchemaValidationConfig {
  /** Whether to enforce strict mode */
  strict?: boolean;
  /** Allowed runtimes */
  allowedRuntimes?: string[];
  /** Required sections */
  requiredSections?: string[];
  /** Maximum section depth */
  maxSectionDepth?: number;
  /** Maximum line length */
  maxLineLength?: number;
}

const DEFAULT_CONFIG: SchemaValidationConfig = {
  strict: false,
  allowedRuntimes: ['python', 'javascript', 'typescript', 'rust', 'go', 'shell'],
  requiredSections: ['Purpose'],
  maxSectionDepth: 6,
  maxLineLength: 120,
};

/**
 * Validate front matter data
 */
export function validateFrontMatter(
  frontmatter: MAMModule['frontmatter'],
  config: SchemaValidationConfig = DEFAULT_CONFIG
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!frontmatter) {
    errors.push(
      createValidationError(
        ErrorCode.MISSING_FRONTMATTER,
        'Front matter is required'
      )
    );
    return errors;
  }

  const data = frontmatter.data;

  // Validate ID
  if (!data.id) {
    errors.push(
      createValidationError(
        ErrorCode.MISSING_REQUIRED_FIELD,
        'Field "id" is required',
        frontmatter.location,
        'frontmatter.id'
      )
    );
  } else if (!/^[a-z][a-z0-9-]{0,63}$/.test(data.id)) {
    errors.push(
      createValidationError(
        ErrorCode.INVALID_ID_FORMAT,
        `Invalid ID format: "${data.id}". Must be lowercase alphanumeric with hyphens, starting with a letter`,
        frontmatter.location,
        'frontmatter.id'
      )
    );
  }

  // Validate version
  if (!data.version) {
    errors.push(
      createValidationError(
        ErrorCode.MISSING_REQUIRED_FIELD,
        'Field "version" is required',
        frontmatter.location,
        'frontmatter.version'
      )
    );
  } else if (!/^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?(\+[a-zA-Z0-9.]+)?$/.test(data.version)) {
    errors.push(
      createValidationError(
        ErrorCode.INVALID_VERSION_FORMAT,
        `Invalid version format: "${data.version}". Must be semantic version (MAJOR.MINOR.PATCH)`,
        frontmatter.location,
        'frontmatter.version'
      )
    );
  }

  // Validate name
  if (!data.name) {
    errors.push(
      createValidationError(
        ErrorCode.MISSING_REQUIRED_FIELD,
        'Field "name" is required',
        frontmatter.location,
        'frontmatter.name'
      )
    );
  } else if (typeof data.name !== 'string' || data.name.length === 0) {
    errors.push(
      createValidationError(
        ErrorCode.INVALID_FIELD_TYPE,
        'Field "name" must be a non-empty string',
        frontmatter.location,
        'frontmatter.name'
      )
    );
  }

  // Validate author
  if (!data.author) {
    errors.push(
      createValidationError(
        ErrorCode.MISSING_REQUIRED_FIELD,
        'Field "author" is required',
        frontmatter.location,
        'frontmatter.author'
      )
    );
  }

  // Validate runtime
  if (!data.runtime) {
    errors.push(
      createValidationError(
        ErrorCode.MISSING_REQUIRED_FIELD,
        'Field "runtime" is required',
        frontmatter.location,
        'frontmatter.runtime'
      )
    );
  } else if (!config.allowedRuntimes?.includes(data.runtime)) {
    errors.push(
      createValidationError(
        ErrorCode.INVALID_RUNTIME,
        `Invalid runtime: "${data.runtime}". Allowed: ${config.allowedRuntimes?.join(', ')}`,
        frontmatter.location,
        'frontmatter.runtime'
      )
    );
  }

  // Validate tags
  if (data.tags !== undefined) {
    if (!Array.isArray(data.tags)) {
      errors.push(
        createValidationError(
          ErrorCode.INVALID_FIELD_TYPE,
          'Field "tags" must be an array',
          frontmatter.location,
          'frontmatter.tags'
        )
      );
    } else {
      for (const tag of data.tags) {
        if (typeof tag !== 'string' || !/^[a-z0-9-]+$/.test(tag)) {
          errors.push(
            createValidationError(
              ErrorCode.INVALID_FIELD_TYPE,
              `Invalid tag format: "${tag}". Must be lowercase alphanumeric with hyphens`,
              frontmatter.location,
              'frontmatter.tags'
            )
          );
        }
      }
    }
  }

  // Validate permissions
  if (data.permissions !== undefined) {
    const validPermissions = ['network', 'filesystem', 'environment', 'exec', 'memory'];
    if (!Array.isArray(data.permissions)) {
      errors.push(
        createValidationError(
          ErrorCode.INVALID_FIELD_TYPE,
          'Field "permissions" must be an array',
          frontmatter.location,
          'frontmatter.permissions'
        )
      );
    } else {
      for (const perm of data.permissions) {
        if (!validPermissions.includes(perm)) {
          errors.push(
            createValidationError(
              ErrorCode.INVALID_PERMISSION,
              `Invalid permission: "${perm}". Allowed: ${validPermissions.join(', ')}`,
              frontmatter.location,
              'frontmatter.permissions'
            )
          );
        }
      }
    }
  }

  return errors;
}

/**
 * Validate sections
 */
export function validateSections(
  sections: Section[],
  config: SchemaValidationConfig = DEFAULT_CONFIG
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Check required sections
  for (const required of config.requiredSections || []) {
    const found = sections.some(s => s.name === required);
    if (!found) {
      errors.push(
        createValidationError(
          ErrorCode.MISSING_SECTION,
          `Required section "${required}" is missing`
        )
      );
    }
  }

  // Check for empty sections
  for (const section of sections) {
    if (section.content.length === 0) {
      errors.push(
        createValidationError(
          ErrorCode.EMPTY_SECTION,
          `Section "${section.name}" is empty`,
          section.location,
          `sections[${section.name}]`
        )
      );
    }
  }

  // Check for duplicate sections
  const sectionNames = sections.map(s => s.name);
  const duplicates = sectionNames.filter((name, index) => sectionNames.indexOf(name) !== index);
  if (duplicates.length > 0) {
    const uniqueDuplicates = [...new Set(duplicates)];
    for (const dup of uniqueDuplicates) {
      errors.push(
        createValidationError(
          ErrorCode.DUPLICATE_SECTION,
          `Duplicate section: "${dup}"`,
          sections.find(s => s.name === dup)?.location,
          `sections[${dup}]`
        )
      );
    }
  }

  return errors;
}

/**
 * Validate content nodes
 */
export function validateContent(
  content: ContentNode[],
  sectionName: string,
  config: SchemaValidationConfig = DEFAULT_CONFIG
): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const node of content) {
    switch (node.type) {
      case 'CodeBlock':
        errors.push(...validateCodeBlock(node as CodeBlock, sectionName));
        break;
      case 'Table':
        errors.push(...validateTable(node as Table, sectionName));
        break;
    }
  }

  return errors;
}

/**
 * Validate code block
 */
function validateCodeBlock(
  block: CodeBlock,
  sectionName: string
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Check language
  const validLanguages = ['python', 'javascript', 'js', 'typescript', 'ts', 'rust', 'go', 'shell', 'bash', 'yaml', 'json', 'mermaid'];
  if (block.language && !validLanguages.includes(block.language.toLowerCase())) {
    errors.push(
      createValidationError(
        ErrorCode.INVALID_LANGUAGE,
        `Invalid language: "${block.language}" in section "${sectionName}"`,
        block.location,
        `sections[${sectionName}].codeblock`
      )
    );
  }

  return errors;
}

/**
 * Validate table
 */
function validateTable(
  table: Table,
  sectionName: string
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Check headers exist
  if (table.headers.length === 0) {
    errors.push(
      createValidationError(
        ErrorCode.MALFORMED_TABLE,
        `Table in section "${sectionName}" has no headers`,
        table.location,
        `sections[${sectionName}].table`
      )
    );
  }

  // Check row column counts match headers
  for (let i = 0; i < table.rows.length; i++) {
    const row = table.rows[i]!;
    if (row.length !== table.headers.length) {
      errors.push(
        createValidationError(
          ErrorCode.MALFORMED_TABLE,
          `Table row ${i + 1} in section "${sectionName}" has ${row.length} columns, expected ${table.headers.length}`,
          table.location,
          `sections[${sectionName}].table.row[${i}]`
        )
      );
    }
  }

  return errors;
}

/**
 * Get all validation warnings
 */
export function getValidationWarnings(
  module: MAMModule,
  config: SchemaValidationConfig = DEFAULT_CONFIG
): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];

  // Check for missing description
  if (!module.frontmatter?.data.description) {
    warnings.push(
      createValidationWarning(
        WarningCode.MISSING_DESCRIPTION,
        'Module is missing a description'
      )
    );
  }

  // Check for missing tags
  if (!module.frontmatter?.data.tags || module.frontmatter.data.tags.length === 0) {
    warnings.push(
      createValidationWarning(
        WarningCode.MISSING_TAGS,
        'Module has no tags for discovery'
      )
    );
  }

  // Check for missing examples section
  const hasExamples = module.sections.some(s => s.name === 'Examples');
  if (!hasExamples) {
    warnings.push(
      createValidationWarning(
        WarningCode.MISSING_EXAMPLES,
        'Module is missing an Examples section'
      )
    );
  }

  // Check for missing tests section
  const hasTests = module.sections.some(s => s.name === 'Tests');
  if (!hasTests) {
    warnings.push(
      createValidationWarning(
        WarningCode.MISSING_TESTS,
        'Module is missing a Tests section'
      )
    );
  }

  // Check for missing references section
  const hasReferences = module.sections.some(s => s.name === 'References');
  if (!hasReferences) {
    warnings.push(
      createValidationWarning(
        WarningCode.MISSING_REFERENCES,
        'Module is missing a References section'
      )
    );
  }

  return warnings;
}