# Permissions Section

## Description
The Permissions section declares required security permissions.

## Valid Permissions
- `network` - HTTP/HTTPS access
- `filesystem` - File read/write access
- `environment` - Environment variable access
- `exec` - Process execution
- `memory` - Large memory allocation

## Syntax
```markdown
## Permissions

- network
- filesystem
```

## Example
```markdown
## Permissions

- `network` - Required for API calls
- `filesystem` - Required for key storage
```