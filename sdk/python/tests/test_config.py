"""Tests for the SDK configuration module."""

import json

import pytest

from mam.config import (
    CONFIG_FILENAME,
    DEFAULT_SDK_CONFIG,
    SUPPORTED_TARGETS,
    SDKConfig,
    find_sdk_config,
    is_supported_target,
    list_sdk_targets,
    load_sdk_config,
    merge_sdk_configs,
    resolve_sdk_config_path,
    save_sdk_config,
    validate_sdk_config,
)


class TestDefaults:
    def test_default_config_is_valid(self) -> None:
        assert validate_sdk_config(DEFAULT_SDK_CONFIG) == []
        assert DEFAULT_SDK_CONFIG.target == "python"
        assert DEFAULT_SDK_CONFIG.version == "1.0.0"

    def test_config_to_dict_and_json(self) -> None:
        config = SDKConfig()
        data = config.to_dict()
        assert set(data) == {"version", "work_dir", "target", "verbose", "extra"}
        assert json.loads(config.to_json())["target"] == "python"

    def test_config_copy_is_independent(self) -> None:
        config = SDKConfig(extra={"a": "1"})
        clone = config.copy()
        clone.extra["a"] = "2"
        assert config.extra["a"] == "1"
        assert clone is not config

    def test_config_get_falls_back_to_extra(self) -> None:
        config = SDKConfig(extra={"custom": 7})
        assert config.get("custom") == 7
        assert config.get("target") == "python"
        assert config.get("missing", "fallback") == "fallback"


class TestValidation:
    def test_non_config_is_rejected(self) -> None:
        assert validate_sdk_config({"target": "python"}) != []

    def test_bad_version_is_reported(self) -> None:
        problems = validate_sdk_config(SDKConfig(version="not-a-version"))
        assert any("version" in problem for problem in problems)

    def test_unsupported_target_is_reported(self) -> None:
        problems = validate_sdk_config(SDKConfig(target="cobol"))
        assert any("cobol" in problem for problem in problems)

    def test_empty_fields_are_reported(self) -> None:
        problems = validate_sdk_config(SDKConfig(version="", work_dir="", target=""))
        assert len(problems) >= 3


class TestTargets:
    def test_list_sdk_targets_is_sorted(self) -> None:
        targets = list_sdk_targets()
        assert targets == sorted(targets)
        assert "python" in targets
        assert "go" in targets
        assert targets == sorted(SUPPORTED_TARGETS)

    def test_aliases_are_supported(self) -> None:
        assert is_supported_target("py") is True
        assert is_supported_target("golang") is True
        assert is_supported_target("  JS  ") is True

    def test_unknown_targets_are_rejected(self) -> None:
        assert is_supported_target("cobol") is False
        assert is_supported_target("") is False
        assert is_supported_target(None) is False


class TestMerge:
    def test_override_wins_for_populated_fields(self) -> None:
        merged = merge_sdk_configs(
            SDKConfig(target="python", version="1.0.0"),
            SDKConfig(target="go"),
        )
        assert merged.target == "go"
        assert merged.version == "1.0.0"

    def test_merge_does_not_mutate_inputs(self) -> None:
        base = SDKConfig(target="python")
        merge_sdk_configs(base, SDKConfig(target="rust"))
        assert base.target == "python"

    def test_extra_maps_are_merged(self) -> None:
        merged = merge_sdk_configs(
            SDKConfig(extra={"a": "1"}), SDKConfig(extra={"b": "2"})
        )
        assert merged.extra == {"a": "1", "b": "2"}

    def test_non_sdk_config_inputs_are_tolerated(self) -> None:
        merged = merge_sdk_configs("nope", None)
        assert isinstance(merged, SDKConfig)
        assert validate_sdk_config(merged) == []


class TestPersistence:
    def test_round_trip(self, tmp_path) -> None:
        path = tmp_path / CONFIG_FILENAME
        config = SDKConfig(target="go", verbose=True, extra={"team": "core"})
        written = save_sdk_config(config, str(path))
        assert written == str(path)
        loaded = load_sdk_config(str(path))
        assert loaded.target == "go"
        assert loaded.verbose is True
        assert loaded.extra == {"team": "core"}

    def test_missing_explicit_path_raises(self, tmp_path) -> None:
        with pytest.raises(FileNotFoundError):
            load_sdk_config(str(tmp_path / "nope.json"))

    def test_invalid_json_raises(self, tmp_path) -> None:
        path = tmp_path / CONFIG_FILENAME
        path.write_text("{not json", encoding="utf-8")
        with pytest.raises(ValueError):
            load_sdk_config(str(path))

    def test_non_object_json_raises(self, tmp_path) -> None:
        path = tmp_path / CONFIG_FILENAME
        path.write_text("[1, 2, 3]", encoding="utf-8")
        with pytest.raises(ValueError):
            load_sdk_config(str(path))

    def test_invalid_config_on_disk_raises(self, tmp_path) -> None:
        path = tmp_path / CONFIG_FILENAME
        path.write_text(json.dumps({"target": "cobol"}), encoding="utf-8")
        with pytest.raises(ValueError):
            load_sdk_config(str(path))

    def test_saving_invalid_config_is_refused(self, tmp_path) -> None:
        with pytest.raises(ValueError):
            save_sdk_config(SDKConfig(target="cobol"), str(tmp_path / CONFIG_FILENAME))

    def test_saving_creates_missing_directories(self, tmp_path) -> None:
        path = tmp_path / "nested" / "deeper" / CONFIG_FILENAME
        written = save_sdk_config(SDKConfig(), str(path))
        assert written == str(path)
        assert path.is_file()


class TestResolution:
    def test_work_dir_resolution(self) -> None:
        path = resolve_sdk_config_path("some-dir")
        assert path.name == CONFIG_FILENAME
        assert path.parent.name == "some-dir"

    def test_finds_config_by_walking_up(self, tmp_path, monkeypatch) -> None:
        (tmp_path / CONFIG_FILENAME).write_text(json.dumps({"target": "rust"}), encoding="utf-8")
        nested = tmp_path / "a" / "b"
        nested.mkdir(parents=True)
        assert find_sdk_config(str(nested)) == tmp_path / CONFIG_FILENAME
        monkeypatch.chdir(nested)
        assert load_sdk_config().target == "rust"

    def test_returns_none_when_absent(self, tmp_path) -> None:
        assert find_sdk_config(str(tmp_path)) is None
