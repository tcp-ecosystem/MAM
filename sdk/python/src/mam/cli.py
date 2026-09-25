"""
MAM CLI for Python.

Command-line interface for parsing, validating, executing, and inspecting
MAM modules using argparse.
"""

from __future__ import annotations

import argparse
import json
import sys
from importlib.metadata import version as _get_version
from pathlib import Path
from typing import Any, List, Optional

from .ast import MAMModule, ParseResult

try:
    __version__ = _get_version("mam-sdk")
except Exception:
    __version__ = "0.2.0"
from .parser import parse_mam
from .runtime import ExecutionConfig, execute
from .validator import ValidationSeverity, validate

__all__ = ["main"]

DESCRIPTION = "MAM Python SDK — Parse, validate, and execute MAM modules."


def _read_file(path: str) -> str:
    p = Path(path)
    if not p.exists():
        print(f"Error: file not found: {path}", file=sys.stderr)
        sys.exit(1)
    if not p.is_file():
        print(f"Error: not a file: {path}", file=sys.stderr)
        sys.exit(1)
    return p.read_text(encoding="utf-8")


def _write_output(content: str, output: Optional[str] = None) -> None:
    if output:
        Path(output).write_text(content, encoding="utf-8")
    else:
        print(content)


def cmd_parse(args: argparse.Namespace) -> None:
    content = _read_file(args.file)
    source = args.file if args.file != "-" else None

    if args.file == "-":
        content = sys.stdin.read()

    result = parse_mam(content, source=source, strict=args.strict)

    if args.json:
        output = result.to_json(indent=2)
    else:
        output = _format_parse_result(result)

    _write_output(output, args.output)

    if not result.success:
        sys.exit(1)


def cmd_validate(args: argparse.Namespace) -> None:
    content = _read_file(args.file)
    source = args.file if args.file != "-" else None

    result = parse_mam(content, source=source)
    if not result.success:
        for error in result.errors:
            print(f"[parse error] {error}", file=sys.stderr)
        sys.exit(1)

    issues = validate(result.ast, strict=args.strict)

    if args.json:
        output = json.dumps(
            [i.to_dict() for i in issues], indent=2, ensure_ascii=False
        )
    else:
        output = _format_validation_result(issues)

    _write_output(output, args.output)

    has_errors = any(i.severity >= ValidationSeverity.ERROR for i in issues)
    if has_errors:
        sys.exit(1)


def cmd_execute(args: argparse.Namespace) -> None:
    content = _read_file(args.file)
    source = args.file if args.file != "-" else None

    result = parse_mam(content, source=source)
    if not result.success:
        for error in result.errors:
            print(f"[parse error] {error}", file=sys.stderr)
        sys.exit(1)

    config = ExecutionConfig(
        timeout_seconds=args.timeout,
        working_directory=args.workdir,
    )

    exec_results = execute(result.ast.to_dict(), config=config)

    if args.json:
        output = json.dumps(exec_results, indent=2, ensure_ascii=False)
    else:
        output = _format_execution_result(exec_results)

    _write_output(output, args.output)

    if not exec_results["success"]:
        sys.exit(1)


def cmd_info(args: argparse.Namespace) -> None:
    content = _read_file(args.file)
    source = args.file if args.file != "-" else None

    result = parse_mam(content, source=source)
    if not result.success:
        for error in result.errors:
            print(f"[parse error] {error}", file=sys.stderr)
        sys.exit(1)

    module = MAMModule.from_ast(result.ast)

    if args.json:
        output = module.to_json(indent=2)
    else:
        output = _format_module_info(module, result)

    _write_output(output, args.output)


def _format_parse_result(result: ParseResult) -> str:
    lines: List[str] = []
    fm = result.ast.frontmatter
    if fm.data:
        lines.append("Front Matter:")
        for k, v in fm.data.items():
            lines.append(f"  {k}: {v}")
    else:
        lines.append("Front Matter: (none)")

    lines.append("")
    lines.append(f"Sections: {len(result.ast.sections)}")
    for section in result.ast.sections:
        code_count = len(section.code_blocks)
        table_count = len(section.tables)
        extras = []
        if code_count:
            extras.append(f"{code_count} code block(s)")
        if table_count:
            extras.append(f"{table_count} table(s)")
        suffix = f" ({', '.join(extras)})" if extras else ""
        lines.append(f"  {'#' * section.level} {section.name}{suffix}")

    lines.append("")
    lines.append(f"Parse time: {result.parse_time_ms:.2f}ms")

    if result.errors:
        lines.append("")
        lines.append(f"Errors: {len(result.errors)}")
        for error in result.errors:
            lines.append(f"  {error}")

    if result.warnings:
        lines.append("")
        lines.append(f"Warnings: {len(result.warnings)}")
        for warning in result.warnings:
            lines.append(f"  {warning}")

    return "\n".join(lines)


def _format_validation_result(issues: list) -> str:
    if not issues:
        return "Validation passed: no issues found."

    lines: List[str] = []
    lines.append(f"Validation issues: {len(issues)}")
    lines.append("")

    by_severity: dict = {}
    for issue in issues:
        sev = issue.severity.to_string()
        by_severity.setdefault(sev, []).append(issue)

    for sev_name in ("critical", "error", "warning", "info"):
        group = by_severity.get(sev_name, [])
        if group:
            lines.append(f"[{sev_name.upper()}] ({len(group)})")
            for issue in group:
                lines.append(f"  {issue}")
            lines.append("")

    return "\n".join(lines)


def _format_execution_result(results: dict) -> str:
    lines: List[str] = []
    success = results["success"]
    lines.append(f"Execution: {'SUCCESS' if success else 'FAILED'}")
    lines.append(f"Total time: {results['total_time_ms']:.2f}ms")
    lines.append("")

    for section_name, section_results in results["results"].items():
        lines.append(f"Section: {section_name}")
        for i, res in enumerate(section_results):
            status = res["status"]
            lang = res["language"]
            time_ms = res.get("execution_time_ms", 0)
            lines.append(f"  Block {i + 1} [{lang}]: {status} ({time_ms:.1f}ms)")
            if res.get("stdout"):
                for line in res["stdout"].strip().split("\n"):
                    lines.append(f"    {line}")
            if res.get("stderr"):
                for line in res["stderr"].strip().split("\n"):
                    lines.append(f"    [err] {line}")
            if res.get("error_message"):
                lines.append(f"    Error: {res['error_message']}")
        lines.append("")

    return "\n".join(lines)


def _format_module_info(module: MAMModule, result: ParseResult) -> str:
    lines: List[str] = []
    lines.append(f"Module: {module.name}")
    lines.append(f"Version: {module.version}")
    if module.author:
        lines.append(f"Author: {module.author}")
    if module.runtime:
        lines.append(f"Runtime: {module.runtime}")
    if module.description:
        lines.append(f"Description: {module.description}")
    if module.tags:
        lines.append(f"Tags: {', '.join(module.tags)}")
    if module.dependencies:
        lines.append(f"Dependencies: {', '.join(module.dependencies)}")
    if module.permissions:
        lines.append(f"Permissions: {', '.join(module.permissions)}")

    lines.append("")
    lines.append(f"Sections ({len(module.sections)}):")
    for section in module.sections:
        lines.append(f"  - {section.name}")

    code_blocks = result.ast.all_code_blocks
    if code_blocks:
        lines.append("")
        lines.append(f"Code blocks ({len(code_blocks)}):")
        for block in code_blocks:
            lang = block.language or "unknown"
            lines.append(f"  - [{lang}] ({len(block.code.splitlines())} lines)")

    if result.errors:
        lines.append("")
        lines.append(f"Parse errors: {len(result.errors)}")
    if result.warnings:
        lines.append("")
        lines.append(f"Parse warnings: {len(result.warnings)}")

    return "\n".join(lines)


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="mam",
        description=DESCRIPTION,
    )
    parser.add_argument(
        "--version", action="version", version=f"%(prog)s {__version__}"
    )

    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    parse_parser = subparsers.add_parser("parse", help="Parse a MAM module")
    parse_parser.add_argument("file", help="MAM file to parse (or - for stdin)")
    parse_parser.add_argument("--json", action="store_true", help="Output as JSON")
    parse_parser.add_argument("--strict", action="store_true", help="Strict mode")
    parse_parser.add_argument("-o", "--output", help="Output file path")
    parse_parser.set_defaults(func=cmd_parse)

    validate_parser = subparsers.add_parser("validate", help="Validate a MAM module")
    validate_parser.add_argument("file", help="MAM file to validate (or - for stdin)")
    validate_parser.add_argument("--json", action="store_true", help="Output as JSON")
    validate_parser.add_argument("--strict", action="store_true", help="Strict mode")
    validate_parser.add_argument("-o", "--output", help="Output file path")
    validate_parser.set_defaults(func=cmd_validate)

    execute_parser = subparsers.add_parser("execute", help="Execute code in a MAM module")
    execute_parser.add_argument("file", help="MAM file to execute (or - for stdin)")
    execute_parser.add_argument("--json", action="store_true", help="Output as JSON")
    execute_parser.add_argument(
        "--timeout", type=float, default=30.0, help="Execution timeout (seconds)"
    )
    execute_parser.add_argument("--workdir", help="Working directory for execution")
    execute_parser.add_argument("-o", "--output", help="Output file path")
    execute_parser.set_defaults(func=cmd_execute)

    info_parser = subparsers.add_parser("info", help="Show module info")
    info_parser.add_argument("file", help="MAM file to inspect (or - for stdin)")
    info_parser.add_argument("--json", action="store_true", help="Output as JSON")
    info_parser.add_argument("-o", "--output", help="Output file path")
    info_parser.set_defaults(func=cmd_info)

    return parser


def main(args: Optional[List[str]] = None) -> None:
    """Entry point for the MAM CLI."""
    parser = _build_parser()
    parsed = parser.parse_args(args)

    if not parsed.command:
        parser.print_help()
        sys.exit(0)

    parsed.func(parsed)


def build_parser() -> argparse.ArgumentParser:
    """Return the fully configured MAM argument parser.

    Public counterpart of the internal builder, so embedders can reuse the CLI
    definition in their own applications.
    """

    return _build_parser()


def run(args: Optional[List[str]] = None) -> int:
    """Run the CLI and return a process exit code instead of exiting.

    Returns 0 on success, 1 on a handled failure, and 2 for a usage error.
    This makes the CLI straightforward to embed and to test.
    """

    parser = build_parser()
    try:
        parsed = parser.parse_args(args)
    except SystemExit as exc:
        code = exc.code
        if code is None:
            return 0
        if isinstance(code, int):
            return code
        return 2

    if not parsed.command:
        parser.print_help()
        return 0

    try:
        parsed.func(parsed)
    except SystemExit as exc:
        code = exc.code
        if code is None:
            return 0
        return code if isinstance(code, int) else 1
    except Exception as exc:  # noqa: BLE001
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    return 0


def exit_code_for(issues: Optional[List[Any]] = None, success: bool = True) -> int:
    """Map a validation or execution outcome to a CLI exit code.

    Returns 0 when everything is clean, 1 when errors are present, and 2 when
    the run failed outright.
    """

    if not success:
        return 2
    if not issues:
        return 0
    for issue in issues:
        severity = getattr(issue, "severity", None)
        if severity is None:
            continue
        if severity >= ValidationSeverity.ERROR:
            return 1
    return 0


def version_header(name: str = "mam-sdk") -> str:
    """Return a one-line banner naming the CLI and its version."""

    return f"{name} {__version__}"


def format_ast(result: ParseResult, indent: str = "  ") -> str:
    """Render a compact structural summary of a parsed module."""

    ast = result.ast
    lines: List[str] = []
    name = ast.frontmatter.name or ast.frontmatter.id or "(untitled)"
    lines.append(f"Module: {name}")
    if ast.frontmatter.version:
        lines.append(f"{indent}version: {ast.frontmatter.version}")
    if ast.frontmatter.runtime:
        lines.append(f"{indent}runtime: {ast.frontmatter.runtime}")
    lines.append(f"{indent}sections: {len(ast.sections)}")
    blocks = sum(len(section.code_blocks) for section in ast.sections)
    lines.append(f"{indent}code blocks: {blocks}")
    for section in ast.sections:
        lines.append(f"{indent}- {section.name} ({len(section.content_nodes)} nodes)")
    return "\n".join(lines)


def format_issues_compact(issues: List[Any], limit: int = 20) -> str:
    """Render validation issues as one line each, capped at ``limit`` entries."""

    if not issues:
        return "No issues found."
    lines: List[str] = []
    for issue in issues[:limit]:
        severity = getattr(issue, "severity", None)
        render = getattr(severity, "to_string", None)
        label = render() if callable(render) else str(severity)
        rule = getattr(issue, "rule", "") or "-"
        section = getattr(issue, "section", None)
        location = f" [{section}]" if section else ""
        lines.append(f"[{label}] ({rule}){location} {getattr(issue, 'message', '')}")
    remaining = len(issues) - limit
    if remaining > 0:
        lines.append(f"... and {remaining} more")
    return "\n".join(lines)


def format_module_summary(module: MAMModule) -> str:
    """Render a compact summary of a built MAMModule instance."""

    lines: List[str] = [f"Module: {module.name or '(untitled)'}"]
    lines.append(f"  version: {module.version}")
    lines.append(f"  runtime: {module.runtime}")
    if module.author:
        lines.append(f"  author: {module.author}")
    if module.tags:
        lines.append(f"  tags: {', '.join(module.tags)}")
    lines.append(f"  sections: {len(module.sections)}")
    return "\n".join(lines)


if __name__ == "__main__":
    main()


__all__ = [
    "main",
    "build_parser",
    "run",
    "exit_code_for",
    "version_header",
    "format_ast",
    "format_issues_compact",
    "format_module_summary",
]
