# Testing Guide

> **Writing and running tests for MAM modules.**

---

## Overview

MAM modules can include tests that validate their behavior. This guide covers test writing, execution, and best practices.

---

## Test Section

Define tests in the Tests section:

```markdown
## Tests

```python
# Basic test
assert greet("World") == "Hello, World!"

# Edge cases
assert greet("") == "Hello, !"
assert greet("123") == "Hello, 123!"
```
```

---

## Running Tests

### Using CLI

```bash
mam test my-module.mam.md
```

### Output

```
✓ All tests passed (3/3)
```

or

```
✗ 1 test failed

  AssertionError: Expected "Hello, World!" but got "Hello, world!"
  at line 5
```

---

## Test Patterns

### Basic Assertions

```python
# Equality
assert result == expected

# Not equal
assert result != unexpected

# True/False
assert condition is True
assert condition is False

# None
assert result is None
assert result is not None

# In collection
assert item in collection
assert item not in collection
```

### Exception Testing

```python
# Expect exception
try:
    risky_operation()
    assert False, "Expected exception"
except ValueError as e:
    assert "invalid" in str(e)
```

### Data Validation

```python
# Validate structure
assert isinstance(result, dict)
assert "key" in result
assert len(result["items"]) > 0

# Validate types
assert isinstance(result["count"], int)
assert isinstance(result["name"], str)
```

---

## Test Examples

### Function Tests

```markdown
## Tests

```python
# Test greet function
assert greet("World") == "Hello, World!"
assert greet("Alice") == "Hello, Alice!"
assert greet("") == "Hello, !"

# Test with different languages
assert greet("World", "es") == "Hola, World!"
assert greet("World", "fr") == "Bonjour, World!"
```
```

### API Tests

```markdown
## Tests

```python
# Test API call
response = fetch_user("123")
assert response is not None
assert response["id"] == "123"
assert "name" in response

# Test error handling
response = fetch_user("invalid")
assert response is None
```
```

### Integration Tests

```markdown
## Tests

```python
# Test complete workflow
input_data = {"user": "test", "action": "create"}
result = workflow(input_data)

assert result["success"] is True
assert result["id"] is not None
assert result["created_at"] is not None
```
```

---

## Test Helpers

### Setup and Teardown

```python
# Setup test data
test_data = {
    "users": [
        {"id": "1", "name": "Alice"},
        {"id": "2", "name": "Bob"}
    ]
}

# Run test
result = process_users(test_data["users"])

# Assert
assert len(result) == 2
assert result[0]["processed"] is True
```

### Mocking

```python
# Simple mock
class MockAPI:
    def __init__(self):
        self.calls = []
    
    def get(self, url):
        self.calls.append(url)
        return {"data": "mocked"}

# Test with mock
api = MockAPI()
result = fetch_data(api)
assert len(api.calls) == 1
assert result == {"data": "mocked"}
```

---

## Test Coverage

### What to Test

1. **Happy path** — Normal expected behavior
2. **Edge cases** — Empty inputs, max values
3. **Error cases** — Invalid inputs, failures
4. **Integration** — Complete workflows

### Test Matrix

| Input Type | Valid | Invalid | Edge |
|------------|-------|---------|------|
| String | ✓ | ✓ | ✓ |
| Number | ✓ | ✓ | ✓ |
| Array | ✓ | ✓ | ✓ |
| Object | ✓ | ✓ | ✓ |

---

## Best Practices

### 1. Keep Tests Simple

```python
# Good - clear and simple
assert greet("World") == "Hello, World!"

# Bad - too complex
assert greet("World") == f"Hello, {'World'}" and len("Hello, World!") > 0
```

### 2. Test One Thing

```python
# Good - tests one behavior
assert greet("World") == "Hello, World!"

# Bad - tests multiple behaviors
result = greet("World")
assert result == "Hello, World!" and len(result) > 0 and "Hello" in result
```

### 3. Use Descriptive Names

```python
# Good - describes what is tested
assert greet("") == "Hello, !"  # Empty string handling

# Bad - unclear
assert greet("") == "Hello, !"
```

### 4. Test Edge Cases

```python
# Test boundary conditions
assert process([]) == []  # Empty list
assert process([1]) == [1]  # Single item
assert process([1, 2, 3]) == [1, 2, 3]  # Multiple items
```

### 5. Keep Tests Independent

```python
# Good - independent tests
assert greet("Alice") == "Hello, Alice!"
assert greet("Bob") == "Hello, Bob!"

# Bad - dependent tests (order matters)
result1 = greet("Alice")
assert result1 == "Hello, Alice!"
result2 = greet(result1)  # Depends on previous test
```

---

## Test Output

### Success

```
✓ All tests passed (5/5)
```

### Failure

```
✗ 1 test failed

  AssertionError: Expected "Hello, World!" but got "Hello, world!"
  at line 12 in Tests section
```

### Error

```
✗ Test error

  NameError: name 'greet' is not defined
  at line 8 in Tests section
```

---

## References

- [Writing Modules](./writing-modules.md)
- [Specification](../specification/sections.md)

---

**Last Updated:** 2026-07-24
**MAM Version:** 1.0.0
