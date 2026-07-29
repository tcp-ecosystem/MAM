# Outputs Section

## Description
The Outputs section defines expected output values using a table format. It serves as a contract between the module and its consumers, specifying what data the module produces, including output names, types, and detailed descriptions.

The Outputs section is critical for:
- **API Documentation**: Clearly defines what the module returns
- **Type Safety**: Provides type information for static analysis
- **Tooling Support**: Enables IDE autocompletion and documentation
- **Error Prevention**: Helps consumers handle responses correctly
- **Testing**: Provides expected output for test cases

## Syntax

```markdown
## Outputs

| Name | Type | Description |
|------|------|-------------|
| result | dict | Processing result |
| error | string | Error message if failed |
```

### Table Format

The Outputs section uses a Markdown table with three columns:

| Column | Description | Values |
|--------|-------------|--------|
| Name | Output name | Identifier (snake_case) |
| Type | Data type | See Type Reference |
| Description | Output purpose | Free text |

### Advanced Table Format

For complex outputs, use extended format:

```markdown
## Outputs

| Name | Type | Nullable | Description |
|------|------|----------|-------------|
| user | dict | No | User object |
| error | string | Yes | Error message |
| metadata | dict | Yes | Response metadata |
```

## Rules

1. **Table format**: Must use Markdown table format
2. **Required columns**: Must include Name, Type, Description
3. **Valid types**: Must use valid type names
4. **Unique names**: Each output must have a unique name
5. **Snake_case**: Output names must use snake_case
6. **Complete documentation**: Each output must have a description
7. **Document side effects**: Document any side effects

### Type Reference

| Type | Description | Examples |
|------|-------------|----------|
| `string` | Text data | `"hello"`, `"error message"` |
| `int` | Integer numbers | `42`, `-1`, `0` |
| `float` | Decimal numbers | `3.14`, `-0.5` |
| `bool` | Boolean values | `true`, `false` |
| `dict` | Dictionary/object | `{"key": "value"}` |
| `list` | Array/list | `[1, 2, 3]` |
| `object` | Complex object | Custom class instances |
| `any` | Any type | Dynamic typing |
| `null` | Null/None value | `null`, `None` |
| `file` | File path/pathlib.Path | `"/path/to/file"` |
| `datetime` | Date/time | `"2026-01-01T00:00:00Z"` |
| `json` | JSON string | `'{"key": "value"}'` |
| `bytes` | Binary data | `b"data"` |

### Naming Rules

| Rule | Valid | Invalid |
|------|-------|---------|
| snake_case | `user_data` | `userData`, `user-data` |
| Alphanumeric | `result1` | `result-1`, `result.1` |
| Starts with letter | `name` | `1name`, `_name` |
| No reserved words | `data` | `class`, `def`, `import` |
| Max 64 chars | - | - |

## Description

The Outputs section defines what the module produces:

### 1. Simple Outputs

Basic output values:

```markdown
## Outputs

| Name | Type | Description |
|------|------|-------------|
| result | string | Processing result |
| success | bool | Whether operation succeeded |
```

### 2. Complex Outputs

Outputs with complex types:

```markdown
## Outputs

| Name | Type | Description |
|------|------|-------------|
| user | dict | User object |
| user.id | string | User ID |
| user.name | string | User name |
| user.email | string | User email |
```

### 3. Array Outputs

Outputs that return arrays:

```markdown
## Outputs

| Name | Type | Description |
|------|------|-------------|
| users | list | List of users |
| total | int | Total count |
| page | int | Current page |
```

### 4. Error Outputs

Outputs that include error information:

```markdown
## Outputs

| Name | Type | Description |
|------|------|-------------|
| success | bool | Whether operation succeeded |
| data | dict|null | Result data (null on error) |
| error | string|null | Error message (null on success) |
| error_code | string|null | Error code (null on success) |
```

### 5. Metadata Outputs

Outputs with metadata:

```markdown
## Outputs

| Name | Type | Description |
|------|------|-------------|
| data | dict | Result data |
| metadata | dict | Response metadata |
| metadata.request_id | string | Unique request ID |
| metadata.timestamp | datetime | Response timestamp |
| metadata.version | string | API version |
```

### 6. Paginated Outputs

Outputs for paginated results:

```markdown
## Outputs

| Name | Type | Description |
|------|------|-------------|
| items | list | List of items |
| total | int | Total item count |
| page | int | Current page number |
| per_page | int | Items per page |
| has_next | bool | Whether more pages exist |
```

### 7. File Outputs

Outputs that return file paths:

```markdown
## Outputs

| Name | Type | Description |
|------|------|-------------|
| output_file | file | Path to output file |
| file_size | int | File size in bytes |
| checksum | string | File checksum |
```

### 8. Status Outputs

Outputs with status information:

```markdown
## Outputs

| Name | Type | Description |
|------|------|-------------|
| status | string | Operation status |
| progress | int | Progress percentage (0-100) |
| message | string | Status message |
```

## Examples

### Authentication Module

```markdown
## Outputs

| Name | Type | Description |
|------|------|-------------|
| access_token | string | JWT access token |
| refresh_token | string | JWT refresh token |
| expires_in | int | Token expiration in seconds |
| token_type | string | Token type (Bearer) |
| user | dict | Authenticated user data |
```

### API Client

```markdown
## Outputs

| Name | Type | Description |
|------|------|-------------|
| data | dict|list|None | Response data |
| status_code | int | HTTP status code |
| headers | dict | Response headers |
| success | bool | Whether request succeeded |
| error | string|null | Error message if failed |
```

### Data Processing

```markdown
## Outputs

| Name | Type | Description |
|------|------|-------------|
| processed_data | list | Processed data rows |
| total_rows | int | Total rows processed |
| successful_rows | int | Successfully processed rows |
| failed_rows | int | Failed rows count |
| errors | list | Processing errors |
```

### File Upload

```markdown
## Outputs

| Name | Type | Description |
|------|------|-------------|
| file_id | string | Unique file identifier |
| filename | string | Original filename |
| url | string | File access URL |
| size | int | File size in bytes |
| content_type | string | MIME type |
```

### Database Query

```markdown
## Outputs

| Name | Type | Description |
|------|------|-------------|
| rows | list | Query result rows |
| row_count | int | Number of rows returned |
| last_insert_id | int|null | Last insert ID (for inserts) |
| affected_rows | int|null | Affected row count |
```

### Search Results

```markdown
## Outputs

| Name | Type | Description |
|------|------|-------------|
| results | list | Search results |
| total | int | Total matching results |
| page | int | Current page |
| per_page | int | Results per page |
| query | string | Original search query |
| facets | dict|None | Search facets |
```

### Webhook Response

```markdown
## Outputs

| Name | Type | Description |
|------|------|-------------|
| received | bool | Whether webhook was received |
| event_id | string | Unique event identifier |
| processed | bool | Whether event was processed |
| error | string|null | Processing error |
```

### Email Sending

```markdown
## Outputs

| Name | Type | Description |
|------|------|-------------|
| message_id | string | Email message ID |
| sent | bool | Whether email was sent |
| error | string|null | Sending error |
| recipients | list | Recipient addresses |
```

## Edge Cases

### 1. Nullable Outputs

When outputs can be null:

```markdown
## Outputs

| Name | Type | Nullable | Description |
|------|------|----------|-------------|
| data | dict | Yes | Result data |
| error | string | Yes | Error message |
```

### 2. Union Types

When outputs can be multiple types:

```markdown
## Outputs

| Name | Type | Description |
|------|------|-------------|
| result | string|int|dict | Result value |
```

### 3. Empty Outputs

When there are no outputs:

```markdown
## Outputs

(none)
```

Or omit the section.

### 4. Streaming Outputs

When outputs are streamed:

```markdown
## Outputs

| Name | Type | Description |
|------|------|-------------|
| stream | generator | Data stream |
| chunk_size | int | Chunk size in bytes |
```

### 5. Binary Outputs

When outputs contain binary data:

```markdown
## Outputs

| Name | Type | Description |
|------|------|-------------|
| data | bytes | Binary data |
| encoding | string | Data encoding |
```

### 6. Error-Only Outputs

When only errors are output:

```markdown
## Outputs

| Name | Type | Description |
|------|------|-------------|
| success | bool | Whether operation succeeded |
| error | string|null | Error message |
```

### 7. Complex Nested Outputs

When outputs have nested structure:

```markdown
## Outputs

| Name | Type | Description |
|------|------|-------------|
| user | dict | User object |
| user.profile | dict | User profile |
| user.profile.name | string | User name |
| user.settings | dict | User settings |
```

### 8. Dynamic Outputs

When outputs vary by input:

```markdown
## Outputs

| Name | Type | Description |
|------|------|-------------|
| ** | any | Dynamic outputs based on input |
```

### 9. File Outputs

When outputs are file paths:

```markdown
## Outputs

| Name | Type | Description |
|------|------|-------------|
| output_file | file | Path to output file |
| file_size | int | File size in bytes |
```

### 10. Status Outputs

When outputs indicate status:

```markdown
## Outputs

| Name | Type | Description |
|------|------|-------------|
| status | string | Operation status |
| message | string | Status message |
```

## Best Practices

### 1. Use Clear Names

Use descriptive, snake_case names:

```markdown
# Bad
- result
- data
- x

# Good
- user_data
- processing_result
- total_count
```

### 2. Document Everything

Include clear descriptions:

```markdown
# Bad
| result | dict | Result |

# Good
| user_data | dict | Authenticated user object with profile information |
```

### 3. Specify Types Accurately

Use precise types:

```markdown
# Bad
| count | int | Count |

# Good
| total_users | int | Total number of active users |
```

### 4. Document Nullability

Document when outputs can be null:

```markdown
## Outputs

| Name | Type | Nullable | Description |
|------|------|----------|-------------|
| data | dict | No | Always present |
| error | string | Yes | Only on error |
```

### 5. Group Related Outputs

Organize outputs logically:

```markdown
## Outputs

# User Data
| Name | Type | Description |
|------|------|-------------|
| user_id | string | User identifier |
| user_name | string | User display name |

# Response Metadata
| Name | Type | Description |
|------|------|-------------|
| request_id | string | Unique request ID |
| timestamp | datetime | Response timestamp |
```

### 6. Document Side Effects

Document any side effects:

```markdown
## Outputs

| Name | Type | Description |
|------|------|-------------|
| success | bool | Whether operation succeeded |

**Side Effects:**
- Sends email to user
- Updates database record
- Logs to audit trail
```

### 7. Show Complex Types

Document nested structures:

```markdown
## Outputs

| Name | Type | Description |
|------|------|-------------|
| user | dict | User object |
| user.name | string | User name |
| user.email | string | User email |
```

### 8. Include Error Outputs

Always document error outputs:

```markdown
## Outputs

| Name | Type | Description |
|------|------|-------------|
| data | dict|null | Result data |
| error | string|null | Error message |
```

### 9. Use Consistent Formatting

Maintain consistent table format:

```markdown
## Outputs

| Name | Type | Description |
|------|------|-------------|
| param1 | string | First parameter |
| param2 | int | Second parameter |
```

### 10. Version Your Outputs

Document output changes between versions.

## Common Patterns

### Pattern 1: Success/Error

```markdown
## Outputs

| Name | Type | Description |
|------|------|-------------|
| success | bool | Whether operation succeeded |
| data | dict|null | Result data |
| error | string|null | Error message |
```

### Pattern 2: Paginated List

```markdown
## Outputs

| Name | Type | Description |
|------|------|-------------|
| items | list | List of items |
| total | int | Total count |
| page | int | Current page |
| per_page | int | Items per page |
| has_next | bool | Whether more pages |
```

### Pattern 3: User Data

```markdown
## Outputs

| Name | Type | Description |
|------|------|-------------|
| user_id | string | User identifier |
| username | string | User name |
| email | string | User email |
| created_at | datetime | Creation timestamp |
```

### Pattern 4: File Result

```markdown
## Outputs

| Name | Type | Description |
|------|------|-------------|
| file_id | string | File identifier |
| filename | string | Original filename |
| url | string | Download URL |
| size | int | File size in bytes |
```

### Pattern 5: Processing Result

```markdown
## Outputs

| Name | Type | Description |
|------|------|-------------|
| processed | int | Items processed |
| successful | int | Successful items |
| failed | int | Failed items |
| errors | list | Error details |
```

### Pattern 6: API Response

```markdown
## Outputs

| Name | Type | Description |
|------|------|-------------|
| data | dict|list|None | Response data |
| status | int | HTTP status code |
| headers | dict | Response headers |
```

### Pattern 7: Search Results

```markdown
## Outputs

| Name | Type | Description |
|------|------|-------------|
| results | list | Search results |
| total | int | Total matches |
| page | int | Current page |
| facets | dict|None | Search facets |
```

### Pattern 8: Task Result

```markdown
## Outputs

| Name | Type | Description |
|------|------|-------------|
| task_id | string | Task identifier |
| status | string | Task status |
| result | dict|null | Task result |
| progress | int | Progress percentage |
```

### Pattern 9: Validation Result

```markdown
## Outputs

| Name | Type | Description |
|------|------|-------------|
| valid | bool | Whether input is valid |
| errors | list | Validation errors |
| warnings | list | Validation warnings |
```

### Pattern 10: Batch Result

```markdown
## Outputs

| Name | Type | Description |
|------|------|-------------|
| total | int | Total items in batch |
| processed | int | Items processed |
| successful | int | Successful items |
| failed | int | Failed items |
| results | list | Individual results |
```

## Validation Rules

### Rule 1: Valid Table Format

Outputs must be in valid Markdown table format:

```python
def validate_table_format(content: str) -> bool:
    lines = content.strip().split('\n')
    if len(lines) < 3:
        return False
    
    # Check header
    header = lines[0]
    if not header.startswith('|') or not header.endswith('|'):
        return False
    
    # Check separator
    separator = lines[1]
    if not all(c in '|-' for c in separator):
        return False
    
    return True
```

### Rule 2: Required Columns

Table must have all required columns:

```python
REQUIRED_COLUMNS = {'Name', 'Type', 'Description'}

def validate_columns(header: str) -> bool:
    columns = [col.strip() for col in header.split('|')[1:-1]]
    return REQUIRED_COLUMNS.issubset(set(columns))
```

### Rule 3: Valid Types

Types must be from valid type list:

```python
VALID_TYPES = {
    'string', 'int', 'float', 'bool', 'dict', 'list',
    'object', 'any', 'null', 'file', 'datetime', 'json', 'bytes'
}

def validate_type(type_name: str) -> bool:
    return type_name in VALID_TYPES
```

### Rule 4: Unique Names

Output names must be unique:

```python
def validate_unique_names(rows: list[str]) -> bool:
    names = [row.split('|')[1].strip() for row in rows]
    return len(names) == len(set(names))
```

### Rule 5: Valid Names

Output names must follow naming rules:

```python
import re

def validate_name(name: str) -> bool:
    pattern = r'^[a-z][a-z0-9_]{0,63}$'
    return bool(re.match(pattern, name))
```

### Rule 6: No Reserved Words

Output names cannot be reserved words:

```python
RESERVED_WORDS = {'class', 'def', 'import', 'return', 'if', 'else', 'for', 'while'}

def validate_reserved_word(name: str) -> bool:
    return name not in RESERVED_WORDS
```

### Rule 7: Description Present

Each output must have a description:

```python
def validate_description(row: str) -> bool:
    parts = row.split('|')
    return len(parts) >= 4 and parts[3].strip() != ''
```

### Rule 8: Type Consistency

Types should be consistent across outputs.

## Related Sections

- **[Inputs](inputs.md)**: Input parameters
- **[Rules](rules.md)**: Validation rules
- **[Tests](tests.md)**: Output validation tests
- **[Python](python.md)**: Python implementation
- **[JavaScript](javascript.md)**: JavaScript implementation
- **[Examples](examples.md)**: Usage examples

## FAQ

### Q: What's the difference between Outputs and Exports?

**A:** Outputs define *values* the module returns. Exports define *functions and classes* the module provides.

### Q: Should I document all outputs?

**A:** Yes, document all outputs including error cases.

### Q: How do I handle dynamic outputs?

**A:** Use `any` type or document variations:

```markdown
| Name | Type | Description |
|------|------|-------------|
| result | any | Varies by input type |
```

### Q: Can I use union types?

**A:** Yes, separate with pipes:

```markdown
| Name | Type | Description |
|------|------|-------------|
| value | string|int | String or integer |
```

### Q: How do I show nullable outputs?

**A:** Add a Nullable column:

```markdown
| Name | Type | Nullable | Description |
|------|------|----------|-------------|
| data | dict | No | Always present |
| error | string | Yes | Only on error |
```

### Q: Should I use snake_case?

**A:** Yes, use snake_case for output names:

```markdown
# Good
user_data
total_count

# Bad
userData
totalCount
```

### Q: How do I document nested outputs?

**A:** Use dot notation:

```markdown
| Name | Type | Description |
|------|------|-------------|
| user | dict | User object |
| user.name | string | User name |
```

### Q: Can I use complex types?

**A:** Yes, document the structure:

```markdown
| Name | Type | Description |
|------|------|-------------|
| config | dict | Configuration object |
| config.host | string | Host address |
```

### Q: How do I handle error outputs?

**A:** Always include error outputs:

```markdown
| Name | Type | Description |
|------|------|-------------|
| data | dict|null | Result data |
| error | string|null | Error message |
```

### Q: Should I show examples?

**A:** Yes, add an Example column:

```markdown
| Name | Type | Example | Description |
|------|------|---------|-------------|
| user_id | string | "123" | User identifier |
```

### Q: How do I group outputs?

**A:** Use section comments:

```markdown
## Outputs

# User Data
| Name | Type | Description |
|------|------|-------------|
| user_id | string | User identifier |

# Metadata
| Name | Type | Description |
|------|------|-------------|
| request_id | string | Request identifier |
```

### Q: Can I use binary types?

**A:** Yes, use `bytes` type:

```markdown
| Name | Type | Description |
|------|------|-------------|
| data | bytes | Binary data |
```

### Q: How do I document side effects?

**A:** Add a Side Effects section:

```markdown
## Outputs

| Name | Type | Description |
|------|------|-------------|
| success | bool | Operation status |

**Side Effects:**
- Sends email
- Updates database
```

### Q: Should I version my outputs?

**A:** Yes, document output changes between versions.

### Q: How do I handle streaming outputs?

**A:** Use `generator` type:

```markdown
| Name | Type | Description |
|------|------|-------------|
| stream | generator | Data stream |
```

### Q: Can I use file types?

**A:** Yes, use `file` type:

```markdown
| Name | Type | Description |
|------|------|-------------|
| output_file | file | Path to output file |
```

### Q: How do I show progress outputs?

**A:** Include progress fields:

```markdown
| Name | Type | Description |
|------|------|-------------|
| status | string | Current status |
| progress | int | Progress percentage |
```

### Q: Should I document all possible error codes?

**A:** Yes, document error codes and their meanings.

### Q: How do I handle async outputs?

**A:** Document async behavior:

```markdown
| Name | Type | Description |
|------|------|-------------|
| task_id | string | Async task ID |
| status | string | Task status |
```

### Q: Can I use nested tables?

**A:** No, use dot notation for nested fields.

### Q: How do I show conditional outputs?

**A:** Document conditions:

```markdown
| Name | Type | Description |
|------|------|-------------|
| data | dict|null | Present on success |
| error | string|null | Present on error |
```

## Implementation Notes

### Output Extraction

```python
def extract_outputs(content: str) -> list[dict]:
    outputs = []
    in_table = False
    
    for line in content.split('\n'):
        if line.strip().startswith('| Name'):
            in_table = True
            continue
        
        if in_table and line.strip().startswith('|'):
            if '---' in line:
                continue
            
            parts = [p.strip() for p in line.split('|')[1:-1]]
            if len(parts) >= 3:
                outputs.append({
                    'name': parts[0],
                    'type': parts[1],
                    'description': parts[2]
                })
        elif in_table:
            in_table = False
    
    return outputs
```

### Output Validation

```python
def validate_outputs(outputs: list[dict]) -> list[str]:
    errors = []
    
    for output in outputs:
        # Validate name
        if not validate_name(output['name']):
            errors.append(f"Invalid name: {output['name']}")
        
        # Validate type
        if not validate_type(output['type']):
            errors.append(f"Invalid type: {output['type']}")
    
    return errors
```

### Output Documentation Generator

```python
def document_outputs(outputs: list[dict]) -> str:
    docs = "# Output Values\n\n"
    
    for output in outputs:
        docs += f"## {output['name']}\n\n"
        docs += f"- **Type**: {output['type']}\n"
        docs += f"- **Description**: {output['description']}\n\n"
    
    return docs
```

## References

- [MAM Specification - Outputs](../SPEC.md#outputs)
- [JSON Schema](https://json-schema.org/)
- [OpenAPI Specification](https://swagger.io/specification/)
- [TypeScript Types](https://www.typescriptlang.org/docs/handbook/basic-types.html)

---

**Section Version:** 1.0.0
**Last Updated:** 2026-07-24
**Status:** Stable