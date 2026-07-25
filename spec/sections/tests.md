# Tests Section

## Description
The Tests section contains validation rules and test cases.

## Syntax
```markdown
## Tests

```python
def test_process():
    result = process("input")
    assert result == expected
```
```

## Rules
- Include test functions with assertions
- Cover happy path and edge cases

## Example
```markdown
## Tests

```python
def test_valid_token():
    auth = Auth("secret")
    tokens = auth.generate_token("user")
    assert "access_token" in tokens

def test_invalid_token():
    auth = Auth("secret")
    result = auth.validate_token("invalid")
    assert result is None
```
```