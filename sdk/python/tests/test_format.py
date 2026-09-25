"""Tests for the text formatter module."""

import json

from mam.ast import MAMModule
from mam.format import (
    format_ast_json,
    format_built_module,
    format_code_block_list,
    format_dependency_table,
    format_execution_report,
    format_front_matter,
    format_module_summary,
    format_parse_errors,
    format_section_list,
    format_toc,
    format_validation_report,
)
from mam.parser import parse_mam
from mam.validator import ValidationIssue, ValidationSeverity, validate

DOC = """---
id: fmt
name: Format Me
version: 2.0.0
author: Tester
runtime: python
description: Formatter fixture
dependencies:
  - pip:requests
  - npm:left-pad
---

## Purpose

A module for formatting.

## Python

```python
print(1)
```
"""

EMPTY = "## Purpose\n\nNothing declared.\n"

INVALID = """---
id: NOT VALID
name: Invalid
version: not-a-version
---

## Purpose

Has bad metadata.
"""


class TestModuleSummary:
    def test_summary_reports_identity_and_totals(self) -> None:
        text = format_module_summary(parse_mam(DOC).ast)
        assert "Format Me" in text
        assert "2.0.0" in text
        assert "sections: 2" in text
        assert "code blocks: 1" in text
        assert "Tester" in text

    def test_summary_falls_back_to_untitled(self) -> None:
        text = format_module_summary(parse_mam(EMPTY).ast)
        assert "(untitled)" in text
        assert "(none)" in text


class TestSectionFormatting:
    def test_section_list(self) -> None:
        text = format_section_list(parse_mam(DOC).ast)
        assert "1. Purpose" in text
        assert "2. Python" in text

    def test_section_list_with_types(self) -> None:
        text = format_section_list(parse_mam(DOC).ast, show_types=True)
        assert "[Purpose]" in text

    def test_empty_module(self) -> None:
        assert format_section_list(parse_mam("").ast) == "(no sections)"

    def test_toc(self) -> None:
        text = format_toc(parse_mam(DOC).ast)
        assert "Contents:" in text
        assert "Purpose" in text
        assert format_toc(parse_mam("").ast) == "(no sections)"


class TestCodeBlocks:
    def test_code_block_list(self) -> None:
        text = format_code_block_list(parse_mam(DOC).ast)
        assert "Code blocks: 1" in text
        assert "python" in text
        assert "By language: python=1" in text

    def test_code_block_list_with_preview(self) -> None:
        text = format_code_block_list(parse_mam(DOC).ast, show_preview=True)
        assert "print(1)" in text

    def test_no_code_blocks(self) -> None:
        assert format_code_block_list(parse_mam(EMPTY).ast) == "(no code blocks)"


class TestJsonAndFrontMatter:
    def test_ast_json_round_trips(self) -> None:
        ast = parse_mam(DOC).ast
        assert json.loads(format_ast_json(ast)) == ast.to_dict()

    def test_front_matter_is_aligned(self) -> None:
        text = format_front_matter(parse_mam(DOC).ast.frontmatter)
        assert "version" in text
        assert "2.0.0" in text
        assert "pip:requests, npm:left-pad" in text

    def test_front_matter_unaligned(self) -> None:
        text = format_front_matter(parse_mam(DOC).ast.frontmatter, align=False)
        assert "id: fmt" in text

    def test_missing_front_matter(self) -> None:
        assert format_front_matter(parse_mam(EMPTY).ast.frontmatter) == "(no front matter)"


class TestValidationReport:
    def test_reports_grouped_counts(self) -> None:
        issues = validate(parse_mam(INVALID).ast)
        assert issues
        text = format_validation_report(issues)
        assert "ERROR" in text
        assert "No issues found." not in text

    def test_no_issues(self) -> None:
        assert format_validation_report([]) == "No issues found."

    def test_respects_limit(self) -> None:
        issues = [
            ValidationIssue(message=f"m{i}", severity=ValidationSeverity.WARNING, rule="r")
            for i in range(10)
        ]
        text = format_validation_report(issues, limit=3)
        assert "WARNING (10)" in text
        assert "and 7 more" in text

    def test_includes_suggestions(self) -> None:
        issues = [
            ValidationIssue(
                message="bad",
                severity=ValidationSeverity.ERROR,
                rule="r",
                suggestion="fix it",
                section="Purpose",
            )
        ]
        text = format_validation_report(issues)
        assert "[Purpose]" in text
        assert "fix it" in text
        assert "fix it" not in format_validation_report(issues, show_suggestions=False)


class TestExecutionReport:
    def test_successful_execution(self) -> None:
        payload = {
            "success": True,
            "total_time_ms": 12.5,
            "results": {
                "Python": [
                    {
                        "status": "success",
                        "language": "python",
                        "execution_time_ms": 3.0,
                        "stdout": "1",
                        "stderr": "",
                    }
                ]
            },
        }
        text = format_execution_report(payload)
        assert "succeeded" in text
        assert "Python [ok]" in text
        assert "stdout: 1" in text

    def test_failed_execution(self) -> None:
        payload = {
            "success": False,
            "total_time_ms": 1.0,
            "results": {
                "Python": [
                    {
                        "status": "failed",
                        "language": "python",
                        "execution_time_ms": 1.0,
                        "stdout": "",
                        "stderr": "boom",
                        "error_message": "exited 1",
                    }
                ]
            },
        }
        text = format_execution_report(payload)
        assert "failed" in text
        assert "Python [FAILED]" in text
        assert "stderr: boom" in text

    def test_empty_and_invalid(self) -> None:
        assert "(no execution result)" in format_execution_report("junk")
        assert "(no code blocks executed)" in format_execution_report({})


class TestMisc:
    def test_dependency_table(self) -> None:
        text = format_dependency_table(parse_mam(DOC).ast)
        assert "[pip]" in text
        assert "[npm]" in text
        assert "Total: 2" in text
        assert format_dependency_table(parse_mam(EMPTY).ast) == "(no dependencies)"

    def test_built_module(self) -> None:
        module = MAMModule(
            name="built",
            author="A",
            description="D",
            tags=["x"],
            dependencies=["pip:requests"],
            permissions=["read"],
            metadata={"z": 1},
        )
        text = format_built_module(module)
        assert "built" in text
        assert "read" in text
        assert format_built_module("junk") == "(not a MAMModule)"

    def test_parse_errors(self) -> None:
        result = parse_mam(DOC)
        text = format_parse_errors(result)
        assert "no errors" in text.lower() or "[" in text
