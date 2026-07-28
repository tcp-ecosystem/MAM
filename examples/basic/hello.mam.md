---
id: hello-world
version: 1.0.0
name: Hello World
author: MAM Team
runtime: python
tags:
  - example
  - beginner
  - hello-world
description: Minimal MAM module demonstrating core concepts
---

# Hello World Module

## Purpose

A minimal MAM module that introduces the core concepts: frontmatter metadata, purpose-driven design, behavioral rules, and executable Python code.

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| name | string | No | Name to greet (defaults to "World") |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| greeting | string | The generated greeting message |
| timestamp | string | ISO-8601 timestamp of execution |

## Rules

- Always return a greeting message
- Include a timestamp with every response
- Never expose internal errors to the caller

## Python

```python
from datetime import datetime, timezone

def greet(name: str = "World") -> dict:
    """
    Generate a greeting with a timestamp.

    Args:
        name: The name to greet.

    Returns:
        dict with greeting and timestamp keys.
    """
    greeting = f"Hello, {name}! Welcome to MAM."
    timestamp = datetime.now(timezone.utc).isoformat()
    return {"greeting": greeting, "timestamp": timestamp}
```

## Examples

```python
result = greet()
print(result["greeting"])  # Hello, World! Welcome to MAM.

result = greet("Alice")
print(result["greeting"])  # Hello, Alice! Welcome to MAM.
```

## Tests

```python
def test_default_greeting():
    result = greet()
    assert result["greeting"] == "Hello, World! Welcome to MAM."
    assert "timestamp" in result

def test_custom_name():
    result = greet("MAM")
    assert result["greeting"] == "Hello, MAM! Welcome to MAM."
```

## Dependencies

- None (standard library only)
