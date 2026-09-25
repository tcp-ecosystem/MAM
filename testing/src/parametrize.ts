/**
 * MAM Parameterized Tests
 *
 * Run the same test body across multiple cases with formatted case names and
 * per-case pass/fail results.
 */

// ============================================================================
// Types
// ============================================================================

/** A single parameterized test case */
export interface ParamCase {
  /** Case name (already formatted) */
  name: string;
  /** Parameters passed to the test body */
  params: Record<string, unknown>;
}

/** Result of executing one parameterized case */
export interface ParamTestResult {
  /** Case name */
  name: string;
  /** Whether the case passed */
  passed: boolean;
  /** Error message on failure */
  error?: string;
  /** Execution time in ms */
  timeMs: number;
}

/** Test body invoked for each case */
export type ParamTestFn = (
  params: Record<string, unknown>,
  caseName: string
) => void | Promise<void>;

/** Options for {@link parametrize} */
export interface ParametrizeOptions {
  /** Stop executing cases after the first failure */
  bail?: boolean;
}

// ============================================================================
// Case expansion
// ============================================================================

/**
 * Expand a name template and a list of value records into concrete
 * {@link ParamCase} instances. Placeholders use `{name}` syntax and are
 * substituted from each value record.
 *
 * @example
 * expandCases('user {name}', [{ name: 'Alice' }, { name: 'Bob' }])
 * // => [{ name: 'user Alice', params: { name: 'Alice' } }, ...]
 */
export function expandCases(
  template: string,
  values: Record<string, unknown>[]
): ParamCase[] {
  return values.map((params) => ({
    name: formatCaseName(template, params),
    params,
  }));
}

/**
 * Substitute `{name}` placeholders in a template using a parameter record.
 * Unmatched placeholders are left as-is.
 */
export function formatCaseName(
  template: string,
  params: Record<string, unknown>
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    if (!(key in params)) return match;
    const value = params[key];
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }
    return String(value);
  });
}

// ============================================================================
// Parametrize
// ============================================================================

/**
 * Run a test body across multiple cases, executing it once per case.
 *
 * Accepts either pre-built {@link ParamCase} objects or raw parameter records
 * (in which case `name` is used as a formatting template). Returns a result
 * per case with pass/fail status and timing.
 */
export async function parametrize(
  name: string,
  cases: ParamCase[] | Record<string, unknown>[],
  fn: ParamTestFn,
  options?: ParametrizeOptions
): Promise<ParamTestResult[]> {
  const normalized: ParamCase[] = isParamCaseList(cases)
    ? cases
    : (cases as Record<string, unknown>[]).map((params) => ({
        name: formatCaseName(name, params),
        params,
      }));

  const results: ParamTestResult[] = [];

  for (const testCase of normalized) {
    const start = performance.now();
    try {
      await fn(testCase.params, testCase.name);
      results.push({
        name: testCase.name,
        passed: true,
        timeMs: performance.now() - start,
      });
    } catch (error) {
      results.push({
        name: testCase.name,
        passed: false,
        error: (error as Error).message,
        timeMs: performance.now() - start,
      });
      if (options?.bail) {
        break;
      }
    }
  }

  return results;
}

/**
 * Americanized alias for {@link parametrize}
 */
export const parameterize = parametrize;

// ============================================================================
// Helpers
// ============================================================================

function isParamCaseList(cases: ParamCase[] | Record<string, unknown>[]): cases is ParamCase[] {
  return cases.length > 0 && 'params' in cases[0] && typeof cases[0].params === 'object';
}