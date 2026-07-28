# Validator API Reference

> **API documentation for the MAM validator.**

---

## Overview

The validator checks MAM modules against the specification. This reference covers all public APIs.

---

## Imports

```typescript
import {
  validate,
  Validator,
  ValidatorConfig,
  ValidationReport,
  ValidationRule
} from '@mam/validator';
```

---

## Types

### ValidatorConfig

```typescript
interface ValidatorConfig {
  level?: ValidationLevel;
  schema?: SchemaValidationConfig;
  customRules?: ValidationRule[];
  collectWarnings?: boolean;
  maxErrors?: number;
}

type ValidationLevel = 'syntax' | 'schema' | 'semantic' | 'strict';
```

### ValidationReport

```typescript
interface ValidationReport {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  stats: ValidationStats;
}

interface ValidationStats {
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  duration: number;
}
```

### ValidationRule

```typescript
interface ValidationRule {
  name: string;
  description: string;
  severity: 'error' | 'warning' | 'info';
  check(ast: MAMModule): ValidationError[];
}
```

---

## Functions

### validate

Main validation function.

```typescript
function validate(
  ast: MAMModule,
  config?: ValidatorConfig
): ValidationReport;
```

**Example:**

```typescript
import { validate } from '@mam/validator';

const report = validate(ast, {
  level: 'strict',
  collectWarnings: true
});

if (report.valid) {
  console.log('Module is valid');
} else {
  console.error('Errors:', report.errors);
}
```

---

## Classes

### Validator

Validator class for more control.

```typescript
class Validator {
  constructor(config?: ValidatorConfig);
  
  validate(ast: MAMModule): ValidationReport;
  addRule(rule: ValidationRule): void;
  removeRule(name: string): void;
}
```

**Example:**

```typescript
import { Validator } from '@mam/validator';

const validator = new Validator({
  level: 'semantic'
});

// Add custom rule
validator.addRule({
  name: 'no-secrets',
  description: 'Ensure no hardcoded secrets',
  severity: 'error',
  check: (ast) => {
    // Custom validation
    return [];
  }
});

const report = validator.validate(ast);
```

---

## Error Types

### ValidationError

```typescript
interface ValidationError {
  type: 'error';
  code: string;
  message: string;
  location?: SourceLocation;
  context?: string;
  rule?: string;
}
```

### ValidationWarning

```typescript
interface ValidationWarning {
  type: 'warning';
  code: string;
  message: string;
  location?: SourceLocation;
  rule?: string;
}
```

---

## Error Codes

| Code | Description |
|------|-------------|
| `FRONTMATTER_MISSING` | Front matter not found |
| `FRONTMATTER_INVALID` | Invalid YAML |
| `FIELD_REQUIRED` | Required field missing |
| `FIELD_INVALID` | Invalid field format |
| `SECTION_MISSING` | Required section missing |
| `SECTION_INVALID` | Invalid section name |
| `CODEBLOCK_NO_LANGUAGE` | Code block missing language |

---

## Example

```typescript
import { validate } from '@mam/validator';
import { parse } from '@mam/parser';

const result = parse(moduleContent);
const report = validate(result.ast, {
  level: 'strict'
});

console.log('Valid:', report.valid);
console.log('Errors:', report.errors.length);
console.log('Warnings:', report.warnings.length);
console.log('Checks:', report.stats.totalChecks);
```

---

## References

- [Validator Architecture](../architecture/validator.md)
- [Specification](../specification/overview.md)

---

**Last Updated:** 2026-07-24
**MAM Version:** 1.0.0
