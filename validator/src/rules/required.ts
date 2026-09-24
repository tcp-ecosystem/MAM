/**
 * Required Field Validation Rules
 *
 * Comprehensive checks for frontmatter fields, section presence,
 * id format, version format, runtime values, and author format.
 */

export type Severity = 'error' | 'warning' | 'info';

export interface RequiredIssue {
  rule: string;
  code: string;
  message: string;
  severity: Severity;
  line?: number;
  column?: number;
  path?: string;
}

export interface RequiredFieldRule {
  section: string;
  fields: string[];
  severity?: Severity;
}

export const FRONTMATTER_FIELDS: RequiredFieldRule[] = [
  {
    section: 'frontmatter',
    fields: ['id', 'version', 'name', 'author', 'runtime'],
    severity: 'error',
  },
];

export const REQUIRED_SECTIONS: string[] = ['Purpose'];

export const ALLOWED_RUNTIMES = [
  'python',
  'javascript',
  'typescript',
  'rust',
  'go',
  'shell',
  'bash',
] as const;

const KEBAB_CASE_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

function locFromAst(
  ast: Record<string, unknown>,
  field?: string
): { line?: number; column?: number } {
  const fm = ast.frontmatter as
    | { location?: { start?: { line?: number; column?: number } } }
    | undefined;
  if (!fm?.location?.start) return {};
  return { line: fm.location.start.line, column: fm.location.start.column };
}

function sectionLocation(
  ast: Record<string, unknown>,
  sectionName: string
): { line?: number; column?: number } {
  const sections = ast.sections as
    | Array<{ name: string; location?: { start?: { line?: number; column?: number } } }>
    | undefined;
  if (!sections) return {};
  const sec = sections.find(s => s.name === sectionName);
  if (!sec?.location?.start) return {};
  return { line: sec.location.start.line, column: sec.location.start.column };
}

function addIssue(
  issues: RequiredIssue[],
  opts: Omit<RequiredIssue, 'rule'>
): void {
  issues.push({ rule: 'required', ...opts });
}

export function validateRequired(
  ast: unknown,
  rules: RequiredFieldRule[] = FRONTMATTER_FIELDS
): RequiredIssue[] {
  const issues: RequiredIssue[] = [];
  const doc = ast as Record<string, unknown>;
  const fm = doc.frontmatter as Record<string, unknown> | undefined;
  const fmLoc = locFromAst(doc);

  if (!fm) {
    addIssue(issues, {
      code: 'MISSING_FRONTMATTER',
      message: 'Front matter block is required',
      severity: 'error',
      ...fmLoc,
      path: 'frontmatter',
    });
    return issues;
  }

  for (const rule of rules) {
    if (rule.section === 'frontmatter') {
      const severity = rule.severity ?? 'error';

      for (const field of rule.fields) {
        const value = fm[field];

        if (value === undefined || value === null || value === '') {
          addIssue(issues, {
            code: 'MISSING_REQUIRED_FIELD',
            message: `Missing required field "${field}" in frontmatter`,
            severity,
            ...fmLoc,
            path: `frontmatter.${field}`,
          });
          continue;
        }

        if (field === 'id' && typeof value === 'string') {
          if (!KEBAB_CASE_RE.test(value)) {
            addIssue(issues, {
              code: 'INVALID_ID_FORMAT',
              message: `Field "id" must be kebab-case (lowercase letters, digits, hyphens): got "${value}"`,
              severity: 'error',
              ...fmLoc,
              path: 'frontmatter.id',
            });
          }
          if (value.includes(' ')) {
            addIssue(issues, {
              code: 'INVALID_ID_FORMAT',
              message: `Field "id" must not contain spaces`,
              severity: 'error',
              ...fmLoc,
              path: 'frontmatter.id',
            });
          }
          if (value.length > 64) {
            addIssue(issues, {
              code: 'INVALID_ID_FORMAT',
              message: `Field "id" must not exceed 64 characters (got ${value.length})`,
              severity: 'warning',
              ...fmLoc,
              path: 'frontmatter.id',
            });
          }
        }

        if (field === 'version' && typeof value === 'string') {
          if (!SEMVER_RE.test(value)) {
            addIssue(issues, {
              code: 'INVALID_VERSION_FORMAT',
              message: `Field "version" must be valid semver (MAJOR.MINOR.PATCH): got "${value}"`,
              severity: 'error',
              ...fmLoc,
              path: 'frontmatter.version',
            });
          }
        }

        if (field === 'runtime' && typeof value === 'string') {
          const allowed = ALLOWED_RUNTIMES as readonly string[];
          if (!allowed.includes(value)) {
            addIssue(issues, {
              code: 'INVALID_RUNTIME',
              message: `Field "runtime" must be one of [${allowed.join(', ')}]: got "${value}"`,
              severity: 'error',
              ...fmLoc,
              path: 'frontmatter.runtime',
            });
          }
        }

        if (field === 'author' && typeof value === 'string') {
          if (value.trim().length === 0) {
            addIssue(issues, {
              code: 'EMPTY_AUTHOR',
              message: 'Field "author" must be a non-empty string',
              severity: 'error',
              ...fmLoc,
              path: 'frontmatter.author',
            });
          }
        }

        if (field === 'name' && typeof value === 'string') {
          if (value.trim().length === 0) {
            addIssue(issues, {
              code: 'EMPTY_NAME',
              message: 'Field "name" must be a non-empty string',
              severity: 'error',
              ...fmLoc,
              path: 'frontmatter.name',
            });
          }
        }
      }
    }
  }

  for (const sectionName of REQUIRED_SECTIONS) {
    const sections = doc.sections as Array<{ name: string }> | undefined;
    const hasSection = sections?.some(s => s.name === sectionName);
    if (!hasSection) {
      const secLoc = sectionLocation(doc, sectionName);
      addIssue(issues, {
        code: 'MISSING_SECTION',
        message: `Required section "${sectionName}" is missing`,
        severity: 'error',
        ...secLoc,
        path: `sections.${sectionName}`,
      });
    }
  }

  return issues;
}

/**
 * The set of permission keys accepted in the structured `permissions`
 * frontmatter object form (e.g. `permissions: { network: ['read'] }`).
 */
export const STRUCTURED_PERMISSION_KEYS = [
  'filesystem',
  'network',
  'python',
  'memory',
  'exec',
  'environment',
  'database',
] as const;

/**
 * Validate a structured `runtime` frontmatter field.
 *
 * A structured runtime is an object of the shape `{ language, version }`
 * where `language` must be one of {@link ALLOWED_RUNTIMES} and `version`
 * must be a string (valid semver is recommended but not enforced).
 *
 * @param ast - The MAM AST (expects `ast.frontmatter.runtime`).
 * @returns A list of {@link RequiredIssue} objects; empty when valid.
 * @remarks Emits `INVALID_RUNTIME` issues for non-object runtimes, unknown
 * languages, and non-string versions. Non-semver versions are reported as
 * `INVALID_RUNTIME` warnings only (semver is optional).
 */
export function validateStructuredRuntime(ast: unknown): RequiredIssue[] {
  const issues: RequiredIssue[] = [];
  const doc = ast as Record<string, unknown>;
  const fm = doc.frontmatter as Record<string, unknown> | undefined;
  const fmLoc = locFromAst(doc);
  const runtime = fm?.runtime;

  if (runtime === undefined || runtime === null) return issues;

  if (typeof runtime !== 'object') {
    addIssue(issues, {
      code: 'INVALID_RUNTIME',
      message:
        'Field "runtime" must be a structured object with "language" and "version"',
      severity: 'error',
      ...fmLoc,
      path: 'frontmatter.runtime',
    });
    return issues;
  }

  const rt = runtime as Record<string, unknown>;
  const language = rt.language;
  const version = rt.version;

  if (typeof language !== 'string' || language.trim() === '') {
    addIssue(issues, {
      code: 'INVALID_RUNTIME',
      message: 'Field "runtime.language" must be a non-empty string',
      severity: 'error',
      ...fmLoc,
      path: 'frontmatter.runtime.language',
    });
  } else {
    const allowed = ALLOWED_RUNTIMES as readonly string[];
    if (!allowed.includes(language)) {
      addIssue(issues, {
        code: 'INVALID_RUNTIME',
        message: `Field "runtime.language" must be one of [${allowed.join(', ')}]: got "${language}"`,
        severity: 'error',
        ...fmLoc,
        path: 'frontmatter.runtime.language',
      });
    }
  }

  if (typeof version !== 'string') {
    addIssue(issues, {
      code: 'INVALID_RUNTIME',
      message: 'Field "runtime.version" must be a string',
      severity: 'error',
      ...fmLoc,
      path: 'frontmatter.runtime.version',
    });
  } else if (version.trim() !== '' && !SEMVER_RE.test(version)) {
    addIssue(issues, {
      code: 'INVALID_RUNTIME',
      message: `Field "runtime.version" should be valid semver (MAJOR.MINOR.PATCH): got "${version}"`,
      severity: 'warning',
      ...fmLoc,
      path: 'frontmatter.runtime.version',
    });
  }

  return issues;
}

/**
 * Validate the structured `permissions` frontmatter field.
 *
 * Accepts the object form such as `permissions: { network: ['read'] }`.
 * Keys must be one of {@link STRUCTURED_PERMISSION_KEYS} and each value
 * must be either a string or an array of strings.
 *
 * @param ast - The MAM AST (expects `ast.frontmatter.permissions`).
 * @returns A list of {@link RequiredIssue} objects; empty when valid.
 * @remarks Emits `INVALID_PERMISSION` issues for unknown keys and
 * non-string / non-array-of-strings values.
 */
export function validateStructuredPermissions(ast: unknown): RequiredIssue[] {
  const issues: RequiredIssue[] = [];
  const doc = ast as Record<string, unknown>;
  const fm = doc.frontmatter as Record<string, unknown> | undefined;
  const fmLoc = locFromAst(doc);
  const permissions = fm?.permissions;

  if (permissions === undefined || permissions === null) return issues;

  if (typeof permissions !== 'object' || Array.isArray(permissions)) {
    addIssue(issues, {
      code: 'INVALID_PERMISSION',
      message:
        'Field "permissions" must be an object with keys in [' +
        STRUCTURED_PERMISSION_KEYS.join(', ') +
        ']',
      severity: 'error',
      ...fmLoc,
      path: 'frontmatter.permissions',
    });
    return issues;
  }

  const known = STRUCTURED_PERMISSION_KEYS as readonly string[];
  for (const [key, value] of Object.entries(permissions)) {
    if (!known.includes(key)) {
      addIssue(issues, {
        code: 'INVALID_PERMISSION',
        message: `Unknown permission key "${key}"; expected one of [${known.join(', ')}]`,
        severity: 'error',
        ...fmLoc,
        path: `frontmatter.permissions.${key}`,
      });
      continue;
    }

    const valid =
      typeof value === 'string' ||
      (Array.isArray(value) &&
        value.every(v => typeof v === 'string'));

    if (!valid) {
      addIssue(issues, {
        code: 'INVALID_PERMISSION',
        message: `Permission "${key}" must be a string or an array of strings`,
        severity: 'error',
        ...fmLoc,
        path: `frontmatter.permissions.${key}`,
      });
    }
  }

  return issues;
}

/**
 * Validate the `capabilities` frontmatter field.
 *
 * `capabilities` must be an array of non-empty strings with no duplicate
 * entries.
 *
 * @param ast - The MAM AST (expects `ast.frontmatter.capabilities`).
 * @returns A list of {@link RequiredIssue} objects; empty when valid.
 * @remarks Emits `INVALID_CAPABILITIES` issues for non-array values,
 * empty/non-string entries, and duplicate entries.
 */
export function validateCapabilitiesField(ast: unknown): RequiredIssue[] {
  const issues: RequiredIssue[] = [];
  const doc = ast as Record<string, unknown>;
  const fm = doc.frontmatter as Record<string, unknown> | undefined;
  const fmLoc = locFromAst(doc);
  const capabilities = fm?.capabilities;

  if (capabilities === undefined || capabilities === null) return issues;

  if (!Array.isArray(capabilities)) {
    addIssue(issues, {
      code: 'INVALID_CAPABILITIES',
      message: 'Field "capabilities" must be an array of non-empty strings',
      severity: 'error',
      ...fmLoc,
      path: 'frontmatter.capabilities',
    });
    return issues;
  }

  const seen = new Set<string>();
  for (let i = 0; i < capabilities.length; i++) {
    const cap = capabilities[i];
    if (typeof cap !== 'string' || cap.trim() === '') {
      addIssue(issues, {
        code: 'INVALID_CAPABILITIES',
        message: `Capability at index ${i} must be a non-empty string`,
        severity: 'error',
        ...fmLoc,
        path: `frontmatter.capabilities[${i}]`,
      });
      continue;
    }
    if (seen.has(cap)) {
      addIssue(issues, {
        code: 'INVALID_CAPABILITIES',
        message: `Duplicate capability "${cap}" in frontmatter`,
        severity: 'error',
        ...fmLoc,
        path: `frontmatter.capabilities[${i}]`,
      });
    }
    seen.add(cap);
  }

  return issues;
}
