# Validator Architecture

> **How MAM validates modules against the specification.**

---

## Overview

The validator checks MAM modules for correctness against the specification. It performs schema validation, semantic validation, and custom rule checking.

---

## Pipeline

```
MAM AST
   │
   ▼
Validator Engine
   │
   ├──▶ Schema Rules
   │       │
   │       ├──▶ Front Matter Validation
   │       ├──▶ Section Validation
   │       └──▶ Content Validation
   │
   ├──▶ Semantic Rules
   │       │
   │       ├──▶ Ordering Validation
   │       ├──▶ Dependency Validation
   │       └──▶ Reference Validation
   │
   └──▶ Custom Rules
           │
           └──▶ Plugin Rules
   │
   ▼
Validation Report
```

---

## Validator Structure

```
┌─────────────────────────────────────────┐
│              Validator                  │
├─────────────────────────────────────────┤
│  Rules                                 │
│  ├── Schema Validation                 │
│  ├── Required Field Checks             │
│  ├── Section Ordering                  │
│  ├── Dependency Resolution             │
│  ├── Reference Validation              │
│  └── Custom Rules                      │
├─────────────────────────────────────────┤
│  Reporters                             │
│  ├── Console Reporter                  │
│  ├── JSON Reporter                     │
│  └── LSP Reporter                      │
├─────────────────────────────────────────┤
│  Errors                                │
│  ├── Validation Error                  │
│  ├── Validation Warning                │
│  └── Validation Info                   │
└─────────────────────────────────────────┘
```

---

## Validation Levels

| Level | Description |
|-------|-------------|
| `syntax` | Valid Markdown structure |
| `schema` | Valid YAML front matter |
| `semantic` | Correct section content |
| `strict` | All rules enforced |

---

## Validator Configuration

```typescript
interface ValidatorConfig {
  level?: ValidationLevel;
  schema?: SchemaValidationConfig;
  customRules?: ValidationRule[];
  collectWarnings?: boolean;
  maxErrors?: number;
}
```

---

## Validation Rules

### Schema Rules

#### Front Matter Validation

- Must exist
- Must be valid YAML
- Required fields must be present
- Field formats must be correct

```typescript
function validateFrontMatter(
  frontmatter: FrontMatter,
  config: SchemaValidationConfig
): ValidationError[];
```

#### Section Validation

- Required sections must exist
- Section names must be valid
- Section content must match type

```typescript
function validateSections(
  sections: Section[],
  config: SchemaValidationConfig
): ValidationError[];
```

#### Content Validation

- Code blocks must have language
- Tables must have headers
- Lists must have items

```typescript
function validateContent(
  content: ContentNode[],
  config: SchemaValidationConfig
): ValidationError[];
```

### Semantic Rules

#### Ordering Validation

Sections should follow recommended order:

1. Purpose
2. Inputs
3. Outputs
4. Rules
5. Workflow
6. Mermaid
7. Python / JavaScript
8. Prompt
9. Memory
10. Examples
11. Tests
12. References
13. Dependencies
14. Exports
15. Imports
16. Plugins
17. Permissions
18. Capabilities

#### Dependency Validation

- Dependencies must exist
- Version ranges must be valid
- Circular dependencies must be detected

#### Reference Validation

- URLs must be valid
- URLs must be reachable (optional)
- File references must exist

### Custom Rules

Plugins can add custom validation rules:

```typescript
interface ValidationRule {
  name: string;
  description: string;
  severity: 'error' | 'warning' | 'info';
  check(ast: MAMModule): ValidationError[];
}
```

---

## Validation Report

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

### Validation Error

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

### Validation Warning

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

## Reporters

### Console Reporter

Outputs validation results to the console:

```typescript
class ConsoleReporter implements Reporter {
  report(result: ValidationReport): void {
    // Format and print results
  }
}
```

### JSON Reporter

Outputs validation results as JSON:

```typescript
class JSONReporter implements Reporter {
  report(result: ValidationReport): void {
    console.log(JSON.stringify(result, null, 2));
  }
}
```

### LSP Reporter

Sends validation results to the LSP client:

```typescript
class LSPReporter implements Reporter {
  report(result: ValidationReport): void {
    // Send diagnostics to LSP client
  }
}
```

---

## Error Codes

| Code | Description |
|------|-------------|
| `FRONTMATTER_MISSING` | Front matter not found |
| `FRONTMATTER_INVALID` | Invalid YAML in front matter |
| `FIELD_REQUIRED` | Required field missing |
| `FIELD_INVALID` | Invalid field format |
| `SECTION_MISSING` | Required section missing |
| `SECTION_INVALID` | Invalid section name |
| `CODEBLOCK_NO_LANGUAGE` | Code block missing language |
| `DEPENDENCY_NOT_FOUND` | Dependency not found |
| `REFERENCE_INVALID` | Invalid reference URL |

---

## Example

### Input

```markdown
---
id: hello
version: 2.0.0
name: Hello
author: LifeJiggy
runtime: python
---

## Purpose

A simple hello module.

## Python

```python
def greet(name):
    return f"Hello, {name}!"
```
```

### Validation Report

```json
{
  "valid": true,
  "errors": [],
  "warnings": [],
  "stats": {
    "totalChecks": 15,
    "passedChecks": 15,
    "failedChecks": 0,
    "duration": 5
  }
}
```

### Invalid Module

```markdown
---
id: 123-invalid
---

## Python

```python
def greet(name):
    return f"Hello, {name}!"
```
```

### Validation Report

```json
{
  "valid": false,
  "errors": [
    {
      "type": "error",
      "code": "FIELD_INVALID",
      "message": "Invalid ID format",
      "location": {
        "start": { "line": 2, "column": 4 }
      },
      "rule": "schema"
    },
    {
      "type": "error",
      "code": "FIELD_REQUIRED",
      "message": "Missing required field: version",
      "location": {
        "start": { "line": 2, "column": 0 }
      },
      "rule": "schema"
    },
    {
      "type": "error",
      "code": "SECTION_MISSING",
      "message": "Missing required section: Purpose",
      "rule": "semantic"
    }
  ],
  "warnings": [],
  "stats": {
    "totalChecks": 15,
    "passedChecks": 12,
    "failedChecks": 3,
    "duration": 5
  }
}
```

---

## Performance

| Operation | Target | Strategy |
|-----------|--------|----------|
| Schema validation | <10ms | Cached rules |
| Semantic validation | <20ms | Parallel checks |
| Full validation | <50ms | Optimized rules |

---

## References

- [Specification](../specification/overview.md)
- [Validator API](../api/validator.md)
- [Parser Architecture](./parser.md)

---

**Last Updated:** 2026-07-24
**MAM Version:** 1.0.0
