/**
 * MAM Validation Code Metadata
 *
 * Canonical descriptions, categories, and default severities for every known
 * `ErrorCode` and `WarningCode`, plus small lookup helpers for describing and
 * classifying codes at runtime.
 */

import { ErrorCode, WarningCode } from './index.js';
import type { ErrorCategory, ErrorCodeInfo } from './types.js';

/**
 * Metadata for a known `ErrorCode`.
 *
 * @property category - The `ErrorCategory` the code belongs to.
 * @property severity - The default severity for the code (always `'error'`).
 * @property description - Human-readable explanation of the code's meaning.
 */
export type ErrorCodeMeta = Omit<ErrorCodeInfo, 'code'>;

/**
 * Metadata for a known `WarningCode`.
 *
 * @property category - The `ErrorCategory` the code belongs to.
 * @property description - Human-readable explanation of the code's meaning.
 */
export interface WarningCodeMeta {
  category: ErrorCategory;
  description: string;
}

/**
 * Description table for every known `ErrorCode`.
 *
 * Keyed by enum member; each entry carries the code's category, default
 * severity, and a human-readable description.
 */
export const ERROR_CODE_DESCRIPTIONS: Record<ErrorCode, ErrorCodeMeta> = {
  // Front matter errors
  [ErrorCode.MISSING_FRONTMATTER]: {
    category: 'frontmatter',
    severity: 'error',
    description: 'The module has no YAML front matter block.',
  },
  [ErrorCode.INVALID_YAML]: {
    category: 'frontmatter',
    severity: 'error',
    description: 'The front matter could not be parsed as valid YAML.',
  },
  [ErrorCode.MISSING_REQUIRED_FIELD]: {
    category: 'frontmatter',
    severity: 'error',
    description: 'A required front matter field is absent.',
  },
  [ErrorCode.INVALID_FIELD_TYPE]: {
    category: 'frontmatter',
    severity: 'error',
    description: 'A front matter field has the wrong type.',
  },
  [ErrorCode.INVALID_ID_FORMAT]: {
    category: 'frontmatter',
    severity: 'error',
    description: 'The module id does not match the expected identifier format.',
  },
  [ErrorCode.INVALID_VERSION_FORMAT]: {
    category: 'frontmatter',
    severity: 'error',
    description: 'The module version does not follow semantic versioning.',
  },
  [ErrorCode.INVALID_RUNTIME]: {
    category: 'frontmatter',
    severity: 'error',
    description: 'The declared runtime is not a supported runtime type.',
  },
  [ErrorCode.INVALID_PERMISSION]: {
    category: 'frontmatter',
    severity: 'error',
    description: 'A declared permission is not a recognized permission kind.',
  },

  // Section errors
  [ErrorCode.MISSING_SECTION]: {
    category: 'section',
    severity: 'error',
    description: 'A required section is missing from the module.',
  },
  [ErrorCode.DUPLICATE_SECTION]: {
    category: 'section',
    severity: 'error',
    description: 'A section appears more than once in the module.',
  },
  [ErrorCode.EMPTY_SECTION]: {
    category: 'section',
    severity: 'error',
    description: 'A section exists but has no content.',
  },
  [ErrorCode.INVALID_SECTION_NAME]: {
    category: 'section',
    severity: 'error',
    description: 'A section name is not a recognized section name.',
  },
  [ErrorCode.INVALID_SECTION_ORDER]: {
    category: 'section',
    severity: 'error',
    description: 'Sections are not in the recommended order.',
  },

  // Content errors
  [ErrorCode.INVALID_CONTENT_TYPE]: {
    category: 'content',
    severity: 'error',
    description: 'Content of an unexpected type appears in a section.',
  },
  [ErrorCode.MALFORMED_TABLE]: {
    category: 'content',
    severity: 'error',
    description: 'A table is malformed and cannot be parsed.',
  },
  [ErrorCode.UNTERMINATED_CODE_BLOCK]: {
    category: 'content',
    severity: 'error',
    description: 'A code block has no closing fence.',
  },
  [ErrorCode.INVALID_LANGUAGE]: {
    category: 'content',
    severity: 'error',
    description: 'A code block uses an unrecognized language tag.',
  },

  // Reference errors
  [ErrorCode.UNRESOLVED_DEPENDENCY]: {
    category: 'reference',
    severity: 'error',
    description: 'A declared dependency cannot be resolved.',
  },
  [ErrorCode.INVALID_URL]: {
    category: 'reference',
    severity: 'error',
    description: 'A URL in the module is malformed or invalid.',
  },
  [ErrorCode.BROKEN_REFERENCE]: {
    category: 'reference',
    severity: 'error',
    description: 'A cross-reference points to a target that does not exist.',
  },

  // Schema errors
  [ErrorCode.SCHEMA_VIOLATION]: {
    category: 'schema',
    severity: 'error',
    description: 'The module violates the declared schema.',
  },
  [ErrorCode.EXTRA_PROPERTY]: {
    category: 'schema',
    severity: 'error',
    description: 'The module contains a property that the schema does not allow.',
  },
  [ErrorCode.TYPE_MISMATCH]: {
    category: 'schema',
    severity: 'error',
    description: 'A value does not match the type required by the schema.',
  },
};

/**
 * Description table for every known `WarningCode`.
 *
 * Keyed by enum member; each entry carries the code's category and a
 * human-readable description.
 */
export const WARNING_CODE_DESCRIPTIONS: Record<WarningCode, WarningCodeMeta> = {
  // Style warnings
  [WarningCode.DEPRECATED_SYNTAX]: {
    category: 'style',
    description: 'The module uses syntax that has been deprecated.',
  },
  [WarningCode.INCONSISTENT_STYLE]: {
    category: 'style',
    description: 'The module is internally inconsistent in style or formatting.',
  },
  [WarningCode.LONG_LINE]: {
    category: 'style',
    description: 'A line exceeds the recommended maximum length.',
  },
  [WarningCode.TRAILING_WHITESPACE]: {
    category: 'style',
    description: 'A line contains trailing whitespace.',
  },

  // Best practice warnings
  [WarningCode.MISSING_DESCRIPTION]: {
    category: 'best-practice',
    description: 'The module has no description in its front matter.',
  },
  [WarningCode.MISSING_TAGS]: {
    category: 'best-practice',
    description: 'The module does not declare any tags.',
  },
  [WarningCode.MISSING_EXAMPLES]: {
    category: 'best-practice',
    description: 'The module has no Examples section.',
  },
  [WarningCode.MISSING_TESTS]: {
    category: 'best-practice',
    description: 'The module has no Tests section.',
  },
  [WarningCode.MISSING_REFERENCES]: {
    category: 'best-practice',
    description: 'The module has no References section.',
  },

  // Future warnings
  [WarningCode.FUTURE_DEPRECATION]: {
    category: 'best-practice',
    description: 'The module relies on a feature planned for deprecation.',
  },
};

/**
 * Look up the metadata for a known `ErrorCode`.
 *
 * @param code - The error code to describe.
 * @returns The code's category, severity, and description.
 */
export function describeErrorCode(code: ErrorCode): ErrorCodeMeta {
  return ERROR_CODE_DESCRIPTIONS[code];
}

/**
 * Look up the metadata for a known `WarningCode`.
 *
 * @param code - The warning code to describe.
 * @returns The code's category and description.
 */
export function describeWarningCode(code: WarningCode): WarningCodeMeta {
  return WARNING_CODE_DESCRIPTIONS[code];
}

/**
 * Resolve the category of a code string, if it is a known code.
 *
 * Checks the error table first, then the warning table.
 *
 * @param code - A code value as a string.
 * @returns The code's `ErrorCategory`, or `undefined` when unknown.
 */
export function codeCategory(code: string): ErrorCategory | undefined {
  const errorMeta = ERROR_CODE_DESCRIPTIONS[code as ErrorCode];
  if (errorMeta) return errorMeta.category;
  const warningMeta = WARNING_CODE_DESCRIPTIONS[code as WarningCode];
  return warningMeta?.category;
}

/**
 * Type guard: is `value` a known `ErrorCode`?
 *
 * @param value - Value to test.
 * @returns `true` when `value` is one of the `ErrorCode` members.
 */
export function isKnownErrorCode(value: string): value is ErrorCode {
  return (Object.values(ErrorCode) as string[]).includes(value);
}

/**
 * Type guard: is `value` a known `WarningCode`?
 *
 * @param value - Value to test.
 * @returns `true` when `value` is one of the `WarningCode` members.
 */
export function isKnownWarningCode(value: string): value is WarningCode {
  return (Object.values(WarningCode) as string[]).includes(value);
}