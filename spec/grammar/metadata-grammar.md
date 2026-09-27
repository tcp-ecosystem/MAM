# MAM Metadata Grammar
# version: 2.0.0
# Human readable specification of the metadata / front matter layer

## Description

The metadata grammar defines the YAML front matter block that begins every
MAM module. It carries machine readable identity: id, name, version, type,
author, license, tags, runtime, capabilities, permissions, and dependencies.
This block is the first syntactic element of a document and is delimited by
three hyphens on their own lines.

The metadata layer is critical for module discovery, versioning, dependency
resolution, and tooling support.

## Syntax

```text
---
id: <id_value>
name: <name_value>
version: <semver_value>
type: <type_value>
author: <author_value>
description: <folded_block>
license: <spdx_value>
runtime:
  language: <runtime_lang>
  version: <runtime_ver>
tags:
  - <tag_value>
capabilities:
  - <capability_value>
permissions:
  <permission_key>:
    - <permission_value>
dependencies:
  - <dependency_value>
---
```

## Grammar Rules

| Rule | Pattern | Description |
|------|---------|-------------|
| id | `^[a-z][a-z0-9-]{0,63}$` | Lowercase alphanumeric and hyphens |
| version | semver | MAJOR.MINOR.PATCH with optional pre release |
| name | free text | Human readable title, max 128 chars |
| type | module types | module, agent, tool, system, service |
| author | free text | Name or name with email |
| runtime | enum | python, javascript, go, rust, shell |
| license | SPDX | MIT, Apache-2.0, GPL-3.0, BSD-3-Clause |
| tag | `^[a-z][a-z0-9-]*$` | Lowercase, hyphens allowed |
| capability | `^[a-z][a-z0-9:-]{0,127}$` | Colon separated hierarchy |
| permission | `^[a-z][a-z0-9:]{0,31}$` | Key with optional scopes |

### Required Fields

A metadata block is mandatory. The required fields are id, version, name,
author, and runtime. Missing required fields produce validation errors.

### Value Types

| Type | Example | Notes |
|------|---------|-------|
| string | `name: Hello` | Plain or quoted |
| number | `version: 2.0.0` | Also semver strings |
| boolean | `deprecated: false` | true or false |
| list | `tags:` then items | Dash prefixed block list |
| object | `runtime:` then keys | Nested indented object |
| folded | `description: >` | Multi line folded text |

## Examples

### Minimal Metadata

```text
---
id: hello
name: Hello
version: 2.0.0
author: MAM Team
runtime: python
---
```

### Full Metadata

```text
---
id: api-client
name: API Client
version: 2.1.0
type: module
author: MAM Team <team@example.com>
description: >
  A client for REST services with retry and logging.
license: MIT
runtime:
  language: python
  version: ">=3.12"
tags:
  - api
  - client
capabilities:
  - request
permissions:
  network:
    - internet
  filesystem:
    - read
---
```

## Validation Notes

1. The metadata block must be the first content in the file.
2. The opening and closing delimiters must be exactly three hyphens.
3. Unknown fields are preserved and not dropped.
4. Secrets and credentials must never be placed in metadata.
5. Version numbers must follow semantic versioning.
6. Runtime language must be one of the supported values.

## Related Files

- tokens.md
- ast-specification.md
- frontmatter-grammar.bnf
- grammar-v2.bnf