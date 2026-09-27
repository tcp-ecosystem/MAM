# MAM Dependencies Grammar
# version: 2.0.0
# Human readable specification of the dependencies section

## Description

The dependencies grammar defines the Dependencies section of a MAM module.
Dependencies list external packages, libraries, frameworks, and MAM modules
that must be present for the module to function. The section drives package
management, version resolution, and deployment automation.

Each dependency is a package name with an optional version constraint and an
optional group marker or comment.

## Syntax

```text
## Dependencies

- <package_name> <operator> <version>
- <package_name> <operator> <version> (optional)
- <package_name> <operator> <version> (dev)
- <package_name>
```

### Version Constraint Operators

| Operator | Meaning | Example |
|----------|---------|---------|
| >= | Greater than or equal | requests >= 2.28.0 |
| <= | Less than or equal | flask <= 2.3.0 |
| == | Exact version | numpy == 1.24.0 |
| != | Not equal | pandas != 1.5.0 |
| ~= | Compatible release | pydantic ~= 2.0 |
| > | Greater than | python > 3.9 |
| < | Less than | sqlalchemy < 2.0 |

### Version Ranges

```text
- Package >= 1.0, < 2.0
- Package >= 1.0, != 1.5
- Package >= 1.0, < 1.5, != 1.2
```

### Group Markers

| Marker | Meaning |
|--------|---------|
| (optional) | Non critical dependency |
| (dev) | Development only |
| (test) | Test only |
| (docs) | Documentation only |

## Grammar Rules

| Rule | Pattern | Description |
|------|---------|-------------|
| Package name | `^[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?$` | Valid package name |
| Lowercase | `[a-z0-9_-]` | Package names are lowercase |
| No spaces | `[a-z0-9._-]` | Spaces not allowed inside names |
| Version | semver | Constraint must be semver compatible |
| No duplicates | unique names | Each package listed once |
| Max length | 214 chars | Package names are limited |

## Examples

### Minimal

```text
## Dependencies

- pydantic >= 2.0
```

### Full

```text
## Dependencies

- fastapi >= 0.100.0
- uvicorn >= 0.23.0
- pydantic >= 2.0
- sqlalchemy >= 1.4.0
- requests >= 2.28.0, < 3.0.0
```

### Grouped

```text
## Dependencies

# Core
- fastapi >= 0.100.0

# Optional
- redis >= 4.0 (optional)

# Development
- pytest >= 7.4.0 (dev)
```

### MAM Modules

```text
## Dependencies

- @myorg/auth-module >= 1.0.0
- @myorg/utils >= 2.0.0
```

## Validation Notes

1. Package names must match the valid name pattern.
2. Version constraints must be valid semver ranges.
3. Each package should be listed only once.
4. Group markers must be from optional, dev, test, docs.
5. Circular dependencies between modules are rejected.
6. Transitive dependencies are not listed directly.

## Related Files

- tokens.md
- ast-specification.md
- section-grammar.bnf
- grammar-v2.bnf