/**
 * MAM Mocking Helpers
 *
 * Call-recording mock functions plus factories that build fake
 * {@link V2ModuleNode}-shaped objects for tests that do not require a real
 * parser/transformer.
 */

import type { V2ModuleNode } from '@mam/ast';

// ============================================================================
// Types
// ============================================================================

/** A single recorded mock invocation */
export interface MockCall {
  /** Arguments the mock was invoked with */
  args: unknown[];
  /** `this` value the mock was invoked with */
  thisArg: unknown;
  /** Value returned by the mock */
  returnValue: unknown;
  /** Timestamp of the call */
  timestamp: number;
}

/** A call-recording mock function */
export interface Mock<Args extends unknown[] = unknown[], Return = unknown> {
  (...args: Args): Return;
  /** All recorded calls */
  calls: MockCall[];
  /** Number of recorded calls */
  callCount: number;
  /** Most recent call, if any */
  lastCall: MockCall | undefined;
  /** Underlying implementation (used when set) */
  impl: ((...args: unknown[]) => unknown) | undefined;
  /** Clear all recorded calls */
  reset(): void;
}

/** Options for {@link createMock} */
export interface MockOptions {
  /** Return value used when no implementation is provided */
  defaultReturn?: unknown;
}

// ============================================================================
// Mock factory
// ============================================================================

/**
 * Create a call-recording mock function. Each invocation is appended to
 * `mock.calls`. If an implementation is provided it is invoked; otherwise the
 * mock returns `options.defaultReturn` (or `undefined`).
 */
export function createMock<Args extends unknown[] = unknown[], Return = unknown>(
  impl?: (...args: unknown[]) => unknown,
  options?: MockOptions
): Mock<Args, Return> {
  const calls: MockCall[] = [];

  const mock = function (this: unknown, ...args: unknown[]): unknown {
    let returnValue: unknown;
    if (impl) {
      returnValue = impl.apply(this, args);
    } else {
      returnValue = options?.defaultReturn;
    }
    calls.push({ args, thisArg: this, returnValue, timestamp: Date.now() });
    return returnValue;
  } as Mock<Args, Return>;

  Object.defineProperty(mock, 'calls', {
    get: () => calls,
    enumerable: true,
  });
  Object.defineProperty(mock, 'callCount', {
    get: () => calls.length,
    enumerable: true,
  });
  Object.defineProperty(mock, 'lastCall', {
    get: () => calls[calls.length - 1],
    enumerable: true,
  });

  mock.impl = impl;
  mock.reset = () => {
    calls.length = 0;
  };

  return mock;
}

// ============================================================================
// Assertions & manipulation
// ============================================================================

/**
 * Assert that a mock was called a given number of times. Throws an Error when
 * the expectation is not met; otherwise returns `void`.
 */
export function expectCalled<Args extends unknown[] = unknown[], Return = unknown>(
  mock: Mock<Args, Return>,
  n?: number,
  message?: string
): void {
  const actual = mock.callCount;

  if (n === undefined) {
    if (actual === 0) {
      throw new Error(message ?? 'Expected mock to be called, but it was never called.');
    }
    return;
  }

  if (actual !== n) {
    throw new Error(
      message ?? `Expected mock to be called ${n} times, but it was called ${actual} times.`
    );
  }
}

/**
 * Configure a mock to return a fixed value on every invocation.
 */
export function mockReturn<Args extends unknown[] = unknown[], Return = unknown>(
  mock: Mock<Args, Return>,
  value: Return
): Mock<Args, Return> {
  mock.impl = () => value;
  return mock;
}

/**
 * Clear all recorded calls on a mock.
 */
export function resetMock<Args extends unknown[] = unknown[], Return = unknown>(
  mock: Mock<Args, Return>
): Mock<Args, Return> {
  mock.reset();
  return mock;
}

// ============================================================================
// Fake module factory
// ============================================================================

/**
 * Build a fake {@link V2ModuleNode}-shaped object for tests, merging the given
 * overrides over sensible defaults.
 */
export function createMockModule(overrides?: Partial<V2ModuleNode>): V2ModuleNode {
  return {
    type: 'ModuleNode',
    name: 'mock-module',
    moduleType: 'module',
    location: {
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 1, column: 1, offset: 0 },
      source: 'mock-module',
    },
    version: '1.0.0',
    description: 'Mock module for testing',
    capabilities: ['mock'],
    metadata: {},
    ...overrides,
  };
}