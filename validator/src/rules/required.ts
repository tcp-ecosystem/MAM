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
