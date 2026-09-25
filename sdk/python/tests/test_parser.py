"""Tests for the MAM parser."""

from mam.ast import NodeType, SectionType
from mam.parser import (
    MAMParser,
    count_headings,
    detect_runtime,
    extract_code_blocks,
    extract_front_matter,
    normalize_mam,
    parse_mam,
    parse_mam_safe,
    split_sections,
    strip_code_blocks,
)

SAMPLE_MAM = """\
---
id: test-module
version: 2.0.0
name: Test Module
author: Test Author
runtime: python
tags:
  - test
  - example
description: A test module for unit testing
dependencies:
  - requests
permissions:
  - network
---

# Test Module

## Purpose

This module is for testing the parser.

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| name | string | Yes | Input name |
| count | int | No | Input count |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| result | string | The result |

## Rules

- Must validate inputs
- Must handle errors gracefully
- Must log all operations

## Python

```python
def process(name: str, count: int = 1) -> dict:
    return {"result": f"{name}:{count}"}
```

## Examples

```python
result = process("test", 5)
assert result["result"] == "test:5"
```

## Tests

```python
def test_process():
    result = process("hello")
    assert "hello" in result["result"]
```

## Dependencies

- None
"""

MINIMAL_MAM = """\
---
id: minimal
version: 0.1.0
name: Minimal Module
author: Tester
runtime: python
---

# Minimal

## Purpose

Minimal test module.
"""


EMPTY_MAM = """\
Just some text with no front matter or headings.
"""


FRONTMATTER_ONLY_MAM = """\
---
id: frontmatter-only
version: 2.0.0
name: Frontmatter Only
author: Tester
runtime: python
---
"""


class TestParseMam:
    """Tests for the parse_mam convenience function."""

    def test_parse_full_module(self) -> None:
        result = parse_mam(SAMPLE_MAM, source="test.mam.md")
        assert result.success
        assert result.ast.frontmatter.id == "test-module"
        assert result.ast.frontmatter.version == "2.0.0"
        assert result.ast.frontmatter.name == "Test Module"
        assert result.ast.frontmatter.author == "Test Author"
        assert result.ast.frontmatter.runtime == "python"
        assert result.ast.frontmatter.tags == ["test", "example"]
        assert result.ast.frontmatter.description == "A test module for unit testing"
        assert result.ast.frontmatter.dependencies == ["requests"]
        assert result.ast.frontmatter.permissions == ["network"]

    def test_parse_sections(self) -> None:
        result = parse_mam(SAMPLE_MAM)
        assert result.success
        section_names = [s.name for s in result.ast.sections]
        assert "Purpose" in section_names
        assert "Inputs" in section_names
        assert "Outputs" in section_names
        assert "Rules" in section_names
        assert "Python" in section_names

    def test_parse_code_blocks(self) -> None:
        result = parse_mam(SAMPLE_MAM)
        assert result.success
        python_section = result.ast.get_section("Python")
        assert python_section is not None
        assert len(python_section.code_blocks) == 1
        block = python_section.code_blocks[0]
        assert block.language == "python"
        assert "def process" in block.code
        assert block.is_executable

    def test_parse_tables(self) -> None:
        result = parse_mam(SAMPLE_MAM)
        assert result.success
        inputs = result.ast.get_section("Inputs")
        assert inputs is not None
        assert len(inputs.tables) == 1
        table = inputs.tables[0]
        assert len(table.headers) >= 4
        assert "Name" in table.headers
        assert "Type" in table.headers

    def test_parse_lists(self) -> None:
        result = parse_mam(SAMPLE_MAM)
        assert result.success
        rules = result.ast.get_section("Rules")
        assert rules is not None
        assert len(rules.lists) == 1
        items = rules.lists[0]
        assert len(items) == 3
        assert items[0].content == "Must validate inputs"

    def test_parse_minimal(self) -> None:
        result = parse_mam(MINIMAL_MAM)
        assert result.success
        assert result.ast.frontmatter.id == "minimal"
        assert len(result.ast.sections) >= 1

    def test_parse_empty(self) -> None:
        result = parse_mam(EMPTY_MAM)
        assert not result.success
        assert len(result.errors) > 0 or len(result.warnings) > 0

    def test_parse_frontmatter_only(self) -> None:
        result = parse_mam(FRONTMATTER_ONLY_MAM)
        assert result.success
        assert result.ast.frontmatter.id == "frontmatter-only"
        assert len(result.ast.sections) == 0

    def test_parse_with_source(self) -> None:
        result = parse_mam(MINIMAL_MAM, source="minimal.mam.md")
        assert result.source == "minimal.mam.md"

    def test_parse_time(self) -> None:
        result = parse_mam(SAMPLE_MAM)
        assert result.parse_time_ms >= 0


class TestFrontMatter:
    """Tests for front matter parsing."""

    def test_unclosed_frontmatter(self) -> None:
        content = "---\nid: test\nversion: 2.0.0\nname: Test\nauthor: Author\nruntime: python\n"
        result = parse_mam(content)
        assert not result.success
        assert any("Unclosed" in e.message for e in result.errors)

    def test_invalid_yaml(self) -> None:
        content = "---\nid: test\n  bad indent: [\n---\n\n# Title\n\n## Purpose\n\nTest.\n"
        result = parse_mam(content)
        assert not result.success
        assert any("YAML" in e.message or "Invalid" in e.message for e in result.errors)

    def test_invalid_id_format(self) -> None:
        content = (
            "---\nid: INVALID_ID!\nversion: 2.0.0\nname: Test\n"
            "author: Author\nruntime: python\n---\n\n# Test\n\n## Purpose\n\nTest.\n"
        )
        result = parse_mam(content)
        assert not result.success
        assert any("Invalid module id" in e.message for e in result.errors)

    def test_invalid_version_format(self) -> None:
        content = (
            "---\nid: test\nversion: not-a-version\nname: Test\n"
            "author: Author\nruntime: python\n---\n\n# Test\n\n## Purpose\n\nTest.\n"
        )
        result = parse_mam(content)
        assert not result.success
        assert any("Invalid version" in e.message for e in result.errors)

    def test_missing_required_fields(self) -> None:
        content = "---\nid: test\n---\n\n# Test\n\n## Purpose\n\nTest.\n"
        result = parse_mam(content)
        warnings = [e for e in result.warnings + result.errors if "Missing" in e.message]
        assert len(warnings) >= 3

    def test_frontmatter_properties(self) -> None:
        result = parse_mam(SAMPLE_MAM)
        fm = result.ast.frontmatter
        assert fm.id == "test-module"
        assert fm.version == "2.0.0"
        assert fm.name == "Test Module"
        assert fm.author == "Test Author"
        assert fm.runtime == "python"
        assert fm.tags == ["test", "example"]
        assert fm.description == "A test module for unit testing"
        assert fm.dependencies == ["requests"]
        assert fm.permissions == ["network"]

    def test_frontmatter_get_default(self) -> None:
        result = parse_mam(MINIMAL_MAM)
        fm = result.ast.frontmatter
        assert fm.get("nonexistent", "default") == "default"
        assert fm.get("nonexistent") is None


class TestSectionParsing:
    """Tests for section content parsing."""

    def test_code_block_unclosed(self) -> None:
        content = MINIMAL_MAM + "\n\n## Code\n\n```python\nprint('hello')\n"
        result = parse_mam(content)
        warnings = [e for e in result.warnings if "Unclosed" in e.message]
        assert len(warnings) >= 1

    def test_multiple_code_blocks(self) -> None:
        content = MINIMAL_MAM + """
## Code

```python
x = 1
```

```python
y = 2
```
"""
        result = parse_mam(content)
        code_section = result.ast.get_section("Code")
        assert code_section is not None
        assert len(code_section.code_blocks) == 2

    def test_blockquote(self) -> None:
        content = MINIMAL_MAM + "\n\n## Quote\n\n> This is a quote.\n> Second line.\n"
        result = parse_mam(content)
        quote_section = result.ast.get_section("Quote")
        assert quote_section is not None
        has_blockquote = any(
            n.node_type == NodeType.BLOCKQUOTE for n in quote_section.content_nodes
        )
        assert has_blockquote

    def test_horizontal_rule(self) -> None:
        content = MINIMAL_MAM + "\n\n## Rule\n\n---\n\nSome content.\n"
        result = parse_mam(content)
        rule_section = result.ast.get_section("Rule")
        assert rule_section is not None

    def test_ordered_list(self) -> None:
        content = MINIMAL_MAM + "\n\n## Steps\n\n1. First step\n2. Second step\n3. Third step\n"
        result = parse_mam(content)
        steps = result.ast.get_section("Steps")
        assert steps is not None
        assert len(steps.lists) == 1
        items = steps.lists[0]
        assert len(items) == 3
        assert items[0].ordered is True

    def test_unordered_list(self) -> None:
        content = MINIMAL_MAM + "\n\n## Items\n\n- Item one\n- Item two\n- Item three\n"
        result = parse_mam(content)
        items_section = result.ast.get_section("Items")
        assert items_section is not None
        assert len(items_section.lists) == 1
        items = items_section.lists[0]
        assert len(items) == 3
        assert items[0].ordered is False

    def test_task_list(self) -> None:
        content = MINIMAL_MAM + "\n\n## Tasks\n\n- [x] Done task\n- [ ] Pending task\n"
        result = parse_mam(content)
        tasks = result.ast.get_section("Tasks")
        assert tasks is not None
        items = tasks.lists[0]
        assert items[0].checked is True
        assert items[1].checked is False

    def test_table_alignments(self) -> None:
        content = MINIMAL_MAM + """
## Table

| Left | Center | Right |
|:-----|:------:|------:|
| a | b | c |
"""
        result = parse_mam(content)
        table_section = result.ast.get_section("Table")
        assert table_section is not None
        table = table_section.tables[0]
        assert table.alignments == ["left", "center", "right"]


class TestMAMParser:
    """Tests for the MAMParser class."""

    def test_strict_mode(self) -> None:
        parser = MAMParser(strict=True)
        content = MINIMAL_MAM
        result = parser.parse(content)
        assert result.success

    def test_validate_ids_false(self) -> None:
        parser = MAMParser(validate_ids=False)
        content = (
            "---\nid: INVALID\nversion: 2.0.0\nname: Test\n"
            "author: Author\nruntime: python\n---\n\n# Test\n\n## Purpose\n\nTest.\n"
        )
        result = parser.parse(content)
        id_errors = [e for e in result.errors if "Invalid module id" in e.message]
        assert len(id_errors) == 0

    def test_source_tracking(self) -> None:
        result = parse_mam(SAMPLE_MAM, source="test.mam.md")
        for section in result.ast.sections:
            assert section.location is not None
            assert section.location.source == "test.mam.md"


class TestAST:
    """Tests for AST methods."""

    def test_ast_to_dict(self) -> None:
        result = parse_mam(SAMPLE_MAM)
        d = result.ast.to_dict()
        assert "frontmatter" in d
        assert "sections" in d

    def test_ast_to_json(self) -> None:
        result = parse_mam(SAMPLE_MAM)
        j = result.ast.to_json()
        assert '"frontmatter"' in j
        assert '"sections"' in j

    def test_ast_to_markdown(self) -> None:
        result = parse_mam(SAMPLE_MAM)
        md = result.ast.to_markdown()
        assert "---" in md
        assert "Purpose" in md

    def test_ast_title(self) -> None:
        result = parse_mam(SAMPLE_MAM)
        assert result.ast.title is not None

    def test_ast_module_id(self) -> None:
        result = parse_mam(SAMPLE_MAM)
        assert result.ast.module_id == "test-module"

    def test_ast_version(self) -> None:
        result = parse_mam(SAMPLE_MAM)
        assert result.ast.version == "2.0.0"

    def test_ast_purpose(self) -> None:
        result = parse_mam(SAMPLE_MAM)
        purpose = result.ast.purpose
        assert purpose is not None
        assert purpose.name == "Purpose"

    def test_ast_code_sections(self) -> None:
        result = parse_mam(SAMPLE_MAM)
        code_sections = result.ast.code_sections
        assert len(code_sections) >= 1

    def test_ast_all_code_blocks(self) -> None:
        result = parse_mam(SAMPLE_MAM)
        blocks = result.ast.all_code_blocks
        assert len(blocks) >= 2

    def test_ast_section_names(self) -> None:
        result = parse_mam(SAMPLE_MAM)
        names = result.ast.section_names
        assert "Purpose" in names

    def test_ast_get_section(self) -> None:
        result = parse_mam(SAMPLE_MAM)
        section = result.ast.get_section("Purpose")
        assert section is not None
        assert result.ast.get_section("Nonexistent") is None

    def test_ast_has_section(self) -> None:
        result = parse_mam(SAMPLE_MAM)
        assert result.ast.has_section("Purpose")
        assert not result.ast.has_section("Nonexistent")

    def test_ast_has_errors(self) -> None:
        result = parse_mam(SAMPLE_MAM)
        assert not result.ast.has_errors()


class TestSection:
    """Tests for Section methods."""

    def test_is_standard(self) -> None:
        result = parse_mam(SAMPLE_MAM)
        purpose = result.ast.get_section("Purpose")
        assert purpose is not None
        assert purpose.is_standard

    def test_section_type(self) -> None:
        result = parse_mam(SAMPLE_MAM)
        purpose = result.ast.get_section("Purpose")
        assert purpose is not None
        assert purpose.section_type == SectionType.PURPOSE

    def test_has_code(self) -> None:
        result = parse_mam(SAMPLE_MAM)
        python = result.ast.get_section("Python")
        assert python is not None
        assert python.has_code

    def test_text_content(self) -> None:
        result = parse_mam(SAMPLE_MAM)
        purpose = result.ast.get_section("Purpose")
        assert purpose is not None
        assert "testing" in purpose.text_content

    def test_get_code_by_language(self) -> None:
        result = parse_mam(SAMPLE_MAM)
        python = result.ast.get_section("Python")
        assert python is not None
        block = python.get_code_by_language("python")
        assert block is not None
        assert python.get_code_by_language("javascript") is None


class TestParseResult:
    """Tests for ParseResult methods."""

    def test_to_dict(self) -> None:
        result = parse_mam(SAMPLE_MAM)
        d = result.to_dict()
        assert "success" in d
        assert "ast" in d
        assert "parse_time_ms" in d

    def test_to_json(self) -> None:
        result = parse_mam(SAMPLE_MAM)
        j = result.to_json()
        assert '"success"' in j

    def test_success_property(self) -> None:
        result = parse_mam(SAMPLE_MAM)
        assert result.success
        result_empty = parse_mam(EMPTY_MAM)
        assert not result_empty.success or len(result_empty.warnings) > 0


CODE_MAM = """---
id: code-module
name: Code Module
version: 2.0.0
runtime: python
---

## Purpose

Has code.

## Python

```python
print(1)
```

## JavaScript

```javascript
console.log(1)
```
"""


class TestParserHelpers:
    """Tests for the text-level parser helpers."""

    def test_parse_mam_safe_never_raises(self) -> None:
        result = parse_mam_safe(CODE_MAM)
        assert result.success is True
        assert parse_mam_safe("").ast is not None

    def test_extract_front_matter(self) -> None:
        data = extract_front_matter(CODE_MAM)
        assert data["id"] == "code-module"
        assert extract_front_matter("## Purpose\n\nNo front matter.\n") == {}
        assert extract_front_matter("") == {}

    def test_split_sections(self) -> None:
        pairs = split_sections(CODE_MAM)
        assert [name for name, _ in pairs] == ["Purpose", "Python", "JavaScript"]
        assert "print(1)" in dict(pairs)["Python"]
        assert split_sections("") == []

    def test_strip_code_blocks(self) -> None:
        stripped = strip_code_blocks(CODE_MAM)
        assert "print(1)" not in stripped
        assert "```" in stripped
        assert "console.log(1)" not in stripped
        assert strip_code_blocks("") == ""

    def test_count_headings(self) -> None:
        assert count_headings(CODE_MAM) == 3
        assert count_headings("") == 0
        assert count_headings("no headings here") == 0

    def test_extract_code_blocks(self) -> None:
        blocks = extract_code_blocks(CODE_MAM)
        assert [block.language for block in blocks] == ["python", "javascript"]
        assert blocks[0].code.strip() == "print(1)"
        assert extract_code_blocks("") == []

    def test_normalize_mam(self) -> None:
        assert normalize_mam("a  \r\nb\n\n\n\nc") == "a\nb\n\nc\n"
        assert normalize_mam("") == ""
        assert normalize_mam("only\n") == "only\n"

    def test_detect_runtime(self) -> None:
        assert detect_runtime(CODE_MAM) == "python"
        assert detect_runtime("```js\nconsole.log(1)\n```\n") == "javascript"
        assert detect_runtime("## Purpose\n\nNo code.\n") is None
