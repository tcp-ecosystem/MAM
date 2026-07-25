# Examples Section

## Description
The Examples section provides usage demonstrations.

## Syntax
```markdown
## Examples

```python
result = module.process("input")
print(result)
```
```

## Rules
- Include runnable code examples
- Show both input and expected output

## Example
```markdown
## Examples

```python
# Initialize
auth = Authenticator("secret-key")

# Generate token
tokens = auth.generate_token("user123")
print(tokens)

# Validate
claims = auth.validate_token(tokens["access_token"])
print(claims)
```
```