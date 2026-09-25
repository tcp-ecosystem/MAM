"""Tests for the environment diagnostics module."""

import json

from mam.config import CONFIG_FILENAME
from mam.diagnostics import (
    DiagnosticCheck,
    DiagnosticReport,
    DiagnosticStatus,
    check_environment,
    check_imports,
    check_language_runtimes,
    check_python_version,
    check_sdk_config,
    format_diagnostics,
    run_diagnostics,
)


class TestIndividualChecks:
    def test_python_version_passes_on_supported_interpreters(self) -> None:
        check = check_python_version()
        assert check.status == DiagnosticStatus.OK
        assert "Python" in check.message

    def test_python_version_fails_when_minimum_is_impossible(self) -> None:
        check = check_python_version(minimum=(99, 0))
        assert check.status == DiagnosticStatus.FAIL
        assert check.ok is False

    def test_import_check_passes_for_required_modules(self) -> None:
        checks = check_imports()
        assert checks
        assert all(check.status == DiagnosticStatus.OK for check in checks)
        assert any(check.name == "import:yaml" for check in checks)

    def test_import_check_fails_for_missing_module(self) -> None:
        checks = check_imports(["definitely_not_installed_xyz"])
        assert checks[0].status == DiagnosticStatus.FAIL

    def test_language_runtime_check(self) -> None:
        checks = check_language_runtimes(["python"])
        assert checks[0].status == DiagnosticStatus.OK

    def test_missing_runtime_is_a_warning_by_default(self) -> None:
        checks = check_language_runtimes(["definitely-not-a-language"])
        assert checks[0].status == DiagnosticStatus.WARN
        assert checks[0].ok is True

    def test_missing_runtime_can_be_a_failure(self) -> None:
        checks = check_language_runtimes(["definitely-not-a-language"], require_all=True)
        assert checks[0].status == DiagnosticStatus.FAIL

    def test_environment_check(self) -> None:
        check = check_environment()
        assert check.status == DiagnosticStatus.OK
        assert "executable" in check.details

    def test_config_check_without_file(self, tmp_path) -> None:
        check = check_sdk_config(str(tmp_path))
        assert check.status == DiagnosticStatus.OK
        assert "defaults" in check.message

    def test_config_check_with_valid_file(self, tmp_path) -> None:
        (tmp_path / CONFIG_FILENAME).write_text(json.dumps({"target": "go"}), encoding="utf-8")
        check = check_sdk_config(str(tmp_path))
        assert check.status == DiagnosticStatus.OK
        assert check.details["target"] == "go"

    def test_config_check_with_invalid_file(self, tmp_path) -> None:
        (tmp_path / CONFIG_FILENAME).write_text(json.dumps({"target": "cobol"}), encoding="utf-8")
        check = check_sdk_config(str(tmp_path))
        assert check.status == DiagnosticStatus.FAIL


class TestReport:
    def test_report_status_reflects_worst_check(self) -> None:
        report = DiagnosticReport()
        report.add(DiagnosticCheck(name="a", status=DiagnosticStatus.OK, message="fine"))
        assert report.status == DiagnosticStatus.OK
        assert report.ok is True

        report.add(DiagnosticCheck(name="b", status=DiagnosticStatus.WARN, message="meh"))
        assert report.status == DiagnosticStatus.WARN

        report.add(DiagnosticCheck(name="c", status=DiagnosticStatus.FAIL, message="bad"))
        assert report.status == DiagnosticStatus.FAIL
        assert report.ok is False
        assert len(report.failures) == 1
        assert len(report.warnings) == 1

    def test_report_to_dict(self) -> None:
        report = DiagnosticReport()
        report.add(DiagnosticCheck(name="a", status=DiagnosticStatus.OK, message="fine"))
        data = report.to_dict()
        assert data["ok"] is True
        assert data["checks"][0]["name"] == "a"

    def test_format_diagnostics(self) -> None:
        report = DiagnosticReport()
        report.add(DiagnosticCheck(name="a", status=DiagnosticStatus.OK, message="fine"))
        text = format_diagnostics(report)
        assert "PASS" in text
        assert "1 checks" in text
        assert format_diagnostics(DiagnosticReport()) == "No diagnostics were run."


class TestRunDiagnostics:
    def test_full_run(self, tmp_path) -> None:
        report = run_diagnostics(languages=["python"], work_dir=str(tmp_path))
        assert isinstance(report, DiagnosticReport)
        assert report.failures == []
        assert any(check.name == "python-version" for check in report.checks)
        assert any(check.name == "sdk-config" for check in report.checks)

    def test_full_run_can_fail_on_runtimes(self, tmp_path) -> None:
        report = run_diagnostics(
            languages=["definitely-not-a-language"],
            work_dir=str(tmp_path),
            require_all_runtimes=True,
        )
        assert report.ok is False
