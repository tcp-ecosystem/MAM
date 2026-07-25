# Python Section

## Description
The Python section contains Python code blocks for execution.

## Syntax
```markdown
## Python

```python
def process(input):
    return result
```
```

## Rules
- Language identifier must be `python` or `py`
- Code must be valid Python syntax
- Use `@mam:` metadata comments for execution hints

## Metadata Comments
```python
# @mam:timeout=30s
# @mam:memory=256MB
# @mam:requires=network
```

## Example
```markdown
## Python

```python
# @mam:timeout=10s

def authenticate(username: str, password: str) -> dict:
    """Authenticate user and return token."""
    if verify_credentials(username, password):
        return {"token": generate_token(username)}
    return {"error": "Invalid credentials"}
```
```