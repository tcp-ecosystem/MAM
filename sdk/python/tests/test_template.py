"""Tests for the starter template module."""

import pytest

from mam.parser import parse_mam
from mam.template import (
    MAX_NAME_LENGTH,
    STARTER_KINDS,
    get_starter_template,
    list_starter_kinds,
    new_module_starter,
    render_starter,
    starter_variables,
    validate_starter_name,
)


class TestKinds:
    def test_list_starter_kinds(self) -> None:
        assert list_starter_kinds() == ["module", "agent", "tool"]
        assert list_starter_kinds() == STARTER_KINDS

    def test_templates_have_placeholders(self) -> None:
        template = get_starter_template("module")
        assert "{{name}}" in template
        assert "## Purpose" in template

    def test_aliases_resolve(self) -> None:
        assert get_starter_template("bot") == get_starter_template("agent")
        assert get_starter_template("MOD") == get_starter_template("module")
        assert get_starter_template("  cli  ") == get_starter_template("tool")

    def test_unknown_kind_raises(self) -> None:
        with pytest.raises(ValueError, match="Unknown starter kind"):
            get_starter_template("spaceship")
        with pytest.raises(ValueError):
            get_starter_template("")


class TestRendering:
    def test_substitutes_placeholders(self) -> None:
        assert render_starter("Hello {{name}}!", {"name": "MAM"}) == "Hello MAM!"

    def test_leaves_unknown_placeholders(self) -> None:
        assert render_starter("Hi {{missing}}", {}) == "Hi {{missing}}"

    def test_matches_case_insensitively(self) -> None:
        assert render_starter("{{Name}}", {"name": "x"}) == "x"

    def test_empty_template(self) -> None:
        assert render_starter("", {"name": "x"}) == ""

    def test_starter_variables_are_unique_and_ordered(self) -> None:
        assert starter_variables("{{a}} {{b}} {{a}}") == ["a", "b"]
        assert starter_variables("none") == []
        assert starter_variables("") == []


class TestNewStarter:
    def test_renders_a_complete_module(self) -> None:
        rendered = new_module_starter("Demo", "module")
        assert "title" not in rendered
        assert "name: Demo" in rendered
        assert "id: demo" in rendered
        assert starter_variables(rendered) == []

    def test_supports_every_kind(self) -> None:
        assert "role" in new_module_starter("Bot", "agent").lower()
        assert "Capabilities" in new_module_starter("Runner", "tool")

    def test_generated_module_parses(self) -> None:
        result = parse_mam(new_module_starter("Demo", "module"))
        assert result.success is True
        assert "Purpose" in [section.name for section in result.ast.sections]

    def test_runtime_is_recorded(self) -> None:
        assert "runtime: go" in new_module_starter("Demo", "tool", runtime="go")

    def test_invalid_name_raises(self) -> None:
        with pytest.raises(ValueError, match="Invalid starter name"):
            new_module_starter("   ")
        with pytest.raises(ValueError, match="Invalid starter name"):
            new_module_starter("bad/name")

    def test_unknown_kind_raises(self) -> None:
        with pytest.raises(ValueError, match="Unknown starter kind"):
            new_module_starter("Demo", "spaceship")


class TestNameValidation:
    def test_valid_names(self) -> None:
        assert validate_starter_name("Good Name-1") == []
        assert validate_starter_name("demo") == []

    def test_blank_name(self) -> None:
        problems = validate_starter_name("   ")
        assert problems
        assert "empty" in problems[0]

    def test_overlong_name(self) -> None:
        problems = validate_starter_name("a" * (MAX_NAME_LENGTH + 1))
        assert any("at most" in problem for problem in problems)

    def test_invalid_characters(self) -> None:
        assert validate_starter_name("bad/name")
        assert validate_starter_name("-leading-dash")
        assert validate_starter_name("!!!")
