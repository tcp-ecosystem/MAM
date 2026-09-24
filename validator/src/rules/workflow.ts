/**
 * MAM Workflow Section Validation Rules
 *
 * Validates the `## Workflow` section: it must have content (a list, steps, or
 * a mermaid diagram). Empty workflows and workflows without mermaid/steps are
 * flagged.
 */

export type Severity = 'error' | 'warning' | 'info';

export interface WorkflowIssue {
  rule: string;
  code: string;
  message: string;
  severity: Severity;
  line?: number;
  column?: number;
  path?: string;
}

interface ContentItem {
  type?: string;
  value?: string;
  language?: string;
  items?: unknown[];
  line?: number;
  column?: number;
}

interface WorkflowSection {
  name: string;
  location?: { start?: { line?: number; column?: number } };
  content?: ContentItem[];
}

function isEmptyValue(value: unknown): boolean {
  return typeof value !== 'string' || value.trim() === '';
}

function isMermaidItem(item: ContentItem): boolean {
  const type = String(item.type ?? '').toLowerCase();
  if (type === 'mermaid') return true;
  if (type === 'codeblock' || type === 'code') {
    const lang = String(item.language ?? '').toLowerCase();
    if (lang === 'mermaid') return true;
    const value = String(item.value ?? '');
    return /graph\s+(tb|td|lr|rl|bt)|sequenceDiagram|stateDiagram|classDiagram/i.test(value);
  }
  return false;
}

function hasStructuredSteps(item: ContentItem): boolean {
  const type = String(item.type ?? '').toLowerCase();
  if (type === 'list' && Array.isArray(item.items) && item.items.length > 0) {
    return true;
  }
  if (type === 'codeblock' || type === 'code') {
    const lang = String(item.language ?? '').toLowerCase();
    if (lang !== 'mermaid' && lang !== '') return true;
    return false;
  }
  if (type === 'mermaid') return true;
  return false;
}

function hasMeaningfulContent(items: ContentItem[] | undefined): boolean {
  if (!items || items.length === 0) return false;
  return items.some(item => {
    const type = String(item.type ?? '').toLowerCase();
    if (type === 'heading') return false;
    if (type === 'list') return Array.isArray(item.items) && item.items.length > 0;
    if (type === 'paragraph' || type === 'text') {
      return !isEmptyValue(item.value);
    }
    return true;
  });
}

function addIssue(
  issues: WorkflowIssue[],
  opts: Omit<WorkflowIssue, 'rule'>
): void {
  issues.push({ rule: 'workflow', ...opts });
}

/**
 * Validate the `## Workflow` section.
 *
 * The section must contain meaningful content — a list of steps, step-like
 * code blocks, or a mermaid diagram. An absent or content-free section is
 * reported as an empty workflow; content that lacks mermaid or structured
 * steps is reported as missing workflow steps.
 *
 * @param ast - The MAM AST (expects `ast.sections`).
 * @returns A list of {@link WorkflowIssue} objects; empty when valid.
 * @remarks Emits `EMPTY_WORKFLOW` when the section is missing/empty and
 * `MISSING_WORKFLOW_STEPS` when present content has no mermaid diagram or
 * structured steps.
 */
export function validateWorkflow(ast: unknown): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];
  const doc = ast as Record<string, unknown>;
  const sections = (doc.sections as WorkflowSection[] | undefined) || [];

  const section = sections.find(s => s.name === 'Workflow');
  const secLoc = (() => {
    const start = section?.location?.start;
    return start && start.line != null
      ? { line: start.line, column: start.column }
      : {};
  })();

  if (!section || !hasMeaningfulContent(section.content)) {
    addIssue(issues, {
      code: 'EMPTY_WORKFLOW',
      message: 'Workflow section is missing or empty',
      severity: section ? 'error' : 'warning',
      ...secLoc,
      path: 'sections.Workflow',
    });
    return issues;
  }

  const items = section.content ?? [];
  const hasMermaid = items.some(isMermaidItem);
  const hasSteps = items.some(hasStructuredSteps);

  if (!hasMermaid && !hasSteps) {
    addIssue(issues, {
      code: 'MISSING_WORKFLOW_STEPS',
      message: 'Workflow section has content but no mermaid diagram or structured steps',
      severity: 'warning',
      ...secLoc,
      path: 'sections.Workflow',
    });
  }

  return issues;
}