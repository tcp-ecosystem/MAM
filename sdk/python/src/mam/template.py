"""
Starter Templates for Python.

Provides ready-to-use MAM module skeletons for common module kinds, along with
placeholder rendering and name validation. Templates are plain strings with
``{{placeholder}}`` markers so they can be embedded in CLIs and generators
without any additional machinery.

Example::

    from mam.template import new_module_starter

    print(new_module_starter("my-agent", "agent"))
"""

from __future__ import annotations

import re
from typing import Dict, List

__all__ = [
    "STARTER_KINDS",
    "STARTER_ALIASES",
    "list_starter_kinds",
    "get_starter_template",
    "render_starter",
    "starter_variables",
    "new_module_starter",
    "validate_starter_name",
    "MAX_NAME_LENGTH",
]

MAX_NAME_LENGTH = 64

PLACEHOLDER_PATTERN = re.compile(r"\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}")

NAME_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _.-]*$")

STARTER_ALIASES: Dict[str, str] = {
    "module": "module",
    "mod": "module",
    "package": "module",
    "lib": "module",
    "library": "module",
    "agent": "agent",
    "bot": "agent",
    "assistant": "agent",
    "plugin": "agent",
    "tool": "tool",
    "utility": "tool",
    "util": "tool",
    "cli": "tool",
    "script": "tool",
}

STARTER_KINDS: List[str] = ["module", "agent", "tool"]

STARTER_TEMPLATES: Dict[str, str] = {
    "module": """---
id: {{id}}
name: {{name}}
version: 0.1.0
author: {{author}}
runtime: {{runtime}}
description: {{description}}
tags:
  - utility
---

## Purpose

{{description}}

## Inputs

Describe the inputs this module consumes.

## Outputs

Describe the outputs this module produces.

## Rules

- State the invariants this module must uphold.

## Workflow

1. Receive inputs
2. Validate inputs
3. Produce outputs

## Python

```python
def process(payload: dict) -> dict:
    # Process the payload and return the result.
    return {{"payload": payload}}
```

## Tests

```python
def test_process():
    assert process({"a": 1}) == {"a": 1}
```

## Exports

- `process`
""",
    "agent": """---
id: {{id}}
name: {{name}}
version: 0.1.0
author: {{author}}
runtime: python
description: {{description}}
tags:
  - agent
permissions:
  - read
---

## Purpose

{{name}} is an agent that {{description}}

## Role

You are {{name}}. Your job is to {{description}}

## Inputs

- The user request
- Relevant context supplied by the caller

## Outputs

- A clear, actionable response
- Supporting reasoning when asked

## Rules

- Never invent facts about the environment
- State uncertainty explicitly
- Prefer concise, structured answers

## Workflow

1. Understand the request
2. Identify the missing information
3. Respond with a concrete plan or answer

## Prompt

You are {{name}}. Respond to the user's request using the rules above.

## Permissions

- read

## Capabilities

- reason
- summarize
""",
    "tool": """---
id: {{id}}
name: {{name}}
version: 0.1.0
author: {{author}}
runtime: {{runtime}}
description: {{description}}
tags:
  - tool
---

## Purpose

{{description}}

## Capabilities

- Command line entry point
- Structured JSON output

## Inputs

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| `input` | string | yes | The value to transform |
| `format` | string | no | Output format, `text` or `json` |

## Outputs

| Name | Type | Description |
| --- | --- | --- |
| `result` | string | The transformed value |

## Rules

- Validate `format` before processing
- Exit non-zero on invalid input

## Usage

```
{{id}} --input "value" --format json
```

## Python

```python
import argparse
import json


def main() -> int:
    parser = argparse.ArgumentParser(prog="{{id}}")
    parser.add_argument("--input", required=True)
    parser.add_argument("--format", default="text", choices=["text", "json"])
    args = parser.parse_args()
    payload = {{"input": args.input, "format": args.format}}
    if args.format == "json":
        print(json.dumps(payload, indent=2))
    else:
        print(payload["input"])
    return 0
```

## Exports

- `main`
""",
}


def list_starter_kinds() -> List[str]:
    """Return the canonical starter kinds."""

    return list(STARTER_KINDS)


def resolve_starter_kind(kind: str) -> str:
    """Return the canonical kind for an alias, or raise ``ValueError``.

    Raises:
        ValueError: When the kind or alias is not recognized.
    """

    if not kind or not isinstance(kind, str):
        raise ValueError("Starter kind must be a non-empty string")
    candidate = kind.strip().lower()
    resolved = STARTER_ALIASES.get(candidate)
    if resolved is None:
        known = ", ".join(sorted(set(STARTER_ALIASES)))
        raise ValueError(f"Unknown starter kind '{kind}'. Known kinds: {known}")
    return resolved


def get_starter_template(kind: str) -> str:
    """Return the template for a starter kind or alias.

    Raises:
        ValueError: When the kind is unknown.
    """

    return STARTER_TEMPLATES[resolve_starter_kind(kind)]


def starter_variables(template: str) -> List[str]:
    """Return the placeholder names in a template, in first-seen order."""

    if not template:
        return []
    found: List[str] = []
    for match in PLACEHOLDER_PATTERN.finditer(template):
        name = match.group(1)
        if name not in found:
            found.append(name)
    return found


def render_starter(template: str, variables: Dict[str, str]) -> str:
    """Substitute placeholders in a template.

    Placeholder names match case-insensitively. Any placeholder without a
    supplied value is left untouched so that incomplete output is obvious
    rather than silently blank.
    """

    if not template:
        return ""
    supplied = {str(key).lower(): str(value) for key, value in (variables or {}).items()}

    def replace(match: re.Match[str]) -> str:
        key = match.group(1).lower()
        if key in supplied:
            return supplied[key]
        return match.group(0)

    return PLACEHOLDER_PATTERN.sub(replace, template)


def slugify(name: str) -> str:
    """Return a lowercase, dash-separated identifier derived from a name."""

    if not name:
        return ""
    lowered = re.sub(r"[^A-Za-z0-9]+", "-", name.strip().lower())
    return re.sub(r"-{2,}", "-", lowered).strip("-")


def validate_starter_name(name: str) -> List[str]:
    """Validate a starter name and return a list of problems.

    An empty list means the name is acceptable.
    """

    problems: List[str] = []

    if not isinstance(name, str):
        return ["Starter name must be a string"]

    candidate = name.strip()
    if not candidate:
        problems.append("Starter name must not be empty")
        return problems

    if len(candidate) > MAX_NAME_LENGTH:
        problems.append(
            f"Starter name must be at most {MAX_NAME_LENGTH} characters, "
            f"got {len(candidate)}"
        )

    if not NAME_PATTERN.match(candidate):
        problems.append(
            "Starter name may only contain letters, digits, spaces, dots, "
            "dashes, and underscores, and must start with a letter or digit"
        )

    if not slugify(candidate):
        problems.append("Starter name must contain at least one alphanumeric character")

    return problems


def default_variables(name: str, runtime: str = "python") -> Dict[str, str]:
    """Return the default variable mapping used by :func:`new_module_starter`."""

    return {
        "id": slugify(name),
        "name": name.strip(),
        "version": "0.1.0",
        "author": "unknown",
        "runtime": runtime,
        "description": f"Describe what {name.strip()} does.",
    }


def new_module_starter(
    name: str, kind: str = "module", runtime: str = "python"
) -> str:
    """Render a complete starter module.

    Args:
        name: The human-readable module name.
        kind: Starter kind or alias, for example ``module``, ``agent``, ``tool``.
        runtime: Runtime language recorded in the front matter.

    Returns:
        The rendered MAM document.

    Raises:
        ValueError: When the name is invalid or the kind is unknown.
    """

    problems = validate_starter_name(name)
    if problems:
        raise ValueError("Invalid starter name: " + "; ".join(problems))

    template = get_starter_template(kind)
    variables = default_variables(name, runtime=runtime)
    variables["runtime"] = runtime
    return render_starter(template, variables)
