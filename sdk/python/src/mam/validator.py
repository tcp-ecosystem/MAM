"""
MAM Module Validator.

Provides comprehensive validation of parsed MAM modules against the MAM spec,
including front matter validation, section structure checks, code block
analysis, dependency verification, and custom rule support.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import IntEnum
from typing import Any, Callable, Dict, List, Optional

from .ast import (
    AST,
    CODE_SECTION_NAMES,
    STANDARD_SECTIONS_ORDER,
    Section,
    SectionType,
)

__all__ = [
    "validate",
    "MAMValidator",
    "ValidationSeverity",
    "ValidationIssue",
    "ValidationRule",
]

VALID_ID_PATTERN = re.compile(r"^[a-z][a-z0-9-]{0,63}$")
SEMVER_PATTERN = re.compile(
    r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    r"(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)"
    r"(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?"
    r"(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$"
)

PYTHON_IMPORT_PATTERN = re.compile(
    r"^(?:from\s+[\w.]+\s+import\s+[\w*, ]+|import\s+[\w., ]+)$",
    re.MULTILINE,
)

JAVASCRIPT_IMPORT_PATTERN = re.compile(
    r"^(?:import\s+.+from\s+['\"].+['\"]|"
    r"const\s+.+\s*=\s*require\s*\(['\"].+['\"]\))$",
    re.MULTILINE,
)

EXTERNAL_DEPENDENCY_PATTERN = re.compile(
    r"^(?!mam-sdk|internal)[a-zA-Z][\w.-]*"
)


class ValidationSeverity(IntEnum):
    """Severity levels for validation issues."""

    INFO = 0
    WARNING = 1
    ERROR = 2
    CRITICAL = 3

    def to_string(self) -> str:
        return self.name.lower()


@dataclass
class ValidationIssue:
    """A single validation issue found during module validation."""

    message: str
    severity: ValidationSeverity
    rule: str = ""
    section: Optional[str] = None
    line: Optional[int] = None
    context: Optional[str] = None
    suggestion: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        result: Dict[str, Any] = {
            "message": self.message,
            "severity": self.severity.to_string(),
            "rule": self.rule,
        }
        if self.section is not None:
            result["section"] = self.section
        if self.line is not None:
            result["line"] = self.line
        if self.context is not None:
            result["context"] = self.context
        if self.suggestion is not None:
            result["suggestion"] = self.suggestion
        return result

    def __str__(self) -> str:
        parts = [f"[{self.severity.to_string()}]"]
        if self.rule:
            parts.append(f"({self.rule})")
        parts.append(self.message)
        if self.section:
            parts.append(f"in section '{self.section}'")
        if self.line:
            parts.append(f"at line {self.line}")
        return " ".join(parts)


@dataclass
class ValidationRule:
    """A custom validation rule with a checker function.

    Custom rules allow extending the validator with project-specific or
    domain-specific checks beyond the built-in MAM spec validation.

    Example::

        no_secrets = ValidationRule(
            name="no-secrets",
            description="Ensure no secrets in code blocks",
            checker=lambda section, ast: [] if "secret" not in section.raw_content.lower()
            else [ValidationIssue("Possible secret found", ValidationSeverity.CRITICAL)]
        )
        validator.add_rule(no_secrets)
    """

    name: str
    description: str
    checker: Callable[[Section, AST], List[ValidationIssue]]
    enabled: bool = True
    severity: ValidationSeverity = ValidationSeverity.WARNING

    def check(self, section: Section, ast: AST) -> List[ValidationIssue]:
        if not self.enabled:
            return []
        return self.checker(section, ast)


class MAMValidator:
    """Comprehensive MAM module validator.

    Validates parsed MAM ASTs against the MAM specification, checking:
    - Front matter completeness and correctness
    - Required section presence
    - Section ordering (advisory)
    - Code block language and syntax
    - Table structure
    - Dependency declarations
    - Module ID and version format

    Supports custom rules via add_rule() for project-specific validation.

    Example::

        validator = MAMValidator(strict=True)
        issues = validator.validate(ast)
        for issue in issues:
            print(issue)
    """

    def __init__(self, strict: bool = False):
        self.strict = strict
        self._rules: Dict[str, ValidationRule] = {}
        self._register_builtins()

    def _register_builtins(self) -> None:
        self._rules["frontmatter-required-fields"] = ValidationRule(
            name="frontmatter-required-fields",
            description="Check that all required front matter fields are present",
            checker=self._check_frontmatter_fields,
            severity=ValidationSeverity.ERROR,
        )
        self._rules["frontmatter-id-format"] = ValidationRule(
            name="frontmatter-id-format",
            description="Validate module ID format",
            checker=self._check_id_format,
            severity=ValidationSeverity.ERROR,
        )
        self._rules["frontmatter-version-format"] = ValidationRule(
            name="frontmatter-version-format",
            description="Validate semantic versioning",
            checker=self._check_version_format,
            severity=ValidationSeverity.ERROR,
        )
        self._rules["section-required-purpose"] = ValidationRule(
            name="section-required-purpose",
            description="Ensure Purpose section exists",
            checker=self._check_purpose_section,
            severity=ValidationSeverity.WARNING,
        )
        self._rules["section-standard-names"] = ValidationRule(
            name="section-standard-names",
            description="Check section names are standard MAM sections",
            checker=self._check_section_names,
            severity=ValidationSeverity.INFO,
        )
        self._rules["section-order"] = ValidationRule(
            name="section-order",
            description="Check section ordering matches recommended order",
            checker=self._check_section_order,
            severity=ValidationSeverity.INFO,
        )
        self._rules["code-block-language"] = ValidationRule(
            name="code-block-language",
            description="Validate code block language annotations",
            checker=self._check_code_languages,
            severity=ValidationSeverity.WARNING,
        )
        self._rules["code-block-executable"] = ValidationRule(
            name="code-block-executable",
            description="Check that code sections have executable blocks",
            checker=self._check_executable_code,
            severity=ValidationSeverity.INFO,
        )
        self._rules["table-structure"] = ValidationRule(
            name="table-structure",
            description="Validate table column consistency",
            checker=self._check_table_structure,
            severity=ValidationSeverity.WARNING,
        )
        self._rules["inputs-outputs-table"] = ValidationRule(
            name="inputs-outputs-table",
            description="Validate Inputs/Outputs sections have proper tables",
            checker=self._check_io_tables,
            severity=ValidationSeverity.WARNING,
        )
        self._rules["dependencies-declared"] = ValidationRule(
            name="dependencies-declared",
            description="Check that external imports are declared in Dependencies",
            checker=self._check_dependencies_declared,
            severity=ValidationSeverity.WARNING,
        )
        self._rules["empty-section"] = ValidationRule(
            name="empty-section",
            description="Flag sections with no meaningful content",
            checker=self._check_empty_section,
            severity=ValidationSeverity.WARNING,
        )

    def add_rule(self, rule: ValidationRule) -> None:
        self._rules[rule.name] = rule

    def remove_rule(self, name: str) -> Optional[ValidationRule]:
        return self._rules.pop(name, None)

    def get_rule(self, name: str) -> Optional[ValidationRule]:
        return self._rules.get(name)

    def list_rules(self) -> List[str]:
        return list(self._rules.keys())

    def enable_rule(self, name: str) -> bool:
        rule = self._rules.get(name)
        if rule:
            rule.enabled = True
            return True
        return False

    def disable_rule(self, name: str) -> bool:
        rule = self._rules.get(name)
        if rule:
            rule.enabled = False
            return True
        return False

    def validate(self, ast: AST) -> List[ValidationIssue]:
        issues: List[ValidationIssue] = []

        if ast.frontmatter.data:
            for rule in self._rules.values():
                if not rule.enabled:
                    continue
                section = Section(name="__frontmatter__", raw_content=ast.frontmatter.raw)
                rule_issues = rule.check(section, ast)
                issues.extend(rule_issues)

        for section in ast.sections:
            for rule in self._rules.values():
                if not rule.enabled:
                    continue
                rule_issues = rule.check(section, ast)
                issues.extend(rule_issues)

        if self.strict:
            for issue in issues:
                if issue.severity <= ValidationSeverity.WARNING:
                    issue.severity = ValidationSeverity.ERROR

        return issues

    def validate_section(self, section: Section, ast: AST) -> List[ValidationIssue]:
        issues: List[ValidationIssue] = []
        for rule in self._rules.values():
            if not rule.enabled:
                continue
            rule_issues = rule.check(section, ast)
            issues.extend(rule_issues)
        return issues

    def _check_frontmatter_fields(
        self, section: Section, ast: AST
    ) -> List[ValidationIssue]:
        issues: List[ValidationIssue] = []
        fm = ast.frontmatter

        required_fields = ["id", "version", "name", "author", "runtime"]
        for field_name in required_fields:
            if not fm.get(field_name):
                issues.append(
                    ValidationIssue(
                        message=f"Missing required front matter field: '{field_name}'",
                        severity=ValidationSeverity.ERROR,
                        rule="frontmatter-required-fields",
                        section="__frontmatter__",
                    )
                )

        tags = fm.get("tags")
        if tags is not None and not isinstance(tags, list):
            issues.append(
                ValidationIssue(
                    message="Field 'tags' must be a list",
                    severity=ValidationSeverity.ERROR,
                    rule="frontmatter-required-fields",
                    section="__frontmatter__",
                )
            )

        deps = fm.get("dependencies")
        if deps is not None and not isinstance(deps, list):
            issues.append(
                ValidationIssue(
                    message="Field 'dependencies' must be a list",
                    severity=ValidationSeverity.ERROR,
                    rule="frontmatter-required-fields",
                    section="__frontmatter__",
                )
            )

        perms = fm.get("permissions")
        if perms is not None and not isinstance(perms, list):
            issues.append(
                ValidationIssue(
                    message="Field 'permissions' must be a list",
                    severity=ValidationSeverity.ERROR,
                    rule="frontmatter-required-fields",
                    section="__frontmatter__",
                )
            )

        return issues

    def _check_id_format(
        self, section: Section, ast: AST
    ) -> List[ValidationIssue]:
        issues: List[ValidationIssue] = []
        fm_id = ast.frontmatter.id
        if fm_id and not VALID_ID_PATTERN.match(str(fm_id)):
            issues.append(
                ValidationIssue(
                    message=(
                        f"Invalid module id '{fm_id}': must match "
                        "^[a-z][a-z0-9-]{0,63}$"
                    ),
                    severity=ValidationSeverity.ERROR,
                    rule="frontmatter-id-format",
                    section="__frontmatter__",
                    suggestion="Use lowercase letters, numbers, and hyphens only",
                )
            )
        return issues

    def _check_version_format(
        self, section: Section, ast: AST
    ) -> List[ValidationIssue]:
        issues: List[ValidationIssue] = []
        version = ast.frontmatter.version
        if version and not SEMVER_PATTERN.match(str(version)):
            issues.append(
                ValidationIssue(
                    message=f"Invalid version '{version}': must follow SemVer 2.0.0",
                    severity=ValidationSeverity.ERROR,
                    rule="frontmatter-version-format",
                    section="__frontmatter__",
                    suggestion="Use MAJOR.MINOR.PATCH format",
                )
            )
        return issues

    def _check_purpose_section(
        self, section: Section, ast: AST
    ) -> List[ValidationIssue]:
        issues: List[ValidationIssue] = []
        if section.name == "__frontmatter__":
            purpose_found = any(
                s.name == SectionType.PURPOSE.value for s in ast.sections
            )
            if not purpose_found:
                issues.append(
                    ValidationIssue(
                        message="Missing required 'Purpose' section",
                        severity=ValidationSeverity.WARNING,
                        rule="section-required-purpose",
                        suggestion="Add a '## Purpose' section describing the module",
                    )
                )
        return issues

    def _check_section_names(
        self, section: Section, ast: AST
    ) -> List[ValidationIssue]:
        issues: List[ValidationIssue] = []
        if section.name == "__frontmatter__":
            return issues
        standard_names = [s.value for s in SectionType]
        if section.name not in standard_names:
            issues.append(
                ValidationIssue(
                    message=(
                        f"Non-standard section name '{section.name}': "
                        f"standard sections are {standard_names}"
                    ),
                    severity=ValidationSeverity.INFO,
                    rule="section-standard-names",
                    section=section.name,
                    suggestion=(
                        "Consider using a standard section name or "
                        "ensure this is intentional"
                    ),
                )
            )
        return issues

    def _check_section_order(
        self, section: Section, ast: AST
    ) -> List[ValidationIssue]:
        issues: List[ValidationIssue] = []
        if section.name == "__frontmatter__":
            return issues
        try:
            current_idx = STANDARD_SECTIONS_ORDER.index(section.name)
        except ValueError:
            return issues

        for other in ast.sections:
            if other.name == "__frontmatter__":
                continue
            try:
                other_idx = STANDARD_SECTIONS_ORDER.index(other.name)
            except ValueError:
                continue
            if other_idx < current_idx:
                other_actual = [s.name for s in ast.sections].index(other.name)
                current_actual = [s.name for s in ast.sections].index(section.name)
                if other_actual > current_actual:
                    issues.append(
                        ValidationIssue(
                            message=(
                                f"Section '{section.name}' appears before "
                                f"'{other.name}' (recommended order: "
                                f"{other.name} before {section.name})"
                            ),
                            severity=ValidationSeverity.INFO,
                            rule="section-order",
                            section=section.name,
                        )
                    )
                    break

        return issues

    def _check_code_languages(
        self, section: Section, ast: AST
    ) -> List[ValidationIssue]:
        issues: List[ValidationIssue] = []
        for block in section.code_blocks:
            if not block.language:
                issues.append(
                    ValidationIssue(
                        message="Code block missing language annotation",
                        severity=ValidationSeverity.WARNING,
                        rule="code-block-language",
                        section=section.name,
                        line=block.location.line if block.location else None,
                        suggestion="Add a language tag (e.g., ```python)",
                    )
                )
            elif block.language.lower() == "mermaid":
                pass
            elif block.language.lower() not in (
                "python", "javascript", "js", "typescript", "ts",
                "rust", "go", "ruby", "java", "bash", "shell",
                "json", "yaml", "markdown", "text", "mermaid",
                "sql", "html", "css",
            ):
                issues.append(
                    ValidationIssue(
                        message=f"Uncommon code language: '{block.language}'",
                        severity=ValidationSeverity.INFO,
                        rule="code-block-language",
                        section=section.name,
                        line=block.location.line if block.location else None,
                    )
                )
        return issues

    def _check_executable_code(
        self, section: Section, ast: AST
    ) -> List[ValidationIssue]:
        issues: List[ValidationIssue] = []
        if section.name in CODE_SECTION_NAMES and not section.code_blocks:
            issues.append(
                ValidationIssue(
                    message=(
                        f"Section '{section.name}' has no code blocks"
                    ),
                    severity=ValidationSeverity.INFO,
                    rule="code-block-executable",
                    section=section.name,
                )
            )
        return issues

    def _check_table_structure(
        self, section: Section, ast: AST
    ) -> List[ValidationIssue]:
        issues: List[ValidationIssue] = []
        for table in section.tables:
            expected_cols = len(table.headers)
            if expected_cols == 0:
                issues.append(
                    ValidationIssue(
                        message="Table has no headers",
                        severity=ValidationSeverity.WARNING,
                        rule="table-structure",
                        section=section.name,
                    )
                )
                continue
            for i, row in enumerate(table.rows):
                if len(row.cells) != expected_cols:
                    issues.append(
                        ValidationIssue(
                            message=(
                                f"Table row {i + 1} has {len(row.cells)} columns, "
                                f"expected {expected_cols}"
                            ),
                            severity=ValidationSeverity.WARNING,
                            rule="table-structure",
                            section=section.name,
                        )
                    )
        return issues

    def _check_io_tables(
        self, section: Section, ast: AST
    ) -> List[ValidationIssue]:
        issues: List[ValidationIssue] = []
        if section.name not in (SectionType.INPUTS.value, SectionType.OUTPUTS.value):
            return issues
        if not section.tables:
            issues.append(
                ValidationIssue(
                    message=(
                        f"Section '{section.name}' should contain a table "
                        "defining parameters"
                    ),
                    severity=ValidationSeverity.WARNING,
                    rule="inputs-outputs-table",
                    section=section.name,
                )
            )
            return issues

        table = section.tables[0]
        if section.name == SectionType.INPUTS.value:
            expected_headers = {"name", "type", "required", "description"}
        else:
            expected_headers = {"name", "type", "description"}

        actual_headers = {h.lower().strip() for h in table.headers}
        missing = expected_headers - actual_headers
        if missing:
            issues.append(
                ValidationIssue(
                    message=(
                        f"Section '{section.name}' table missing columns: "
                        f"{sorted(missing)}"
                    ),
                    severity=ValidationSeverity.WARNING,
                    rule="inputs-outputs-table",
                    section=section.name,
                )
            )
        return issues

    def _check_dependencies_declared(
        self, section: Section, ast: AST
    ) -> List[ValidationIssue]:
        issues: List[ValidationIssue] = []
        if not section.code_blocks:
            return issues

        declared_deps = set(ast.frontmatter.dependencies)
        for block in section.code_blocks:
            if block.language.lower() == "python":
                imports = PYTHON_IMPORT_PATTERN.findall(block.code)
                for imp in imports:
                    parts = imp.strip().split()
                    if parts[0] == "from":
                        pkg = parts[1].split(".")[0]
                    elif parts[0] == "import":
                        pkg = parts[1].split(".")[0].split(",")[0]
                    else:
                        continue
                    if EXTERNAL_DEPENDENCY_PATTERN.match(pkg) and pkg not in declared_deps:
                        issues.append(
                            ValidationIssue(
                                message=(
                                    f"Import '{pkg}' in code not declared in "
                                    "front matter dependencies"
                                ),
                                severity=ValidationSeverity.WARNING,
                                rule="dependencies-declared",
                                section=section.name,
                                suggestion=(
                                    f"Add '{pkg}' to the dependencies list "
                                    "in front matter"
                                ),
                            )
                        )
            elif block.language.lower() in ("javascript", "js"):
                imports = JAVASCRIPT_IMPORT_PATTERN.findall(block.code)
                for imp in imports:
                    match = re.search(r"['\"]([^'\"]+)['\"]", imp)
                    if match:
                        pkg = match.group(1).split("/")[0]
                        if pkg.startswith("@"):
                            pkg = "/".join(pkg.split("/")[:2])
                        if EXTERNAL_DEPENDENCY_PATTERN.match(pkg) and pkg not in declared_deps:
                            issues.append(
                                ValidationIssue(
                                    message=(
                                        f"Import '{pkg}' in code not declared in "
                                        "front matter dependencies"
                                    ),
                                    severity=ValidationSeverity.WARNING,
                                    rule="dependencies-declared",
                                    section=section.name,
                                    suggestion=(
                                        f"Add '{pkg}' to the dependencies list "
                                        "in front matter"
                                    ),
                                )
                            )
        return issues

    def _check_empty_section(
        self, section: Section, ast: AST
    ) -> List[ValidationIssue]:
        issues: List[ValidationIssue] = []
        if section.name == "__frontmatter__":
            return issues
        content = section.raw_content.strip()
        if not content:
            issues.append(
                ValidationIssue(
                    message=f"Section '{section.name}' is empty",
                    severity=ValidationSeverity.WARNING,
                    rule="empty-section",
                    section=section.name,
                    suggestion="Add content or remove the empty section",
                )
            )
        return issues


def validate(ast: AST, strict: bool = False) -> List[ValidationIssue]:
    """Validate a parsed MAM AST and return all issues found.

    This is the primary entry point for validation. It runs all built-in
    rules plus any custom rules that have been registered.

    Args:
        ast: The parsed MAM AST to validate.
        strict: If True, upgrade warnings to errors.

    Returns:
        List of ValidationIssue objects, sorted by severity.

    Example::

        from mam.parser import parse_mam
        from mam.validator import validate

        result = parse_mam(content)
        issues = validate(result.ast)
        errors = [i for i in issues if i.severity >= ValidationSeverity.ERROR]
    """
    validator = MAMValidator(strict=strict)
    issues = validator.validate(ast)
    issues.sort(key=lambda i: i.severity, reverse=True)
    return issues


def count_issues_by_severity(issues: List[ValidationIssue]) -> Dict[str, int]:
    """Count issues keyed by severity name.

    Every known severity is present in the result, using 0 when absent, so
    callers can rely on the shape of the mapping.
    """

    counts: Dict[str, int] = {}
    for severity in ValidationSeverity:
        counts[severity.to_string()] = 0
    for issue in issues:
        key = issue.severity.to_string()
        counts[key] = counts.get(key, 0) + 1
    return counts


def has_errors(issues: List[ValidationIssue]) -> bool:
    """Return True when any issue is at least as severe as ``error``."""

    return any(issue.severity >= ValidationSeverity.ERROR for issue in issues)


def has_warnings(issues: List[ValidationIssue]) -> bool:
    """Return True when any issue is at least as severe as ``warning``.

    Errors and criticals also satisfy this predicate.
    """

    return any(issue.severity >= ValidationSeverity.WARNING for issue in issues)


def filter_by_severity(
    issues: List[ValidationIssue], severity: ValidationSeverity
) -> List[ValidationIssue]:
    """Return only the issues with exactly the requested severity."""

    return [issue for issue in issues if issue.severity == severity]


def issue_messages(issues: List[ValidationIssue]) -> List[str]:
    """Return the messages of the issues, in order."""

    return [issue.message for issue in issues]


def is_valid(issues: List[ValidationIssue]) -> bool:
    """Return True when no issue is at ``error`` severity or above."""

    return not has_errors(issues)


def summarize_issues(issues: List[ValidationIssue]) -> str:
    """Return a one-line count summary, pluralized correctly."""

    if not issues:
        return "no issues"
    counts = count_issues_by_severity(issues)
    parts: List[str] = []
    for severity in (
        ValidationSeverity.CRITICAL,
        ValidationSeverity.ERROR,
        ValidationSeverity.WARNING,
        ValidationSeverity.INFO,
    ):
        count = counts.get(severity.to_string(), 0)
        if not count:
            continue
        label = severity.to_string()
        parts.append(f"{count} {label}" + ("s" if count != 1 else ""))
    return ", ".join(parts)


__all__ = [
    "validate",
    "MAMValidator",
    "ValidationSeverity",
    "ValidationIssue",
    "ValidationRule",
    "count_issues_by_severity",
    "filter_by_severity",
    "has_errors",
    "has_warnings",
    "is_valid",
    "issue_messages",
    "summarize_issues",
]
