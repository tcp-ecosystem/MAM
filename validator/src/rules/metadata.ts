/**
 * MAM Metadata Validation Rules
 *
 * Validates the full-MAM metadata carried in the frontmatter: the module
 * `type` field and best-practice presence of `description`, `license`, and
 * `tags`.
 */

export type Severity = 'error' | 'warning' | 'info';

export interface MetadataIssue {
  rule: string;
  code: string;
  message: string;
  severity: Severity;
  line?: number;
  column?: number;
  path?: string;
}

/**
 * The module types recognised by the MAM metadata spec.
 */
export const KNOWN_MODULE_TYPES = [
  'module',
  'agent',
  'tool',
  'memory',
  'workflow',
  'team',
  'policy',
  'system',
  'service',
  'component',
  'resource',
  'interface',
  'contract',
  'plugin',
  'extension',
  'runtime',
  'package',
  'repository',
  'documentation',
] as const;

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

function addIssue(
  issues: MetadataIssue[],
  opts: Omit<MetadataIssue, 'rule'>
): void {
  issues.push({ rule: 'metadata', ...opts });
}

/**
 * Validate full-MAM metadata.
 *
 * Checks the frontmatter `type` field against {@link KNOWN_MODULE_TYPES} and
 * emits best-practice warnings when `description`, `license`, or `tags` are
 * missing.
 *
 * @param ast - The MAM AST (expects `ast.frontmatter`).
 * @returns A list of {@link MetadataIssue} objects; empty when valid.
 * @remarks Emits `INVALID_MODULE_TYPE` for unknown `type` values and
 * `MISSING_DESCRIPTION`, `MISSING_LICENSE`, and `MISSING_TAGS` warnings for
 * the corresponding absent fields.
 */
export function validateMetadata(ast: unknown): MetadataIssue[] {
  const issues: MetadataIssue[] = [];
  const doc = ast as Record<string, unknown>;
  const fm = doc.frontmatter as Record<string, unknown> | undefined;
  const fmLoc = locFromAst(doc);

  if (!fm) return issues;

  const type = fm.type;
  if (type !== undefined && type !== null) {
    const known = KNOWN_MODULE_TYPES as readonly string[];
    if (typeof type !== 'string' || !known.includes(type)) {
      addIssue(issues, {
        code: 'INVALID_MODULE_TYPE',
        message: `Field "type" must be one of [${known.join(', ')}]: got "${String(type)}"`,
        severity: 'error',
        ...fmLoc,
        path: 'frontmatter.type',
      });
    }
  }

  const description = fm.description;
  if (
    description === undefined ||
    description === null ||
    (typeof description === 'string' && description.trim() === '')
  ) {
    addIssue(issues, {
      code: 'MISSING_DESCRIPTION',
      message: 'Module is missing a description; add "description" to frontmatter',
      severity: 'warning',
      ...fmLoc,
      path: 'frontmatter.description',
    });
  }

  const license = fm.license;
  if (
    license === undefined ||
    license === null ||
    (typeof license === 'string' && license.trim() === '')
  ) {
    addIssue(issues, {
      code: 'MISSING_LICENSE',
      message: 'Module is missing a license; add "license" to frontmatter',
      severity: 'warning',
      ...fmLoc,
      path: 'frontmatter.license',
    });
  }

  const tags = fm.tags;
  if (
    tags === undefined ||
    tags === null ||
    (Array.isArray(tags) && tags.length === 0)
  ) {
    addIssue(issues, {
      code: 'MISSING_TAGS',
      message: 'Module has no tags for discovery; add "tags" to frontmatter',
      severity: 'warning',
      ...fmLoc,
      path: 'frontmatter.tags',
    });
  }

  return issues;
}