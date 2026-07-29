---
title: Custom Section Plugin
description: Example of defining a custom section type via the MAM Plugin API
version: 1.0.0
author: MAM Examples
license: MIT
tags: [plugin, section, custom, example]
---

# Custom Section Plugin

Demonstrates how to create a custom section type using the MAM Plugin API.
This plugin registers a `diagram` section that accepts Mermaid diagram syntax
and validates it before rendering.

## Overview

The MAM Plugin API allows you to extend the module format with new section types.
Each section definition declares its content types, validation logic, and rendering
behavior. This example shows the full lifecycle: registration, validation, parsing,
and rendering.

## Plugin Manifest (`plugin.json`)

```json
{
  "name": "custom-diagram-section",
  "version": "1.0.0",
  "description": "Adds a custom diagram section type for Mermaid diagrams",
  "author": "MAM Examples",
  "license": "MIT",
  "mamVersion": ">=0.1.0",
  "keywords": ["section", "diagram", "mermaid"],
  "categories": ["renderer"],
  "main": "dist/index.js",
  "engines": { "mam": ">=0.1.0" }
}
```

## TypeScript Plugin Code

```typescript
import {
  MAMPlugin,
  SectionDefinition,
  SectionExample,
  ValidationResult,
  PluginManifest,
} from "@mam/plugin-api";
import { ContentNode } from "@mam/ast";

/**
 * Custom diagram section plugin.
 *
 * Registers a "diagram" section type that accepts Mermaid syntax,
 * validates diagram structure, and renders to SVG via the Mermaid API.
 */
const diagramSectionPlugin: MAMPlugin = {
  manifest: {
    name: "custom-diagram-section",
    version: "1.0.0",
    description: "Adds a custom diagram section type for Mermaid diagrams",
    author: "MAM Examples",
    license: "MIT",
    mamVersion: ">=0.1.0",
    keywords: ["section", "diagram", "mermaid"],
    categories: ["renderer"],
    main: "dist/index.js",
  },

  // ─── Section Definitions ─────────────────────────────────────────
  sections: [
    {
      name: "diagram",
      description: "Mermaid diagram section — renders flowcharts, sequence diagrams, and more",
      required: false,
      contentTypes: ["code"],
      aliases: ["mermaid", "chart", "flowchart"],

      // ─── Validator ─────────────────────────────────────────────
      validator: (content: ContentNode[]): ValidationResult[] => {
        const results: ValidationResult[] = [];

        if (content.length === 0) {
          results.push({
            valid: false,
            message: "Diagram section must contain at least one code block",
            severity: "error",
            rule: "diagram/no-empty",
          });
          return results;
        }

        const codeBlocks = content.filter((n) => n.type === "code");
        if (codeBlocks.length === 0) {
          results.push({
            valid: false,
            message: "Diagram section must contain code blocks with diagram syntax",
            severity: "error",
            rule: "diagram/code-required",
          });
        }

        for (const block of codeBlocks) {
          if (block.type === "code" && "language" in block) {
            const lang = (block as any).language;
            if (lang && lang !== "mermaid") {
              results.push({
                valid: false,
                message: `Expected Mermaid syntax but got "${lang}"`,
                severity: "warning",
                rule: "diagram/language-check",
              });
            }
          }

          const text = extractText(block);
          if (text.trim().length === 0) {
            results.push({
              valid: false,
              message: "Diagram code block is empty",
              severity: "error",
              rule: "diagram/empty-block",
            });
          }

          const diagramType = detectDiagramType(text);
          if (diagramType) {
            results.push({
              valid: true,
              message: `Detected diagram type: ${diagramType}`,
              severity: "info",
              rule: "diagram/type-detection",
            });
          }
        }

        return results;
      },

      // ─── Renderer ──────────────────────────────────────────────
      renderer: (content: ContentNode[]): string => {
        const codeBlocks = content.filter((n) => n.type === "code");
        if (codeBlocks.length === 0) return "";

        const parts: string[] = ['<div class="mam-diagram">'];
        for (const block of codeBlocks) {
          const text = extractText(block);
          parts.push(`<pre class="mermaid">${escapeHtml(text)}</pre>`);
        }
        parts.push("</div>");
        return parts.join("\n");
      },

      // ─── Parser ────────────────────────────────────────────────
      parser: (raw: string): ContentNode[] => {
        const trimmed = raw.trim();
        if (!trimmed) return [];
        return [
          {
            type: "code",
            language: "mermaid",
            value: trimmed,
            children: [],
          } as ContentNode,
        ];
      },

      // ─── Examples ──────────────────────────────────────────────
      examples: [
        {
          title: "Simple Flowchart",
          input: "flowchart TD\n    A[Start] --> B{Decision}\n    B -->|Yes| C[OK]\n    B -->|No| D[Cancel]",
          description: "A basic top-down flowchart with a decision node",
        },
        {
          title: "Sequence Diagram",
          input: "sequenceDiagram\n    Alice->>Bob: Hello\n    Bob-->>Alice: Hi\n    Alice->>Bob: How are you?\n    Bob-->>Alice: Great!",
          description: "A two-party sequence diagram",
        },
      ],
    } as SectionDefinition,
  ],

  // ─── Lifecycle Hooks ────────────────────────────────────────────
  hooks: {
    beforeParse: (input: string) => {
      // Normalize diagram syntax: convert ```mermaid blocks to section format
      return input.replace(
        /```mermaid\n([\s\S]*?)```/g,
        (_match, diagram: string) => `\n:::diagram\n${diagram}\n:::\n`
      );
    },

    afterParse: (module) => {
      // Annotate diagram sections with metadata
      for (const section of module.sections || []) {
        if (section.type === "diagram") {
          (section as any).metadata = {
            ...(section as any).metadata,
            parsedAt: new Date().toISOString(),
            plugin: "custom-diagram-section",
          };
        }
      }
      return module;
    },
  },
};

// ─── Utility Functions ────────────────────────────────────────────

function extractText(node: ContentNode): string {
  if ("value" in node && typeof (node as any).value === "string") {
    return (node as any).value;
  }
  if ("children" in node && Array.isArray((node as any).children)) {
    return (node as any).children.map(extractText).join("\n");
  }
  return "";
}

function detectDiagramType(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.startsWith("flowchart") || trimmed.startsWith("graph")) return "flowchart";
  if (trimmed.startsWith("sequenceDiagram")) return "sequence";
  if (trimmed.startsWith("classDiagram")) return "class";
  if (trimmed.startsWith("stateDiagram")) return "state";
  if (trimmed.startsWith("erDiagram")) return "er";
  if (trimmed.startsWith("pie")) return "pie";
  if (trimmed.startsWith("gantt")) return "gantt";
  return null;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export default diagramSectionPlugin;
```

## Python Section Handler

```python
"""
Custom diagram section handler for MAM modules.

Provides validation, parsing, and rendering for Mermaid diagram sections.
This handler can be used as a standalone Python utility or integrated
with the MAM CLI via a custom command.
"""

from __future__ import annotations

import re
import html
import json
from dataclasses import dataclass, field
from typing import Any
from enum import Enum


class DiagramType(Enum):
    """Supported Mermaid diagram types."""
    FLOWCHART = "flowchart"
    SEQUENCE = "sequence"
    CLASS = "class"
    STATE = "state"
    ER = "er"
    PIE = "pie"
    GANTT = "gantt"
    UNKNOWN = "unknown"


@dataclass
class ValidationResult:
    """Result of a validation check."""
    valid: bool
    message: str
    rule: str
    severity: str = "error"
    location: dict[str, int] | None = None


@dataclass
class DiagramSection:
    """Parsed diagram section from a MAM module."""
    raw_content: str
    diagram_type: DiagramType = DiagramType.UNKNOWN
    metadata: dict[str, Any] = field(default_factory=dict)
    errors: list[ValidationResult] = field(default_factory=list)

    @property
    def is_valid(self) -> bool:
        return all(e.valid or e.severity != "error" for e in self.errors)


DIAGRAM_TYPE_PATTERNS: list[tuple[str, DiagramType]] = [
    (r"^(?:flowchart|graph)\s+[A-Z]", DiagramType.FLOWCHART),
    (r"^sequenceDiagram", DiagramType.SEQUENCE),
    (r"^classDiagram", DiagramType.CLASS),
    (r"^stateDiagram", DiagramType.STATE),
    (r"^erDiagram", DiagramType.ER),
    (r"^pie", DiagramType.PIE),
    (r"^gantt", DiagramType.GANTT),
]

SECTION_PATTERN = re.compile(
    r":::diagram\s*\n(.*?)\n:::",
    re.DOTALL,
)


def detect_diagram_type(content: str) -> DiagramType:
    """Detect the Mermaid diagram type from raw content."""
    stripped = content.strip()
    for pattern, dtype in DIAGRAM_TYPE_PATTERNS:
        if re.match(pattern, stripped):
            return dtype
    return DiagramType.UNKNOWN


def validate_diagram_content(content: str) -> list[ValidationResult]:
    """Validate Mermaid diagram syntax."""
    results: list[ValidationResult] = []

    if not content.strip():
        results.append(ValidationResult(
            valid=False,
            message="Diagram content is empty",
            rule="diagram/empty",
            severity="error",
        ))
        return results

    dtype = detect_diagram_type(content)
    if dtype == DiagramType.UNKNOWN:
        results.append(ValidationResult(
            valid=False,
            message="Unrecognized diagram type",
            rule="diagram/unknown-type",
            severity="warning",
        ))

    node_count = content.count("-->") + content.count("-->>")
    if node_count == 0 and dtype == DiagramType.FLOWCHART:
        results.append(ValidationResult(
            valid=False,
            message="Flowchart has no connections",
            rule="diagram/no-connections",
            severity="warning",
        ))

    if len(content) > 10_000:
        results.append(ValidationResult(
            valid=False,
            message="Diagram content exceeds 10,000 characters",
            rule="diagram/too-long",
            severity="warning",
        ))

    results.append(ValidationResult(
        valid=True,
        message=f"Detected diagram type: {dtype.value}",
        rule="diagram/type-detection",
        severity="info",
    ))

    return results


def parse_section(raw: str) -> DiagramSection:
    """Parse a raw diagram section into a DiagramSection object."""
    content = raw.strip()
    dtype = detect_diagram_type(content)
    errors = validate_diagram_content(content)

    return DiagramSection(
        raw_content=content,
        diagram_type=dtype,
        metadata={"parsed_at": "", "format": "mermaid"},
        errors=errors,
    )


def render_section(section: DiagramSection) -> str:
    """Render a DiagramSection to HTML."""
    escaped = html.escape(section.raw_content)
    return (
        f'<div class="mam-diagram" data-type="{section.diagram_type.value}">'
        f'<pre class="mermaid">{escaped}</pre>'
        f"</div>"
    )


def extract_diagrams_from_module(module_content: str) -> list[DiagramSection]:
    """Extract all diagram sections from a MAM module string."""
    sections = []
    for match in SECTION_PATTERN.finditer(module_content):
        section = parse_section(match.group(1))
        sections.append(section)
    return sections


def export_diagrams_as_json(sections: list[DiagramSection]) -> str:
    """Export diagram sections as JSON for external tool consumption."""
    data = []
    for s in sections:
        data.append({
            "type": s.diagram_type.value,
            "content": s.raw_content,
            "valid": s.is_valid,
            "errors": [
                {"message": e.message, "rule": e.rule, "severity": e.severity}
                for e in s.errors
            ],
        })
    return json.dumps(data, indent=2)


# ─── Tests ──────────────────────────────────────────────────────────

def test_detect_diagram_type():
    assert detect_diagram_type("flowchart TD\n    A --> B") == DiagramType.FLOWCHART
    assert detect_diagram_type("sequenceDiagram\n    A->>B: msg") == DiagramType.SEQUENCE
    assert detect_diagram_type("classDiagram\n    A <|-- B") == DiagramType.CLASS
    assert detect_diagram_type("stateDiagram-v2\n    [*] --> A") == DiagramType.STATE
    assert detect_diagram_type("erDiagram\n    USER ||--o{ ORDER : places") == DiagramType.ER
    assert detect_diagram_type("pie title Fruits") == DiagramType.PIE
    assert detect_diagram_type("gantt\n    title X") == DiagramType.GANTT
    assert detect_diagram_type("random text") == DiagramType.UNKNOWN


def test_validate_empty_content():
    results = validate_diagram_content("")
    assert len(results) == 1
    assert not results[0].valid
    assert results[0].severity == "error"


def test_validate_valid_content():
    results = validate_diagram_content("flowchart TD\n    A --> B")
    errors = [r for r in results if r.severity == "error"]
    assert len(errors) == 0


def test_parse_section():
    section = parse_section("sequenceDiagram\n    A->>B: hello")
    assert section.diagram_type == DiagramType.SEQUENCE
    assert section.is_valid


def test_render_section():
    section = parse_section("flowchart TD\n    A --> B")
    rendered = render_section(section)
    assert "mam-diagram" in rendered
    assert "mermaid" in rendered
    assert "&amp;" not in rendered or "mermaid" in rendered


def test_extract_diagrams():
    module = """
Some text here.

:::diagram
flowchart TD
    A --> B
:::

More text.

:::diagram
sequenceDiagram
    A->>B: hi
:::
"""
    sections = extract_diagrams_from_module(module)
    assert len(sections) == 2
    assert sections[0].diagram_type == DiagramType.FLOWCHART
    assert sections[1].diagram_type == DiagramType.SEQUENCE


if __name__ == "__main__":
    test_detect_diagram_type()
    test_validate_empty_content()
    test_validate_valid_content()
    test_parse_section()
    test_render_section()
    test_extract_diagrams()
    print("All tests passed.")
```

## Usage

1. Place the plugin directory in `.mam/plugins/` or add to `node_modules`.
2. The plugin auto-registers the `diagram` section type on load.
3. Use the section in any `.mam.md` file:

```markdown
:::diagram
flowchart TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Proceed]
    B -->|No| D[Abort]
:::
```

## What This Demonstrates

| Concept | Where |
|---------|-------|
| Section registration | `sections` array with `name`, `contentTypes`, `aliases` |
| Content validation | `validator` function returning `ValidationResult[]` |
| HTML rendering | `renderer` function producing `<div>` with Mermaid markup |
| Raw parsing | `parser` function converting text to `ContentNode[]` |
| Lifecycle hooks | `beforeParse` normalizing syntax, `afterParse` adding metadata |
| Type examples | `SectionExample` objects for documentation |
