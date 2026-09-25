"""
Text Formatters for Python.

Renders parsed modules, validation issues, and execution results as
human-readable text. Every formatter is pure: it never mutates its input and
returns a string, so results are safe to print, log, or write to disk.

Example::

    from mam.format import format_module_summary, format_validation_report
    from mam.parser import parse_mam
    from mam.validator import validate

    result = parse_mam(content)
    print(format_module_summary(result.ast))
    print(format_validation_report(validate(result.ast)))
"""

from __future__ import annotations

import json
from typing import Any, Dict, List

from .ast import AST, MAMModule

__all__ = [
    "format_module_summary",
    "format_ast_json",
    "format_section_list",
    "format_validation_report",
    "format_execution_report",
    "format_code_block_list",
    "format_front_matter",
    "format_dependency_table",
    "format_toc",
    "format_built_module",
    "format_parse_errors",
]


def _node_type_name(node: Any) -> str:
    """Return the readable node type for a content node."""

    node_type = getattr(node, "type", None)
    if node_type is None:
        return "Unknown"
    value = getattr(node_type, "value", node_type)
    return str(value)


def format_module_summary(ast: AST) -> str:
    """Return a short summary of a parsed module.

    Reports the module identity, version, runtime, and content totals. Falls
    back to ``(untitled)`` when no name or id is declared.
    """

    name = ast.frontmatter.name or ast.frontmatter.id or "(untitled)"
    sections = len(ast.sections)
    blocks = sum(len(section.code_blocks) for section in ast.sections)
    lines = [
        f"Module: {name}",
        f"  version: {ast.frontmatter.version or '(none)'}",
        f"  runtime: {ast.frontmatter.runtime or '(none)'}",
        f"  sections: {sections}",
        f"  code blocks: {blocks}",
    ]
    if ast.frontmatter.author:
        lines.insert(2, f"  author: {ast.frontmatter.author}")
    if ast.errors:
        lines.append(f"  errors: {len(ast.errors)}")
    if ast.warnings:
        lines.append(f"  warnings: {len(ast.warnings)}")
    return "\n".join(lines)


def format_ast_json(ast: AST, indent: int = 2) -> str:
    """Return the AST as pretty-printed JSON."""

    return json.dumps(ast.to_dict(), indent=indent, ensure_ascii=False, default=str)


def format_section_list(ast: AST, show_types: bool = False) -> str:
    """Return a list of section names, optionally with their section types.

    Returns ``(no sections)`` for an empty module.
    """

    if not ast.sections:
        return "(no sections)"
    lines: List[str] = []
    for index, section in enumerate(ast.sections, start=1):
        entry = f"{index}. {section.name}"
        if show_types:
            section_type = section.section_type
            if section_type is not None:
                entry += f" [{getattr(section_type, 'value', section_type)}]"
        else:
            entry += f" ({len(section.content_nodes)} nodes)"
        lines.append(entry)
    return "\n".join(lines)


def format_validation_report(
    issues: List[Any], show_suggestions: bool = True, limit: int = 0
) -> str:
    """Return a grouped validation report.

    Args:
        issues: The validation issues to render.
        show_suggestions: Include the suggestion text when the issue has one.
        limit: Maximum issues to render per severity; 0 means no limit.
    """

    if not issues:
        return "No issues found."

    groups: Dict[str, List[Any]] = {}
    for issue in issues:
        severity = getattr(issue, "severity", None)
        render = getattr(severity, "to_string", None)
        label = render() if callable(render) else str(severity)
        groups.setdefault(label, []).append(issue)

    order = ["critical", "error", "warning", "info"]
    labels = list(groups.keys())
    labels.sort(key=lambda name: order.index(name) if name in order else len(order))

    lines: List[str] = []
    for label in labels:
        bucket = groups[label]
        shown = bucket if limit <= 0 else bucket[:limit]
        lines.append(f"{label.upper()} ({len(bucket)})")
        for issue in shown:
            rule = getattr(issue, "rule", "") or "-"
            section = getattr(issue, "section", None)
            location = f" [{section}]" if section else ""
            line = getattr(issue, "line", None)
            where = f"{location}:{line}" if line else location
            lines.append(f"  ({rule}){where} {getattr(issue, 'message', '')}".rstrip())
            suggestion = getattr(issue, "suggestion", None)
            if show_suggestions and suggestion:
                lines.append(f"    suggestion: {suggestion}")
        hidden = len(bucket) - len(shown)
        if hidden > 0:
            lines.append(f"  ... and {hidden} more")

    return "\n".join(lines)


def format_execution_report(result: Dict[str, Any], indent: str = "  ") -> str:
    """Render an execution payload returned by :func:`mam.runtime.execute`."""

    if not isinstance(result, dict):
        return "(no execution result)"

    success = bool(result.get("success"))
    state = "succeeded" if success else "failed"
    total = result.get("total_time_ms", 0.0)
    lines = [f"Execution {state} in {float(total):.1f} ms"]

    results = result.get("results", {})
    if not isinstance(results, dict) or not results:
        lines.append(f"{indent}(no code blocks executed)")
        return "\n".join(lines)

    for section_name, entries in results.items():
        if not isinstance(entries, list) or not entries:
            continue
        section_failures = [
            entry
            for entry in entries
            if isinstance(entry, dict) and entry.get("status") not in (None, "success", "skipped")
        ]
        marker = "FAILED" if section_failures else "ok"
        lines.append(f"{indent}{section_name} [{marker}]")
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            language = entry.get("language") or "unknown"
            status = entry.get("status") or "unknown"
            duration = float(entry.get("execution_time_ms", 0.0))
            lines.append(f"{indent}{indent}{language}: {status} ({duration:.1f} ms)")
            stdout = (entry.get("stdout") or "").rstrip()
            stderr = (entry.get("stderr") or "").rstrip()
            error = entry.get("error_message")
            if stdout:
                lines.append(f"{indent}{indent}{indent}stdout: {stdout}")
            if stderr:
                lines.append(f"{indent}{indent}{indent}stderr: {stderr}")
            if error:
                lines.append(f"{indent}{indent}{indent}error: {error}")

    return "\n".join(lines)


def format_code_block_list(ast: AST, show_preview: bool = False) -> str:
    """Return a list of code blocks with their language and size.

    Returns ``(no code blocks)`` when the module has none.
    """

    blocks = ast.all_code_blocks
    if not blocks:
        return "(no code blocks)"

    lines: List[str] = [f"Code blocks: {len(blocks)}"]
    for index, block in enumerate(blocks, start=1):
        language = block.language or "unknown"
        line_count = len(block.code.splitlines())
        entry = f"{index}. {language} ({line_count} lines)"
        if show_preview:
            first = block.code.strip().splitlines()
            entry += f" - {first[0] if first else ''}"
        lines.append(entry)

    counts: Dict[str, int] = {}
    for block in blocks:
        key = block.language or "unknown"
        counts[key] = counts.get(key, 0) + 1
    breakdown = ", ".join(f"{name}={count}" for name, count in sorted(counts.items()))
    lines.append(f"By language: {breakdown}")
    return "\n".join(lines)


def format_front_matter(frontmatter: Any, align: bool = True) -> str:
    """Render front matter fields as aligned key/value lines.

    Returns ``(no front matter)`` when the block has no fields.
    """

    data = getattr(frontmatter, "data", None)
    if not isinstance(data, dict) or not data:
        return "(no front matter)"

    width = max(len(str(key)) for key in data) if align else 0

    lines: List[str] = []
    for key in data:
        value = data[key]
        if isinstance(value, list):
            rendered = ", ".join(str(item) for item in value)
        elif isinstance(value, dict):
            rendered = json.dumps(value, sort_keys=True)
        else:
            rendered = str(value)
        label = str(key)
        lines.append(f"{label.ljust(width)}: {rendered}" if align else f"{label}: {rendered}")
    return "\n".join(lines)


def format_dependency_table(ast: AST) -> str:
    """Return a table of declared dependencies and their availability.

    Dependencies are grouped by prefix so that runtime, language, and external
    packages can be told apart at a glance.
    """

    dependencies = ast.frontmatter.dependencies
    if not dependencies:
        return "(no dependencies)"

    groups: Dict[str, List[str]] = {}
    for dependency in dependencies:
        name = str(dependency)
        if name.startswith("npm:"):
            key = "npm"
            value = name[4:]
        elif name.startswith("pip:"):
            key = "pip"
            value = name[4:]
        elif name.startswith("cargo:"):
            key = "cargo"
            value = name[6:]
        else:
            key = "other"
            value = name
        groups.setdefault(key, []).append(value)

    width = max(len(str(name)) for name in dependencies)
    lines: List[str] = ["Dependencies:"]
    for key in sorted(groups):
        for value in sorted(groups[key]):
            lines.append(f"  {str(value).ljust(width)}  [{key}]")
    lines.append(f"Total: {len(dependencies)}")
    return "\n".join(lines)


def format_toc(ast: AST, include_counts: bool = True) -> str:
    """Return a table of contents for the module.

    Args:
        ast: The parsed module.
        include_counts: Append the node count for each section.
    """

    if not ast.sections:
        return "(no sections)"

    lines: List[str] = ["Contents:"]
    for index, section in enumerate(ast.sections, start=1):
        entry = f"  {index}. {section.name}"
        if include_counts:
            entry += f" ({len(section.content_nodes)} nodes)"
        lines.append(entry)
    return "\n".join(lines)


def format_built_module(module: MAMModule) -> str:
    """Render a built :class:`~mam.ast.MAMModule` instance as a summary."""

    if not isinstance(module, MAMModule):
        return "(not a MAMModule)"
    lines = [
        f"Module: {module.name or '(untitled)'}",
        f"  version: {module.version}",
        f"  runtime: {module.runtime}",
        f"  sections: {len(module.sections)}",
    ]
    if module.author:
        lines.append(f"  author: {module.author}")
    if module.description:
        lines.append(f"  description: {module.description}")
    if module.tags:
        lines.append(f"  tags: {', '.join(module.tags)}")
    if module.dependencies:
        lines.append(f"  dependencies: {', '.join(module.dependencies)}")
    if module.permissions:
        lines.append(f"  permissions: {', '.join(module.permissions)}")
    if module.metadata:
        lines.append(f"  metadata keys: {', '.join(sorted(module.metadata))}")
    return "\n".join(lines)


def format_parse_errors(result: Any) -> str:
    """Render the errors and warnings of a parse result."""

    errors = list(getattr(result, "errors", []) or [])
    warnings = list(getattr(result, "warnings", []) or [])
    if not errors and not warnings:
        return "Parsed with no errors or warnings."

    lines: List[str] = []
    for label, bucket in (("error", errors), ("warning", warnings)):
        for item in bucket:
            message = getattr(item, "message", str(item))
            line = getattr(item, "line", None)
            where = f"line {line}" if line else "unknown line"
            lines.append(f"[{label}] {where}: {message}")
    return "\n".join(lines)
