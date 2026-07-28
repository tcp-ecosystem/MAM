# Code Blocks Guide

> **Advanced usage of executable code blocks in MAM.**

---

## Overview

Code blocks are fenced code sections that contain executable code. This guide covers advanced features and best practices.

---

## Basic Syntax

````markdown
```language
code here
```
````

---

## Supported Languages

| Language | Identifier | Version |
|----------|------------|---------|
| Python | `python`, `py` | 3.10+ |
| JavaScript | `javascript`, `js` | 20+ |
| TypeScript | `typescript`, `ts` | 5+ |
| Rust | `rust`, `rs` | 1.70+ |
| Go | `go`, `golang` | 1.21+ |
| Shell | `shell`, `bash`, `sh` | - |

---

## Metadata Comments

Control execution with metadata comments:

### Execution Control

```python
# @mam:exec
def process():
    pass
```

### Timeout

```python
# @mam:timeout=30s
def slow_operation():
    pass
```

Valid formats:
- `30s` — 30 seconds
- `5m` — 5 minutes
- `1h` — 1 hour

### Memory Limit

```python
# @mam:memory=256MB
def memory_intensive():
    pass
```

### Dependencies

```python
# @mam:requires=network,filesystem
def fetch_data():
    pass
```

### Environment Variables

```python
# @mam:env=API_KEY,LOG_LEVEL
import os
api_key = os.environ.get("API_KEY")
```

---

## Complete Metadata Example

```python
# @mam:exec
# @mam:timeout=60s
# @mam:memory=512MB
# @mam:requires=network,filesystem
# @mam:env=API_KEY,DEBUG,LOG_LEVEL

import os
import requests

def fetch_and_process(url: str) -> dict:
    """Fetch data from URL and process it."""
    api_key = os.environ.get("API_KEY")
    debug = os.environ.get("DEBUG", "false").lower() == "true"
    
    response = requests.get(
        url,
        headers={"Authorization": f"Bearer {api_key}"}
    )
    
    if debug:
        print(f"Response status: {response.status_code}")
    
    return response.json()
```

---

## Code Block Isolation

Each code block runs in its own context:

| Feature | Description |
|---------|-------------|
| Namespace | Variables don't leak between blocks |
| Memory | Each block has its own memory |
| Timeout | Each block has its own timeout |
| Permissions | Each block has its own permissions |

---

## Best Practices

### 1. Use Type Hints

```python
# Good
def process(data: List[str], config: Dict[str, Any]) -> Optional[str]:
    pass

# Bad
def process(data, config):
    pass
```

### 2. Add Docstrings

```python
def verify_token(token: str) -> Optional[dict]:
    """Verify a JWT token and return claims.
    
    Args:
        token: The JWT token to verify
        
    Returns:
        Decoded claims if valid, None otherwise
        
    Raises:
        ValueError: If token format is invalid
    """
    pass
```

### 3. Handle Errors

```python
def safe_process(data: str) -> dict:
    """Process data with error handling."""
    try:
        result = process(data)
        return {"success": True, "result": result}
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except Exception as e:
        return {"success": False, "error": "Internal error"}
```

### 4. Use Constants

```python
# Good
MAX_RETRIES = 3
TIMEOUT_SECONDS = 30

def fetch_with_retry(url: str) -> dict:
    for attempt in range(MAX_RETRIES):
        try:
            return requests.get(url, timeout=TIMEOUT_SECONDS).json()
        except requests.RequestException:
            if attempt == MAX_RETRIES - 1:
                raise
```

### 5. Keep Blocks Focused

```python
# Good - Single responsibility
def validate_input(data: str) -> bool:
    """Validate input data."""
    return len(data) > 0 and len(data) < 1000

# Bad - Too many responsibilities
def validate_and_process_and_store(data: str) -> dict:
    """Validate, process, and store data."""
    # 100 lines of code...
```

---

## Multi-Language Modules

Use multiple code blocks for different purposes:

```markdown
## Python

```python
def process(data: str) -> dict:
    """Main processing function."""
    return {"result": data.upper()}
```

## JavaScript

```javascript
function display(result) {
  console.log(JSON.stringify(result, null, 2));
}
```

## Shell

```bash
# Install dependencies
pip install requests
npm install
```
```

---

## Code Block Patterns

### Data Processing

```python
# @mam:exec
# @mam:timeout=120s
# @mam:memory=1GB

import pandas as pd
from typing import List, Dict

def process_dataset(file_path: str) -> Dict:
    """Process a dataset and return statistics."""
    df = pd.read_csv(file_path)
    
    return {
        "rows": len(df),
        "columns": list(df.columns),
        "stats": df.describe().to_dict()
    }
```

### API Integration

```python
# @mam:exec
# @mam:timeout=30s
# @mam:requires=network
# @mam:env=API_KEY

import requests
from typing import Optional

def fetch_user(user_id: str) -> Optional[dict]:
    """Fetch user from API."""
    api_key = os.environ.get("API_KEY")
    
    response = requests.get(
        f"https://api.example.com/users/{user_id}",
        headers={"Authorization": f"Bearer {api_key}"}
    )
    
    if response.status_code == 200:
        return response.json()
    return None
```

### File Operations

```python
# @mam:exec
# @mam:requires=filesystem

import json
from pathlib import Path

def load_config(config_path: str) -> dict:
    """Load configuration from file."""
    path = Path(config_path)
    
    if not path.exists():
        return {}
    
    with open(path) as f:
        return json.load(f)
```

---

## Error Handling

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| SyntaxError | Invalid Python syntax | Check indentation, syntax |
| NameError | Undefined variable | Define variable before use |
| ImportError | Missing module | Add to dependencies |
| TimeoutError | Operation too slow | Increase timeout |
| MemoryError | Out of memory | Increase memory limit |

### Error Recovery

```python
def resilient_operation(data: str) -> dict:
    """Operation with graceful error handling."""
    try:
        result = risky_operation(data)
        return {"success": True, "result": result}
    except TimeoutError:
        return {"success": False, "error": "Operation timed out"}
    except MemoryError:
        return {"success": False, "error": "Out of memory"}
    except Exception as e:
        return {"success": False, "error": f"Unexpected: {e}"}
```

---

## Performance Tips

1. **Use appropriate timeout** — Don't set too high or too low
2. **Limit memory usage** — Only allocate what you need
3. **Cache expensive operations** — Use memoization when possible
4. **Process in batches** — Don't load everything at once
5. **Use efficient data structures** — Lists vs sets based on use case

---

## References

- [Specification](../specification/codeblocks.md)
- [Writing Modules](./writing-modules.md)
- [Testing Guide](./testing.md)

---

**Last Updated:** 2026-07-24
**MAM Version:** 1.0.0
