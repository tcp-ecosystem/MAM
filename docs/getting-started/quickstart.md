# Quickstart Guide

> **Build your first MAM module in 5 minutes.**

---

## What You'll Learn

By the end of this guide, you will:
- Create a MAM module from scratch
- Understand the module structure
- Validate and execute your module
- Export to different formats

---

## Step 1: Initialize a Module

```bash
mam init
```

This creates a basic module structure:

```
hello.mam.md
```

---

## Step 2: Understanding the Structure

Open `hello.mam.md`:

```markdown
---
id: hello
version: 2.0.0
name: Hello Module
author: Your Name
runtime: python
---

## Purpose

A simple hello world module that demonstrates MAM basics.

## Python

```python
def greet(name: str) -> str:
    return f"Hello, {name}! Welcome to MAM."
```

## Examples

```python
# Basic greeting
result = greet("World")
print(result)  # Hello, World! Welcome to MAM.
```
```

### File Anatomy

| Part | Description |
|------|-------------|
| `---` | Front matter delimiters |
| `id` | Unique module identifier |
| `version` | Semantic version |
| `runtime` | Target execution language |
| `## Purpose` | Required section — module objective |
| `## Python` | Code section — executable code |
| `## Examples` | Usage examples |

---

## Step 3: Validate Your Module

```bash
mam validate hello.mam.md
```

Output:

```
✓ Validation passed
  - Front matter: valid
  - Sections: 3 found
  - Code blocks: 2
  - Warnings: 0
```

---

## Step 4: View the AST

```bash
mam ast hello.mam.md --pretty
```

This displays the parsed Abstract Syntax Tree:

```json
{
  "type": "MAMModule",
  "frontmatter": {
    "type": "FrontMatter",
    "data": {
      "id": "hello",
      "version": "1.0.0",
      "name": "Hello Module",
      "runtime": "python"
    }
  },
  "sections": [
    {
      "type": "Section",
      "name": "Purpose",
      "content": [...]
    },
    {
      "type": "Section",
      "name": "Python",
      "content": [...]
    }
  ]
}
```

---

## Step 5: Execute the Module

```bash
mam execute hello.mam.md
```

Output:

```
✓ Module executed successfully
  - Section: Python
  - Result: "Hello, World! Welcome to MAM."
```

---

## Step 6: Export to Different Formats

### Export to JSON

```bash
mam export hello.mam.md --format json
```

### Export to HTML

```bash
mam export hello.mam.md --format html
```

### Export to Markdown

```bash
mam export hello.mam.md --format markdown
```

---

## Step 7: Add More Sections

Enhance your module with additional sections:

```markdown
---
id: hello
version: 2.0.0
name: Hello Module
author: Your Name
runtime: python
tags:
  - example
  - greeting
dependencies: []
permissions: []
---

## Purpose

A greeting module that demonstrates MAM fundamentals.

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| name | string | Yes | Person to greet |
| language | string | No | Language code (en, es, fr) |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| greeting | string | Formatted greeting message |
| success | boolean | Whether greeting succeeded |

## Rules

- Always return a string greeting
- Never expose internal errors
- Support at least 3 languages

## Python

```python
def greet(name: str, language: str = "en") -> dict:
    greetings = {
        "en": f"Hello, {name}!",
        "es": f"Hola, {name}!",
        "fr": f"Bonjour, {name}!",
    }
    return {
        "greeting": greetings.get(language, greetings["en"]),
        "success": True,
    }
```

## Examples

```python
# English greeting
result = greet("World")
print(result["greeting"])  # Hello, World!

# Spanish greeting
result = greet("Mundo", "es")
print(result["greeting"])  # Hola, Mundo!
```

## Tests

```python
assert greet("World")["success"] == True
assert greet("World")["greeting"] == "Hello, World!"
assert greet("Mundo", "es")["greeting"] == "Hola, Mundo!"
```
```

---

## Step 8: Run Tests

```bash
mam test hello.mam.md
```

Output:

```
✓ All tests passed (3/3)
```

---

## Step 9: Build the Module

```bash
mam build hello.mam.md
```

Output:

```
✓ Module built successfully
  - Output: dist/hello/
  - Files: 3
  - Size: 2.4 KB
```

---

## Step 10: Check Your Environment

```bash
mam doctor
```

This ensures everything is configured correctly.

---

## Next Steps

- [Concepts](./concepts.md) — Learn MAM core concepts
- [Writing Modules](../guides/writing-modules.md) — Comprehensive module guide
- [Examples](../examples/basic.md) — More example modules

---

## Quick Reference

| Command | Description |
|---------|-------------|
| `mam init` | Create new module |
| `mam validate <file>` | Validate module |
| `mam ast <file>` | View AST |
| `mam execute <file>` | Run module |
| `mam export <file>` | Export module |
| `mam test <file>` | Run tests |
| `mam build <file>` | Build module |
| `mam doctor` | Health check |

---

**Last Updated:** 2026-07-24
**MAM Version:** 1.0.0
