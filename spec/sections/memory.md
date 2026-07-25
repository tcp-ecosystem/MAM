# Memory Section

## Description
The Memory section defines persistent state and knowledge for the module.

## Syntax
```markdown
## Memory

- **key**: value
- **state**: idle
```

## Rules
- Use bold key format for entries
- Can contain JSON code blocks for structured data

## Example
```markdown
## Memory

- **last_login**: null
- **login_count**: 0
- **session_data**: {}

```json
{
  "preferences": {},
  "history": []
}
```
```