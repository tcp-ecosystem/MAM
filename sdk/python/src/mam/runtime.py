"""
MAM Module Execution Runtime.

Provides secure subprocess-based execution of MAM code blocks with timeout
enforcement, environment injection, execution history tracking, and
comprehensive result reporting.
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import threading
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional

from .ast import AST, Section

__all__ = [
    "execute",
    "MAMRuntime",
    "ExecutionResult",
    "ExecutionConfig",
    "ExecutionContext",
    "ExecutionStatus",
]


class ExecutionStatus(Enum):
    """Status of a code block execution."""

    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    TIMEOUT = "timeout"
    SKIPPED = "skipped"
    ERROR = "error"

    def to_string(self) -> str:
        return self.value


@dataclass
class ExecutionConfig:
    """Configuration for runtime execution behavior."""

    timeout_seconds: float = 30.0
    max_output_bytes: int = 1024 * 1024
    working_directory: Optional[str] = None
    environment: Optional[Dict[str, str]] = None
    capture_stderr: bool = True
    shell: bool = False
    python_executable: Optional[str] = None
    node_executable: Optional[str] = None
    allowed_languages: Optional[List[str]] = None
    blocked_commands: Optional[List[str]] = None
    cleanup_temp_files: bool = True

    def to_dict(self) -> Dict[str, Any]:
        result: Dict[str, Any] = {
            "timeout_seconds": self.timeout_seconds,
            "max_output_bytes": self.max_output_bytes,
            "capture_stderr": self.capture_stderr,
            "shell": self.shell,
            "cleanup_temp_files": self.cleanup_temp_files,
        }
        if self.working_directory:
            result["working_directory"] = self.working_directory
        if self.environment:
            result["environment"] = dict(self.environment)
        if self.python_executable:
            result["python_executable"] = self.python_executable
        if self.node_executable:
            result["node_executable"] = self.node_executable
        if self.allowed_languages:
            result["allowed_languages"] = list(self.allowed_languages)
        if self.blocked_commands:
            result["blocked_commands"] = list(self.blocked_commands)
        return result


@dataclass
class ExecutionContext:
    """Runtime context for a single execution session."""

    module_id: str = "unknown"
    section_name: str = ""
    block_index: int = 0
    variables: Dict[str, Any] = field(default_factory=dict)
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        result: Dict[str, Any] = {
            "module_id": self.module_id,
            "section_name": self.section_name,
            "block_index": self.block_index,
        }
        if self.variables:
            result["variables"] = dict(self.variables)
        if self.metadata:
            result["metadata"] = dict(self.metadata)
        return result


@dataclass
class ExecutionResult:
    """Result of executing a single code block."""

    status: ExecutionStatus
    stdout: str = ""
    stderr: str = ""
    exit_code: Optional[int] = None
    execution_time_ms: float = 0.0
    language: str = ""
    context: Optional[ExecutionContext] = None
    error_message: Optional[str] = None
    temp_file: Optional[str] = None

    @property
    def success(self) -> bool:
        return self.status == ExecutionStatus.SUCCESS

    @property
    def output(self) -> str:
        return self.stdout

    def to_dict(self) -> Dict[str, Any]:
        result: Dict[str, Any] = {
            "status": self.status.to_string(),
            "stdout": self.stdout,
            "stderr": self.stderr,
            "execution_time_ms": self.execution_time_ms,
            "language": self.language,
        }
        if self.exit_code is not None:
            result["exit_code"] = self.exit_code
        if self.context:
            result["context"] = self.context.to_dict()
        if self.error_message:
            result["error_message"] = self.error_message
        if self.temp_file:
            result["temp_file"] = self.temp_file
        return result


class _HistoryEntry:
    """Internal execution history entry."""

    def __init__(self, result: ExecutionResult, context: ExecutionContext):
        self.result = result
        self.context = context
        self.timestamp = time.time()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "timestamp": self.timestamp,
            "result": self.result.to_dict(),
            "context": self.context.to_dict(),
        }


class MAMRuntime:
    """Secure execution runtime for MAM code blocks.

    Executes code blocks in isolated subprocesses with timeout enforcement,
    output capture, environment injection, and execution history tracking.

    Supports Python, JavaScript/Node.js, Bash, and other runtimes configured
    via ExecutionConfig.

    Example::

        runtime = MAMRuntime(ExecutionConfig(timeout_seconds=10))
        result = runtime.execute_code("python", "print('hello')")
        print(result.stdout)  # "hello"
    """

    def __init__(self, config: Optional[ExecutionConfig] = None):
        self.config = config or ExecutionConfig()
        self._history: List[_HistoryEntry] = []
        self._lock = threading.Lock()

    def execute_code(
        self,
        language: str,
        code: str,
        context: Optional[ExecutionContext] = None,
        config_override: Optional[ExecutionConfig] = None,
    ) -> ExecutionResult:
        cfg = config_override or self.config
        ctx = context or ExecutionContext()

        if cfg.allowed_languages and language.lower() not in cfg.allowed_languages:
            return ExecutionResult(
                status=ExecutionStatus.SKIPPED,
                language=language,
                context=ctx,
                error_message=(
                    f"Language '{language}' not in allowed list: "
                    f"{cfg.allowed_languages}"
                ),
            )

        if cfg.blocked_commands:
            for cmd in cfg.blocked_commands:
                if cmd.lower() in code.lower():
                    return ExecutionResult(
                        status=ExecutionStatus.SKIPPED,
                        language=language,
                        context=ctx,
                        error_message=f"Blocked command pattern detected: '{cmd}'",
                    )

        cmd_info = self._build_command(language, code, cfg)
        if cmd_info is None:
            return ExecutionResult(
                status=ExecutionStatus.ERROR,
                language=language,
                context=ctx,
                error_message=f"Unsupported language: '{language}'",
            )

        executable, args, temp_file = cmd_info
        start_time = time.monotonic()

        env = dict(os.environ)
        env["MAM_MODULE_ID"] = ctx.module_id
        env["MAM_SECTION"] = ctx.section_name
        env["MAM_LANG"] = language
        for k, v in ctx.variables.items():
            env[f"MAM_VAR_{k.upper()}"] = str(v)
        if cfg.environment:
            env.update(cfg.environment)

        try:
            process = subprocess.Popen(
                args,
                executable=executable,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE if cfg.capture_stderr else subprocess.DEVNULL,
                cwd=cfg.working_directory or tempfile.gettempdir(),
                env=env,
                shell=cfg.shell,
                text=True,
            )

            try:
                stdout, stderr = process.communicate(
                    timeout=cfg.timeout_seconds
                )
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
                elapsed = (time.monotonic() - start_time) * 1000
                result = ExecutionResult(
                    status=ExecutionStatus.TIMEOUT,
                    language=language,
                    context=ctx,
                    exit_code=-1,
                    execution_time_ms=elapsed,
                    error_message=(
                        f"Execution timed out after {cfg.timeout_seconds}s"
                    ),
                    temp_file=temp_file,
                )
                self._record_history(result, ctx)
                return result

            elapsed = (time.monotonic() - start_time) * 1000

            if stdout and len(stdout) > cfg.max_output_bytes:
                stdout = stdout[:cfg.max_output_bytes] + "\n... (truncated)"
            if stderr and len(stderr) > cfg.max_output_bytes:
                stderr = stderr[:cfg.max_output_bytes] + "\n... (truncated)"

            status = (
                ExecutionStatus.SUCCESS
                if process.returncode == 0
                else ExecutionStatus.FAILED
            )

            result = ExecutionResult(
                status=status,
                stdout=stdout or "",
                stderr=stderr or "",
                exit_code=process.returncode,
                execution_time_ms=elapsed,
                language=language,
                context=ctx,
                temp_file=temp_file,
            )
            self._record_history(result, ctx)
            return result

        except FileNotFoundError as exc:
            elapsed = (time.monotonic() - start_time) * 1000
            result = ExecutionResult(
                status=ExecutionStatus.ERROR,
                language=language,
                context=ctx,
                execution_time_ms=elapsed,
                error_message=f"Executable not found: {exc}",
                temp_file=temp_file,
            )
            self._record_history(result, ctx)
            return result

        except PermissionError as exc:
            elapsed = (time.monotonic() - start_time) * 1000
            result = ExecutionResult(
                status=ExecutionStatus.ERROR,
                language=language,
                context=ctx,
                execution_time_ms=elapsed,
                error_message=f"Permission denied: {exc}",
                temp_file=temp_file,
            )
            self._record_history(result, ctx)
            return result

        except Exception as exc:
            elapsed = (time.monotonic() - start_time) * 1000
            result = ExecutionResult(
                status=ExecutionStatus.ERROR,
                language=language,
                context=ctx,
                execution_time_ms=elapsed,
                error_message=f"Unexpected error: {exc}",
                temp_file=temp_file,
            )
            self._record_history(result, ctx)
            return result

    def execute_section(
        self,
        section: Section,
        module_id: str = "unknown",
        config_override: Optional[ExecutionConfig] = None,
    ) -> List[ExecutionResult]:
        results: List[ExecutionResult] = []
        for i, block in enumerate(section.code_blocks):
            if not block.is_executable:
                results.append(
                    ExecutionResult(
                        status=ExecutionStatus.SKIPPED,
                        language=block.language,
                        context=ExecutionContext(
                            module_id=module_id,
                            section_name=section.name,
                            block_index=i,
                        ),
                        error_message=f"Non-executable language: '{block.language}'",
                    )
                )
                continue

            ctx = ExecutionContext(
                module_id=module_id,
                section_name=section.name,
                block_index=i,
            )
            result = self.execute_code(
                block.language, block.code, ctx, config_override
            )
            results.append(result)
        return results

    def execute_ast(
        self,
        ast: AST,
        config_override: Optional[ExecutionConfig] = None,
    ) -> Dict[str, List[ExecutionResult]]:
        module_id = ast.frontmatter.id or "unknown"
        results: Dict[str, List[ExecutionResult]] = {}
        for section in ast.sections:
            if section.code_blocks:
                section_results = self.execute_section(
                    section, module_id, config_override
                )
                results[section.name] = section_results
        return results

    def get_history(self) -> List[Dict[str, Any]]:
        with self._lock:
            return [entry.to_dict() for entry in self._history]

    def clear_history(self) -> None:
        with self._lock:
            self._history.clear()

    @property
    def history_count(self) -> int:
        with self._lock:
            return len(self._history)

    def _build_command(
        self, language: str, code: str, config: ExecutionConfig
    ) -> Optional[tuple]:
        lang = language.lower()

        if lang in ("python", "py"):
            exe = config.python_executable or sys.executable
            tmp = tempfile.NamedTemporaryFile(
                mode="w", suffix=".py", delete=False, encoding="utf-8"
            )
            tmp.write(code)
            tmp.close()
            return (None, [exe, tmp.name], tmp.name)

        if lang in ("javascript", "js", "node"):
            exe = config.node_executable or "node"
            tmp = tempfile.NamedTemporaryFile(
                mode="w", suffix=".js", delete=False, encoding="utf-8"
            )
            tmp.write(code)
            tmp.close()
            return (None, [exe, tmp.name], tmp.name)

        if lang in ("bash", "sh", "shell"):
            return (None, ["/bin/bash", "-c", code], None)

        if lang in ("ruby",):
            return (None, ["ruby", "-e", code], None)

        if lang in ("go",):
            tmp = tempfile.NamedTemporaryFile(
                mode="w", suffix=".go", delete=False, encoding="utf-8"
            )
            tmp.write(code)
            tmp.close()
            return (None, ["go", "run", tmp.name], tmp.name)

        if lang in ("rust",):
            return (None, ["rustc", "--edition", "2021", "-e", code], None)

        return None

    def _record_history(self, result: ExecutionResult, context: ExecutionContext) -> None:
        entry = _HistoryEntry(result, context)
        with self._lock:
            self._history.append(entry)


def execute(
    module: Dict[str, Any],
    context: Optional[Dict[str, Any]] = None,
    config: Optional[ExecutionConfig] = None,
) -> Dict[str, Any]:
    """Execute code blocks in a MAM module dictionary.

    This is a convenience function for executing module dictionaries
    (e.g., from parse_mam().ast.to_dict()) without needing to work
    with the full AST API.

    Args:
        module: Module dict with 'sections' containing code blocks.
        context: Optional execution context variables.
        config: Optional execution configuration.

    Returns:
        Dict with 'results' mapping section names to execution results,
        'success' flag, and 'total_time_ms' timing.

    Example::

        result_dict = execute(
            {"sections": [{"name": "Python", "code_blocks": [
                {"language": "python", "code": "print('hi')", "is_executable": True}
            ]}]},
            context={"verbose": "true"},
        )
        print(result_dict["success"])
    """
    ctx_dict = context or {}
    cfg = config or ExecutionConfig()
    runtime = MAMRuntime(cfg)

    overall_start = time.monotonic()
    all_results: Dict[str, List[Dict[str, Any]]] = {}
    any_failed = False

    sections = module.get("sections", [])
    module_id = module.get("id", "unknown")

    for section_data in sections:
        section_name = section_data.get("name", "unknown")
        code_blocks = section_data.get("code_blocks", [])
        section_results: List[Dict[str, Any]] = []

        for i, block_data in enumerate(code_blocks):
            if not block_data.get("is_executable", False):
                section_results.append(
                    ExecutionResult(
                        status=ExecutionStatus.SKIPPED,
                        language=block_data.get("language", ""),
                        context=ExecutionContext(
                            module_id=module_id,
                            section_name=section_name,
                            block_index=i,
                            variables=ctx_dict,
                        ),
                    ).to_dict()
                )
                continue

            exec_ctx = ExecutionContext(
                module_id=module_id,
                section_name=section_name,
                block_index=i,
                variables=ctx_dict,
            )
            result = runtime.execute_code(
                block_data.get("language", ""),
                block_data.get("code", ""),
                exec_ctx,
                cfg,
            )
            section_results.append(result.to_dict())
            if not result.success:
                any_failed = True

        all_results[section_name] = section_results

    elapsed = (time.monotonic() - overall_start) * 1000
    return {
        "success": not any_failed,
        "results": all_results,
        "total_time_ms": elapsed,
        "history": runtime.get_history(),
    }


def _iter_block_results(result: Any) -> List[Dict[str, Any]]:
    """Flatten a result payload into a list of per-block result dicts."""

    if isinstance(result, ExecutionResult):
        return [result.to_dict()]
    if not isinstance(result, dict):
        return []
    results = result.get("results", {})
    if not isinstance(results, dict):
        return []
    flattened: List[Dict[str, Any]] = []
    for entries in results.values():
        if isinstance(entries, list):
            flattened.extend(entry for entry in entries if isinstance(entry, dict))
    return flattened


def is_success(result: Any) -> bool:
    """Return True when an execution payload or result reports success.

    Accepts either the dictionary returned by :func:`execute` or a single
    :class:`ExecutionResult`.
    """

    if isinstance(result, ExecutionResult):
        return result.success
    if not isinstance(result, dict):
        return False
    if "success" in result:
        return bool(result["success"])
    return all(entry.get("status") == "success" for entry in _iter_block_results(result))


def count_successful(result: Any) -> int:
    """Count the per-block results whose status is ``success``."""

    return sum(1 for entry in _iter_block_results(result) if entry.get("status") == "success")


def failed_sections(result: Any) -> List[str]:
    """Return the names of sections that produced at least one non-success result.

    Skipped blocks do not count as failures.
    """

    if not isinstance(result, dict):
        return []
    results = result.get("results", {})
    if not isinstance(results, dict):
        return []
    failed: List[str] = []
    for name, entries in results.items():
        if not isinstance(entries, list):
            continue
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            status = entry.get("status")
            if status in ("failed", "timeout", "error"):
                failed.append(str(name))
                break
    return failed


def execution_languages(result: Any) -> List[str]:
    """Return the distinct languages executed, in first-seen order."""

    languages: List[str] = []
    for entry in _iter_block_results(result):
        language = entry.get("language") or "unknown"
        if language not in languages:
            languages.append(str(language))
    return languages


def total_duration(result: Any) -> float:
    """Return the total execution duration in milliseconds.

    Uses the payload total when available, otherwise sums per-block times.
    """

    if isinstance(result, dict):
        total = result.get("total_time_ms")
        if isinstance(total, (int, float)):
            return float(total)
    return float(
        sum(float(entry.get("execution_time_ms", 0.0)) for entry in _iter_block_results(result))
    )


def summarize_execution(result: Any) -> str:
    """Return a one-line human-readable summary of an execution payload."""

    blocks = _iter_block_results(result)
    passed = count_successful(result)
    state = "succeeded" if is_success(result) else "failed"
    failed_names = failed_sections(result)
    summary = f"Execution {state}: {passed}/{len(blocks)} blocks succeeded"
    if failed_names:
        summary += " (failed: " + ", ".join(failed_names) + ")"
    return summary


def record_execution(history: List[Dict[str, Any]], entry: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Append an entry to an execution history list and return the list.

    Supports building histories outside of :class:`MAMRuntime`, for example when
    aggregating runs across several modules.
    """

    history.append(dict(entry))
    return history


def format_execution_output(result: Any, indent: str = "  ") -> str:
    """Render per-block output of an execution payload for terminal display."""

    lines: List[str] = []
    for entry in _iter_block_results(result):
        language = entry.get("language") or "unknown"
        status = entry.get("status") or "unknown"
        lines.append(f"{indent}[{language}] {status}")
        stdout = (entry.get("stdout") or "").rstrip()
        stderr = (entry.get("stderr") or "").rstrip()
        if stdout:
            lines.append(f"{indent}  stdout: {stdout}")
        if stderr:
            lines.append(f"{indent}  stderr: {stderr}")
    if not lines:
        return "(no output)"
    return "\n".join(lines)


__all__ = [
    "execute",
    "MAMRuntime",
    "ExecutionResult",
    "ExecutionConfig",
    "ExecutionContext",
    "ExecutionStatus",
    "count_successful",
    "execution_languages",
    "failed_sections",
    "format_execution_output",
    "is_success",
    "record_execution",
    "summarize_execution",
    "total_duration",
]
