# @mam/testing

> Testing framework for MAM modules and plugins

The Testing Framework provides utilities for writing, running, and reporting on MAM module tests.

## Installation

```bash
npm install @mam/testing
# or
pnpm add @mam/testing
```

## Quick Start

```typescript
import { describe, it, expect } from '@mam/testing';

describe('Auth Module', () => {
  it('should validate credentials', async () => {
    const result = await validateCredentials('user', 'pass');
    expect(result.valid).toBe(true);
  });

  it('should reject invalid tokens', async () => {
    const result = await validateToken('invalid-token');
    expect(result.valid).toBe(false);
  });
});
```

## Writing Tests

### Module Tests

```typescript
import { testModule } from '@mam/testing';

const suite = testModule('auth.mam.md', {
  setup() {
    // Setup test fixtures
    return { db: createTestDb() };
  },
  teardown(fixtures) {
    // Cleanup
    fixtures.db.close();
  }
});

suite.test('should authenticate user', async (ctx) => {
  const auth = await loadModule('auth.mam.md');
  const result = await auth.authenticate('user', 'pass');
  expect(result.success).toBe(true);
});
```

### Plugin Tests

```typescript
import { testPlugin } from '@mam/testing';

const suite = testPlugin('@mam/plugin-memory');

suite.test('should store and retrieve values', async (ctx) => {
  const memory = ctx.getPlugin('memory');
  await memory.set('key', 'value');
  const result = await memory.get('key');
  expect(result).toBe('value');
});
```

### Validation Tests

```typescript
import { testValidation } from '@mam/testing';

testValidation('auth.mam.md', {
  shouldHaveRequiredSections: ['metadata', 'prompts'],
  shouldNotHaveErrors: true,
  shouldBeValidSchema: true
});
```

## Test Runner

```bash
# Run all tests
mam test

# Run specific module tests
mam test auth.mam.md

# Run tests with coverage
mam test --coverage

# Run tests in watch mode
mam test --watch
```

## Assertions

```typescript
import { expect } from '@mam/testing';

// Module assertions
expect(ast).toHaveSection('metadata');
expect(ast).toHaveSection('prompts');
expect(ast.sections).toHaveLength(5);

// Value assertions
expect(result).toBe(expected);
expect(result).toEqual(expected);
expect(result).toMatchObject({ valid: true });

// Async assertions
await expect(promise).resolves.toBe(value);
await expect(promise).rejects.toThrow();
```

## Coverage

```typescript
import { coverage } from '@mam/testing';

const report = await coverage('auth.mam.md', {
  statements: 85,
  branches: 80,
  functions: 90,
  lines: 85
});
```

## API

```typescript
class TestRunner {
  run(pattern?: string): Promise<TestResult>;
  watch(pattern?: string): Promise<void>;
  coverage(pattern?: string): Promise<CoverageReport>;
}
```

## License

MIT
