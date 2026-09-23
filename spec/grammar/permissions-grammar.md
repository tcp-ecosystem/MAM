# MAM Permissions Grammar
# Version: 1.0.0
# Human readable specification of the permissions section

## Description

The permissions grammar defines the Permissions section of a MAM module.
Permissions declare what resources the module is allowed to access: network,
filesystem, environment, exec, and memory. They enable sandboxing, access
control, and security auditing. Permissions are security grants, distinct from
Capabilities which are functional prerequisites.

Permissions are case insensitive names with optional colon separated scopes
and an optional justification comment.

## Syntax

```text
## Permissions

- <permission_name>
- <permission_name>:<scope>
- `<permission_name>` - <justification>
```

### Valid Permissions

| Permission | Meaning | Risk |
|------------|---------|------|
| network | HTTP/HTTPS access | Medium |
| filesystem | File read and write access | High |
| environment | Environment variable access | Medium |
| exec | Process execution | High |
| memory | Large memory allocation | Low |

### Scope Syntax

Scopes restrict a permission to a specific resource.

```text
filesystem:read
filesystem:write
filesystem:/app/data
network:https
network:api.example.com
environment:MYAPP_*
exec:python
exec:git
```

## Grammar Rules

| Rule | Pattern | Description |
|------|---------|-------------|
| Lowercase | `[a-z]` | Permission names are lowercase |
| No spaces | `[a-z0-9:]` | Spaces are not allowed |
| Colon scopes | `:` | Scopes follow the base name |
| Hyphens allowed | `-` | Hyphens allowed in scopes |
| Max length | 32 chars | Permission names are limited |
| Justification | `- text` | Optional comment after a dash |

### Validation Rules

1. The base permission must be from the valid list.
2. Each permission should be listed only once.
3. Conflicting permissions such as network and network:none are rejected.
4. High risk permissions should carry a justification.
5. The principle of least privilege applies.

## Examples

### Minimal

```text
## Permissions

- network
```

### Scoped

```text
## Permissions

- filesystem:read:/app/config
- filesystem:write:/app/data
- network:https
```

### Justified

```text
## Permissions

- `network` - Required for API authentication
- `filesystem` - Required for certificate storage
```

### Full

```text
## Permissions

- network
- filesystem
- environment
- exec
- memory
```

## Validation Notes

1. Valid base names are network, filesystem, environment, exec, memory.
2. The format pattern is `^[a-z][a-z0-9:]{0,31}$`.
3. Duplicates are reported as errors.
4. Risk levels: network medium, filesystem high, environment medium, exec high, memory low.
5. Custom permissions should be documented and use standard names when possible.

## Related Files

- tokens.md
- ast-specification.md
- section-grammar.bnf
- grammar-v2.bnf