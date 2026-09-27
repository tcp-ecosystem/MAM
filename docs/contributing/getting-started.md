# Contributing to MAM

> **Getting started with MAM development.**

---

## Welcome

Thank you for your interest in contributing to MAM! This guide will help you get started.

---

## Prerequisites

| Requirement | Version | Purpose |
|-------------|---------|---------|
| Node.js | 20+ | Runtime |
| pnpm | 8+ | Package manager |
| Git | 2.30+ | Version control |
| TypeScript | 5+ | Language |

---

## Setup

### 1. Fork and Clone

```bash
# Fork on GitHub, then clone
git clone https://github.com/YOUR_USERNAME/mam.git
cd mam
```

### 2. Install Dependencies

```bash
pnpm install
```

### 3. Build

```bash
pnpm build
```

### 4. Run Tests

```bash
pnpm test
```

---

## Project Structure

```
mam/
├── spec/           # Specification
├── parser/         # Parser implementation
├── ast/            # AST definitions
├── validator/      # Validation system
├── runtime/        # Execution engine
├── compiler/       # Compilation targets
├── cli/            # Command-line interface
├── plugins/        # Plugin system
├── lsp/            # Language server
├── sdk/            # Language SDKs
├── registry/       # Module registry
└── docs/           # Documentation
```

---

## Development Workflow

### 1. Create Branch

```bash
git checkout -b feature/my-feature
```

### 2. Make Changes

- Write code following existing patterns
- Add tests for new functionality
- Update documentation if needed

### 3. Run Checks

```bash
pnpm lint        # Lint code
pnpm test        # Run tests
pnpm build       # Build project
```

### 4. Commit

```bash
git add .
git commit -m "feat: add new feature"
```

### 5. Push and Create PR

```bash
git push origin feature/my-feature
```

Then create a Pull Request on GitHub.

---

## Code Style

### TypeScript

```typescript
// Use explicit types
function process(data: string): string {
  return data.toUpperCase();
}

// Use interfaces for objects
interface User {
  id: string;
  name: string;
  email: string;
}

// Use enums for constants
enum Status {
  Active = 'active',
  Inactive = 'inactive',
  Pending = 'pending'
}
```

### Naming Conventions

- **Files:** `kebab-case.ts`
- **Classes:** `PascalCase`
- **Functions:** `camelCase`
- **Constants:** `UPPER_SNAKE_CASE`
- **Interfaces:** `PascalCase` with `I` prefix (optional)

---

## Testing

### Running Tests

```bash
# All tests
pnpm test

# Specific package
pnpm test --filter @mam/parser

# Watch mode
pnpm test --watch
```

### Writing Tests

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

---

## Documentation

### Updating Docs

Documentation is in `docs/` directory. Update relevant files when making changes.

### API Documentation

API docs are generated from JSDoc comments:

```typescript
/**
 * Parse a MAM module.
 * @param input - Raw Markdown content
 * @param options - Parser options
 * @returns Parse result with AST and errors
 */
function parse(input: string, options?: ParserOptions): ParseResult;
```

---

## Pull Request Checklist

- [ ] Code follows style guidelines
- [ ] Tests added for new functionality
- [ ] All tests pass
- [ ] Documentation updated
- [ ] No breaking changes (or clearly documented)
- [ ] Commit messages follow conventions

---

## Getting Help

- **Issues:** GitHub Issues
- **Discussions:** GitHub Discussions
- **Code:** Review existing code

---

## Code of Conduct

Please follow our [Code of Conduct](./code-of-conduct.md).

---

**Last Updated:** 2026-07-24
**MAM Version:** 1.0.0
