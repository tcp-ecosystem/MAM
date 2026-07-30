# @mam/validator

> Schema and semantic validation for MAM modules

The Validator checks MAM modules against the specification and custom rules, providing detailed error reporting.

## Installation

```bash
npm install @mam/validator
# or
pnpm add @mam/validator
```

## Quick Start

```typescript
import { Validator } from '@mam/validator';

const validator = new Validator();
const result = validator.validate(mamSource);

if (result.valid) {
  console.log('Module is valid');
} else {
  console.error('Validation errors:', result.errors);
}
```

## Validation Types

### Schema Validation

Checks structure against MAM specification:

```typescript
import { SchemaValidator } from '@mam/validator';

const schemaValidator = new SchemaValidator();
const result = schemaValidator.validate(ast);

// result.errors = [
//   { line: 10, column: 1, message: 'Missing required section: metadata' },
//   { line: 25, column: 5, message: 'Invalid YAML in front matter' }
// ]
```

### Semantic Validation

Checks logical consistency:

```typescript
import { SemanticValidator } from '@mam/validator';

const semanticValidator = new SemanticValidator();
const result = semanticValidator.validate(ast);

// result.warnings = [
//   { message: 'Unused variable: auth_token', line: 45 },
//   { message: 'Missing return statement in function: process', line: 78 }
// ]
```

### Custom Rules

```typescript
import { Validator, Rule } from '@mam/validator';

const customRule: Rule = {
  name: 'no-hardcoded-secrets',
  validate(ast) {
    const secrets = findSecrets(ast);
    return secrets.map(s => ({
      severity: 'error',
      message: 'Hardcoded secret found',
      line: s.line
    }));
  }
};

const validator = new Validator();
validator.addRule(customRule);
```

## CLI Usage

```bash
# Validate a module
mam validate auth.mam.md

# Validate with strict mode
mam validate auth.mam.md --strict

# Output as JSON
mam validate auth.mam.md --format json

# Validate all modules
mam validate ./modules/**/*.mam.md
```

## Built-in Rules

| Rule | Severity | Description |
|------|----------|-------------|
| `valid-schema` | Error | Structure follows MAM spec |
| `valid-yaml` | Error | YAML front matter is valid |
| `required-sections` | Error | Required sections present |
| `no-duplicate-sections` | Error | No duplicate section types |
| `valid-references` | Warning | All references resolve |
| `no-unused-imports` | Warning | No unused imports |
| `consistent-naming` | Info | Consistent naming conventions |

## API

### `Validator`

```typescript
class Validator {
  validate(source: string): ValidationResult;
  validateAST(ast: MAMAST): ValidationResult;
  addRule(rule: Rule): void;
  removeRule(name: string): void;
  getRules(): Rule[];
}
```

### `ValidationResult`

```typescript
interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  info: ValidationInfo[];
}
```

## Configuration

```json
{
  "validation": {
    "strict": true,
    "rules": {
      "no-hardcoded-secrets": "error",
      "consistent-naming": "warning"
    },
    "ignore": ["node_modules/**"]
  }
}
```

## License

MIT
