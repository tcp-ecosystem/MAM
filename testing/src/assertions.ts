/**
 * MAM Custom Assertion Library
 *
 * Provides structured assertion methods for MAM module testing with
 * detailed error messages including source locations.
 */

// ============================================================================
// Types
// ============================================================================

/** Source location for error messages */
export interface SourceLocation {
  file?: string;
  line?: number;
  column?: number;
  section?: string;
}

/** Result of a single assertion */
export interface AssertionResult {
  /** Whether assertion passed */
  passed: boolean;
  /** Assertion name */
  name: string;
  /** Human-readable message */
  message: string;
  /** Expected value */
  expected?: unknown;
  /** Actual value */
  actual?: unknown;
  /** Source location of failure */
  location?: SourceLocation;
}

/** Configuration for assertion behavior */
export interface AssertionConfig {
  /** Throw on failure instead of collecting */
  throwOnFail?: boolean;
  /** Include stack traces in messages */
  includeStack?: boolean;
  /** Custom message prefix */
  messagePrefix?: string;
}

/** Parsed MAM AST subset for assertion checks */
export interface MAMASTPartial {
  frontmatter?: {
    data: Record<string, unknown>;
  };
  sections?: Array<{
    name: string;
    level: number;
    content?: string;
    codeBlocks?: Array<{ language: string; content: string }>;
  }>;
  metadata?: Record<string, unknown>;
  errors?: Array<{ message: string; line?: number }>;
}

// ============================================================================
// Assertion Error
// ============================================================================

export class MAMAssertionError extends Error {
  public readonly assertionName: string;
  public readonly expected?: unknown;
  public readonly actual?: unknown;
  public readonly location?: SourceLocation;

  constructor(
    message: string,
    name: string,
    expected?: unknown,
    actual?: unknown,
    location?: SourceLocation
  ) {
    super(message);
    this.name = 'MAMAssertionError';
    this.assertionName = name;
    this.expected = expected;
    this.actual = actual;
    this.location = location;
  }
}

// ============================================================================
// MAMAssert
// ============================================================================

export class MAMAssert {
  private results: AssertionResult[] = [];
  private config: AssertionConfig;

  constructor(config?: AssertionConfig) {
    this.config = {
      throwOnFail: false,
      includeStack: false,
      messagePrefix: '',
      ...config,
    };
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  /** Reset all collected assertion results */
  reset(): void {
    this.results = [];
  }

  /** Get all collected assertion results */
  getResults(): readonly AssertionResult[] {
    return this.results;
  }

  /** Get only failed assertion results */
  getFailures(): AssertionResult[] {
    return this.results.filter((r) => !r.passed);
  }

  /** Whether all assertions passed */
  allPassed(): boolean {
    return this.results.every((r) => r.passed);
  }

  /** Get summary of results */
  getSummary(): { total: number; passed: number; failed: number } {
    const total = this.results.length;
    const passed = this.results.filter((r) => r.passed).length;
    return { total, passed, failed: total - passed };
  }

  // --------------------------------------------------------------------------
  // Core assertions
  // --------------------------------------------------------------------------

  /**
   * Assert that two values are deeply equal
   */
  assertEqual<T>(
    actual: T,
    expected: T,
    message?: string,
    location?: SourceLocation
  ): void {
    const passed = this.deepEqual(actual, expected);
    const msg = message ?? `Expected ${this.stringify(expected)}, got ${this.stringify(actual)}`;
    this.record({
      passed,
      name: 'assertEqual',
      message: this.prefix(msg),
      expected,
      actual,
      location,
    });
  }

  /**
   * Assert that two values are strictly equal (===)
   */
  assertStrictEqual(
    actual: unknown,
    expected: unknown,
    message?: string,
    location?: SourceLocation
  ): void {
    const passed = actual === expected;
    const msg = message ?? `Expected strict equality: ${this.stringify(expected)} === ${this.stringify(actual)}`;
    this.record({
      passed,
      name: 'assertStrictEqual',
      message: this.prefix(msg),
      expected,
      actual,
      location,
    });
  }

  /**
   * Assert that a value is truthy
   */
  assertTrue(
    value: unknown,
    message?: string,
    location?: SourceLocation
  ): void {
    const passed = Boolean(value);
    const msg = message ?? `Expected truthy value, got ${this.stringify(value)}`;
    this.record({
      passed,
      name: 'assertTrue',
      message: this.prefix(msg),
      expected: true,
      actual: value,
      location,
    });
  }

  /**
   * Assert that a value is falsy
   */
  assertFalse(
    value: unknown,
    message?: string,
    location?: SourceLocation
  ): void {
    const passed = !value;
    const msg = message ?? `Expected falsy value, got ${this.stringify(value)}`;
    this.record({
      passed,
      name: 'assertFalse',
      message: this.prefix(msg),
      expected: false,
      actual: value,
      location,
    });
  }

  /**
   * Assert that a value is null or undefined
   */
  assertNull(
    value: unknown,
    message?: string,
    location?: SourceLocation
  ): void {
    const passed = value === null || value === undefined;
    const msg = message ?? `Expected null/undefined, got ${this.stringify(value)}`;
    this.record({
      passed,
      name: 'assertNull',
      message: this.prefix(msg),
      expected: null,
      actual: value,
      location,
    });
  }

  /**
   * Assert that a value is not null and not undefined
   */
  assertNotNull(
    value: unknown,
    message?: string,
    location?: SourceLocation
  ): void {
    const passed = value !== null && value !== undefined;
    const msg = message ?? `Expected non-null value, got ${this.stringify(value)}`;
    this.record({
      passed,
      name: 'assertNotNull',
      message: this.prefix(msg),
      expected: 'non-null',
      actual: value,
      location,
    });
  }

  /**
   * Assert that a value is an instance of a type
   */
  assertInstanceOf(
    actual: unknown,
    expectedType: new (...args: unknown[]) => unknown,
    message?: string,
    location?: SourceLocation
  ): void {
    const passed = actual instanceof expectedType;
    const typeName = expectedType.name ?? 'Unknown';
    const msg = message ?? `Expected instance of ${typeName}, got ${typeof actual}`;
    this.record({
      passed,
      name: 'assertInstanceOf',
      message: this.prefix(msg),
      expected: typeName,
      actual: typeof actual,
      location,
    });
  }

  /**
   * Assert that a string matches a regex pattern
   */
  assertMatch(
    actual: string,
    pattern: RegExp,
    message?: string,
    location?: SourceLocation
  ): void {
    const passed = pattern.test(actual);
    const msg = message ?? `Expected "${actual}" to match ${pattern.toString()}`;
    this.record({
      passed,
      name: 'assertMatch',
      message: this.prefix(msg),
      expected: pattern.toString(),
      actual,
      location,
    });
  }

  /**
   * Assert that an array contains a specific element
   */
  assertContains<T>(
    array: T[],
    element: T,
    message?: string,
    location?: SourceLocation
  ): void {
    const passed = array.some((item) => this.deepEqual(item, element));
    const msg = message ?? `Expected array to contain ${this.stringify(element)}`;
    this.record({
      passed,
      name: 'assertContains',
      message: this.prefix(msg),
      expected: element,
      actual: array,
      location,
    });
  }

  /**
   * Assert that a value has a specific type
   */
  assertType(
    actual: unknown,
    expectedType: string,
    message?: string,
    location?: SourceLocation
  ): void {
    const passed = typeof actual === expectedType;
    const msg = message ?? `Expected type "${expectedType}", got "${typeof actual}"`;
    this.record({
      passed,
      name: 'assertType',
      message: this.prefix(msg),
      expected: expectedType,
      actual: typeof actual,
      location,
    });
  }

  // --------------------------------------------------------------------------
  // MAM-specific assertions
  // --------------------------------------------------------------------------

  /**
   * Assert that a section exists with the given name
   */
  assertSection(
    ast: MAMASTPartial,
    sectionName: string,
    message?: string,
    location?: SourceLocation
  ): void {
    const sections = ast.sections ?? [];
    const found = sections.some((s) => s.name === sectionName);
    const msg = message ?? `Expected section "${sectionName}" to exist`;
    this.record({
      passed: found,
      name: 'assertSection',
      message: this.prefix(msg),
      expected: sectionName,
      actual: sections.map((s) => s.name),
      location,
    });
  }

  /**
   * Assert that a section contains a code block with a specific language
   */
  assertCodeBlock(
    ast: MAMASTPartial,
    sectionName: string,
    language: string,
    message?: string,
    location?: SourceLocation
  ): void {
    const sections = ast.sections ?? [];
    const section = sections.find((s) => s.name === sectionName);
    const codeBlocks = section?.codeBlocks ?? [];
    const found = codeBlocks.some((b) => b.language === language);
    const msg = message ?? `Expected code block with language "${language}" in section "${sectionName}"`;
    this.record({
      passed: found,
      name: 'assertCodeBlock',
      message: this.prefix(msg),
      expected: language,
      actual: codeBlocks.map((b) => b.language),
      location,
    });
  }

  /**
   * Assert that frontmatter contains specific data
   */
  assertFrontmatter(
    ast: MAMASTPartial,
    expectedData: Record<string, unknown>,
    message?: string,
    location?: SourceLocation
  ): void {
    const fm = ast.frontmatter?.data ?? {};
    const missing: string[] = [];

    for (const [key, value] of Object.entries(expectedData)) {
      if (!this.deepEqual(fm[key], value)) {
        missing.push(key);
      }
    }

    const passed = missing.length === 0;
    const msg = message ?? `Frontmatter missing keys: ${missing.join(', ')}`;
    this.record({
      passed,
      name: 'assertFrontmatter',
      message: this.prefix(msg),
      expected: expectedData,
      actual: fm,
      location,
    });
  }

  /**
   * Assert that no parse errors occurred
   */
  assertNoErrors(
    ast: MAMASTPartial,
    message?: string,
    location?: SourceLocation
  ): void {
    const errors = ast.errors ?? [];
    const passed = errors.length === 0;
    const msg = message ?? `Expected no errors, got ${errors.length}`;
    this.record({
      passed,
      name: 'assertNoErrors',
      message: this.prefix(msg),
      expected: 0,
      actual: errors.length,
      location,
    });
  }

  /**
   * Assert that metadata contains a specific key-value pair
   */
  assertMetadata(
    ast: MAMASTPartial,
    key: string,
    expectedValue: unknown,
    message?: string,
    location?: SourceLocation
  ): void {
    const metadata = ast.metadata ?? {};
    const passed = this.deepEqual(metadata[key], expectedValue);
    const msg = message ?? `Metadata.${key}: expected ${this.stringify(expectedValue)}, got ${this.stringify(metadata[key])}`;
    this.record({
      passed,
      name: 'assertMetadata',
      message: this.prefix(msg),
      expected: expectedValue,
      actual: metadata[key],
      location,
    });
  }

  /**
   * Assert that a dependency exists in frontmatter
   */
  assertDependency(
    ast: MAMASTPartial,
    depName: string,
    message?: string,
    location?: SourceLocation
  ): void {
    const deps = (ast.frontmatter?.data?.dependencies as string[]) ?? [];
    const passed = deps.includes(depName);
    const msg = message ?? `Expected dependency "${depName}" to exist`;
    this.record({
      passed,
      name: 'assertDependency',
      message: this.prefix(msg),
      expected: depName,
      actual: deps,
      location,
    });
  }

  /**
   * Assert that a permission exists in frontmatter
   */
  assertPermission(
    ast: MAMASTPartial,
    permission: string,
    message?: string,
    location?: SourceLocation
  ): void {
    const perms = (ast.frontmatter?.data?.permissions as string[]) ?? [];
    const passed = perms.includes(permission);
    const msg = message ?? `Expected permission "${permission}" to exist`;
    this.record({
      passed,
      name: 'assertPermission',
      message: this.prefix(msg),
      expected: permission,
      actual: perms,
      location,
    });
  }

  /**
   * Assert that a hook exists in frontmatter
   */
  assertHook(
    ast: MAMASTPartial,
    hookName: string,
    message?: string,
    location?: SourceLocation
  ): void {
    const hooks = (ast.frontmatter?.data?.hooks as Record<string, unknown>) ?? {};
    const passed = hookName in hooks;
    const msg = message ?? `Expected hook "${hookName}" to exist`;
    this.record({
      passed,
      name: 'assertHook',
      message: this.prefix(msg),
      expected: hookName,
      actual: Object.keys(hooks),
      location,
    });
  }

  /**
   * Assert that the module has a specific runtime type
   */
  assertRuntime(
    ast: MAMASTPartial,
    expectedRuntime: string,
    message?: string,
    location?: SourceLocation
  ): void {
    const runtime = ast.frontmatter?.data?.runtime;
    const passed = runtime === expectedRuntime;
    const msg = message ?? `Expected runtime "${expectedRuntime}", got "${runtime}"`;
    this.record({
      passed,
      name: 'assertRuntime',
      message: this.prefix(msg),
      expected: expectedRuntime,
      actual: runtime,
      location,
    });
  }

  /**
   * Assert section count equals expected value
   */
  assertSectionCount(
    ast: MAMASTPartial,
    expectedCount: number,
    message?: string,
    location?: SourceLocation
  ): void {
    const actual = (ast.sections ?? []).length;
    const passed = actual === expectedCount;
    const msg = message ?? `Expected ${expectedCount} sections, got ${actual}`;
    this.record({
      passed,
      name: 'assertSectionCount',
      message: this.prefix(msg),
      expected: expectedCount,
      actual,
      location,
    });
  }

  /**
   * Assert that section content contains a substring
   */
  assertSectionContent(
    ast: MAMASTPartial,
    sectionName: string,
    substring: string,
    message?: string,
    location?: SourceLocation
  ): void {
    const sections = ast.sections ?? [];
    const section = sections.find((s) => s.name === sectionName);
    const content = section?.content ?? '';
    const passed = content.includes(substring);
    const msg = message ?? `Section "${sectionName}" does not contain "${substring}"`;
    this.record({
      passed,
      name: 'assertSectionContent',
      message: this.prefix(msg),
      expected: substring,
      actual: content.substring(0, 200),
      location,
    });
  }

  // --------------------------------------------------------------------------
  // Utility
  // --------------------------------------------------------------------------

  private record(result: AssertionResult): void {
    this.results.push(result);

    if (!result.passed && this.config.throwOnFail) {
      const loc = result.location
        ? ` at ${result.location.file ?? '?'}:${result.location.line ?? '?'}:${result.location.column ?? '?'}`
        : '';
      throw new MAMAssertionError(
        `[${result.name}]${loc} ${result.message}`,
        result.name,
        result.expected,
        result.actual,
        result.location
      );
    }
  }

  private prefix(msg: string): string {
    return this.config.messagePrefix
      ? `${this.config.messagePrefix}: ${msg}`
      : msg;
  }

  private deepEqual(a: unknown, b: unknown): boolean {
    if (Object.is(a, b)) return true;
    if (a === null || b === null) return false;
    if (typeof a !== typeof b) return false;

    if (typeof a !== 'object') return false;

    if (Array.isArray(a) !== Array.isArray(b)) return false;

    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((item, i) => this.deepEqual(item, b[i]));
    }

    const keysA = Object.keys(a as Record<string, unknown>);
    const keysB = Object.keys(b as Record<string, unknown>);

    if (keysA.length !== keysB.length) return false;

    return keysA.every((key) =>
      this.deepEqual(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key]
      )
    );
  }

  private stringify(value: unknown): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'string') return `"${value}"`;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) return `[${value.length} items]`;
    if (typeof value === 'object') return '{object}';
    return String(value);
  }
}
