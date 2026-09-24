/**
 * MAM Capabilities Section Validation Rules
 *
 * Validates the `## Capabilities` section: sub-headings (`### name`) become
 * capability names, empty capabilities are detected, and duplicate names are
 * flagged.
 */

export type Severity = 'error' | 'warning' | 'info';

export interface CapabilitiesIssue {
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
  level?: number;
  line?: number;
  column?: number;
}

interface CapabilitySection {
  name: string;
  location?: { start?: { line?: number; column?: number } };
  content?: ContentItem[];
}

function isHeading(item: ContentItem): boolean {
  const type = String(item.type ?? '').toLowerCase();
  return type === 'heading' || type === 'h3' || /^h[1-6]$/.test(type);
}

function headingLevel(item: ContentItem): number {
  if (typeof item.level === 'number' && item.level > 0) return item.level;
  const match = /^h([1-6])$/.exec(String(item.type ?? ''));
  if (match) return Number(match[1]);
  return 3;
}

function isEmptyValue(value: unknown): boolean {
  return typeof value !== 'string' || value.trim() === '';
}

function addIssue(
  issues: CapabilitiesIssue[],
  opts: Omit<CapabilitiesIssue, 'rule'>
): void {
  issues.push({ rule: 'capabilities', ...opts });
}

/**
 * Validate the `## Capabilities` section.
 *
 * Sub-headings (`### name`) inside the section are treated as capability
 * names. The validator flags an absent or content-free section, empty
 * capabilities, duplicate names, and capabilities lacking a prose
 * description.
 *
 * @param ast - The MAM AST (expects `ast.sections`).
 * @returns A list of {@link CapabilitiesIssue} objects; empty when valid.
 * @remarks Emits `EMPTY_CAPABILITIES` when the section is missing/empty or a
 * capability has no content, `DUPLICATE_CAPABILITY` for repeated names, and
 * `MISSING_CAPABILITY_DESCRIPTION` when a capability body lacks a paragraph.
 */
export function validateCapabilities(ast: unknown): CapabilitiesIssue[] {
  const issues: CapabilitiesIssue[] = [];
  const doc = ast as Record<string, unknown>;
  const sections = (doc.sections as CapabilitySection[] | undefined) || [];

  const section = sections.find(s => s.name === 'Capabilities');
  const secLoc = section?.location?.start;
  const baseLoc =
    secLoc && secLoc.line != null
      ? { line: secLoc.line, column: secLoc.column }
      : {};

  if (!section || !section.content || section.content.length === 0) {
    addIssue(issues, {
      code: 'EMPTY_CAPABILITIES',
      message: 'Capabilities section is missing or empty',
      severity: 'warning',
      ...baseLoc,
      path: 'sections.Capabilities',
    });
    return issues;
  }

  const capabilities: Array<{
    name: string;
    line?: number;
    column?: number;
    body: ContentItem[];
  }> = [];

  let current: {
    name: string;
    line?: number;
    column?: number;
    body: ContentItem[];
  } | null = null;

  for (const item of section.content) {
    if (isHeading(item) && headingLevel(item) >= 3) {
      current = {
        name: typeof item.value === 'string' ? item.value.trim() : '',
        line: item.line,
        column: item.column,
        body: [],
      };
      capabilities.push(current);
      continue;
    }
    if (current) current.body.push(item);
  }

  if (capabilities.length === 0) {
    addIssue(issues, {
      code: 'EMPTY_CAPABILITIES',
      message: 'Capabilities section declares no capabilities (no "### name" sub-headings)',
      severity: 'warning',
      ...baseLoc,
      path: 'sections.Capabilities',
    });
    return issues;
  }

  const seen = new Map<string, number>();
  for (let i = 0; i < capabilities.length; i++) {
    const cap = capabilities[i]!;
    const capLoc =
      cap.line != null ? { line: cap.line, column: cap.column } : baseLoc;

    if (isEmptyValue(cap.name)) {
      addIssue(issues, {
        code: 'EMPTY_CAPABILITIES',
        message: `Capability at index ${i} has an empty name`,
        severity: 'error',
        ...capLoc,
        path: `sections.Capabilities.capabilities[${i}]`,
      });
      continue;
    }

    if (seen.has(cap.name)) {
      addIssue(issues, {
        code: 'DUPLICATE_CAPABILITY',
        message: `Duplicate capability "${cap.name}"`,
        severity: 'error',
        ...capLoc,
        path: `sections.Capabilities.capabilities[${i}].${cap.name}`,
      });
    }
    seen.set(cap.name, i);

    if (cap.body.length === 0) {
      addIssue(issues, {
        code: 'EMPTY_CAPABILITIES',
        message: `Capability "${cap.name}" is empty`,
        severity: 'error',
        ...capLoc,
        path: `sections.Capabilities.capabilities[${i}].${cap.name}`,
      });
      continue;
    }

    const hasDescription = cap.body.some(
      bodyItem => String(bodyItem.type ?? '').toLowerCase() === 'paragraph'
    );
    if (!hasDescription) {
      addIssue(issues, {
        code: 'MISSING_CAPABILITY_DESCRIPTION',
        message: `Capability "${cap.name}" has no prose description`,
        severity: 'warning',
        ...capLoc,
        path: `sections.Capabilities.capabilities[${i}].${cap.name}`,
      });
    }
  }

  return issues;
}