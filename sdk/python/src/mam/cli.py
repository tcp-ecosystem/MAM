"""
MAM CLI for Python.

Command-line interface for parsing, validating, executing, and inspecting
MAM modules using argparse.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import List, Optional

from importlib.metadata import version as _get_version

from .ast import MAMModule, ParseResult

try:
    __version__ = _get_version("mam-sdk")
except Exception:
    __version__ = "0.2.0"
from .parser import parse_mam
from .runtime import ExecutionConfig, MAMRuntime, execute
from .validator import MAMValidator, ValidationSeverity, validate

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


def _format_validation_result(issues: list) -> str:  # type: ignore
    if not issues:
        return "Validation passed: no issues found."

    lines: List[str] = []
    lines.append(f"Validation issues: {len(issues)}")
    lines.append("")

    by_severity: dict = {}  # type: ignore
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


def _format_execution_result(results: dict) -> str:  # type: ignore
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


if __name__ == "__main__":
    main()
