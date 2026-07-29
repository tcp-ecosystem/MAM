---
title: Validation Plugin
description: Custom validation rules plugin for MAM modules
version: 1.0.0
author: MAM Examples
license: MIT
tags: [plugin, validation, rules, example]
---

# Validation Plugin

Demonstrates how to register custom validation rules with the MAM Plugin API.
This plugin enforces business rules, security policies, and structural conventions
on MAM modules before they are executed or exported.

## Overview

Validation plugins intercept the `beforeValidation` and `afterValidation` hooks to
inspect and enforce rules on module ASTs. Each rule returns `ValidationResult[]` with
severity levels. Rules can be auto-fixable or advisory-only.

## Plugin Manifest (`plugin.json`)

```json
{
  "name": "custom-validation-rules",
  "version": "1.0.0",
  "description": "Custom validation rules for MAM modules",
  "author": "MAM Examples",
  "license": "MIT",
  "mamVersion": ">=0.1.0",
  "keywords": ["validation", "rules", "security"],
  "categories": ["validator"],
  "main": "dist/index.js",
  "engines": { "mam": ">=0.1.0" }
}
```

## TypeScript Plugin Code

```typescript
import {
  MAMPlugin,
  ValidationRule,
  ValidationResult,
  PluginManifest,
} from "@mam/plugin-api";
import { MAMModule, Section, ContentNode, CodeBlock } from "@mam/ast";

// ─── Rule: Require Description Section ────────────────────────────

const requireDescriptionRule: ValidationRule = {
  name: "require-description",
  description: "Every module must have a description section",
  severity: "error",
  category: "structure",
  tags: ["required", "documentation"],
  fixable: true,

  check(ast: MAMModule): ValidationResult[] {
    const hasDescription = ast.sections?.some(
      (s: Section) => s.type === "description" || s.type === "purpose"
    );

    if (!hasDescription) {
      return [
        {
          valid: false,
          message: "Module is missing a description or purpose section",
          rule: "require-description",
          severity: "error",
          fix: {
            description: "Add a description section at the beginning of the module",
            autoFixable: false,
            replacements: [
              {
                range: { start: 0, end: 0 },
                replacement: "# Description\n\n<!-- Add module description here -->\n\n",
                description: "Prepend description section",
              },
            ],
          },
        },
      ];
    }
    return [{ valid: true, message: "Description section present", rule: "require-description" }];
  },
};

// ─── Rule: No Hardcoded Secrets ───────────────────────────────────

const noHardcodedSecretsRule: ValidationRule = {
  name: "no-hardcoded-secrets",
  description: "Detect hardcoded secrets, API keys, and tokens in code blocks",
  severity: "error",
  category: "security",
  tags: ["security", "secrets", "critical"],
  fixable: false,

  check(ast: MAMModule): ValidationResult[] {
    const results: ValidationResult[] = [];
    const secretPatterns: Array<{ pattern: RegExp; label: string }> = [
      { pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"][A-Za-z0-9]{20,}['"]/gi, label: "API key" },
      { pattern: /(?:secret|token|password)\s*[:=]\s*['"][^'"]{8,}['"]/gi, label: "Secret/token" },
      { pattern: /(?:aws[_-]?(?:access[_-]?key|secret))\s*[:=]\s*['"][A-Z0-9]{16,}['"]/gi, label: "AWS credential" },
      { pattern: /(?:private[_-]?key)\s*[:=]\s*['"]-----BEGIN/gi, label: "Private key" },
      { pattern: /(?:bearer|auth)\s*[:=]\s*['"][A-Za-z0-9\-._~+\/]+=*['"]/gi, label: "Auth token" },
    ];

    const walk = (nodes: ContentNode[], path: string) => {
      for (const node of nodes) {
        if (node.type === "code" || node.type === "text") {
          const text = extractText(node);
          for (const { pattern, label } of secretPatterns) {
            pattern.lastIndex = 0;
            const match = pattern.exec(text);
            if (match) {
              results.push({
                valid: false,
                message: `Potential ${label} found: "${match[0].slice(0, 40)}..."`,
                rule: "no-hardcoded-secrets",
                severity: "error",
                path: path,
              });
            }
          }
        }
        if ("children" in node && Array.isArray((node as any).children)) {
          walk((node as any).children, `${path}/children`);
        }
      }
    };

    for (const section of ast.sections || []) {
      walk(section.content || [], `sections/${section.type}`);
    }

    if (results.length === 0) {
      results.push({ valid: true, message: "No hardcoded secrets detected", rule: "no-hardcoded-secrets" });
    }
    return results;
  },
};

// ─── Rule: Validate Code Block Languages ───────────────────────────

const validLanguagesRule: ValidationRule = {
  name: "valid-code-languages",
  description: "Ensure code blocks use recognized language identifiers",
  severity: "warning",
  category: "quality",
  tags: ["code", "lint"],
  fixable: true,

  check(ast: MAMModule): ValidationResult[] {
    const results: ValidationResult[] = [];
    const knownLanguages = new Set([
      "typescript", "javascript", "python", "rust", "go", "java", "c", "cpp",
      "ruby", "php", "swift", "kotlin", "shell", "bash", "sql", "html", "css",
      "json", "yaml", "toml", "markdown", "mermaid", "dockerfile", "makefile",
    ]);

    const walk = (nodes: ContentNode[]) => {
      for (const node of nodes) {
        if (node.type === "code" && "language" in node) {
          const lang = (node as CodeBlock).language?.toLowerCase();
          if (lang && !knownLanguages.has(lang)) {
            results.push({
              valid: false,
              message: `Unrecognized language identifier: "${lang}"`,
              rule: "valid-code-languages",
              severity: "warning",
            });
          }
        }
        if ("children" in node && Array.isArray((node as any).children)) {
          walk((node as any).children);
        }
      }
    };

    for (const section of ast.sections || []) {
      walk(section.content || []);
    }

    return results;
  },
};

// ─── Rule: Module Size Limit ──────────────────────────────────────

const moduleSizeRule: ValidationRule = {
  name: "module-size-limit",
  description: "Ensure module does not exceed maximum section count",
  severity: "warning",
  category: "performance",
  tags: ["limits", "performance"],

  check(ast: MAMModule): ValidationResult[] {
    const maxSections = 50;
    const sectionCount = ast.sections?.length || 0;

    if (sectionCount > maxSections) {
      return [
        {
          valid: false,
          message: `Module has ${sectionCount} sections (max: ${maxSections})`,
          rule: "module-size-limit",
          severity: "warning",
        },
      ];
    }
    return [{ valid: true, message: `Section count OK (${sectionCount}/${maxSections})`, rule: "module-size-limit" }];
  },
};

// ─── Rule: Cross-Reference Integrity ──────────────────────────────

const crossReferenceRule: ValidationRule = {
  name: "cross-reference-integrity",
  description: "Validate that internal cross-references resolve correctly",
  severity: "error",
  category: "integrity",
  tags: ["references", "links"],

  check(ast: MAMModule): ValidationResult[] {
    const results: ValidationResult[] = [];
    const definedRefs = new Set<string>();
    const usedRefs = new Set<string>();

    // Collect defined references (section IDs)
    for (const section of ast.sections || []) {
      if ((section as any).id) {
        definedRefs.add((section as any).id);
      }
    }

    // Collect used references
    const walk = (nodes: ContentNode[]) => {
      for (const node of nodes) {
        if (node.type === "text" || node.type === "code") {
          const text = extractText(node);
          const refMatches = text.matchAll(/\{@ref:([^}]+)\}/g);
          for (const m of refMatches) {
            usedRefs.add(m[1]);
          }
        }
        if ("children" in node && Array.isArray((node as any).children)) {
          walk((node as any).children);
        }
      }
    };

    for (const section of ast.sections || []) {
      walk(section.content || []);
    }

    // Check for undefined references
    for (const ref of usedRefs) {
      if (!definedRefs.has(ref)) {
        results.push({
          valid: false,
          message: `Cross-reference "{@ref:${ref}}" does not resolve to any defined section`,
          rule: "cross-reference-integrity",
          severity: "error",
        });
      }
    }

    if (results.length === 0) {
      results.push({ valid: true, message: "All cross-references resolve correctly", rule: "cross-reference-integrity" });
    }
    return results;
  },
};

// ─── Plugin Assembly ──────────────────────────────────────────────

const validationPlugin: MAMPlugin = {
  manifest: {
    name: "custom-validation-rules",
    version: "1.0.0",
    description: "Custom validation rules for MAM modules",
    author: "MAM Examples",
    license: "MIT",
    mamVersion: ">=0.1.0",
    keywords: ["validation", "rules", "security"],
    categories: ["validator"],
    main: "dist/index.js",
  },

  rules: [
    requireDescriptionRule,
    noHardcodedSecretsRule,
    validLanguagesRule,
    moduleSizeRule,
    crossReferenceRule,
  ],

  hooks: {
    beforeValidation: (module) => {
      // Add validation context metadata
      (module as any)._validationStart = performance.now();
      return module;
    },

    afterValidation: (report) => {
      // Log validation summary
      const duration = (report as any).durationMs || 0;
      console.log(
        `[validation-plugin] Validation complete: ` +
        `${report.errors?.length || 0} errors, ` +
        `${report.warnings?.length || 0} warnings`
      );
      return report;
    },
  },
};

// ─── Utilities ────────────────────────────────────────────────────

function extractText(node: ContentNode): string {
  if ("value" in node && typeof (node as any).value === "string") {
    return (node as any).value;
  }
  if ("children" in node && Array.isArray((node as any).children)) {
    return (node as any).children.map(extractText).join("\n");
  }
  return "";
}

export default validationPlugin;
```

## Python Validation Engine

```python
"""
Custom validation engine for MAM modules.

Implements business rules, security checks, and structural validation
using the MAM module AST. Designed for integration with CI/CD pipelines.
"""

from __future__ import annotations

import re
import json
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable


class Severity(Enum):
    """Validation result severity levels."""
    ERROR = "error"
    WARNING = "warning"
    INFO = "info"


@dataclass
class ValidationResult:
    """Single validation result."""
    valid: bool
    message: str
    rule: str
    severity: Severity = Severity.ERROR
    path: str | None = None
    fixable: bool = False


@dataclass
class ValidationReport:
    """Aggregated validation report for a module."""
    errors: list[ValidationResult] = field(default_factory=list)
    warnings: list[ValidationResult] = field(default_factory=list)
    infos: list[ValidationResult] = field(default_factory=list)
    duration_ms: float = 0.0

    @property
    def is_valid(self) -> bool:
        return len(self.errors) == 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "valid": self.is_valid,
            "errors": len(self.errors),
            "warnings": len(self.warnings),
            "infos": len(self.infos),
            "duration_ms": self.duration_ms,
            "details": {
                "errors": [self._result_dict(r) for r in self.errors],
                "warnings": [self._result_dict(r) for r in self.warnings],
            },
        }

    @staticmethod
    def _result_dict(r: ValidationResult) -> dict[str, Any]:
        return {
            "message": r.message,
            "rule": r.rule,
            "severity": r.severity.value,
            "path": r.path,
        }


@dataclass
class ValidationRule:
    """A single validation rule."""
    name: str
    description: str
    severity: Severity
    category: str
    check: Callable[[dict[str, Any]], list[ValidationResult]]
    fixable: bool = False


# ─── Secret Detection Patterns ──────────────────────────────────────

SECRET_PATTERNS: list[tuple[str, str]] = [
    (r'api[_-]?key\s*[:=]\s*[\'"][A-Za-z0-9]{20,}[\'"]', "API key"),
    (r'secret\s*[:=]\s*[\'"][^\'"]{8,}[\'"]', "Secret"),
    (r'token\s*[:=]\s*[\'"][A-Za-z0-9\-._~+\/]+=*[\'"]', "Token"),
    (r'password\s*[:=]\s*[\'"][^\'"]{6,}[\'"]', "Password"),
    (r'aws[_-]?(?:access[_-]?key|secret)\s*[:=]\s*[\'"][A-Z0-9]{16,}[\'"]', "AWS credential"),
    (r'private[_-]?key\s*[:=]\s*[\'"]-----BEGIN', "Private key"),
]

KNOWN_LANGUAGES = frozenset([
    "typescript", "javascript", "python", "rust", "go", "java", "c", "cpp",
    "ruby", "php", "swift", "kotlin", "shell", "bash", "sql", "html", "css",
    "json", "yaml", "toml", "markdown", "mermaid", "dockerfile", "makefile",
])


def validate_business_rules(module: dict[str, Any]) -> list[ValidationResult]:
    """Check business rules: required sections, naming conventions, limits."""
    results: list[ValidationResult] = []
    sections = module.get("sections", [])

    has_description = any(
        s.get("type") in ("description", "purpose") for s in sections
    )
    if not has_description:
        results.append(ValidationResult(
            valid=False,
            message="Module requires a description or purpose section",
            rule="business/require-description",
            severity=Severity.ERROR,
        ))

    if len(sections) > 50:
        results.append(ValidationResult(
            valid=False,
            message=f"Module exceeds maximum section count ({len(sections)}/50)",
            rule="business/section-limit",
            severity=Severity.WARNING,
        ))

    seen_ids: set[str] = set()
    for i, section in enumerate(sections):
        sid = section.get("id")
        if sid:
            if sid in seen_ids:
                results.append(ValidationResult(
                    valid=False,
                    message=f"Duplicate section ID: '{sid}' at index {i}",
                    rule="business/duplicate-id",
                    severity=Severity.ERROR,
                    path=f"sections[{i}]",
                ))
            seen_ids.add(sid)

    return results


def validate_security(module: dict[str, Any]) -> list[ValidationResult]:
    """Check for security issues: hardcoded secrets, dangerous patterns."""
    results: list[ValidationResult] = []
    sections = module.get("sections", [])

    def scan_text(text: str, path: str) -> None:
        for pattern, label in SECRET_PATTERNS:
            matches = re.finditer(pattern, text, re.IGNORECASE)
            for match in matches:
                results.append(ValidationResult(
                    valid=False,
                    message=f"Potential {label} detected at {path}: '{match.group()[:40]}...'",
                    rule="security/no-hardcoded-secrets",
                    severity=Severity.ERROR,
                    path=path,
                ))

    def walk_nodes(nodes: list[dict[str, Any]], path: str) -> None:
        for i, node in enumerate(nodes):
            node_type = node.get("type", "")
            current_path = f"{path}[{i}]"

            if node_type in ("text", "code"):
                value = node.get("value", "")
                if isinstance(value, str):
                    scan_text(value, current_path)

            children = node.get("children", [])
            if children:
                walk_nodes(children, f"{current_path}/children")

    for i, section in enumerate(sections):
        content = section.get("content", [])
        walk_nodes(content, f"sections[{i}].content")

    return results


def validate_code_languages(module: dict[str, Any]) -> list[ValidationResult]:
    """Ensure code blocks use recognized language identifiers."""
    results: list[ValidationResult] = []
    sections = module.get("sections", [])

    def walk_nodes(nodes: list[dict[str, Any]], path: str) -> None:
        for i, node in enumerate(nodes):
            current_path = f"{path}[{i}]"
            if node.get("type") == "code":
                lang = node.get("language", "").lower()
                if lang and lang not in KNOWN_LANGUAGES:
                    results.append(ValidationResult(
                        valid=False,
                        message=f"Unrecognized language: '{lang}'",
                        rule="quality/valid-language",
                        severity=Severity.WARNING,
                        path=current_path,
                    ))
            children = node.get("children", [])
            if children:
                walk_nodes(children, current_path)

    for i, section in enumerate(sections):
        walk_nodes(section.get("content", []), f"sections[{i}].content")

    return results


class ModuleValidator:
    """High-level validator that orchestrates all rules."""

    def __init__(self) -> None:
        self.rules: list[ValidationRule] = [
            ValidationRule(
                name="business-rules",
                description="Business rule validation",
                severity=Severity.ERROR,
                category="business",
                check=validate_business_rules,
            ),
            ValidationRule(
                name="security-checks",
                description="Security issue detection",
                severity=Severity.ERROR,
                category="security",
                check=validate_security,
            ),
            ValidationRule(
                name="code-languages",
                description="Code language validation",
                severity=Severity.WARNING,
                category="quality",
                check=validate_code_languages,
            ),
        ]

    def validate(self, module: dict[str, Any]) -> ValidationReport:
        """Run all validation rules and return a report."""
        report = ValidationReport()
        import time
        start = time.perf_counter()

        for rule in self.rules:
            results = rule.check(module)
            for r in results:
                if r.severity == Severity.ERROR and not r.valid:
                    report.errors.append(r)
                elif r.severity == Severity.WARNING and not r.valid:
                    report.warnings.append(r)
                else:
                    report.infos.append(r)

        report.duration_ms = (time.perf_counter() - start) * 1000
        return report


# ─── Tests ──────────────────────────────────────────────────────────

def test_validate_missing_description():
    module = {"sections": [{"type": "code", "content": []}]}
    report = ModuleValidator().validate(module)
    assert not report.is_valid
    assert any("description" in e.message for e in report.errors)


def test_validate_with_description():
    module = {"sections": [{"type": "description", "content": []}]}
    report = ModuleValidator().validate(module)
    desc_errors = [e for e in report.errors if "description" in e.message]
    assert len(desc_errors) == 0


def test_validate_secret_detection():
    module = {
        "sections": [{
            "type": "code",
            "content": [{"type": "code", "value": 'api_key = "sk-1234567890abcdefghij"'}],
        }]
    }
    report = ModuleValidator().validate(module)
    secret_errors = [e for e in report.errors if "secret" in e.rule]
    assert len(secret_errors) > 0


def test_validate_section_limit():
    sections = [{"type": "text", "content": []} for _ in range(55)]
    module = {"sections": sections}
    report = ModuleValidator().validate(module)
    limit_warnings = [w for w in report.warnings if "section" in w.rule]
    assert len(limit_warnings) > 0


def test_validate_unknown_language():
    module = {
        "sections": [{
            "type": "code",
            "content": [{"type": "code", "language": "xyznotreal", "value": "x"}],
        }]
    }
    report = ModuleValidator().validate(module)
    lang_warnings = [w for w in report.warnings if "language" in w.rule]
    assert len(lang_warnings) > 0


if __name__ == "__main__":
    test_validate_missing_description()
    test_validate_with_description()
    test_validate_secret_detection()
    test_validate_section_limit()
    test_validate_unknown_language()
    print("All tests passed.")
```

## Usage

1. Place the plugin in `.mam/plugins/validation-plugin/`.
2. Rules auto-register on plugin load.
3. Run validation via the MAM CLI:

```bash
mam validate my-module.mam.md
```

Or programmatically:

```typescript
import { PluginRegistry, HookManager } from "@mam/plugin-api";

const hookManager = new HookManager();
const registry = new PluginRegistry(hookManager);
await registry.loadPlugin("./plugins/validation-plugin");
const report = await hookManager.execute("beforeValidation", module);
```

## What This Demonstrates

| Concept | Where |
|---------|-------|
| Rule definition | `ValidationRule` objects with `check` functions |
| Severity levels | `error`, `warning`, `info` classifications |
| Auto-fix suggestions | `ValidationFix` with `replacements` |
| Hook integration | `beforeValidation` / `afterValidation` hooks |
| Security scanning | Pattern matching for secrets and credentials |
| Cross-reference checks | Reference integrity validation |
| Python integration | Standalone `ModuleValidator` class with CI/CD support |
