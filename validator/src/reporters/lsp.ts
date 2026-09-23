/**
 * LSP Validation Reporter
 *
 * Full Language Server Protocol diagnostic output with severity mapping,
 * related information, diagnostic codes, code actions, and tags.
 */

export interface ValidationIssue {
  rule: string;
  code?: string;
  message: string;
  severity: 'error' | 'warning' | 'info';
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  path?: string;
}

export interface ValidationReport {
  file: string;
  issues: ValidationIssue[];
  passed: boolean;
}

/** LSP DiagnosticSeverity: Error=1, Warning=2, Information=3, Hint=4 */
export type LSPSeverity = 1 | 2 | 3 | 4;

/** LSP DiagnosticTag: Unnecessary=1, Deprecated=2 */
export type LSPDiagnosticTag = 1 | 2;

export interface LSPPosition {
  line: number;
  character: number;
}

export interface LSPRange {
  start: LSPPosition;
  end: LSPPosition;
}

export interface LSPRelatedInformation {
  location: {
    uri: string;
    range: LSPRange;
  };
  message: string;
}

export interface LSPCodeAction {
  title: string;
  kind: 'quickfix' | 'refactor' | 'source';
  diagnostics: LSPDiagnostic[];
  edit?: Record<string, unknown>;
}

export interface LSPDiagnostic {
  range: LSPRange;
  severity: LSPSeverity;
  code: string;
  codeDescription?: {
    href: string;
  };
  source: string;
  message: string;
  tags?: LSPDiagnosticTag[];
  relatedInformation?: LSPRelatedInformation[];
  data?: unknown;
}

export interface LSPResult {
  uri: string;
  diagnostics: LSPDiagnostic[];
  codeActions?: LSPCodeAction[];
}

export interface LSPWorkspaceDiagnosticItem {
  uri: string;
  version: number | null;
  kind: 'full';
  items: LSPDiagnostic[];
}

export interface LSPWorkspaceDiagnosticReport {
  kind: 'workspace/diagnostic';
  items: LSPWorkspaceDiagnosticItem[];
}

export interface LSPPublishDiagnosticsParams {
  uri: string;
  diagnostics: LSPDiagnostic[];
}

export interface LSPPublishDiagnosticsNotification {
  method: 'textDocument/publishDiagnostics';
  params: LSPPublishDiagnosticsParams;
}

export interface LSPReporterOptions {
  /** Source name reported in diagnostics (default: 'mam-validator') */
  source?: string;
  /** Include related information (default: true) */
  includeRelatedInformation?: boolean;
  /** Include code actions (default: true) */
  includeCodeActions?: boolean;
  /** Custom code action map (rule -> action factory) */
  codeActionMap?: Record<string, (issue: ValidationIssue) => LSPCodeAction>;
  /** Custom URI used in diagnostics (default: derived from file) */
  uri?: string;
  /** Return a workspace/diagnostic-style report grouped per file (default: false) */
  workspace?: boolean;
}

function severityToLSP(severity: string): LSPSeverity {
  switch (severity) {
    case 'error':
      return 1;
    case 'warning':
      return 2;
    case 'info':
      return 3;
    default:
      return 3;
  }
}

function computeEndPosition(issue: ValidationIssue): LSPPosition {
  if (issue.endLine != null && issue.endColumn != null) {
    return { line: issue.endLine - 1, character: issue.endColumn };
  }
  if (issue.line != null) {
    return { line: issue.line - 1, character: (issue.column ?? 0) + 1 };
  }
  return { line: 0, character: 0 };
}

const TAG_MAP: Record<string, LSPDiagnosticTag[]> = {
  deprecated: [2],
  unnecessary: [1],
};

function inferTags(issue: ValidationIssue): LSPDiagnosticTag[] | undefined {
  if (issue.code?.includes('DEPRECATED')) return TAG_MAP.deprecated;
  if (issue.code?.includes('UNNECESSARY')) return TAG_MAP.unnecessary;
  return undefined;
}

function inferCodeDescription(
  issue: ValidationIssue
): { href: string } | undefined {
  if (!issue.rule) return undefined;
  const base = 'https://mam.dev/docs/validation/rules';
  return { href: `${base}#${issue.rule}` };
}

function buildRelatedInformation(
  issue: ValidationIssue,
  fileUri: string
): LSPRelatedInformation[] | undefined {
  if (!issue.path) return undefined;
  return [
    {
      location: {
        uri: fileUri,
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
      },
      message: `At path: ${issue.path}`,
    },
  ];
}

function buildCodeAction(
  issue: ValidationIssue,
  diagnostic: LSPDiagnostic
): LSPCodeAction | undefined {
  switch (issue.code) {
    case 'MISSING_REQUIRED_FIELD':
      return {
        title: `Add missing field "${issue.path?.split('.').pop() ?? ''}"`,
        kind: 'quickfix',
        diagnostics: [diagnostic],
        edit: {
          changes: {
            [issue.path ?? '']: [{ range: diagnostic.range, newText: '' }],
          },
        },
      };
    case 'INVALID_ID_FORMAT':
      return {
        title: 'Convert to kebab-case',
        kind: 'quickfix',
        diagnostics: [diagnostic],
      };
    case 'SECTION_OUT_OF_ORDER':
      return {
        title: 'Move section to correct position',
        kind: 'refactor',
        diagnostics: [diagnostic],
      };
    case 'DUPLICATE_SECTION':
      return {
        title: 'Remove duplicate section',
        kind: 'quickfix',
        diagnostics: [diagnostic],
      };
    case 'DUPLICATE_DEPENDENCY':
    case 'DUPLICATE_REFERENCE':
      return {
        title: 'Remove duplicate',
        kind: 'quickfix',
        diagnostics: [diagnostic],
      };
    default:
      return undefined;
  }
}

function sortIssues(issues: ValidationIssue[]): ValidationIssue[] {
  return [...issues].sort((a, b) => {
    const sevA = severityToLSP(a.severity);
    const sevB = severityToLSP(b.severity);
    if (sevA !== sevB) return sevA - sevB;
    const lineA = a.line ?? Infinity;
    const lineB = b.line ?? Infinity;
    if (lineA !== lineB) return lineA - lineB;
    return (a.column ?? 0) - (b.column ?? 0);
  });
}

export class LSPReporter {
  private options: LSPReporterOptions;

  constructor(options?: LSPReporterOptions) {
    this.options = {
      source: 'mam-validator',
      includeRelatedInformation: true,
      includeCodeActions: true,
      workspace: false,
      ...options,
    };
  }

  private buildDiagnostics(
    sorted: ValidationIssue[],
    fileUri: string
  ): { diagnostics: LSPDiagnostic[]; codeActions: LSPCodeAction[] } {
    const diagnostics: LSPDiagnostic[] = [];
    const codeActions: LSPCodeAction[] = [];

    for (const issue of sorted) {
      const start: LSPPosition = {
        line: (issue.line ?? 1) - 1,
        character: issue.column ?? 0,
      };
      const end = computeEndPosition(issue);

      const diagnostic: LSPDiagnostic = {
        range: { start, end },
        severity: severityToLSP(issue.severity),
        code: issue.code ?? issue.rule,
        source: this.options.source!,
        message: `[${issue.rule}] ${issue.message}`,
      };

      const desc = inferCodeDescription(issue);
      if (desc) diagnostic.codeDescription = desc;

      const tags = inferTags(issue);
      if (tags) diagnostic.tags = tags;

      if (this.options.includeRelatedInformation) {
        const related = buildRelatedInformation(issue, fileUri);
        if (related) diagnostic.relatedInformation = related;
      }

      diagnostics.push(diagnostic);

      if (this.options.includeCodeActions) {
        const customAction = this.options.codeActionMap?.[issue.code ?? '']?.(issue);
        if (customAction) {
          codeActions.push(customAction);
        } else {
          const action = buildCodeAction(issue, diagnostic);
          if (action) codeActions.push(action);
        }
      }
    }

    return { diagnostics, codeActions };
  }

  report(result: ValidationReport): LSPResult | LSPWorkspaceDiagnosticReport {
    const sorted = sortIssues(result.issues);
    const fileUri =
      this.options.uri ?? `file:///${result.file.replace(/\\/g, '/')}`;
    const { diagnostics, codeActions } = this.buildDiagnostics(sorted, fileUri);

    if (this.options.workspace) {
      return {
        kind: 'workspace/diagnostic',
        items: [
          {
            uri: fileUri,
            version: null,
            kind: 'full',
            items: diagnostics,
          },
        ],
      };
    }

    return {
      uri: fileUri,
      diagnostics,
      codeActions: codeActions.length > 0 ? codeActions : undefined,
    };
  }

  publishDiagnostics(
    result: ValidationReport
  ): LSPPublishDiagnosticsNotification {
    const sorted = sortIssues(result.issues);
    const fileUri =
      this.options.uri ?? `file:///${result.file.replace(/\\/g, '/')}`;
    const { diagnostics } = this.buildDiagnostics(sorted, fileUri);

    return {
      method: 'textDocument/publishDiagnostics',
      params: {
        uri: fileUri,
        diagnostics,
      },
    };
  }
}
