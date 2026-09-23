# MAM Capabilities Grammar
# Version: 1.0.0
# Human readable specification of the capabilities section

## Description

The capabilities grammar defines the Capabilities section of a MAM module.
Capabilities declare functional prerequisites: the runtime features, network
access, storage, compute, security, integration, and hardware conditions the
module needs to run. They are distinct from Permissions, which declare what
the module is allowed to do.

Capabilities are case insensitive strings that follow a colon separated
hierarchical naming pattern. The section is a markdown bullet list.

## Syntax

```text
## Capabilities

- <category>:<name>:<constraint>
- <category>:<name>
```

### Capability Format

Capabilities follow a structured pattern:

```text
<category>:<specific>:<version>
```

| Category | Meaning | Example |
|----------|---------|---------|
| runtime | Language runtime needs | runtime:python:3.12+ |
| network | Network access needs | network:https |
| storage | Persistence needs | storage:sqlite |
| compute | Resource needs | compute:memory:1GB |
| security | Security needs | security:tls:1.2+ |
| integration | External services | integration:rest-api |
| hardware | Hardware needs | hardware:gpu:cuda |

## Grammar Rules

| Rule | Pattern | Description |
|------|---------|-------------|
| Lowercase | `[a-z]` | All capability names are lowercase |
| Colon separated | `:` | Categories and names separated by colons |
| No spaces | `[a-z0-9:-]` | Spaces are not allowed |
| Hyphens allowed | `-` | Hyphens are allowed inside names |
| Max length | 128 chars | Capability names are limited |
| Optional marker | `(optional)` | Marks non critical capability |

### Version Constraints

Version constraints use semver compatible operators appended after a colon.

```text
runtime:python:>=3.10,<4.0
storage:sqlite:>=3.35,<4.0
compute:gpu:cuda:11.8+
```

### Nested Module Listings

A capability may carry nested module requirements as a sub list.

```text
- runtime:python:modules
  - `fastapi` - Web framework
  - `sqlalchemy` - ORM
```

## Examples

### Minimal

```text
## Capabilities

- runtime:python:3.12+
```

### Full

```text
## Capabilities

- runtime:python:3.12+
- runtime:python:venv
- network:https
- storage:sqlite
- compute:memory:512MB
- compute:timeout:30s
- security:tls:1.2+
- integration:rest-api
- hardware:x86_64
```

### Optional

```text
## Capabilities

- runtime:python:3.12+
- compute:gpu:cuda (optional)
- storage:redis (optional)
```

## Validation Notes

1. Capability names must match the pattern `^[a-z][a-z0-9:-]{0,127}$`.
2. Each capability should be listed only once.
3. Conflicting capabilities such as network:http and network:none are rejected.
4. Known categories are runtime, network, storage, compute, security, integration, hardware.
5. Custom capabilities use a namespace prefix such as custom:mycompany:feature.
6. The (optional) marker means the capability enhances but is not required.

## Related Files

- tokens.md
- ast-specification.md
- section-grammar.bnf
- grammar-v2.bnf