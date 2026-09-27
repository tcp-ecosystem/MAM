# Front Matter Specification

> **The metadata layer of MAM modules.**

---

## Overview

Every MAM module MUST begin with YAML front matter delimited by `---`. Front matter contains the module's identity, configuration, and metadata.

---

## Syntax

```yaml
---
id: my-module
version: 2.0.0
name: My Module
author: Your Name
runtime: python
---
```

### Delimiters

- Opening: `---` (first line)
- Closing: `---` (second delimiter)

### Rules

- MUST be the first content in the file
- MUST use YAML syntax
- MUST include at least the required fields
- MUST NOT contain executable code

---

## Required Fields

| Field | Type | Description | Pattern |
|-------|------|-------------|---------|
| `id` | string | Unique identifier | `^[a-z][a-z0-9-]{0,63}$` |
| `version` | string | Semantic version | `^\d+\.\d+\.\d+$` |
| `name` | string | Human-readable name | Any string |
| `author` | string | Module author | Any string |
| `runtime` | string | Primary runtime | `python`, `javascript`, `rust`, `go` |

### id

The unique identifier for the module.

```yaml
id: authentication
```

Rules:
- Lowercase alphanumeric and hyphens only
- Maximum 64 characters
- Must start with a letter
- No consecutive hyphens
- No leading/trailing hyphens

Valid examples:
- `authentication`
- `data-pipeline`
- `agent-planner`
- `v2-module`

Invalid examples:
- `123-module` (starts with number)
- `my--module` (consecutive hyphens)
- `my_module` (underscore)
- `My-Module` (uppercase)

### version

Semantic version following SemVer 2.0.0:

```yaml
version: 1.2.3
```

Format: `MAJOR.MINOR.PATCH`

- MAJOR: Breaking changes
- MINOR: New features (backward compatible)
- PATCH: Bug fixes (backward compatible)

### name

Human-readable module name:

```yaml
name: Authentication Module
```

### author

Module author:

```yaml
author: LifeJiggy
```

### runtime

Primary execution runtime:

```yaml
runtime: python
```

Valid values:
- `python` — Python 3.10+
- `javascript` — Node.js 20+
- `rust` — Rust 1.70+
- `go` — Go 1.21+

---

## Optional Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `tags` | string[] | [] | Discovery tags |
| `description` | string | "" | Module description |
| `dependencies` | string[] | [] | Module dependencies |
| `permissions` | string[] | [] | Required permissions |
| `license` | string | "MIT" | License identifier |
| `repository` | string | "" | Source repository URL |
| `mam_version` | string | "1.0.0" | MAM spec version |

### tags

Discovery tags for the module registry:

```yaml
tags:
  - auth
  - security
  - tokens
  - jwt
```

### description

Brief module description:

```yaml
description: >
  Secure JWT authentication module with
  support for multiple token formats.
```

### dependencies

Required modules:

```yaml
dependencies:
  - crypto-utils@^1.2.0
  - logging@^2.0.0
```

### permissions

Security permissions required:

```yaml
permissions:
  - network
  - filesystem
```

### license

License identifier (SPDX format):

```yaml
license: MIT
```

### repository

Source repository URL:

```yaml
repository: https://github.com/lifejiggy/mam-auth
```

### mam_version

MAM specification version:

```yaml
mam_version: 2.0.0
```

---

## Complete Example

```yaml
---
id: authentication
version: 1.2.0
name: Authentication Module
author: LifeJiggy
runtime: python
tags:
  - auth
  - security
  - jwt
description: >
  Secure JWT authentication module with
  support for multiple token formats and
  automatic token refresh.
dependencies:
  - crypto-utils@^1.2.0
  - logging@^2.0.0
permissions:
  - network
  - filesystem
license: MIT
repository: https://github.com/lifejiggy/mam-auth
mam_version: 2.0.0
---
```

---

## Validation Rules

### Required Rules

1. Front matter MUST exist
2. `id` MUST be present
3. `version` MUST be present
4. `name` MUST be present
5. `author` MUST be present
6. `runtime` MUST be present

### Format Rules

1. `id` MUST match pattern `^[a-z][a-z0-9-]{0,63}$`
2. `version` MUST be valid semver
3. `runtime` MUST be one of: `python`, `javascript`, `rust`, `go`
4. `license` SHOULD be a valid SPDX identifier

### Semantic Rules

1. `id` SHOULD be unique within a project
2. `version` SHOULD follow semver conventions
3. `dependencies` SHOULD reference valid modules
4. `permissions` SHOULD match actual usage

---

## Parsing

The parser extracts front matter using the `parseFrontMatter` function:

```typescript
interface FrontMatterData {
  id: string;
  version: string;
  name: string;
  author: string;
  runtime: string;
  tags?: string[];
  description?: string;
  dependencies?: string[];
  permissions?: string[];
  license?: string;
  repository?: string;
  mam_version?: string;
}

function parseFrontMatter(content: string): FrontMatterData;
```

---

## Error Handling

### Missing Front Matter

```
Error: Front matter not found
  at line 1
  Expected: "---" at start of file
```

### Invalid YAML

```
Error: Invalid YAML in front matter
  at line 3
  Expected: valid YAML syntax
```

### Missing Required Field

```
Error: Missing required field "id"
  at line 2
  Expected: "id: <identifier>"
```

### Invalid ID Format

```
Error: Invalid ID format
  at line 2
  Value: "123-invalid"
  Expected: pattern "^[a-z][a-z0-9-]{0,63}$"
```

---

## References

- [Specification Overview](./overview.md)
- [Section Types](./sections.md)
- [Validation](./validation.md)

---

**Last Updated:** 2026-07-24
**MAM Version:** 1.0.0
