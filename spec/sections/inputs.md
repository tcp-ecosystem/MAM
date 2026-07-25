# Inputs Section

## Description
The Inputs section defines expected input parameters using a table format.

## Syntax
```markdown
## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| param1 | string | Yes | Description |
| param2 | int | No | Description |
```

## Rules
- Table format with columns: Name, Type, Required, Description
- Type values: string, int, float, bool, dict, list, object
- Required values: Yes or No

## Example
```markdown
## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| username | string | Yes | User identifier |
| password | string | Yes | User password |
| timeout | int | No | Request timeout in seconds |
```