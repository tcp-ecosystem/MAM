/**
 * MAM Permissions Section Validation Rules
 *
 * Validates the `## Permissions` section (list/table form) and merges it with
 * the frontmatter `permissions` object, checking known permission keys and
 * valid values.
 */

export type Severity = 'error' | 'warning' | 'info';

export interface PermissionsIssue {
  rule: string;
  code: string;
  message: string;
  severity: Severity;
  line?: number;
  column?: number;
  path?: string;
}

/**
 * The permission keys recognised across frontmatter and section declarations.
 */
export const PERMISSION_KEYS = [
  'filesystem',
  'network',
  'python',
  'memory',
  'exec',
  'environment',
  'database',
] as const;

const PERMISSION_PREFIXES = [
  'fs:',
  'file:',
  'net:',
  'network:',
  'env:',
  'exec:',
  'memory:',
  'py:',
  'python:',
  'db:',
  'database:',
  'http:',
  'https:',
];

interface ContentItem {
  type?: string;
  value?: string;
  items?: Array<{ content?: ContentItem[] }>;
  headers?: unknown[];
  rows?: unknown[][];
  line?: number;
  column?: number;
}

interface PermissionsSection {
  name: string;
  location?: { start?: { line?: number; column?: number } };
  content?: ContentItem[];
}

function cellText(cell: unknown): string {
  if (typeof cell === 'string') return cell;
  if (cell && typeof cell === 'object') {
    const obj = cell as Record<string, unknown>;
    if (typeof obj.value === 'string') return obj.value;
    if (typeof obj.text === 'string') return obj.text;
  }
  return '';
}

function isKnownPermissionKey(key: string): boolean {
  const k = key.trim().toLowerCase();
  return (PERMISSION_KEYS as readonly string[]).includes(k);
}

function isKnownPermissionValue(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (isKnownPermissionKey(v)) return true;
  return PERMISSION_PREFIXES.some(prefix => v.startsWith(prefix));
}

function collectItemText(item: ContentItem, out: string[]): void {
  if (item.type === 'List' || item.type === 'list') {
    for (const li of item.items ?? []) {
      for (const child of li.content ?? []) {
        collectItemText(child, out);
      }
    }
    return;
  }
  const value = typeof item.value === 'string' ? item.value : '';
  if (value.trim() !== '') out.push(value.trim());
}

function splitDeclarations(text: string): string[] {
  return text
    .split(/[,;|\n]/)
    .map(part => part.trim())
    .filter(part => part.length > 0);
}

function addIssue(
  issues: PermissionsIssue[],
  opts: Omit<PermissionsIssue, 'rule'>
): void {
  issues.push({ rule: 'permissions', ...opts });
}

/**
 * Validate the `## Permissions` section and frontmatter `permissions`.
 *
 * Permission declarations are collected from the frontmatter object
 * (keys in {@link PERMISSION_KEYS} with string/array-of-strings values), from
 * list items, and from table first-column cells in the section. The two
 * sources are merged before validation.
 *
 * @param ast - The MAM AST (expects `ast.frontmatter.permissions` and
 * `ast.sections`).
 * @returns A list of {@link PermissionsIssue} objects; empty when valid.
 * @remarks Emits `INVALID_PERMISSION` for unknown keys/values and
 * `EMPTY_PERMISSIONS` when no permissions are declared in either source.
 */
export function validatePermissions(ast: unknown): PermissionsIssue[] {
  const issues: PermissionsIssue[] = [];
  const doc = ast as Record<string, unknown>;
  const fm = doc.frontmatter as Record<string, unknown> | undefined;
  const sections = (doc.sections as PermissionsSection[] | undefined) || [];

  const fmLoc = (() => {
    const start = (fm as
      | { location?: { start?: { line?: number; column?: number } } }
      | undefined)?.location?.start;
    return start && start.line != null
      ? { line: start.line, column: start.column }
      : {};
  })();

  const section = sections.find(s => s.name === 'Permissions');
  const secLoc = (() => {
    const start = section?.location?.start;
    return start && start.line != null
      ? { line: start.line, column: start.column }
      : {};
  })();

  const declared: string[] = [];
  const declaredLoc: Record<string, { line?: number; column?: number }> = {};

  const permissions = fm?.permissions;
  if (permissions !== undefined && permissions !== null) {
    if (typeof permissions !== 'object' || Array.isArray(permissions)) {
      addIssue(issues, {
        code: 'INVALID_PERMISSION',
        message:
          'Field "permissions" must be an object with keys in [' +
          PERMISSION_KEYS.join(', ') +
          ']',
        severity: 'error',
        ...fmLoc,
        path: 'frontmatter.permissions',
      });
    } else {
      for (const [key, value] of Object.entries(permissions)) {
        declared.push(key);
        declaredLoc[key] = fmLoc;
        if (!isKnownPermissionKey(key)) {
          addIssue(issues, {
            code: 'INVALID_PERMISSION',
            message: `Unknown permission key "${key}"; expected one of [${PERMISSION_KEYS.join(', ')}]`,
            severity: 'error',
            ...fmLoc,
            path: `frontmatter.permissions.${key}`,
          });
          continue;
        }
        const valid =
          typeof value === 'string' ||
          (Array.isArray(value) && value.every(v => typeof v === 'string'));
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
    }
  }

  const sectionTexts: string[] = [];
  for (const item of section?.content ?? []) {
    if (item.type === 'Table' || item.type === 'table') {
      for (const row of item.rows ?? []) {
        const first = row[0];
        if (first !== undefined && cellText(first).trim() !== '') {
          sectionTexts.push(cellText(first));
        }
      }
    } else if (item.type === 'List' || item.type === 'list') {
      collectItemText(item, sectionTexts);
    } else if (
      item.type === 'Paragraph' ||
      item.type === 'paragraph'
    ) {
      if (typeof item.value === 'string') sectionTexts.push(item.value);
    }
  }

  for (const text of sectionTexts) {
    for (const decl of splitDeclarations(text)) {
      declared.push(decl);
      declaredLoc[decl] = secLoc;
      if (!isKnownPermissionValue(decl)) {
        addIssue(issues, {
          code: 'INVALID_PERMISSION',
          message: `Unknown permission "${decl}" in Permissions section`,
          severity: 'warning',
          ...secLoc,
          path: 'sections.Permissions',
        });
      }
    }
  }

  if (declared.length === 0) {
    addIssue(issues, {
      code: 'EMPTY_PERMISSIONS',
      message: 'No permissions declared in frontmatter or Permissions section',
      severity: 'warning',
      ...(section ? secLoc : fmLoc),
      path: section ? 'sections.Permissions' : 'frontmatter.permissions',
    });
  }

  return issues;
}