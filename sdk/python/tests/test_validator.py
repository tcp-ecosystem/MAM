"""Tests for the MAM validator."""

from mam.ast import AST, FrontMatter, Section
from mam.parser import parse_mam
from mam.validator import (
    MAMValidator,
    ValidationIssue,
    ValidationRule,
    ValidationSeverity,
    count_issues_by_severity,
    filter_by_severity,
    has_errors,
    has_warnings,
    is_valid,
    issue_messages,
    summarize_issues,
    validate,
)

VALID_MAM = """\
---
id: valid-module
version: 2.0.0
name: Valid Module
author: Test Author
runtime: python
tags:
  - test
description: A valid test module
dependencies:
  - requests
---

# Valid Module

## Purpose

This is a valid module for testing.

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| input1 | string | Yes | An input |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| output1 | string | An output |

## Rules

- Rule one
- Rule two

## Python

```python
def process(input1: str) -> dict:
    return {"output1": input1}
```
"""


class TestValidationSeverity:
    """Tests for ValidationSeverity enum."""

    def test_to_string(self) -> None:
        assert ValidationSeverity.INFO.to_string() == "info"
        assert ValidationSeverity.WARNING.to_string() == "warning"
        assert ValidationSeverity.ERROR.to_string() == "error"
        assert ValidationSeverity.CRITICAL.to_string() == "critical"

    def test_ordering(self) -> None:
        assert ValidationSeverity.CRITICAL > ValidationSeverity.ERROR
        assert ValidationSeverity.ERROR > ValidationSeverity.WARNING
        assert ValidationSeverity.WARNING > ValidationSeverity.INFO


class TestValidationIssue:
    """Tests for ValidationIssue dataclass."""

    def test_to_dict(self) -> None:
        issue = ValidationIssue(
            message="Test issue",
            severity=ValidationSeverity.WARNING,
            rule="test-rule",
            section="Purpose",
            line=10,
            context="some context",
            suggestion="fix it",
        )
        d = issue.to_dict()
        assert d["message"] == "Test issue"
        assert d["severity"] == "warning"
        assert d["rule"] == "test-rule"
        assert d["section"] == "Purpose"
        assert d["line"] == 10
        assert d["context"] == "some context"
        assert d["suggestion"] == "fix it"

    def test_to_dict_minimal(self) -> None:
        issue = ValidationIssue(
            message="Simple issue",
            severity=ValidationSeverity.INFO,
        )
        d = issue.to_dict()
        assert d["message"] == "Simple issue"
        assert d["severity"] == "info"
        assert "section" not in d
        assert "line" not in d

    def test_str(self) -> None:
        issue = ValidationIssue(
            message="Test issue",
            severity=ValidationSeverity.ERROR,
            rule="test-rule",
            section="Purpose",
            line=10,
        )
        s = str(issue)
        assert "[error]" in s
        assert "(test-rule)" in s
        assert "Test issue" in s
        assert "Purpose" in s
        assert "line 10" in s


class TestValidationRule:
    """Tests for ValidationRule dataclass."""

    def test_check_enabled(self) -> None:
        rule = ValidationRule(
            name="test",
            description="Test rule",
            checker=lambda s, a: [],
            enabled=True,
        )
        section = Section(name="Test")
        ast = AST()
        issues = rule.check(section, ast)
        assert issues == []

    def test_check_disabled(self) -> None:
        rule = ValidationRule(
            name="test",
            description="Test rule",
            checker=lambda s, a: [ValidationIssue("fail", ValidationSeverity.ERROR)],
            enabled=False,
        )
        section = Section(name="Test")
        ast = AST()
        issues = rule.check(section, ast)
        assert issues == []


class TestMAMValidator:
    """Tests for MAMValidator class."""

    def test_validate_valid_module(self) -> None:
        result = parse_mam(VALID_MAM)
        assert result.success
        issues = validate(result.ast)
        errors = [i for i in issues if i.severity >= ValidationSeverity.ERROR]
        assert len(errors) == 0

    def test_validate_missing_frontmatter(self) -> None:
        ast = AST(
            frontmatter=FrontMatter(data={}),
            sections=[Section(name="Purpose", raw_content="Test")],
        )
        validator = MAMValidator()
        issues = validator.validate(ast)
        field_issues = [
            i
            for i in issues
            if "required" in i.message.lower() and "field" in i.message.lower()
        ]
        assert len(field_issues) >= 3

    def test_validate_invalid_id(self) -> None:
        content = (
            "---\nid: INVALID_ID\nversion: 2.0.0\nname: Test\n"
            "author: Author\nruntime: python\n---\n\n# Test\n\n## Purpose\n\nTest.\n"
        )
        result = parse_mam(content)
        validator = MAMValidator()
        issues = validator.validate(result.ast)
        id_issues = [
            i
            for i in issues
            if "id" in i.message.lower()
            and ("invalid" in i.message.lower() or "format" in i.rule.lower())
        ]
        assert len(id_issues) >= 1

    def test_validate_invalid_version(self) -> None:
        content = (
            "---\nid: test\nversion: bad\nname: Test\n"
            "author: Author\nruntime: python\n---\n\n# Test\n\n## Purpose\n\nTest.\n"
        )
        result = parse_mam(content)
        validator = MAMValidator()
        issues = validator.validate(result.ast)
        version_issues = [
            i
            for i in issues
            if "version" in i.message.lower() or "version" in i.rule.lower()
        ]
        assert len(version_issues) >= 1

    def test_validate_missing_purpose(self) -> None:
        content = (
            "---\nid: test\nversion: 2.0.0\nname: Test\n"
            "author: Author\nruntime: python\n---\n\n# Test\n\n## Inputs\n\nSomething.\n"
        )
        result = parse_mam(content)
        validator = MAMValidator()
        issues = validator.validate(result.ast)
        purpose_issues = [i for i in issues if "Purpose" in i.message]
        assert len(purpose_issues) >= 1

    def test_validate_empty_section(self) -> None:
        content = (
            "---\nid: test\nversion: 2.0.0\nname: Test\n"
            "author: Author\nruntime: python\n---\n\n# Test\n\n"
            "## Purpose\n\nDo things.\n\n## Empty\n\n"
        )
        result = parse_mam(content)
        validator = MAMValidator()
        issues = validator.validate(result.ast)
        empty_issues = [i for i in issues if "empty" in i.message.lower()]
        assert len(empty_issues) >= 1

    def test_validate_code_language(self) -> None:
        content = VALID_MAM + "\n\n## Extra\n\n```\nSome code\n```\n"
        result = parse_mam(content)
        validator = MAMValidator()
        issues = validator.validate(result.ast)
        lang_issues = [
            i
            for i in issues
            if "language" in i.message.lower() and "missing" in i.message.lower()
        ]
        assert len(lang_issues) >= 1

    def test_validate_table_structure(self) -> None:
        content = VALID_MAM + """
## Bad Table

| Name | Type |
|------|------|------|
| a | b | c |
"""
        result = parse_mam(content)
        validator = MAMValidator()
        issues = validator.validate(result.ast)
        table_issues = [
            i
            for i in issues
            if "column" in i.message.lower() or "columns" in i.message.lower()
        ]
        assert len(table_issues) >= 1

    def test_validate_inputs_table_headers(self) -> None:
        content = """\
---
id: test
version: 2.0.0
name: Test
author: Author
runtime: python
---

# Test

## Purpose

Test.

## Inputs

| Name | Bad |
|------|-----|
| x | y |
"""
        result = parse_mam(content)
        validator = MAMValidator()
        issues = validator.validate(result.ast)
        header_issues = [i for i in issues if "missing columns" in i.message.lower()]
        assert len(header_issues) >= 1

    def test_validate_strict_mode(self) -> None:
        result = parse_mam(VALID_MAM)
        validator = MAMValidator(strict=True)
        issues = validator.validate(result.ast)
        error_levels = [i.severity for i in issues]
        assert all(s >= ValidationSeverity.ERROR for s in error_levels)

    def test_validate_section(self) -> None:
        result = parse_mam(VALID_MAM)
        validator = MAMValidator()
        section = result.ast.get_section("Python")
        assert section is not None
        issues = validator.validate_section(section, result.ast)
        assert isinstance(issues, list)

    def test_list_rules(self) -> None:
        validator = MAMValidator()
        rules = validator.list_rules()
        assert len(rules) > 0
        assert "frontmatter-required-fields" in rules

    def test_enable_disable_rule(self) -> None:
        validator = MAMValidator()
        assert validator.disable_rule("empty-section")
        rule = validator.get_rule("empty-section")
        assert rule is not None
        assert not rule.enabled
        assert validator.enable_rule("empty-section")
        assert rule.enabled

    def test_remove_rule(self) -> None:
        validator = MAMValidator()
        removed = validator.remove_rule("empty-section")
        assert removed is not None
        assert validator.get_rule("empty-section") is None

    def test_add_custom_rule(self) -> None:
        def my_checker(section: Section, ast: AST) -> list:
            return [ValidationIssue("Custom check", ValidationSeverity.INFO)]

        rule = ValidationRule(
            name="custom-check",
            description="Custom validation",
            checker=my_checker,
        )
        validator = MAMValidator()
        validator.add_rule(rule)
        assert "custom-check" in validator.list_rules()

    def test_validate_dependencies_in_code(self) -> None:
        content = """\
---
id: test
version: 2.0.0
name: Test
author: Author
runtime: python
---

# Test

## Purpose

Test.

## Python

```python
import os
import sys
import nonexistent_package_xyz

def run():
    pass
```
"""
        result = parse_mam(content)
        validator = MAMValidator()
        issues = validator.validate(result.ast)
        dep_issues = [
            i
            for i in issues
            if "not declared" in i.message.lower() or "dependencies" in i.rule.lower()
        ]
        assert len(dep_issues) >= 1


class TestValidateFunction:
    """Tests for the validate convenience function."""

    def test_validate_returns_list(self) -> None:
        result = parse_mam(VALID_MAM)
        issues = validate(result.ast)
        assert isinstance(issues, list)

    def test_validate_sorted_by_severity(self) -> None:
        result = parse_mam(VALID_MAM)
        issues = validate(result.ast)
        for i in range(len(issues) - 1):
            assert issues[i].severity >= issues[i + 1].severity

    def test_validate_strict(self) -> None:
        result = parse_mam(VALID_MAM)
        issues_strict = validate(result.ast, strict=True)
        issues_normal = validate(result.ast, strict=False)
        assert len(issues_strict) >= len(issues_normal)


def _issue(message: str, severity: ValidationSeverity) -> ValidationIssue:
    return ValidationIssue(message=message, severity=severity, rule="test")


MIXED_ISSUES = [
    _issue("bad id", ValidationSeverity.ERROR),
    _issue("missing version", ValidationSeverity.ERROR),
    _issue("out of order", ValidationSeverity.WARNING),
    _issue("style nit", ValidationSeverity.INFO),
]


class TestValidatorHelpers:
    """Tests for the validation issue helper functions."""

    def test_count_issues_by_severity(self) -> None:
        counts = count_issues_by_severity(MIXED_ISSUES)
        assert counts["error"] == 2
        assert counts["warning"] == 1
        assert counts["info"] == 1
        assert counts["critical"] == 0
        assert sum(counts.values()) == len(MIXED_ISSUES)

    def test_has_errors(self) -> None:
        assert has_errors(MIXED_ISSUES) is True
        assert has_errors([]) is False
        assert has_errors([_issue("w", ValidationSeverity.WARNING)]) is False

    def test_has_warnings(self) -> None:
        assert has_warnings(MIXED_ISSUES) is True
        assert has_warnings([_issue("i", ValidationSeverity.INFO)]) is False
        assert has_warnings([]) is False

    def test_filter_by_severity(self) -> None:
        errors = filter_by_severity(MIXED_ISSUES, ValidationSeverity.ERROR)
        assert len(errors) == 2
        assert all(i.severity == ValidationSeverity.ERROR for i in errors)
        assert filter_by_severity(MIXED_ISSUES, ValidationSeverity.CRITICAL) == []

    def test_issue_messages(self) -> None:
        assert issue_messages(MIXED_ISSUES) == [
            "bad id",
            "missing version",
            "out of order",
            "style nit",
        ]
        assert issue_messages([]) == []

    def test_is_valid(self) -> None:
        assert is_valid([]) is True
        assert is_valid([_issue("w", ValidationSeverity.WARNING)]) is True
        assert is_valid([_issue("e", ValidationSeverity.ERROR)]) is False
        assert is_valid([_issue("c", ValidationSeverity.CRITICAL)]) is False

    def test_summarize_issues(self) -> None:
        assert summarize_issues([]) == "no issues"
        summary = summarize_issues(MIXED_ISSUES)
        assert "2 errors" in summary
        assert "1 warning" in summary
        assert "1 info" in summary
        assert summarize_issues([_issue("only", ValidationSeverity.WARNING)]) == "1 warning"
