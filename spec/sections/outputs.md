# Outputs Section

## Description
The Outputs section defines expected output values.

## Syntax
```markdown
## Outputs

| Name | Type | Description |
|------|------|-------------|
| result | dict | Processing result |
```

## Rules
- Table format with columns: Name, Type, Description
- Mirrors the Inputs section structure

## Example
```markdown
## Outputs

| Name | Type | Description |
|------|------|-------------|
| access_token | string | JWT access token |
| expires_in | int | Token expiration in seconds |
| user | dict | Authenticated user data |
```