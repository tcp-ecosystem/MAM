---
id: string-utils
version: 1.0.0
name: String Utilities
author: MAM Team
runtime: python
tags:
  - example
  - beginner
  - string
  - utilities
description: Common string manipulation utilities with Unicode support and error handling
---

# String Utilities Module

## Purpose

A collection of common string manipulation utilities including reversal, word counting, palindrome detection, truncation, and email extraction. Handles empty strings gracefully and supports Unicode characters.

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| text | string | Yes | The input text to process |
| operation | string | Yes | The operation to perform: "reverse", "count_words", "is_palindrome", "truncate", "extract_emails" |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| result | string/number/list | The result of the operation (type varies by operation) |

## Rules

- Empty strings must return appropriate empty results, not errors
- Truncation must add "..." when text exceeds max length
- Email extraction must use pattern matching, not external libraries
- Palindrome detection must be case-insensitive and ignore non-alphanumeric characters
- Word counting must handle multiple spaces and leading/trailing whitespace
- Unicode characters must be handled correctly throughout

## Python

```python
import re


def reverse(text: str) -> str:
    """Reverse a string."""
    return text[::-1]


def count_words(text: str) -> int:
    """Count the number of words in a string."""
    text = text.strip()
    if not text:
        return 0
    return len(text.split())


def is_palindrome(text: str) -> bool:
    """Check if text is a palindrome (case-insensitive, alphanumeric only)."""
    cleaned = re.sub(r'[^a-zA-Z0-9]', '', text).lower()
    return cleaned == cleaned[::-1] and len(cleaned) > 0


def truncate(text: str, max_length: int = 100) -> str:
    """Truncate text to max_length, adding '...' if truncated."""
    if len(text) <= max_length:
        return text
    return text[:max_length - 3] + "..."


def extract_emails(text: str) -> list:
    """Extract all email addresses from text using pattern matching."""
    pattern = r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'
    return re.findall(pattern, text)


def perform_operation(text: str, operation: str, **kwargs) -> dict:
    """
    Perform a string operation.

    Args:
        text: The input text.
        operation: The operation to perform.
        **kwargs: Additional arguments (e.g., max_length for truncate).

    Returns:
        dict with result key containing the operation output.
    """
    operations = {
        "reverse": lambda t: reverse(t),
        "count_words": lambda t: count_words(t),
        "is_palindrome": lambda t: is_palindrome(t),
        "truncate": lambda t: truncate(t, kwargs.get("max_length", 100)),
        "extract_emails": lambda t: extract_emails(t),
    }

    if operation not in operations:
        return {"result": None, "error": f"Unknown operation: {operation}"}

    result = operations[operation](text)
    return {"result": result}
```

## Examples

```python
result = perform_operation("Hello, World!", "reverse")
print(result["result"])  # !dlroW ,olleH

result = perform_operation("  Hello   World  ", "count_words")
print(result["result"])  # 2

result = perform_operation("A man a plan a canal Panama", "is_palindrome")
print(result["result"])  # True

result = perform_operation("This is a long text", "truncate", max_length=10)
print(result["result"])  # This is a...

result = perform_operation("Contact us at info@example.com or support@test.org", "extract_emails")
print(result["result"])  # ['info@example.com', 'support@test.org']
```

## Tests

```python
def test_reverse():
    result = perform_operation("hello", "reverse")
    assert result["result"] == "olleh"


def test_reverse_empty():
    result = perform_operation("", "reverse")
    assert result["result"] == ""


def test_count_words():
    result = perform_operation("hello world", "count_words")
    assert result["result"] == 2


def test_count_words_empty():
    result = perform_operation("", "count_words")
    assert result["result"] == 0


def test_count_words_whitespace():
    result = perform_operation("  hello   world  ", "count_words")
    assert result["result"] == 2


def test_is_palindrome():
    result = perform_operation("racecar", "is_palindrome")
    assert result["result"] is True


def test_is_palindrome_case_insensitive():
    result = perform_operation("RaceCar", "is_palindrome")
    assert result["result"] is True


def test_is_palindrome_with_punctuation():
    result = perform_operation("A man, a plan, a canal: Panama", "is_palindrome")
    assert result["result"] is True


def test_is_not_palindrome():
    result = perform_operation("hello", "is_palindrome")
    assert result["result"] is False


def test_truncate_short():
    result = perform_operation("short", "truncate", max_length=10)
    assert result["result"] == "short"


def test_truncate_long():
    result = perform_operation("this is a long text", "truncate", max_length=10)
    assert result["result"] == "this is a..."
    assert len(result["result"]) == 10


def test_extract_emails():
    text = "Contact alice@example.com or bob@test.org"
    result = perform_operation(text, "extract_emails")
    assert result["result"] == ["alice@example.com", "bob@test.org"]


def test_extract_emails_none():
    result = perform_operation("no emails here", "extract_emails")
    assert result["result"] == []


def test_unknown_operation():
    result = perform_operation("hello", "unknown_op")
    assert result["result"] is None
    assert "error" in result


def test_unicode_support():
    result = perform_operation("héllo wörld", "reverse")
    assert result["result"] == "dlröw olleh"

    result = perform_operation("日本語テスト", "reverse")
    assert result["result"] == "トステツ語本日"
```
