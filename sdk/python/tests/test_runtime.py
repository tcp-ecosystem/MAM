"""Tests for the MAM runtime."""

import pytest
from mam.runtime import (
    ExecutionContext,
    ExecutionConfig,
    ExecutionResult,
    ExecutionStatus,
    MAMRuntime,
    execute,
)


class TestExecutionStatus:
    """Tests for ExecutionStatus enum."""

    def test_to_string(self) -> None:
        assert ExecutionStatus.PENDING.to_string() == "pending"
        assert ExecutionStatus.RUNNING.to_string() == "running"
        assert ExecutionStatus.SUCCESS.to_string() == "success"
        assert ExecutionStatus.FAILED.to_string() == "failed"
        assert ExecutionStatus.TIMEOUT.to_string() == "timeout"
        assert ExecutionStatus.SKIPPED.to_string() == "skipped"
        assert ExecutionStatus.ERROR.to_string() == "error"


class TestExecutionConfig:
    """Tests for ExecutionConfig dataclass."""

    def test_defaults(self) -> None:
        cfg = ExecutionConfig()
        assert cfg.timeout_seconds == 30.0
        assert cfg.max_output_bytes == 1024 * 1024
        assert cfg.capture_stderr is True
        assert cfg.shell is False

    def test_to_dict(self) -> None:
        cfg = ExecutionConfig(timeout_seconds=10.0, working_directory="/tmp")
        d = cfg.to_dict()
        assert d["timeout_seconds"] == 10.0
        assert d["working_directory"] == "/tmp"

    def test_to_dict_with_lists(self) -> None:
        cfg = ExecutionConfig(
            allowed_languages=["python", "bash"],
            blocked_commands=["rm", "sudo"],
        )
        d = cfg.to_dict()
        assert d["allowed_languages"] == ["python", "bash"]
        assert d["blocked_commands"] == ["rm", "sudo"]


class TestExecutionContext:
    """Tests for ExecutionContext dataclass."""

    def test_defaults(self) -> None:
        ctx = ExecutionContext()
        assert ctx.module_id == "unknown"
        assert ctx.section_name == ""
        assert ctx.block_index == 0

    def test_to_dict(self) -> None:
        ctx = ExecutionContext(
            module_id="test-mod",
            section_name="Python",
            block_index=1,
            variables={"key": "value"},
            metadata={"debug": True},
        )
        d = ctx.to_dict()
        assert d["module_id"] == "test-mod"
        assert d["section_name"] == "Python"
        assert d["block_index"] == 1
        assert d["variables"]["key"] == "value"
        assert d["metadata"]["debug"] is True


class TestExecutionResult:
    """Tests for ExecutionResult dataclass."""

    def test_success_property(self) -> None:
        result = ExecutionResult(status=ExecutionStatus.SUCCESS)
        assert result.success

    def test_not_success(self) -> None:
        result = ExecutionResult(status=ExecutionStatus.FAILED)
        assert not result.success

    def test_output_property(self) -> None:
        result = ExecutionResult(status=ExecutionStatus.SUCCESS, stdout="hello")
        assert result.output == "hello"

    def test_to_dict(self) -> None:
        result = ExecutionResult(
            status=ExecutionStatus.SUCCESS,
            stdout="output",
            stderr="",
            exit_code=0,
            execution_time_ms=123.45,
            language="python",
        )
        d = result.to_dict()
        assert d["status"] == "success"
        assert d["stdout"] == "output"
        assert d["exit_code"] == 0
        assert d["execution_time_ms"] == 123.45
        assert d["language"] == "python"

    def test_to_dict_with_error(self) -> None:
        result = ExecutionResult(
            status=ExecutionStatus.ERROR,
            error_message="Something went wrong",
        )
        d = result.to_dict()
        assert d["error_message"] == "Something went wrong"


class TestMAMRuntime:
    """Tests for MAMRuntime class."""

    def test_execute_python(self) -> None:
        runtime = MAMRuntime(ExecutionConfig(timeout_seconds=10))
        result = runtime.execute_code("python", "print('hello world')")
        assert result.success
        assert "hello world" in result.stdout
        assert result.language == "python"

    def test_execute_python_error(self) -> None:
        runtime = MAMRuntime(ExecutionConfig(timeout_seconds=10))
        result = runtime.execute_code("python", "raise ValueError('test error')")
        assert not result.success
        assert result.exit_code != 0
        assert "test error" in result.stderr

    def test_execute_unsupported_language(self) -> None:
        runtime = MAMRuntime()
        result = runtime.execute_code("brainfuck", "+++++")
        assert result.status == ExecutionStatus.ERROR
        assert "Unsupported" in result.error_message

    def test_execute_timeout(self) -> None:
        runtime = MAMRuntime(ExecutionConfig(timeout_seconds=1))
        result = runtime.execute_code("python", "import time; time.sleep(10)")
        assert result.status == ExecutionStatus.TIMEOUT
        assert "timed out" in result.error_message

    def test_execute_with_context(self) -> None:
        runtime = MAMRuntime(ExecutionConfig(timeout_seconds=5))
        ctx = ExecutionContext(
            module_id="test-mod",
            section_name="Python",
            block_index=0,
        )
        result = runtime.execute_code("python", "print('context test')", ctx)
        assert result.success
        assert result.context is not None
        assert result.context.module_id == "test-mod"

    def test_execute_blocked_command(self) -> None:
        cfg = ExecutionConfig(blocked_commands=["rm"])
        runtime = MAMRuntime(cfg)
        result = runtime.execute_code("python", "import os; os.system('rm -rf /')")
        assert result.status == ExecutionStatus.SKIPPED
        assert "Blocked" in result.error_message

    def test_execute_disallowed_language(self) -> None:
        cfg = ExecutionConfig(allowed_languages=["python"])
        runtime = MAMRuntime(cfg)
        result = runtime.execute_code("javascript", "console.log('hi')")
        assert result.status == ExecutionStatus.SKIPPED
        assert "not in allowed" in result.error_message

    def test_execute_bash(self) -> None:
        runtime = MAMRuntime(ExecutionConfig(timeout_seconds=5))
        result = runtime.execute_code("bash", "echo 'bash works'")
        if result.status == ExecutionStatus.ERROR and "not found" in (result.error_message or "").lower():
            pytest.skip("bash not available on this platform")
        assert result.success
        assert "bash works" in result.stdout

    def test_execute_node(self) -> None:
        runtime = MAMRuntime(ExecutionConfig(timeout_seconds=5))
        result = runtime.execute_code("javascript", "console.log('node works')")
        if result.status == ExecutionStatus.ERROR and "not found" in (result.error_message or "").lower():
            pytest.skip("Node.js not installed")
        assert result.success
        assert "node works" in result.stdout

    def test_history_tracking(self) -> None:
        runtime = MAMRuntime(ExecutionConfig(timeout_seconds=5))
        runtime.execute_code("python", "print('one')")
        runtime.execute_code("python", "print('two')")
        assert runtime.history_count == 2
        history = runtime.get_history()
        assert len(history) == 2

    def test_clear_history(self) -> None:
        runtime = MAMRuntime(ExecutionConfig(timeout_seconds=5))
        runtime.execute_code("python", "print('test')")
        assert runtime.history_count == 1
        runtime.clear_history()
        assert runtime.history_count == 0

    def test_execute_code_with_env_vars(self) -> None:
        runtime = MAMRuntime(ExecutionConfig(timeout_seconds=5))
        ctx = ExecutionContext(
            variables={"MY_VAR": "test_value"},
        )
        result = runtime.execute_code(
            "python",
            "import os; print(os.environ.get('MAM_VAR_MY_VAR', ''))",
            ctx,
        )
        assert result.success
        assert "test_value" in result.stdout

    def test_execute_code_mam_env_vars(self) -> None:
        runtime = MAMRuntime(ExecutionConfig(timeout_seconds=5))
        ctx = ExecutionContext(
            module_id="env-test",
            section_name="Python",
        )
        result = runtime.execute_code(
            "python",
            "import os; print(os.environ.get('MAM_MODULE_ID', ''))",
            ctx,
        )
        assert result.success
        assert "env-test" in result.stdout


class TestExecuteFunction:
    """Tests for the execute convenience function."""

    def test_execute_dict(self) -> None:
        module = {
            "sections": [
                {
                    "name": "Python",
                    "code_blocks": [
                        {
                            "language": "python",
                            "code": "print('dict execute')",
                            "is_executable": True,
                        }
                    ],
                }
            ]
        }
        result = execute(module)
        assert result["success"]
        assert "Python" in result["results"]

    def test_execute_non_executable(self) -> None:
        module = {
            "sections": [
                {
                    "name": "Python",
                    "code_blocks": [
                        {
                            "language": "mermaid",
                            "code": "graph TD; A-->B",
                            "is_executable": False,
                        }
                    ],
                }
            ]
        }
        result = execute(module)
        assert result["success"]
        assert result["results"]["Python"][0]["status"] == "skipped"

    def test_execute_with_context(self) -> None:
        module = {
            "sections": [
                {
                    "name": "Python",
                    "code_blocks": [
                        {
                            "language": "python",
                            "code": "import os; print(os.environ.get('MAM_VAR_TEST_KEY', ''))",
                            "is_executable": True,
                        }
                    ],
                }
            ]
        }
        result = execute(module, context={"test_key": "hello"})
        assert result["success"]

    def test_execute_empty_module(self) -> None:
        result = execute({"sections": []})
        assert result["success"]
        assert result["results"] == {}

    def test_execute_timing(self) -> None:
        result = execute({"sections": []})
        assert "total_time_ms" in result
        assert result["total_time_ms"] >= 0
