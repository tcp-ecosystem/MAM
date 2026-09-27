# Testing Guide

> **Writing and running tests for MAM.**

---

## Overview

MAM uses Vitest for testing. This guide covers test setup, writing tests, and best practices.

---

## Running Tests

### All Tests

```bash
pnpm test
```

### Specific Package

```bash
pnpm test --filter @mam/parser
```

### Watch Mode

```bash
pnpm test --watch
```

### Coverage

```bash
pnpm test:coverage
```

---

## Test Structure

```
packages/
├── parser/
│   └── tests/
│       ├── lexer/
│       │   ├── tokenizer.test.ts
│       │   └── tokens.test.ts
│       ├── parser/
│       │   ├── mam.test.ts
│       │   ├── sections.test.ts
│       │   └── frontmatter.test.ts
│       └── fixtures/
│           ├── valid/
│           │   ├── basic.mam.md
│           │   └── full.mam.md
│           └── invalid/
│               └── missing_frontmatter.md
```

---

## Writing Tests

### Basic Test

```typescript
import { describe, it, expect } from 'vitest';
import { parse } from '../src';

describe('Parser', () => {
  it('should parse basic module', () => {
    const input = `---
id: test
version: 2.0.0
name: Test
author: Test
runtime: python
---

## Purpose

Test module.
`;
    
    const result = parse(input);
    expect(result.ast).toBeDefined();
    expect(result.errors).toHaveLength(0);
  });
});
```

### Test with Fixtures

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parse } from '../src';

describe('Parser', () => {
  it('should parse basic fixture', () => {
    const fixture = readFileSync(
      join(__dirname, 'fixtures/valid/basic.mam.md'),
      'utf-8'
    );
    
    const result = parse(fixture);
    expect(result.ast).toBeDefined();
    expect(result.errors).toHaveLength(0);
  });
});
```

### Test Error Cases

```typescript
describe('Parser', () => {
  it('should return error for missing frontmatter', () => {
    const input = `## Purpose

Test module.
`;
    
    const result = parse(input);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].code).toBe('FRONTMATTER_NOT_FOUND');
  });
});
```

### Test Validation

```typescript
import { validate } from '@mam/validator';

describe('Validator', () => {
  it('should validate correct module', () => {
    const ast = parse(validModule).ast;
    const report = validate(ast);
    
    expect(report.valid).toBe(true);
    expect(report.errors).toHaveLength(0);
  });
  
  it('should catch invalid ID', () => {
    const ast = parse(invalidModule).ast;
    const report = validate(ast, { level: 'strict' });
    
    expect(report.valid).toBe(false);
    expect(report.errors.some(e => e.code === 'FIELD_INVALID')).toBe(true);
  });
});
```

---

## Test Patterns

### Unit Tests

Test individual functions:

```typescript
describe('Token', () => {
  it('should create token', () => {
    const token = createToken(TokenType.TEXT, 'hello');
    expect(token.type).toBe(TokenType.TEXT);
    expect(token.value).toBe('hello');
  });
});
```

### Integration Tests

Test component interactions:

```typescript
describe('Parser Integration', () => {
  it('should parse and validate', () => {
    const result = parse(module);
    const report = validate(result.ast);
    
    expect(result.errors).toHaveLength(0);
    expect(report.valid).toBe(true);
  });
});
```

### End-to-End Tests

Test complete workflows:

```typescript
describe('E2E', () => {
  it('should parse, validate, and compile', () => {
    const parsed = parse(module);
    const validated = validate(parsed.ast);
    const compiled = compile(parsed.ast, { target: 'python' });
    
    expect(parsed.errors).toHaveLength(0);
    expect(validated.valid).toBe(true);
    expect(compiled.success).toBe(true);
  });
});
```

---

## Test Fixtures

### Valid Modules

Place in `tests/fixtures/valid/`:

```
basic.mam.md
full.mam.md
minimal.mam.md
```

### Invalid Modules

Place in `tests/fixtures/invalid/`:

```
missing_frontmatter.md
bad_sections.md
unclosed_codeblock.md
```

---

## Mocking

### Mock Functions

```typescript
import { vi } from 'vitest';

const mockFetch = vi.fn();
vi.mock('node-fetch', () => ({
  default: mockFetch
}));

describe('API', () => {
  it('should fetch data', async () => {
    mockFetch.mockResolvedValue({ json: () => ({}) });
    
    const result = await fetchData('https://api.example.com');
    expect(result).toBeDefined();
  });
});
```

### Mock Modules

```typescript
vi.mock('../src/external', () => ({
  externalFunction: vi.fn()
}));
```

---

## Coverage

### Coverage Reports

```bash
pnpm test:coverage
```

### Coverage Configuration

In `vitest.config.ts`:

```typescript
export default {
  coverage: {
    provider: 'v8',
    reporter: ['text', 'json', 'html'],
    exclude: [
      'node_modules/',
      'tests/'
    ]
  }
}
```

---

## Best Practices

### 1. Test One Thing

```typescript
// Good
it('should parse frontmatter', () => {
  // Test frontmatter parsing
});

it('should parse sections', () => {
  // Test section parsing
});

// Bad
it('should parse everything', () => {
  // Tests too many things
});
```

### 2. Use Descriptive Names

```typescript
// Good
it('should return error for missing frontmatter', () => {});

// Bad
it('should work', () => {});
```

### 3. Test Edge Cases

```typescript
it('should handle empty input', () => {
  const result = parse('');
  expect(result.errors).toHaveLength(1);
});

it('should handle very long input', () => {
  const input = 'x'.repeat(100000);
  const result = parse(input);
  expect(result).toBeDefined();
});
```

### 4. Use Fixtures

```typescript
it('should parse valid module', () => {
  const fixture = readFixture('valid/basic.mam.md');
  const result = parse(fixture);
  expect(result.ast).toBeDefined();
});
```

### 5. Keep Tests Independent

```typescript
// Good - each test is independent
it('test 1', () => { /* ... */ });
it('test 2', () => { /* ... */ });

// Bad - tests depend on each other
let state;
it('test 1', () => { state = setup(); });
it('test 2', () => { use(state); });
```

---

## References

- [Development Guide](./development.md)
- [Contributing](./getting-started.md)

---

**Last Updated:** 2026-07-24
**MAM Version:** 1.0.0
