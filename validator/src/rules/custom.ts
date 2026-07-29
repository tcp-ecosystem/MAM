/**
 * Custom Validation Rule Support
 *
 * Full-featured custom rule engine with severity levels, categories,
 * per-rule options, async support, time limits, and issue deduplication.
 */

export type ValidationSeverity = 'error' | 'warning' | 'info';
export type RuleCategory = 'structural' | 'semantic' | 'style';

export interface CustomIssue {
  rule: string;
  code: string;
  message: string;
  severity: ValidationSeverity;
  line?: number;
  column?: number;
  path?: string;
  category?: RuleCategory;
}

export interface CustomRuleConfig {
  /** Per-rule options passed to the validate function */
  [key: string]: unknown;
}

export interface CustomRule {
  name: string;
  description?: string;
  severity: ValidationSeverity;
  category?: RuleCategory;
  /** Per-rule options */
  config?: CustomRuleConfig;
  /** Timeout per rule in milliseconds (default: 5000) */
  timeoutMs?: number;
  validate: (
    ast: unknown,
    config?: CustomRuleConfig
  ) => CustomIssue[] | Promise<CustomIssue[]>;
}

export interface CustomValidationOptions {
  /** Global timeout per rule in ms (default: 5000) */
  defaultTimeoutMs?: number;
  /** Skip rules matching these categories */
  excludeCategories?: RuleCategory[];
  /** Only run rules matching these categories */
  onlyCategories?: RuleCategory[];
  /** Maximum issues to collect before stopping */
  maxIssues?: number;
  /** Whether to deduplicate issues (default: true) */
  deduplicate?: boolean;
}

const DEFAULT_OPTS: Required<CustomValidationOptions> = {
  defaultTimeoutMs: 5000,
  excludeCategories: [],
  onlyCategories: [],
  maxIssues: 500,
  deduplicate: true,
};

function issueKey(issue: CustomIssue): string {
  return `${issue.rule}::${issue.code}::${issue.message}`;
}

function timeoutPromise(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`Rule timed out after ${ms}ms`)), ms);
  });
}

function addIssue(
  issues: CustomIssue[],
  opts: Omit<CustomIssue, 'rule'>
): void {
  issues.push({ rule: 'custom', ...opts });
}

export async function validateCustom(
  ast: unknown,
  rules: CustomRule[] = [],
  options?: CustomValidationOptions
): Promise<CustomIssue[]> {
  const opts = { ...DEFAULT_OPTS, ...options };
  const issues: CustomIssue[] = [];
  const seen = new Set<string>();

  const filtered = rules.filter(rule => {
    if (opts.excludeCategories.length > 0 && rule.category) {
      if (opts.excludeCategories.includes(rule.category)) return false;
    }
    if (opts.onlyCategories.length > 0) {
      if (!rule.category || !opts.onlyCategories.includes(rule.category)) return false;
    }
    return true;
  });

  for (const rule of filtered) {
    if (issues.length >= opts.maxIssues) break;

    const timeoutMs = rule.timeoutMs ?? opts.defaultTimeoutMs;

    try {
      const resultOrPromise = rule.validate(ast, rule.config);
      const result = await Promise.race([
        Promise.resolve(resultOrPromise),
        timeoutPromise(timeoutMs),
      ]);

      for (const issue of result) {
        if (issues.length >= opts.maxIssues) break;

        const enriched: CustomIssue = {
          ...issue,
          rule: rule.name,
          category: rule.category ?? issue.category,
        };

        if (opts.deduplicate) {
          const key = issueKey(enriched);
          if (seen.has(key)) continue;
          seen.add(key);
        }

        issues.push(enriched);
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err);
      addIssue(issues, {
        code: 'RULE_EXECUTION_ERROR',
        message: `Custom rule "${rule.name}" failed: ${message}`,
        severity: 'warning',
        category: rule.category,
      });
    }
  }

  return issues;
}

export function validateCustomSync(
  ast: unknown,
  rules: CustomRule[] = [],
  options?: CustomValidationOptions
): CustomIssue[] {
  const opts = { ...DEFAULT_OPTS, ...options };
  const issues: CustomIssue[] = [];
  const seen = new Set<string>();

  const filtered = rules.filter(rule => {
    if (opts.excludeCategories.length > 0 && rule.category) {
      if (opts.excludeCategories.includes(rule.category)) return false;
    }
    if (opts.onlyCategories.length > 0) {
      if (!rule.category || !opts.onlyCategories.includes(rule.category)) return false;
    }
    return true;
  });

  for (const rule of filtered) {
    if (issues.length >= opts.maxIssues) break;

    try {
      const result = rule.validate(ast, rule.config);
      if (result instanceof Promise) {
        addIssue(issues, {
          code: 'ASYNC_RULE_IN_SYNC_CONTEXT',
          message: `Custom rule "${rule.name}" returned a Promise but was called synchronously`,
          severity: 'warning',
          category: rule.category,
        });
        continue;
      }

      for (const issue of result) {
        if (issues.length >= opts.maxIssues) break;

        const enriched: CustomIssue = {
          ...issue,
          rule: rule.name,
          category: rule.category ?? issue.category,
        };

        if (opts.deduplicate) {
          const key = issueKey(enriched);
          if (seen.has(key)) continue;
          seen.add(key);
        }

        issues.push(enriched);
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err);
      addIssue(issues, {
        code: 'RULE_EXECUTION_ERROR',
        message: `Custom rule "${rule.name}" failed: ${message}`,
        severity: 'warning',
        category: rule.category,
      });
    }
  }

  return issues;
}

export function createCustomRule(
  name: string,
  description: string,
  severity: ValidationSeverity,
  validate: CustomRule['validate'],
  opts?: { category?: RuleCategory; config?: CustomRuleConfig; timeoutMs?: number }
): CustomRule {
  return {
    name,
    description,
    severity,
    category: opts?.category,
    config: opts?.config,
    timeoutMs: opts?.timeoutMs,
    validate,
  };
}
