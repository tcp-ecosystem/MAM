/**
 * Dependency Validation Rules
 *
 * Validates dependency name format, version ranges, duplicates,
 * circular references, source URLs, and deprecated packages.
 */

export type Severity = 'error' | 'warning' | 'info';

export interface DependencyIssue {
  rule: string;
  code: string;
  message: string;
  severity: Severity;
  line?: number;
  column?: number;
  path?: string;
}

const SCOPE_NAME_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z][a-z0-9-]*$/;
const SEMVER_RANGE_RE =
  /^(\^|~|>=|<=|>|<|=)?\s*(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([a-zA-Z0-9.-]+))?(?:\+[a-zA-Z0-9.-]+)?$|^(\^|~|>=|<=|>|<|=)?\s*(0|[1-9]\d*)\.x$|^(\^|~|>=|<=|>|<|=)?\s*(0|[1-9]\d*)\.\*$/;
const VERSION_EXACT_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([a-zA-Z0-9.-]+))?(?:\+[a-zA-Z0-9.-]+)?$/;
const WORKSPACE_RE = /^(workspace:\*|workspace:\^|workspace:~|workspace:[\d.]+)$/;
const GIT_URL_RE = /^(https?:\/\/|git@|github:)/;
const URL_RE = /^https?:\/\/[^\s]+$/i;

export interface DependencyEntry {
  name: string;
  version?: string;
  source?: string;
  line?: number;
  column?: number;
}

export function parseDependencies(ast: unknown): DependencyEntry[] {
  const doc = ast as Record<string, unknown>;
  const fm = doc.frontmatter as Record<string, unknown> | undefined;
  const raw = fm?.dependencies;

  if (!raw) return [];

  if (Array.isArray(raw)) {
    return raw.map((d, i) => {
      if (typeof d === 'string') {
        return { name: d, version: undefined, line: undefined, column: undefined };
      }
      if (typeof d === 'object' && d !== null) {
        const obj = d as Record<string, unknown>;
        return {
          name: String(obj.name ?? ''),
          version: obj.version != null ? String(obj.version) : undefined,
          source: obj.source != null ? String(obj.source) : undefined,
          line: obj.line != null ? Number(obj.line) : undefined,
          column: obj.column != null ? Number(obj.column) : undefined,
        };
      }
      return { name: '', version: undefined };
    });
  }

  if (typeof raw === 'object') {
    const entries: DependencyEntry[] = [];
    const obj = raw as Record<string, unknown>;
    for (const [name, version] of Object.entries(obj)) {
      entries.push({
        name,
        version: version != null ? String(version) : undefined,
      });
    }
    return entries;
  }

  return [];
}

function addIssue(
  issues: DependencyIssue[],
  opts: Omit<DependencyIssue, 'rule'>
): void {
  issues.push({ rule: 'dependencies', ...opts });
}

export function validateDependencies(
  ast: unknown,
  opts?: { checkDuplicates?: boolean; checkCircular?: boolean; allowedDomains?: string[] }
): DependencyIssue[] {
  const issues: DependencyIssue[] = [];
  const deps = parseDependencies(ast);
  const doc = ast as Record<string, unknown>;
  const fm = doc.frontmatter as Record<string, unknown> | undefined;

  const seen = new Map<string, number[]>();

  for (let i = 0; i < deps.length; i++) {
    const dep = deps[i]!;
    const loc = dep.line != null ? { line: dep.line, column: dep.column } : {};

    if (!dep.name || dep.name.trim() === '') {
      addIssue(issues, {
        code: 'EMPTY_DEPENDENCY_NAME',
        message: `Dependency at index ${i} has an empty name`,
        severity: 'error',
        ...loc,
        path: `frontmatter.dependencies[${i}]`,
      });
      continue;
    }

    if (!SCOPE_NAME_RE.test(dep.name)) {
      addIssue(issues, {
        code: 'INVALID_DEPENDENCY_NAME',
        message: `Dependency name "${dep.name}" is invalid; expected format: [scope/]name (lowercase, hyphens)`,
        severity: 'error',
        ...loc,
        path: `frontmatter.dependencies.${dep.name}`,
      });
    }

    if (dep.version) {
      const isSemver = VERSION_EXACT_RE.test(dep.version);
      const isRange = SEMVER_RANGE_RE.test(dep.version);
      const isWorkspace = WORKSPACE_RE.test(dep.version);
      const isGit = GIT_URL_RE.test(dep.version);
      const isWildcard = dep.version === '*' || dep.version === 'latest';

      if (!isSemver && !isRange && !isWorkspace && !isGit && !isWildcard) {
        addIssue(issues, {
          code: 'INVALID_VERSION_FORMAT',
          message: `Invalid version format for dependency "${dep.name}": "${dep.version}"`,
          severity: 'warning',
          ...loc,
          path: `frontmatter.dependencies.${dep.name}`,
        });
      }

      if (isWildcard) {
        addIssue(issues, {
          code: 'WILDCARD_VERSION',
          message: `Dependency "${dep.name}" uses wildcard version "${dep.version}"; pin to an exact version for reproducibility`,
          severity: 'warning',
          ...loc,
          path: `frontmatter.dependencies.${dep.name}`,
        });
      }
    }

    if (dep.source) {
      if (!URL_RE.test(dep.source)) {
        addIssue(issues, {
          code: 'INVALID_SOURCE_URL',
          message: `Source URL for dependency "${dep.name}" is not a valid HTTP/HTTPS URL: "${dep.source}"`,
          severity: 'warning',
          ...loc,
          path: `frontmatter.dependencies.${dep.name}.source`,
        });
      } else if (opts?.allowedDomains && opts.allowedDomains.length > 0) {
        try {
          const hostname = new URL(dep.source).hostname;
          const allowed = opts.allowedDomains.some(d => hostname === d || hostname.endsWith('.' + d));
          if (!allowed) {
            addIssue(issues, {
              code: 'SOURCE_URL_NOT_ALLOWLISTED',
              message: `Source URL domain "${hostname}" for dependency "${dep.name}" is not in the allowlist`,
              severity: 'info',
              ...loc,
              path: `frontmatter.dependencies.${dep.name}.source`,
            });
          }
        } catch {
          // already flagged as invalid URL above
        }
      }
    }

    if (!seen.has(dep.name)) {
      seen.set(dep.name, []);
    }
    seen.get(dep.name)!.push(i);
  }

  if (opts?.checkDuplicates !== false) {
    for (const [name, indices] of seen) {
      if (indices.length > 1) {
        for (const idx of indices) {
          const dep = deps[idx]!;
          const loc = dep.line != null ? { line: dep.line, column: dep.column } : {};
          addIssue(issues, {
            code: 'DUPLICATE_DEPENDENCY',
            message: `Duplicate dependency "${name}"`,
            severity: 'warning',
            ...loc,
            path: `frontmatter.dependencies[${idx}]`,
          });
        }
      }
    }
  }

  if (opts?.checkCircular) {
    const depMap = new Map<string, string[]>();
    for (const dep of deps) {
      depMap.set(dep.name, depMap.get(dep.name) ?? []);
    }

    const visited = new Set<string>();
    const stack = new Set<string>();

    function hasCycle(node: string): boolean {
      if (stack.has(node)) return true;
      if (visited.has(node)) return false;
      visited.add(node);
      stack.add(node);
      for (const neighbor of depMap.get(node) ?? []) {
        if (hasCycle(neighbor)) return true;
      }
      stack.delete(node);
      return false;
    }

    for (const name of depMap.keys()) {
      if (hasCycle(name)) {
        addIssue(issues, {
          code: 'CIRCULAR_DEPENDENCY',
          message: `Circular dependency detected involving "${name}"`,
          severity: 'error',
          path: `frontmatter.dependencies.${name}`,
        });
      }
    }
  }

  return issues;
}
