/**
 * Reference Validation Rules
 *
 * Validates URL format, reference titles, duplicate references,
 * domain allowlists, and internal vs external classification.
 */

export type Severity = 'error' | 'warning' | 'info';

export interface ReferenceIssue {
  rule: string;
  code: string;
  message: string;
  severity: Severity;
  line?: number;
  column?: number;
  path?: string;
}

export interface ParsedReference {
  url: string;
  title?: string;
  isInternal: boolean;
  line?: number;
  column?: number;
}

const URL_RE = /^https?:\/\/[^\s)>]+$/i;
const ANY_URL_RE = /[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s)>]+/g;
const ANY_URL_RE_TEST = /[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s)>]+/;
const INTERNAL_DOMAINS = ['localhost', '127.0.0.1', '::1', '10.', '192.168.', '172.16.', '172.17.', '172.18.', '172.19.', '172.20.', '172.21.', '172.22.', '172.23.', '172.24.', '172.25.', '172.26.', '172.27.', '172.28.', '172.29.', '172.30.', '172.31.'];
const PRIVATE_SUFFIXES = ['.internal', '.local', '.corp', '.lan', '.private'];

function isInternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    if (INTERNAL_DOMAINS.some(p => host.startsWith(p) || host === p)) return true;
    if (PRIVATE_SUFFIXES.some(s => host.endsWith(s))) return true;
    if (host === 'localhost') return true;
    return false;
  } catch {
    return false;
  }
}

function extractReferences(ast: unknown): ParsedReference[] {
  const doc = ast as Record<string, unknown>;
  const sections = (doc.sections as Array<{
    name: string;
    content?: Array<{
      type: string;
      value?: string;
      url?: string;
      title?: string;
      line?: number;
      column?: number;
    }>;
  }>) || [];

  const refs: ParsedReference[] = [];

  for (const section of sections) {
    if (!section.content) continue;

    for (const item of section.content) {
      if (item.url && ANY_URL_RE_TEST.test(item.url)) {
        refs.push({
          url: item.url,
          title: item.title,
          isInternal: isInternalUrl(item.url),
          line: item.line,
          column: item.column,
        });
        continue;
      }

      if (item.type === 'paragraph' && item.value) {
        let match: RegExpExecArray | null;
        while ((match = ANY_URL_RE.exec(item.value)) !== null) {
          const url = match[0];
          refs.push({
            url,
            isInternal: isInternalUrl(url),
            line: item.line,
            column: item.column,
          });
        }
      }

      if (
        (item.type === 'link' || item.type === 'Link') &&
        item.url &&
        ANY_URL_RE_TEST.test(item.url)
      ) {
        refs.push({
          url: item.url,
          title: item.title,
          isInternal: isInternalUrl(item.url),
          line: item.line,
          column: item.column,
        });
      }
    }
  }

  return refs;
}

function addIssue(
  issues: ReferenceIssue[],
  opts: Omit<ReferenceIssue, 'rule'>
): void {
  issues.push({ rule: 'references', ...opts });
}

export function validateReferences(
  ast: unknown,
  opts?: {
    checkDead?: boolean;
    requireTitle?: boolean;
    allowedDomains?: string[];
    flagInternal?: boolean;
  }
): ReferenceIssue[] {
  const issues: ReferenceIssue[] = [];
  const refs = extractReferences(ast);
  const seen = new Map<string, number[]>();

  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i]!;
    const loc =
      ref.line != null ? { line: ref.line, column: ref.column } : {};

    const isValidHttpUrl = URL_RE.test(ref.url);
    const isAnyUrl = ANY_URL_RE_TEST.test(ref.url);

    if (!isAnyUrl) {
      addIssue(issues, {
        code: 'INVALID_URL_FORMAT',
        message: `URL is not a valid URL: "${ref.url}"`,
        severity: 'error',
        ...loc,
        path: `references[${i}]`,
      });
      continue;
    }

    if (!isValidHttpUrl) {
      try {
        const parsed = new URL(ref.url);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          addIssue(issues, {
            code: 'INVALID_URL_PROTOCOL',
            message: `URL must use http or https protocol: "${ref.url}"`,
            severity: 'warning',
            ...loc,
            path: `references[${i}]`,
          });
        }
      } catch {
        addIssue(issues, {
          code: 'MALFORMED_URL',
          message: `Malformed URL: "${ref.url}"`,
          severity: 'error',
          ...loc,
          path: `references[${i}]`,
        });
      }
    }

    if (opts?.requireTitle && !ref.title) {
      addIssue(issues, {
        code: 'MISSING_REFERENCE_TITLE',
        message: `Reference URL lacks a descriptive title: "${ref.url}"`,
        severity: 'info',
        ...loc,
        path: `references[${i}]`,
      });
    }

    if (opts?.allowedDomains && opts.allowedDomains.length > 0) {
      try {
        const hostname = new URL(ref.url).hostname;
        const allowed = opts.allowedDomains.some(
          d => hostname === d || hostname.endsWith('.' + d)
        );
        if (!allowed) {
          addIssue(issues, {
            code: 'URL_DOMAIN_NOT_ALLOWLISTED',
            message: `URL domain "${hostname}" is not in the allowlist`,
            severity: 'warning',
            ...loc,
            path: `references[${i}]`,
          });
        }
      } catch {
        // already flagged as malformed
      }
    }

    if (opts?.flagInternal && ref.isInternal) {
      addIssue(issues, {
        code: 'INTERNAL_URL_EXPOSED',
        message: `Internal/private URL exposed in references: "${ref.url}"`,
        severity: 'warning',
        ...loc,
        path: `references[${i}]`,
      });
    }

    if (!seen.has(ref.url)) {
      seen.set(ref.url, []);
    }
    seen.get(ref.url)!.push(i);
  }

  for (const [url, indices] of seen) {
    if (indices.length > 1) {
      for (const idx of indices) {
        const ref = refs[idx]!;
        const loc =
          ref.line != null ? { line: ref.line, column: ref.column } : {};
        addIssue(issues, {
          code: 'DUPLICATE_REFERENCE',
          message: `Duplicate reference URL: "${url}"`,
          severity: 'warning',
          ...loc,
          path: `references[${idx}]`,
        });
      }
    }
  }

  if (opts?.checkDead) {
    for (let i = 0; i < refs.length; i++) {
      const ref = refs[i]!;
      const loc =
        ref.line != null ? { line: ref.line, column: ref.column } : {};
      const domain = (() => {
        try {
          return new URL(ref.url).hostname;
        } catch {
          return null;
        }
      })();
      if (domain) {
        const suspicious = [
          'example.com',
          'example.org',
          'example.net',
          'test.com',
          'localhost',
        ];
        if (suspicious.includes(domain)) {
          addIssue(issues, {
            code: 'SUSPICIOUS_URL',
            message: `URL points to a placeholder/test domain: "${ref.url}"`,
            severity: 'info',
            ...loc,
            path: `references[${i}]`,
          });
        }
      }
    }
  }

  return issues;
}

const MARKDOWN_LINK_RE = /\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
const URL_SCAN_RE = /[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s)>]+/g;

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

/**
 * Extract reference URLs from the `References` section.
 *
 * Scans the section named "References" and returns parsed references for
 * every URL found, including URLs pulled out of markdown `[text](url)` links.
 * The {@link ParsedReference} shape is preserved, with `url` populated
 * whenever a URL is located.
 *
 * @param ast - The MAM AST (expects `ast.sections`).
 * @returns A list of {@link ParsedReference} objects; empty when the section
 * is absent or contains no URLs.
 * @remarks Parses `Link`-typed content nodes, inline `url` fields, markdown
 * link syntax inside paragraph text, and bare URLs appearing in text.
 */
export function extractReferenceUrls(ast: unknown): ParsedReference[] {
  const doc = ast as Record<string, unknown>;
  const sections = (doc.sections as Array<{
    name?: string;
    content?: Array<Record<string, unknown>>;
  }>) || [];

  const refs: ParsedReference[] = [];

  for (const section of sections) {
    if (section.name !== 'References') continue;

    for (const item of section.content ?? []) {
      const type = item.type;
      const url = typeof item.url === 'string' ? item.url : undefined;
      const title = typeof item.title === 'string' ? item.title : undefined;
      const line = asNumber(item.line);
      const column = asNumber(item.column);

      if (url && ANY_URL_RE_TEST.test(url)) {
        refs.push({ url, title, isInternal: isInternalUrl(url), line, column });
        continue;
      }

      const value = typeof item.value === 'string' ? item.value : undefined;
      if (value) {
        MARKDOWN_LINK_RE.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = MARKDOWN_LINK_RE.exec(value)) !== null) {
          const linkUrl = match[2]!;
          if (ANY_URL_RE_TEST.test(linkUrl)) {
            refs.push({
              url: linkUrl,
              title: match[1] ? match[1] : title,
              isInternal: isInternalUrl(linkUrl),
              line,
              column,
            });
          }
        }

        URL_SCAN_RE.lastIndex = 0;
        while ((match = URL_SCAN_RE.exec(value)) !== null) {
          const found = match[0];
          if (ANY_URL_RE_TEST.test(found) && !refs.some(r => r.url === found)) {
            refs.push({
              url: found,
              title,
              isInternal: isInternalUrl(found),
              line,
              column,
            });
          }
        }
      }

      if (
        (type === 'link' || type === 'Link') &&
        url &&
        ANY_URL_RE_TEST.test(url)
      ) {
        refs.push({ url, title, isInternal: isInternalUrl(url), line, column });
      }
    }
  }

  return refs;
}
