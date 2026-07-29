---
id: text-transform
version: 1.0.0
name: Text Transform
author: MAM Team
runtime: python
tags:
  - example
  - beginner
  - text
  - transformation
description: Transform text between different cases and formats with length tracking
---

# Text Transform Module

## Purpose

A text transformation utility that converts strings between different cases and formats (uppercase, lowercase, title case, snake_case, kebab-case) while preserving non-alphabetic characters and tracking length changes.

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| text | string | Yes | The text to transform |
| transform | string | Yes | The transformation to apply: "uppercase", "lowercase", "title", "snake", "kebab" |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| transformed_text | string | The transformed text |
| original_length | int | Length of the original text |
| new_length | int | Length of the transformed text |

## Rules

- Non-alphabetic characters (numbers, symbols, spaces) must be preserved
- Empty strings must return empty results without errors
- The original_length and new_length must accurately reflect character counts
- snake_case and kebab_case must handle multiple consecutive spaces gracefully
- Title case must capitalize the first letter of each word

## Python

```python
import re


def to_uppercase(text: str) -> str:
    """Convert text to uppercase."""
    return text.upper()


def to_lowercase(text: str) -> str:
    """Convert text to lowercase."""
    return text.lower()


def to_title_case(text: str) -> str:
    """Convert text to title case."""
    return text.title()


def to_snake_case(text: str) -> str:
    """Convert text to snake_case."""
    text = text.strip()
    text = re.sub(r'[\s\-]+', '_', text)
    text = re.sub(r'([a-z])([A-Z])', r'\1_\2', text)
    return text.lower()


def to_kebab_case(text: str) -> str:
    """Convert text to kebab-case."""
    text = text.strip()
    text = re.sub(r'[\s_]+', '-', text)
    text = re.sub(r'([a-z])([A-Z])', r'\1-\2', text)
    return text.lower()


def transform_text(text: str, transform: str) -> dict:
    """
    Apply a text transformation.

    Args:
        text: The input text to transform.
        transform: The transformation type.

    Returns:
        dict with transformed_text, original_length, and new_length.
    """
    transforms = {
        "uppercase": to_uppercase,
        "lowercase": to_lowercase,
        "title": to_title_case,
        "snake": to_snake_case,
        "kebab": to_kebab_case,
    }

    if transform not in transforms:
        return {
            "transformed_text": text,
            "original_length": len(text),
            "new_length": len(text),
        }

    result = transforms[transform](text)
    return {
        "transformed_text": result,
        "original_length": len(text),
        "new_length": len(result),
    }
```

## Examples

```python
result = transform_text("Hello World", "uppercase")
print(result["transformed_text"])  # HELLO WORLD

result = transform_text("Hello World", "snake")
print(result["transformed_text"])  # hello_world

result = transform_text("hello world", "kebab")
print(result["transformed_text"])  # hello-world

result = transform_text("helloWorld", "title")
print(result["transformed_text"])  # HelloWorld
```

## Tests

```python
def test_uppercase():
    result = transform_text("hello", "uppercase")
    assert result["transformed_text"] == "HELLO"
    assert result["original_length"] == 5
    assert result["new_length"] == 5


def test_lowercase():
    result = transform_text("HELLO", "lowercase")
    assert result["transformed_text"] == "hello"


def test_title_case():
    result = transform_text("hello world", "title")
    assert result["transformed_text"] == "Hello World"


def test_snake_case():
    result = transform_text("Hello World", "snake")
    assert result["transformed_text"] == "hello_world"

    result = transform_text("hello-world", "snake")
    assert result["transformed_text"] == "hello-world"


def test_kebab_case():
    result = transform_text("Hello World", "kebab")
    assert result["transformed_text"] == "hello-world"

    result = transform_text("hello_world", "kebab")
    assert result["transformed_text"] == "hello-world"


def test_preserve_numbers():
    result = transform_text("Hello123World", "uppercase")
    assert result["transformed_text"] == "HELLO123WORLD"


def test_empty_string():
    result = transform_text("", "uppercase")
    assert result["transformed_text"] == ""
    assert result["original_length"] == 0
    assert result["new_length"] == 0


def test_unknown_transform():
    result = transform_text("hello", "unknown")
    assert result["transformed_text"] == "hello"
    assert result["original_length"] == 5
    assert result["new_length"] == 5


def test_consecutive_spaces():
    result = transform_text("hello   world", "snake")
    assert result["transformed_text"] == "hello_world"


def test_mixed_case_snake():
    result = transform_text("helloWorldTest", "snake")
    assert result["transformed_text"] == "hello_world_test"
```
