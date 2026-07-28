# Code Blocks Specification

> **Executable code embedded in MAM modules.**

---

## Overview

Code blocks are fenced code sections within MAM modules that contain executable code. They use standard Markdown fenced code block syntax with language identifiers.

---

## Syntax

````markdown
```language
code here
```
````

### Fencing

- Opening: ` ``` ` (three backticks) or `~~~` (three tildes)
- Closing: ` ``` ` or `~~~` (must match opening)

### Language Identifier

The language identifier specifies the runtime:

```markdown
```python
code here
```

```javascript
code here
```
````

---

## Supported Languages

| Identifier | Aliases | Runtime | Version |
|------------|---------|---------|---------|
| `python` | `py` | Python | 3.10+ |
| `javascript` | `js` | Node.js | 20+ |
| `typescript` | `ts` | TypeScript | 5+ |
| `rust` | `rs` | Rust | 1.70+ |
| `go` | `golang` | Go | 1.21+ |
| `shell` | `bash`, `sh` | Shell | - |
| `yaml` | `yml` | Configuration | - |
| `json` | - | Data | - |
| `mermaid` | - | Diagrams | - |

---

## Code Block Metadata

Code blocks can include metadata comments that control execution:

### Execution Control

```python
# @mam:exec
```

Marks the code block for execution.

### Timeout

```python
# @mam:timeout=30s
```

Sets the maximum execution time.

Valid formats:
- `30s` — 30 seconds
- `5m` — 5 minutes
- `1h` — 1 hour

### Memory Limit

```python
# @mam:memory=256MB
```

Sets the maximum memory usage.

Valid formats:
- `128MB` — 128 megabytes
- `1GB` — 1 gigabyte

### Dependencies

```python
# @mam:requires=network
```

Declares required capabilities.

Valid values:
- `network` — Network access
- `filesystem` — File system access
- `gpu` — GPU access

### Environment Variables

```python
# @mam:env=API_KEY,LOG_LEVEL
```

Lists required environment variables.

---

## Complete Metadata Example

```python
# @mam:exec
# @mam:timeout=60s
# @mam:memory=512MB
# @mam:requires=network,filesystem
# @mam:env=API_KEY,DEBUG

import os
import requests

def fetch_data(url: str) -> dict:
    api_key = os.environ.get("API_KEY")
    response = requests.get(url, headers={"Authorization": f"Bearer {api_key}"})
    return response.json()
```

---

## Code Block Isolation

Each code block runs in its own execution context:

| Feature | Description |
|---------|-------------|
| Separate namespace | Variables don't leak between blocks |
| Separate memory | Each block has its own memory |
| Separate timeout | Each block has its own timeout |
| Separate permissions | Each block has its own permissions |

---

## Content Types

### Python Code

```markdown
## Python

```python
from typing import List, Optional

def process_items(items: List[str]) -> Optional[str]:
    """Process a list of items."""
    if not items:
        return None
    return ", ".join(items)
```
```

### JavaScript Code

```markdown
## JavaScript

```javascript
function processItems(items) {
  if (!items || items.length === 0) {
    return null;
  }
  return items.join(", ");
}
```
```

### Rust Code

```markdown
## Rust

```rust
fn process_items(items: Vec<String>) -> Option<String> {
    if items.is_empty() {
        return None;
    }
    Some(items.join(", "))
}
```
```

### Go Code

```markdown
## Go

```go
func processItems(items []string) string {
    if len(items) == 0 {
        return ""
    }
    return strings.Join(items, ", ")
}
```
```

---

## Code Block Parsing

The parser extracts code blocks with the following structure:

```typescript
interface CodeBlock {
  type: 'CodeBlock';
  language: string;
  value: string;
  metadata: CodeBlockMetadata;
  location: SourceLocation;
}

interface CodeBlockMetadata {
  exec: boolean;
  timeout?: string;
  memory?: string;
  requires?: string[];
  env?: string[];
}
```

---

## Validation Rules

### Required Rules

1. Code blocks MUST have a language identifier
2. Language MUST be from the supported list
3. Metadata comments MUST follow the `@mam:key=value` format

### Format Rules

1. Fencing MUST be three backticks or tildes
2. Closing fence MUST match opening fence
3. Metadata comments MUST be at the start of the code block

### Semantic Rules

1. Code SHOULD be syntactically valid
2. Metadata SHOULD match actual usage
3. Dependencies SHOULD be available

---

## Error Handling

### Missing Language Identifier

```
Error: Code block missing language identifier
  at line 15
  Expected: ```<language>
```

### Invalid Language

```
Error: Unsupported language "perl"
  at line 15
  Supported: python, javascript, typescript, rust, go, shell
```

### Invalid Metadata

```
Error: Invalid metadata format
  at line 16
  Expected: # @mam:key=value
```

---

## Security Considerations

### Sandboxing

All code execution happens in sandboxes:
- Process isolation
- Memory limits
- CPU time limits
- Network restrictions
- Filesystem restrictions

### Permission Model

Code blocks declare their permissions:

```python
# @mam:requires=network
# Network access is granted only if declared
```

---

## References

- [Specification Overview](./overview.md)
- [Section Types](./sections.md)
- [Examples](./examples.md)

---

**Last Updated:** 2026-07-24
**MAM Version:** 1.0.0
