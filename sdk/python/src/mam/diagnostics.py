"""
Environment Diagnostics for Python.

Performs self-checks on the MAM SDK installation: verifies that required
dependencies import cleanly, reports the availability of language runtimes the
SDK can execute, validates the resolved SDK configuration, and summarizes the
overall health of the environment.

Example::

    from mam.diagnostics import run_diagnostics

    report = run_diagnostics()
    if not report.ok:
        print(report.format())
"""

from __future__ import annotations

import importlib
import os
import platform
import shutil
import sys
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

__all__ = [
    "DiagnosticStatus",
    "DiagnosticCheck",
    "DiagnosticReport",
    "REQUIRED_MODULES",
    "LANGUAGE_COMMANDS",
    "check_imports",
    "check_language_runtimes",
    "check_python_version",
    "check_sdk_config",
    "run_diagnostics",
    "format_diagnostics",
]

MIN_PYTHON_VERSION = (3, 10)


class DiagnosticStatus:
    """Status constants used by diagnostic checks."""

    OK = "ok"
    WARN = "warn"
    FAIL = "fail"

    ORDER = [OK, WARN, FAIL]


REQUIRED_MODULES: List[str] = ["yaml"]

LANGUAGE_COMMANDS: Dict[str, List[str]] = {
    "python": [sys.executable] if sys.executable else ["python3"],
    "node": ["node"],
    "typescript": ["npx", "tsc"],
    "rust": ["cargo"],
    "go": ["go"],
    "shell": ["bash"],
}


@dataclass
class DiagnosticCheck:
    """A single diagnostic result."""

    name: str
    status: str
    message: str
    details: Dict[str, Any] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        """Return True when the check did not fail."""

        return self.status != DiagnosticStatus.FAIL

    def to_dict(self) -> Dict[str, Any]:
        """Return the check as a plain dictionary."""

        return {
            "name": self.name,
            "status": self.status,
            "message": self.message,
            "details": dict(self.details),
        }


@dataclass
class DiagnosticReport:
    """The aggregate result of a diagnostics run."""

    checks: List[DiagnosticCheck] = field(default_factory=list)

    @property
    def failures(self) -> List[DiagnosticCheck]:
        """Return the checks that failed."""

        return [check for check in self.checks if check.status == DiagnosticStatus.FAIL]

    @property
    def warnings(self) -> List[DiagnosticCheck]:
        """Return the checks that warned."""

        return [check for check in self.checks if check.status == DiagnosticStatus.WARN]

    @property
    def ok(self) -> bool:
        """Return True when no check failed."""

        return not self.failures

    @property
    def status(self) -> str:
        """Return the worst status across all checks."""

        if self.failures:
            return DiagnosticStatus.FAIL
        if self.warnings:
            return DiagnosticStatus.WARN
        return DiagnosticStatus.OK

    def add(self, check: DiagnosticCheck) -> DiagnosticReport:
        """Append a check and return the report."""

        self.checks.append(check)
        return self

    def to_dict(self) -> Dict[str, Any]:
        """Return the report as a plain dictionary."""

        return {
            "status": self.status,
            "ok": self.ok,
            "checks": [check.to_dict() for check in self.checks],
        }

    def format(self) -> str:
        """Render the report as readable text."""

        return format_diagnostics(self)


def check_python_version(minimum: Optional[Any] = None) -> DiagnosticCheck:
    """Check that the interpreter is new enough to run the SDK."""

    required = tuple(minimum) if minimum else MIN_PYTHON_VERSION
    current = sys.version_info[:3]
    text = ".".join(str(part) for part in current)
    if current[:2] < required[:2]:
        wanted = ".".join(str(part) for part in required)
        return DiagnosticCheck(
            name="python-version",
            status=DiagnosticStatus.FAIL,
            message=f"Python {text} is too old; {wanted} or newer is required",
            details={"current": text, "required": wanted},
        )
    return DiagnosticCheck(
        name="python-version",
        status=DiagnosticStatus.OK,
        message=f"Python {text}",
        details={"current": text, "required": ".".join(str(p) for p in required)},
    )


def check_imports(modules: Optional[List[str]] = None) -> List[DiagnosticCheck]:
    """Check that each required module imports successfully."""

    results: List[DiagnosticCheck] = []
    for name in modules if modules is not None else REQUIRED_MODULES:
        try:
            imported = importlib.import_module(name)
        except Exception as exc:  # noqa: BLE001
            results.append(
                DiagnosticCheck(
                    name=f"import:{name}",
                    status=DiagnosticStatus.FAIL,
                    message=f"Could not import '{name}': {exc}",
                    details={"module": name},
                )
            )
            continue
        version = getattr(imported, "__version__", "unknown")
        results.append(
            DiagnosticCheck(
                name=f"import:{name}",
                status=DiagnosticStatus.OK,
                message=f"'{name}' available ({version})",
                details={"module": name, "version": str(version)},
            )
        )
    return results


def check_language_runtimes(
    languages: Optional[List[str]] = None, require_all: bool = False
) -> List[DiagnosticCheck]:
    """Check whether the commands for each target language are on PATH.

    Args:
        languages: Languages to check; defaults to every known target.
        require_all: When True, a missing command is a failure rather than a
            warning.
    """

    results: List[DiagnosticCheck] = []
    selected = languages if languages is not None else sorted(LANGUAGE_COMMANDS)
    for language in selected:
        candidates = LANGUAGE_COMMANDS.get(language, [language])
        found: Optional[str] = None
        for candidate in candidates:
            executable = candidate if os.path.isabs(candidate) else shutil.which(candidate)
            if executable:
                found = executable
                break
        if found:
            results.append(
                DiagnosticCheck(
                    name=f"runtime:{language}",
                    status=DiagnosticStatus.OK,
                    message=f"{language} runtime found at {found}",
                    details={"language": language, "path": found},
                )
            )
            continue
        status = DiagnosticStatus.FAIL if require_all else DiagnosticStatus.WARN
        results.append(
            DiagnosticCheck(
                name=f"runtime:{language}",
                status=status,
                message=f"{language} runtime not found (looked for {', '.join(candidates)})",
                details={"language": language, "candidates": candidates},
            )
        )
    return results


def check_sdk_config(work_dir: Optional[str] = None) -> DiagnosticCheck:
    """Check that the resolved SDK configuration loads and validates."""

    from .config import (
        find_sdk_config,
        load_sdk_config,
        resolve_sdk_config_path,
        validate_sdk_config,
    )

    try:
        path = resolve_sdk_config_path(work_dir)
    except Exception as exc:  # noqa: BLE001
        return DiagnosticCheck(
            name="sdk-config",
            status=DiagnosticStatus.FAIL,
            message=f"Could not resolve the SDK config path: {exc}",
        )

    if not path.is_file():
        discovered = find_sdk_config()
        return DiagnosticCheck(
            name="sdk-config",
            status=DiagnosticStatus.OK,
            message=f"No SDK config at {path}; using defaults",
            details={"path": str(path), "discovered": str(discovered) if discovered else None},
        )

    try:
        config = load_sdk_config(str(path))
    except Exception as exc:  # noqa: BLE001
        return DiagnosticCheck(
            name="sdk-config",
            status=DiagnosticStatus.FAIL,
            message=f"SDK config at {path} could not be loaded: {exc}",
            details={"path": str(path)},
        )

    problems = validate_sdk_config(config)
    if problems:
        return DiagnosticCheck(
            name="sdk-config",
            status=DiagnosticStatus.FAIL,
            message="; ".join(problems),
            details={"path": str(path), "problems": problems},
        )
    return DiagnosticCheck(
        name="sdk-config",
        status=DiagnosticStatus.OK,
        message=f"SDK config loaded from {path}",
        details={"path": str(path), "target": config.target},
    )


def check_environment() -> DiagnosticCheck:
    """Report basic interpreter and platform information."""

    details = {
        "executable": sys.executable,
        "platform": platform.platform(),
        "cwd": os.getcwd(),
    }
    return DiagnosticCheck(
        name="environment",
        status=DiagnosticStatus.OK,
        message=f"Python {platform.python_version()} on {platform.system()}",
        details=details,
    )


def run_diagnostics(
    languages: Optional[List[str]] = None,
    work_dir: Optional[str] = None,
    require_all_runtimes: bool = False,
) -> DiagnosticReport:
    """Run every diagnostic check and return the aggregate report."""

    report = DiagnosticReport()
    report.add(check_python_version())
    report.add(check_environment())
    for check in check_imports():
        report.add(check)
    report.add(check_sdk_config(work_dir))
    for check in check_language_runtimes(languages, require_all=require_all_runtimes):
        report.add(check)
    return report


def format_diagnostics(report: DiagnosticReport) -> str:
    """Render a diagnostics report as readable text."""

    if not report.checks:
        return "No diagnostics were run."

    width = max(len(check.name) for check in report.checks)
    symbols = {
        DiagnosticStatus.OK: "PASS",
        DiagnosticStatus.WARN: "WARN",
        DiagnosticStatus.FAIL: "FAIL",
    }
    lines = [f"MAM SDK diagnostics: {report.status.upper()}"]
    for check in report.checks:
        symbol = symbols.get(check.status, check.status.upper())
        lines.append(f"[{symbol}] {check.name.ljust(width)}  {check.message}")
    lines.append("")
    lines.append(
        f"{len(report.checks)} checks, "
        f"{len(report.failures)} failed, "
        f"{len(report.warnings)} warnings"
    )
    return "\n".join(lines)
