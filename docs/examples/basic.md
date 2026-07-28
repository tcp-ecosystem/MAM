# Basic Module Examples

> **Simple MAM module examples to get started.**

---

## Hello World

The simplest MAM module:

```markdown
---
id: hello
version: 1.0.0
name: Hello World
author: LifeJiggy
runtime: python
---

## Purpose

A simple hello world module.

## Python

```python
def greet(name: str) -> str:
    return f"Hello, {name}!"
```

## Examples

```python
print(greet("World"))  # Hello, World!
```
```

---

## Calculator

A basic calculator module:

```markdown
---
id: calculator
version: 1.0.0
name: Calculator
author: LifeJiggy
runtime: python
tags:
  - math
  - calculator
---

## Purpose

Basic arithmetic operations.

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| operation | string | Yes | Operation (add, subtract, multiply, divide) |
| a | number | Yes | First operand |
| b | number | Yes | Second operand |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| result | number | Calculation result |
| error | string | Error message if failed |

## Rules

- Division by zero must return error
- All operations must handle invalid inputs

## Python

```python
def calculate(operation: str, a: float, b: float) -> dict:
    operations = {
        "add": lambda x, y: x + y,
        "subtract": lambda x, y: x - y,
        "multiply": lambda x, y: x * y,
        "divide": lambda x, y: x / y if y != 0 else None,
    }
    
    if operation not in operations:
        return {"error": f"Unknown operation: {operation}"}
    
    if operation == "divide" and b == 0:
        return {"error": "Division by zero"}
    
    result = operations[operation](a, b)
    return {"result": result}
```

## Examples

```python
print(calculate("add", 2, 3))       # {'result': 5}
print(calculate("subtract", 10, 4)) # {'result': 6}
print(calculate("multiply", 3, 7))  # {'result': 21}
print(calculate("divide", 10, 2))   # {'result': 5.0}
print(calculate("divide", 1, 0))    # {'error': 'Division by zero'}
```

## Tests

```python
assert calculate("add", 2, 3)["result"] == 5
assert calculate("subtract", 10, 4)["result"] == 6
assert calculate("multiply", 3, 7)["result"] == 21
assert calculate("divide", 10, 2)["result"] == 5.0
assert "error" in calculate("divide", 1, 0)
```
```

---

## String Utils

String manipulation utilities:

```markdown
---
id: string-utils
version: 1.0.0
name: String Utilities
author: LifeJiggy
runtime: python
tags:
  - strings
  - utilities
---

## Purpose

Common string manipulation functions.

## Python

```python
def reverse(text: str) -> str:
    """Reverse a string."""
    return text[::-1]

def capitalize_words(text: str) -> str:
    """Capitalize first letter of each word."""
    return text.title()

def slugify(text: str) -> str:
    """Convert text to URL-friendly slug."""
    import re
    text = text.lower()
    text = re.sub(r'[^a-z0-9]+', '-', text)
    return text.strip('-')

def truncate(text: str, max_length: int, suffix: str = "...") -> str:
    """Truncate text with suffix."""
    if len(text) <= max_length:
        return text
    return text[:max_length - len(suffix)] + suffix
```

## Examples

```python
print(reverse("hello"))           # olleh
print(capitalize_words("hello world"))  # Hello World
print(slugify("Hello World!"))    # hello-world
print(truncate("Long text", 5))   # Lon...
```
```

---

## Date Formatter

Date formatting utilities:

```markdown
---
id: date-formatter
version: 1.0.0
name: Date Formatter
author: LifeJiggy
runtime: python
tags:
  - dates
  - formatting
---

## Purpose

Date formatting and parsing utilities.

## Python

```python
from datetime import datetime

def format_date(date: datetime, format: str = "%Y-%m-%d") -> str:
    """Format date to string."""
    return date.strftime(format)

def parse_date(date_str: str, format: str = "%Y-%m-%d") -> datetime:
    """Parse string to date."""
    return datetime.strptime(date_str, format)

def time_ago(date: datetime) -> str:
    """Get human-readable time ago."""
    now = datetime.now()
    diff = now - date
    
    if diff.days > 365:
        return f"{diff.days // 365} years ago"
    elif diff.days > 30:
        return f"{diff.days // 30} months ago"
    elif diff.days > 0:
        return f"{diff.days} days ago"
    elif diff.seconds > 3600:
        return f"{diff.seconds // 3600} hours ago"
    elif diff.seconds > 60:
        return f"{diff.seconds // 60} minutes ago"
    else:
        return "just now"
```

## Examples

```python
from datetime import datetime

now = datetime.now()
print(format_date(now))                    # 2026-01-15
print(format_date(now, "%d/%m/%Y"))        # 15/01/2026
print(parse_date("2026-01-15"))            # datetime(2026, 1, 15)
```
```

---

## JSON Utils

JSON manipulation utilities:

```markdown
---
id: json-utils
version: 1.0.0
name: JSON Utilities
author: LifeJiggy
runtime: python
tags:
  - json
  - utilities
---

## Purpose

JSON parsing and manipulation utilities.

## Python

```python
import json
from typing import Any

def safe_parse(json_str: str) -> dict:
    """Safely parse JSON string."""
    try:
        return json.loads(json_str)
    except json.JSONDecodeError as e:
        return {"error": str(e)}

def pretty_json(data: Any, indent: int = 2) -> str:
    """Pretty print JSON data."""
    return json.dumps(data, indent=indent, default=str)

def deep_merge(base: dict, override: dict) -> dict:
    """Deep merge two dictionaries."""
    result = base.copy()
    
    for key, value in override.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = deep_merge(result[key], value)
        else:
            result[key] = value
    
    return result
```

## Examples

```python
print(pretty_json({"name": "test", "value": 123}))
# {
#   "name": "test",
#   "value": 123
# }

base = {"a": 1, "b": {"c": 2}}
override = {"b": {"d": 3}, "e": 4}
print(deep_merge(base, override))
# {"a": 1, "b": {"c": 2, "d": 3}, "e": 4}
```
```

---

## Next Steps

- [Advanced Examples](./advanced.md) — Complex module examples
- [Agent Examples](./agent.md) — AI agent modules
- [Workflow Examples](./workflow.md) — Workflow modules

---

**Last Updated:** 2026-07-24
**MAM Version:** 1.0.0
