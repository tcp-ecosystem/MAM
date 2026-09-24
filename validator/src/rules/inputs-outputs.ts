/**
 * MAM Inputs/Outputs Table Validation Rules
 *
 * Validates the `## Inputs` and `## Outputs` sections: required columns
 * (Name/Type/Required/Description), well-formed tables, valid port types, and
 * duplicate names.
 */

export type Severity = 'error' | 'warning' | 'info';

export interface InputsOutputsIssue {
  rule: string;
  code: string;
  message: string;
  severity: Severity;
  line?: number;
  column?: number;
  path?: string;
}

/**
 * The columns required in an Inputs/Outputs table.
 */
export const REQUIRED_PORT_COLUMNS = [
  'name',
  'type',
  'required',
  'description',
] as const;

/**
 * The port types recognised for Inputs/Outputs tables.
 */
export const VALID_PORT_TYPES = [
  'string',
  'number',
  'boolean',
  'object',
  'array',
  'image',
  'audio',
  'video',
  'file',
  'json',
  'markdown',
  'code',
] as const;

interface TableItem {
  type?: string;
  headers?: unknown[];
  rows?: unknown[][];
  line?: number;
  column?: number;
}

interface PortSection {
  name: string;
  location?: { start?: { line?: number; column?: number } };
  content?: TableItem[];
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

function headerTexts(headers: unknown[] | undefined): string[] {
  return (headers ?? []).map(cellText);
}

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase();
}

function addIssue(
  issues: InputsOutputsIssue[],
  opts: Omit<InputsOutputsIssue, 'rule'>
): void {
  issues.push({ rule: 'inputs-outputs', ...opts });
}

/**
 * Validate the `## Inputs` and `## Outputs` tables.
 *
 * Each of the two sections must contain a table with the required columns
 * {@link REQUIRED_PORT_COLUMNS}. Rows are checked for column-count
 * consistency, unique names, and valid port types
 * (see {@link VALID_PORT_TYPES}).
 *
 * @param ast - The MAM AST (expects `ast.sections`).
 * @returns A list of {@link InputsOutputsIssue} objects; empty when valid.
 * @remarks Emits `MALFORMED_TABLE` for missing/malformed tables,
 * `MISSING_REQUIRED_COLUMN` for absent required headers, `DUPLICATE_INPUT`
 * for repeated names, and `INVALID_TYPE` for unsupported port types.
 */
export function validateInputsOutputs(ast: unknown): InputsOutputsIssue[] {
  const issues: InputsOutputsIssue[] = [];
  const doc = ast as Record<string, unknown>;
  const sections = (doc.sections as PortSection[] | undefined) || [];

  for (const section of sections) {
    const isInputs = section.name === 'Inputs';
    const isOutputs = section.name === 'Outputs';
    if (!isInputs && !isOutputs) continue;

    const kind = isInputs ? 'input' : 'output';
    const pathBase = `sections.${section.name}`;
    const secLoc = (() => {
      const start = section.location?.start;
      return start && start.line != null
        ? { line: start.line, column: start.column }
        : {};
    })();

    const tables = (section.content ?? []).filter(
      item => item.type === 'Table' || item.type === 'table'
    );

    if (tables.length === 0) {
      addIssue(issues, {
        code: 'MALFORMED_TABLE',
        message: `Section "${section.name}" must contain a table with columns: ${REQUIRED_PORT_COLUMNS.join(', ')}`,
        severity: 'error',
        ...secLoc,
        path: pathBase,
      });
      continue;
    }

    for (let t = 0; t < tables.length; t++) {
      const table = tables[t]!;
      const headers = headerTexts(table.headers);
      const normalized = headers.map(normalizeHeader);
      const tblLoc =
        table.line != null
          ? { line: table.line, column: table.column }
          : secLoc;

      for (const required of REQUIRED_PORT_COLUMNS) {
        if (!normalized.includes(required)) {
          addIssue(issues, {
            code: 'MISSING_REQUIRED_COLUMN',
            message: `Table in "${section.name}" is missing required column "${required}"`,
            severity: 'error',
            ...tblLoc,
            path: `${pathBase}.table[${t}]`,
          });
        }
      }

      const nameIdx = normalized.indexOf('name');
      const typeIdx = normalized.indexOf('type');
      const rows = table.rows ?? [];

      const seen = new Set<string>();
      for (let r = 0; r < rows.length; r++) {
        const row = rows[r]!;
        if (row.length !== headers.length) {
          addIssue(issues, {
            code: 'MALFORMED_TABLE',
            message: `Row ${r + 1} in "${section.name}" table has ${row.length} columns, expected ${headers.length}`,
            severity: 'error',
            ...tblLoc,
            path: `${pathBase}.table[${t}].row[${r}]`,
          });
        }

        const name =
          nameIdx >= 0 ? cellText(row[nameIdx] ?? '').trim() : '';
        if (name === '') continue;

        if (seen.has(name)) {
          addIssue(issues, {
            code: 'DUPLICATE_INPUT',
            message: `Duplicate ${kind} name "${name}" in "${section.name}"`,
            severity: 'error',
            ...tblLoc,
            path: `${pathBase}.table[${t}].row[${r}].name`,
          });
        }
        seen.add(name);

        if (typeIdx >= 0) {
          const type = cellText(row[typeIdx] ?? '').trim().toLowerCase();
          if (type !== '' && !(VALID_PORT_TYPES as readonly string[]).includes(type)) {
            addIssue(issues, {
              code: 'INVALID_TYPE',
              message: `Invalid ${kind} type "${type}" for "${name}"; expected one of [${VALID_PORT_TYPES.join(', ')}]`,
              severity: 'warning',
              ...tblLoc,
              path: `${pathBase}.table[${t}].row[${r}].type`,
            });
          }
        }
      }
    }
  }

  return issues;
}