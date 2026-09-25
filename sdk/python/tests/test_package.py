"""Tests for the public package surface and the plugin/CLI helpers."""

import pytest

from mam.plugins import (
    Plugin,
    PluginHook,
    PluginLifecycle,
    PluginManager,
    PluginMeta,
    enabled_plugin_names,
    find_plugin,
    hook_count,
    plugin_has_hook,
    plugin_meta_dicts,
    require_plugin,
    sort_plugin_meta,
)


class RecordingPlugin(Plugin):
    meta = PluginMeta(
        name="recorder",
        version="1.0.0",
        author="Tester",
        description="Records calls",
    )

    def register_hooks(self):
        return [
            PluginHook(
                name="recorder::capture",
                lifecycle=PluginLifecycle.POST_PARSE,
                callback=lambda **kwargs: "captured",
            )
        ]


class OtherPlugin(Plugin):
    meta = PluginMeta(name="other", version="0.5.0", author="Nobody")


@pytest.fixture
def manager() -> PluginManager:
    manager = PluginManager()
    manager.register(RecordingPlugin)
    manager.register(OtherPlugin)
    return manager


class TestPluginHelpers:
    def test_enabled_plugin_names(self, manager: PluginManager) -> None:
        assert enabled_plugin_names(manager) == ["other", "recorder"]
        manager.disable("other")
        assert enabled_plugin_names(manager) == ["recorder"]

    def test_plugin_has_hook(self, manager: PluginManager) -> None:
        assert plugin_has_hook(manager, "recorder::capture") is True
        assert plugin_has_hook(manager, "nope") is False

    def test_hook_count(self, manager: PluginManager) -> None:
        assert hook_count(manager) == 1
        assert hook_count(manager, PluginLifecycle.POST_PARSE) == 1
        assert hook_count(manager, PluginLifecycle.PRE_PARSE) == 0

    def test_plugin_meta_dicts_are_sorted(self, manager: PluginManager) -> None:
        metas = plugin_meta_dicts(manager)
        assert [meta["name"] for meta in metas] == ["other", "recorder"]
        assert metas[1]["version"] == "1.0.0"

    def test_sort_plugin_meta(self, manager: PluginManager) -> None:
        by_version = sort_plugin_meta(manager.list_meta(), key="version")
        assert [meta.name for meta in by_version] == ["other", "recorder"]
        with pytest.raises(ValueError, match="unknown key"):
            sort_plugin_meta(manager.list_meta(), key="nope")

    def test_find_plugin(self, manager: PluginManager) -> None:
        found = find_plugin(manager, lambda meta: meta.author == "Nobody")
        assert found is not None
        assert found.name == "other"
        assert find_plugin(manager, lambda meta: False) is None

    def test_require_plugin(self, manager: PluginManager) -> None:
        assert require_plugin(manager, "recorder").version == "1.0.0"
        with pytest.raises(KeyError, match="not registered"):
            require_plugin(manager, "nope")


class TestPublicPackageSurface:
    def test_all_exports_resolve(self) -> None:
        import mam

        missing = [name for name in mam.__all__ if not hasattr(mam, name)]
        assert missing == []

    def test_core_entry_points_are_exported(self) -> None:
        import mam

        for name in (
            "parse_mam",
            "validate",
            "execute",
            "MAMModule",
            "build_graph",
            "new_module_starter",
            "create_result_cache",
            "load_sdk_config",
            "run_diagnostics",
            "cli_main",
        ):
            assert callable(getattr(mam, name)), name

    def test_new_families_are_exported(self) -> None:
        import mam

        assert isinstance(mam.DEFAULT_SDK_CONFIG, mam.SDKConfig)
        assert isinstance(mam.ResultCache(), mam.ResultCache)
        assert callable(mam.build_graph)
        assert callable(mam.format_validation_report)
        assert callable(mam.new_module_starter)
        assert callable(mam.run_diagnostics)

    def test_existing_entry_points_still_work(self) -> None:
        import mam

        ast = mam.parse_mam("---\nid: x\nname: X\nversion: 2.0.0\n---\n\n## Purpose\n\nHi.\n").ast
        assert mam.section_names(ast) == ["Purpose"]
        assert mam.is_valid(mam.validate(ast)) in (True, False)
        assert mam.is_success({"success": True}) is True
        assert mam.has_front_matter(ast) is True

    def test_cli_helpers_are_exported(self) -> None:
        import mam

        assert callable(mam.build_parser)
        assert callable(mam.run)
        assert callable(mam.exit_code_for)
        assert "mam-sdk" in mam.version_header()


class TestCliHelpers:
    def test_build_parser(self) -> None:
        from mam.cli import build_parser

        parser = build_parser()
        parsed = parser.parse_args(["parse", "file.mam.md", "--json"])
        assert parsed.command == "parse"
        assert parsed.json is True

    def test_run_without_command_prints_help(self, capsys) -> None:
        from mam.cli import run

        assert run([]) == 0
        assert "usage" in capsys.readouterr().out

    def test_run_maps_usage_errors(self) -> None:
        from mam.cli import run

        assert run(["nope"]) != 0

    def test_run_reports_missing_file(self, tmp_path, capsys) -> None:
        from mam.cli import run

        code = run(["parse", str(tmp_path / "missing.mam.md")])
        assert code == 1
        assert "not found" in capsys.readouterr().err

    def test_exit_code_for(self) -> None:
        from mam.cli import exit_code_for
        from mam.validator import ValidationIssue, ValidationSeverity

        assert exit_code_for([]) == 0
        assert exit_code_for([], success=False) == 2
        error = ValidationIssue(message="e", severity=ValidationSeverity.ERROR)
        warning = ValidationIssue(message="w", severity=ValidationSeverity.WARNING)
        assert exit_code_for([error]) == 1
        assert exit_code_for([warning]) == 0

    def test_format_ast(self) -> None:
        from mam.cli import format_ast
        from mam.parser import parse_mam

        result = parse_mam("---\nid: x\nname: X\nversion: 2.0.0\n---\n\n## Purpose\n\nHi.\n")
        text = format_ast(result)
        assert "Module: X" in text
        assert "sections: 1" in text

    def test_format_issues_compact(self) -> None:
        from mam.cli import format_issues_compact
        from mam.validator import ValidationIssue, ValidationSeverity

        assert format_issues_compact([]) == "No issues found."
        issues = [
            ValidationIssue(
                message=f"m{i}", severity=ValidationSeverity.WARNING, rule="r", section="Purpose"
            )
            for i in range(30)
        ]
        text = format_issues_compact(issues, limit=5)
        assert "[warning]" in text
        assert "and 25 more" in text

    def test_format_module_summary(self) -> None:
        from mam.ast import MAMModule
        from mam.cli import format_module_summary

        text = format_module_summary(MAMModule(name="demo", tags=["x"]))
        assert "Module: demo" in text
        assert "x" in text
