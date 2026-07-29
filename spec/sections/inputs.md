# Inputs Section

## Description
The Inputs section defines expected input parameters using a table format. It serves as a contract between the module and its consumers, specifying what data the module expects to receive, including parameter names, types, whether they're required, and detailed descriptions.

The Inputs section is critical for:
- **API Documentation**: Clearly defines what parameters the module accepts
- **Validation**: Enables automatic input validation
- **Type Safety**: Provides type information for static analysis
- **Tooling Support**: Enables IDE autocompletion and documentation
- **Error Prevention**: Catches missing or invalid inputs early

## Syntax

```markdown
## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| param1 | string | Yes | Description |
| param2 | int | No | Description |
```

### Table Format

The Inputs section uses a Markdown table with four columns:

| Column | Description | Values |
|--------|-------------|--------|
| Name | Parameter name | Identifier (snake_case) |
| Type | Data type | See Type Reference |
| Required | Whether required | Yes or No |
| Description | Parameter purpose | Free text |

### Advanced Table Format

For complex parameters, use extended format:

```markdown
## Inputs

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| username | string | Yes | - | User identifier |
| password | string | Yes | - | User password |
| timeout | int | No | 30 | Request timeout in seconds |
| retry | bool | No | true | Enable retries |
```

## Rules

1. **Table format**: Must use Markdown table format
2. **Required columns**: Must include Name, Type, Required, Description
3. **Valid types**: Must use valid type names
4. **Required values**: Required must be Yes or No
5. **Unique names**: Each parameter must have a unique name
6. **Snake_case**: Parameter names must use snake_case
7. **Complete documentation**: Each parameter must have a description

### Type Reference

| Type | Description | Examples |
|------|-------------|----------|
| `string` | Text data | `"hello"`, `"user@example.com"` |
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
| snake_case | `user_name` | `userName`, `user-name` |
| Alphanumeric | `param1` | `param-1`, `param.1` |
| Starts with letter | `name` | `1name`, `_name` |
| No reserved words | `user` | `class`, `def`, `import` |
| Max 64 chars | - | - |

## Description

The Inputs section defines the module's input contract:

### 1. Simple Parameters

Basic input parameters:

```markdown
## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| name | string | Yes | User's full name |
| email | string | Yes | User's email address |
| age | int | No | User's age |
```

### 2. Complex Parameters

Parameters with complex types:

```markdown
## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| user | dict | Yes | User data object |
| user.name | string | Yes | User's name |
| user.email | string | Yes | User's email |
| settings | dict | No | Configuration options |
| settings.timeout | int | No | Request timeout (default: 30) |
| settings.retries | int | No | Retry count (default: 3) |
```

### 3. Array Parameters

Parameters that accept arrays:

```markdown
## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| tags | list | No | List of tags |
| items | list | Yes | List of items to process |
| permissions | list | No | User permissions |
```

### 4. File Parameters

Parameters that accept file paths:

```markdown
## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| input_file | file | Yes | Path to input file |
| output_file | file | No | Path to output file |
| config_file | file | No | Path to configuration file |
```

### 5. Optional Parameters with Defaults

Parameters with default values:

```markdown
## Inputs

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| timeout | int | No | 30 | Request timeout in seconds |
| retries | int | No | 3 | Number of retry attempts |
| verbose | bool | No | false | Enable verbose logging |
```

### 6. Validated Parameters

Parameters with validation constraints:

```markdown
## Inputs

| Name | Type | Required | Constraints | Description |
|------|------|----------|-------------|-------------|
| username | string | Yes | 3-32 chars, alphanumeric | User identifier |
| password | string | Yes | min 8 chars | User password |
| email | string | Yes | valid email format | User email |
| age | int | No | 0-150 | User age |
```

### 7. Nested Object Parameters

Parameters with nested structures:

```markdown
## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| config | dict | Yes | Configuration object |
| config.database | dict | Yes | Database configuration |
| config.database.host | string | Yes | Database host |
| config.database.port | int | No | Database port (default: 5432) |
| config.cache | dict | No | Cache configuration |
```

### 8. Union Type Parameters

Parameters that accept multiple types:

```markdown
## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| value | string|int|float | Yes | Numeric or string value |
| data | dict|list | Yes | Structured data |
```

## Examples

### Authentication Module

```markdown
## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| username | string | Yes | User identifier |
| password | string | Yes | User password |
| remember_me | bool | No | Remember login session |
| mfa_code | string | No | Multi-factor authentication code |
```

### API Client

```markdown
## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| method | string | Yes | HTTP method (GET, POST, PUT, DELETE) |
| path | string | Yes | API endpoint path |
| data | dict | No | Request body data |
| headers | dict | No | Custom HTTP headers |
| timeout | int | No | Request timeout in seconds |
| retry | bool | No | Enable automatic retries |
```

### Data Processing

```markdown
## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| input_file | file | Yes | Path to input CSV file |
| output_file | file | No | Path to output file |
| columns | list | No | Columns to process |
| filters | dict | No | Filter conditions |
| sort_by | string | No | Column to sort by |
| limit | int | No | Maximum rows to process |
```

### File Upload

```markdown
## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| file | file | Yes | File to upload |
| filename | string | No | Custom filename |
| content_type | string | No | MIME type |
| metadata | dict | No | File metadata |
| overwrite | bool | No | Overwrite existing file |
```

### Webhook Handler

```markdown
## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| event_type | string | Yes | Webhook event type |
| payload | dict | Yes | Event payload data |
| signature | string | Yes | Webhook signature |
| timestamp | int | Yes | Event timestamp |
```

### Database Query

```markdown
## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| table | string | Yes | Database table name |
| query | dict | Yes | Query conditions |
| fields | list | No | Fields to select |
| order_by | string | No | Order by field |
| limit | int | No | Maximum results |
| offset | int | No | Result offset |
```

### Machine Learning

```markdown
## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| data | list | Yes | Training data |
| labels | list | Yes | Training labels |
| model_type | string | No | Model type (default: random_forest) |
| parameters | dict | No | Model hyperparameters |
| test_size | float | No | Test split ratio (default: 0.2) |
```

### Email Sending

```markdown
## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| to | string|list | Yes | Recipient email(s) |
| subject | string | Yes | Email subject |
| body | string | Yes | Email body |
| html | bool | No | Send as HTML |
| attachments | list | No | File attachments |
| cc | string|list | No | CC recipients |
| bcc | string|list | No | BCC recipients |
```

## Edge Cases

### 1. Optional vs Required

When parameters are truly optional:

```markdown
## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| name | string | Yes | User name |
| email | string | Yes | User email |
| phone | string | No | User phone (optional) |
```

### 2. Default Values

When parameters have defaults:

```markdown
## Inputs

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| timeout | int | No | 30 | Timeout in seconds |
| retries | int | No | 3 | Retry count |
```

### 3. Validation Constraints

When parameters have constraints:

```markdown
## Inputs

| Name | Type | Required | Constraints | Description |
|------|------|----------|-------------|-------------|
| age | int | No | 0-150 | User age |
| email | string | Yes | valid email | User email |
| password | string | Yes | min 8 chars | User password |
```

### 4. Union Types

When parameters accept multiple types:

```markdown
## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| value | string|int | Yes | String or integer value |
| data | dict|list | Yes | Object or array |
```

### 5. Nested Objects

When parameters contain nested data:

```markdown
## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| user | dict | Yes | User object |
| user.name | string | Yes | User name |
| user.email | string | Yes | User email |
```

### 6. Array Parameters

When parameters accept arrays:

```markdown
## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| tags | list | No | List of tags |
| items | list | Yes | Items to process |
```

### 7. File Parameters

When parameters accept file paths:

```markdown
## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| input_file | file | Yes | Input file path |
| output_file | file | No | Output file path |
```

### 8. Binary Data

When parameters accept binary data:

```markdown
## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| data | bytes | Yes | Binary data |
| encoding | string | No | Data encoding |
```

### 9. Null Values

When parameters can be null:

```markdown
## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| value | string|null | Yes | String or null |
| data | dict|null | No | Object or null |
```

### 10. Dynamic Parameters

When parameters are dynamic:

```markdown
## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| **kwargs | dict | No | Additional parameters |
```

## Best Practices

### 1. Use Clear Names

Use descriptive, snake_case names:

```markdown
# Bad
- n
- x
- data

# Good
- username
- timeout
- user_data
```

### 2. Document Everything

Include clear descriptions:

```markdown
# Bad
| name | string | Yes | Name |

# Good
| username | string | Yes | Unique user identifier (3-32 characters) |
```

### 3. Specify Defaults

Document default values:

```markdown
## Inputs

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| timeout | int | No | 30 | Request timeout in seconds |
```

### 4. Use Constraints

Add validation constraints:

```markdown
## Inputs

| Name | Type | Required | Constraints | Description |
|------|------|----------|-------------|-------------|
| age | int | No | 0-150 | User age |
```

### 5. Group Related Parameters

Organize parameters logically:

```markdown
## Inputs

# User Information
| Name | Type | Required | Description |
|------|------|----------|-------------|
| username | string | Yes | User identifier |
| email | string | Yes | User email |

# Configuration
| Name | Type | Required | Description |
|------|------|----------|-------------|
| timeout | int | No | Request timeout |
| retries | int | No | Retry count |
```

### 6. Show Complex Types

Document nested structures:

```markdown
## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| config | dict | Yes | Configuration object |
| config.host | string | Yes | Host address |
| config.port | int | No | Port number |
```

### 7. Document Validation Rules

Explain validation:

```markdown
## Inputs

| Name | Type | Required | Validation | Description |
|------|------|----------|------------|-------------|
| email | string | Yes | RFC 5322 | User email |
| password | string | Yes | min 8 chars | User password |
```

### 8. Show Examples

Include example values:

```markdown
## Inputs

| Name | Type | Required | Example | Description |
|------|------|----------|---------|-------------|
| email | string | Yes | user@example.com | User email |
| timeout | int | No | 30 | Timeout in seconds |
```

### 9. Document Optional Parameters

Clearly mark optional parameters:

```markdown
## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| name | string | Yes | Required parameter |
| phone | string | No | Optional parameter |
```

### 10. Use Consistent Formatting

Maintain consistent table format:

```markdown
## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| param1 | string | Yes | First parameter |
| param2 | int | No | Second parameter |
```

## Common Patterns

### Pattern 1: CRUD Operations

```markdown
## Inputs

# Create/Update
| Name | Type | Required | Description |
|------|------|----------|-------------|
| id | string | Yes (update) | Resource ID |
| data | dict | Yes | Resource data |

# Read/Delete
| Name | Type | Required | Description |
|------|------|----------|-------------|
| id | string | Yes | Resource ID |

# List
| Name | Type | Required | Description |
|------|------|----------|-------------|
| filter | dict | No | Filter conditions |
| sort | string | No | Sort field |
| limit | int | No | Result limit |
| offset | int | No | Result offset |
```

### Pattern 2: API Client

```markdown
## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| method | string | Yes | HTTP method |
| path | string | Yes | Endpoint path |
| data | dict | No | Request body |
| headers | dict | No | Custom headers |
| params | dict | No | Query parameters |
| timeout | int | No | Request timeout |
```

### Pattern 3: File Processing

```markdown
## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| input_path | file | Yes | Input file path |
| output_path | file | No | Output file path |
| options | dict | No | Processing options |
```

### Pattern 4: Database Operations

```markdown
## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| table | string | Yes | Table name |
| operation | string | Yes | Operation type |
| data | dict | Yes | Operation data |
| conditions | dict | No | Filter conditions |
```

### Pattern 5: Authentication

```markdown
## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| username | string | Yes | User identifier |
| password | string | Yes | User password |
| mfa_code | string | No | MFA code |
| remember | bool | No | Remember session |
```

### Pattern 6: Search

```markdown
## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| query | string | Yes | Search query |
| filters | dict | No | Search filters |
| page | int | No | Page number |
| per_page | int | No | Results per page |
```

### Pattern 7: Configuration

```markdown
## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| config | dict | Yes | Configuration object |
| validate | bool | No | Validate config |
| merge | bool | No | Merge with defaults |
```

### Pattern 8: Batch Processing

```markdown
## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| items | list | Yes | Items to process |
| batch_size | int | No | Batch size |
| parallel | bool | No | Process in parallel |
```

### Pattern 9: Webhook

```markdown
## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| event | string | Yes | Event type |
| payload | dict | Yes | Event data |
| signature | string | Yes | Webhook signature |
| timestamp | int | Yes | Event timestamp |
```

### Pattern 10: Export/Import

```markdown
## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| format | string | Yes | Export format |
| data | list|dict | Yes | Data to export |
| options | dict | No | Export options |
```

## Validation Rules

### Rule 1: Valid Table Format

Inputs must be in valid Markdown table format:

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
REQUIRED_COLUMNS = {'Name', 'Type', 'Required', 'Description'}

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

### Rule 4: Required Values

Required column must be Yes or No:

```python
def validate_required(value: str) -> bool:
    return value.strip() in ('Yes', 'No')
```

### Rule 5: Unique Names

Parameter names must be unique:

```python
def validate_unique_names(rows: list[str]) -> bool:
    names = [row.split('|')[1].strip() for row in rows]
    return len(names) == len(set(names))
```

### Rule 6: Valid Names

Parameter names must follow naming rules:

```python
import re

def validate_name(name: str) -> bool:
    pattern = r'^[a-z][a-z0-9_]{0,63}$'
    return bool(re.match(pattern, name))
```

### Rule 7: No Reserved Words

Parameter names cannot be reserved words:

```python
RESERVED_WORDS = {'class', 'def', 'import', 'return', 'if', 'else', 'for', 'while'}

def validate_reserved_word(name: str) -> bool:
    return name not in RESERVED_WORDS
```

### Rule 8: Description Present

Each parameter must have a description:

```python
def validate_description(row: str) -> bool:
    parts = row.split('|')
    return len(parts) >= 5 and parts[4].strip() != ''
```

## Related Sections

- **[Outputs](outputs.md)**: Output parameters
- **[Rules](rules.md)**: Validation rules
- **[Tests](tests.md)**: Input validation tests
- **[Python](python.md)**: Python implementation
- **[JavaScript](javascript.md)**: JavaScript implementation
- **[Examples](examples.md)**: Usage examples

## FAQ

### Q: What's the difference between Inputs and Dependencies?

**A:** Inputs define *parameters* the module accepts at runtime. Dependencies define *packages* that must be installed.

### Q: Should I document all parameters?

**A:** Yes, document all parameters including optional ones.

### Q: How do I handle dynamic parameters?

**A:** Use `**kwargs` or document as "additional parameters".

### Q: Can I use complex types?

**A:** Yes, use nested documentation:

```markdown
| Name | Type | Required | Description |
|------|------|----------|-------------|
| config | dict | Yes | Configuration object |
| config.host | string | Yes | Host address |
```

### Q: How do I show default values?

**A:** Add a Default column:

```markdown
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| timeout | int | No | 30 | Timeout in seconds |
```

### Q: Should I use snake_case?

**A:** Yes, use snake_case for parameter names:

```markdown
# Good
user_name
timeout_seconds

# Bad
userName
timeoutSeconds
```

### Q: How do I document validation rules?

**A:** Add a Constraints or Validation column:

```markdown
| Name | Type | Required | Constraints | Description |
|------|------|----------|-------------|-------------|
| age | int | No | 0-150 | User age |
```

### Q: Can I use union types?

**A:** Yes, separate with pipes:

```markdown
| Name | Type | Required | Description |
|------|------|----------|-------------|
| value | string|int | Yes | String or integer |
```

### Q: How do I handle file inputs?

**A:** Use the `file` type:

```markdown
| Name | Type | Required | Description |
|------|------|----------|-------------|
| input_file | file | Yes | Path to input file |
```

### Q: Should I show examples?

**A:** Yes, add an Example column:

```markdown
| Name | Type | Required | Example | Description |
|------|------|----------|---------|-------------|
| email | string | Yes | user@example.com | User email |
```

### Q: How do I group parameters?

**A:** Use section comments:

```markdown
## Inputs

# User Information
| Name | Type | Required | Description |
|------|------|----------|-------------|
| username | string | Yes | User identifier |

# Configuration
| Name | Type | Required | Description |
|------|------|----------|-------------|
| timeout | int | No | Request timeout |
```

### Q: Can I use null types?

**A:** Yes, for nullable parameters:

```markdown
| Name | Type | Required | Description |
|------|------|----------|-------------|
| value | string|null | Yes | String or null |
```

### Q: How do I handle binary data?

**A:** Use the `bytes` type:

```markdown
| Name | Type | Required | Description |
|------|------|----------|-------------|
| data | bytes | Yes | Binary data |
```

### Q: Should I document side effects?

**A:** Yes, in the Description column:

```markdown
| Name | Type | Required | Description |
|------|------|----------|-------------|
| email | string | Yes | Sends email to this address |
```

### Q: How do I handle required vs optional?

**A:** Use the Required column:

```markdown
| Name | Type | Required | Description |
|------|------|----------|-------------|
| name | string | Yes | Required parameter |
| phone | string | No | Optional parameter |
```

### Q: Can I use nested tables?

**A:** No, use nested documentation:

```markdown
| Name | Type | Required | Description |
|------|------|----------|-------------|
| user | dict | Yes | User object |
| user.name | string | Yes | User name |
```

### Q: How do I handle array inputs?

**A:** Use the `list` type:

```markdown
| Name | Type | Required | Description |
|------|------|----------|-------------|
| items | list | Yes | List of items |
```

### Q: Should I validate inputs in the module?

**A:** Yes, document validation rules and implement them.

### Q: Can I have multiple input tables?

**A:** Yes, for different input modes:

```markdown
## Inputs

### Create Mode
| Name | Type | Required | Description |
|------|------|----------|-------------|
| ... | ... | ... | ... |

### Update Mode
| Name | Type | Required | Description |
|------|------|----------|-------------|
| ... | ... | ... | ... |
```

## Implementation Notes

### Input Extraction

```python
def extract_inputs(content: str) -> list[dict]:
    inputs = []
    in_table = False
    
    for line in content.split('\n'):
        if line.strip().startswith('| Name'):
            in_table = True
            continue
        
        if in_table and line.strip().startswith('|'):
            if '---' in line:
                continue
            
            parts = [p.strip() for p in line.split('|')[1:-1]]
            if len(parts) >= 4:
                inputs.append({
                    'name': parts[0],
                    'type': parts[1],
                    'required': parts[2] == 'Yes',
                    'description': parts[3]
                })
        elif in_table:
            in_table = False
    
    return inputs
```

### Input Validation

```python
def validate_inputs(inputs: list[dict]) -> list[str]:
    errors = []
    
    for input_def in inputs:
        # Validate name
        if not validate_name(input_def['name']):
            errors.append(f"Invalid name: {input_def['name']}")
        
        # Validate type
        if not validate_type(input_def['type']):
            errors.append(f"Invalid type: {input_def['type']}")
        
        # Validate required
        if input_def['required'] not in ('Yes', 'No'):
            errors.append(f"Invalid required value: {input_def['required']}")
    
    return errors
```

### Input Documentation Generator

```python
def document_inputs(inputs: list[dict]) -> str:
    docs = "# Input Parameters\n\n"
    
    for input_def in inputs:
        docs += f"## {input_def['name']}\n\n"
        docs += f"- **Type**: {input_def['type']}\n"
        docs += f"- **Required**: {input_def['required']}\n"
        docs += f"- **Description**: {input_def['description']}\n\n"
    
    return docs
```

## References

- [MAM Specification - Inputs](../SPEC.md#inputs)
- [JSON Schema](https://json-schema.org/)
- [OpenAPI Specification](https://swagger.io/specification/)
- [TypeScript Types](https://www.typescriptlang.org/docs/handbook/basic-types.html)

---

**Section Version:** 1.0.0
**Last Updated:** 2026-07-24
**Status:** Stable