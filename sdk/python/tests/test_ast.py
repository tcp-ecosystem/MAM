"""Tests for the MAM AST types."""

import json
import pytest
from mam.ast import (
    AST,
    CodeBlock,
    ContentNode,
    FrontMatter,
    ListItem,
    MAMModule,
    NodeType,
    ParseError,
    ParseResult,
    Section,
    SectionType,
    SourceLocation,
    STANDARD_SECTIONS_ORDER,
    REQUIRED_SECTIONS,
    CODE_SECTION_NAMES,
    Table,
    TableRow,
)


class TestSourceLocation:
    """Tests for SourceLocation dataclass."""

    def test_basic(self) -> None:
        loc = SourceLocation(line=10, column=5)
        d = loc.to_dict()
        assert d["line"] == 10
        assert d["column"] == 5

    def test_full(self) -> None:
        loc = SourceLocation(line=1, column=0, end_line=10, end_column=20, source="test.mam.md")
        d = loc.to_dict()
        assert d["end_line"] == 10
        assert d["end_column"] == 20
        assert d["source"] == "test.mam.md"

    def test_optional_fields(self) -> None:
        loc = SourceLocation(line=1)
        d = loc.to_dict()
        assert "end_line" not in d
        assert "end_column" not in d
        assert "source" not in d


class TestContentNode:
    """Tests for ContentNode dataclass."""

    def test_basic(self) -> None:
        node = ContentNode(node_type=NodeType.PARAGRAPH, content="Hello")
        d = node.to_dict()
        assert d["node_type"] == "paragraph"
        assert d["content"] == "Hello"

    def test_with_children(self) -> None:
        child = ContentNode(node_type=NodeType.PARAGRAPH, content="Child")
        parent = ContentNode(
            node_type=NodeType.SECTION,
            children=[child],
        )
        d = parent.to_dict()
        assert len(d["children"]) == 1

    def test_with_location(self) -> None:
        loc = SourceLocation(line=5)
        node = ContentNode(node_type=NodeType.PARAGRAPH, content="Test", location=loc)
        d = node.to_dict()
        assert d["location"]["line"] == 5


class TestCodeBlock:
    """Tests for CodeBlock dataclass."""

    def test_basic(self) -> None:
        block = CodeBlock(language="python", code="print('hi')")
        d = block.to_dict()
        assert d["language"] == "python"
        assert d["code"] == "print('hi')"
        assert d["is_executable"] is False

    def test_executable(self) -> None:
        block = CodeBlock(language="python", code="x = 1", is_executable=True)
        assert block.is_executable

    def test_with_metadata(self) -> None:
        block = CodeBlock(
            language="python",
            code="pass",
            metadata={"version": "3.10"},
        )
        d = block.to_dict()
        assert d["metadata"]["version"] == "3.10"


class TestTable:
    """Tests for Table and TableRow dataclasses."""

    def test_basic(self) -> None:
        table = Table(
            headers=["Name", "Type"],
            rows=[TableRow(cells=["a", "string"], is_header=False)],
        )
        d = table.to_dict()
        assert d["headers"] == ["Name", "Type"]
        assert len(d["rows"]) == 1

    def test_alignments(self) -> None:
        table = Table(
            headers=["A", "B"],
            alignments=["left", "center"],
        )
        d = table.to_dict()
        assert d["alignments"] == ["left", "center"]


class TestListItem:
    """Tests for ListItem dataclass."""

    def test_basic(self) -> None:
        item = ListItem(content="Test item")
        d = item.to_dict()
        assert d["content"] == "Test item"
        assert d["level"] == 0
        assert d["ordered"] is False

    def test_checked(self) -> None:
        item = ListItem(content="Task", checked=True)
        d = item.to_dict()
        assert d["checked"] is True

    def test_unchecked(self) -> None:
        item = ListItem(content="Task", checked=False)
        d = item.to_dict()
        assert d["checked"] is False

    def test_no_checked(self) -> None:
        item = ListItem(content="Normal item")
        d = item.to_dict()
        assert "checked" not in d


class TestFrontMatter:
    """Tests for FrontMatter dataclass."""

    def test_basic(self) -> None:
        fm = FrontMatter(data={"id": "test", "version": "1.0.0"})
        assert fm.id == "test"
        assert fm.version == "1.0.0"

    def test_properties(self) -> None:
        fm = FrontMatter(data={
            "id": "mod",
            "version": "2.0.0",
            "name": "Module",
            "author": "Alice",
            "runtime": "python",
            "tags": ["a", "b"],
            "description": "Desc",
            "dependencies": ["dep1"],
            "permissions": ["net"],
        })
        assert fm.id == "mod"
        assert fm.version == "2.0.0"
        assert fm.name == "Module"
        assert fm.author == "Alice"
        assert fm.runtime == "python"
        assert fm.tags == ["a", "b"]
        assert fm.description == "Desc"
        assert fm.dependencies == ["dep1"]
        assert fm.permissions == ["net"]

    def test_get_default(self) -> None:
        fm = FrontMatter(data={})
        assert fm.get("missing") is None
        assert fm.get("missing", "default") == "default"

    def test_to_dict(self) -> None:
        fm = FrontMatter(
            raw="id: test",
            data={"id": "test"},
            location=SourceLocation(line=1),
        )
        d = fm.to_dict()
        assert d["data"]["id"] == "test"
        assert d["location"]["line"] == 1


class TestSection:
    """Tests for Section dataclass."""

    def test_basic(self) -> None:
        section = Section(name="Purpose", raw_content="Do things.")
        assert section.name == "Purpose"
        assert section.level == 2
        assert section.raw_content == "Do things."

    def test_is_standard(self) -> None:
        section = Section(name="Purpose")
        assert section.is_standard
        section_custom = Section(name="CustomSection")
        assert not section_custom.is_standard

    def test_section_type(self) -> None:
        section = Section(name="Purpose")
        assert section.section_type == SectionType.PURPOSE
        section_custom = Section(name="Custom")
        assert section_custom.section_type is None

    def test_has_code(self) -> None:
        section = Section(name="Python")
        assert not section.has_code
        section.code_blocks.append(CodeBlock(language="python", code="pass"))
        assert section.has_code

    def test_text_content(self) -> None:
        section = Section(name="Purpose")
        section.content_nodes.append(
            ContentNode(node_type=NodeType.PARAGRAPH, content="Hello")
        )
        section.content_nodes.append(
            ContentNode(node_type=NodeType.BLOCKQUOTE, content="Quote")
        )
        text = section.text_content
        assert "Hello" in text
        assert "Quote" in text

    def test_get_code_by_language(self) -> None:
        section = Section(name="Code")
        section.code_blocks.append(CodeBlock(language="python", code="py"))
        section.code_blocks.append(CodeBlock(language="javascript", code="js"))
        assert section.get_code_by_language("python") is not None
        assert section.get_code_by_language("javascript") is not None
        assert section.get_code_by_language("ruby") is None

    def test_to_dict(self) -> None:
        section = Section(
            name="Purpose",
            level=2,
            raw_content="Test",
            location=SourceLocation(line=10),
            metadata={"custom": True},
        )
        d = section.to_dict()
        assert d["name"] == "Purpose"
        assert d["level"] == 2
        assert d["raw_content"] == "Test"
        assert d["location"]["line"] == 10
        assert d["metadata"]["custom"] is True


class TestParseError:
    """Tests for ParseError dataclass."""

    def test_basic(self) -> None:
        error = ParseError(message="Something went wrong", line=5, column=10)
        d = error.to_dict()
        assert d["message"] == "Something went wrong"
        assert d["line"] == 5
        assert d["column"] == 10

    def test_str(self) -> None:
        error = ParseError(message="Bad YAML", line=3, severity="error")
        s = str(error)
        assert "[error]" in s
        assert "Bad YAML" in s
        assert "line 3" in s

    def test_with_context(self) -> None:
        error = ParseError(
            message="Error",
            line=1,
            severity="warning",
            source="test.mam.md",
            context="---",
        )
        d = error.to_dict()
        assert d["source"] == "test.mam.md"
        assert d["context"] == "---"


class TestAST:
    """Tests for AST dataclass."""

    def test_basic(self) -> None:
        ast = AST()
        assert ast.frontmatter is not None
        assert ast.sections == []
        assert ast.errors == []

    def test_title(self) -> None:
        ast = AST(sections=[Section(name="My Title")])
        assert ast.title == "My Title"

    def test_title_from_frontmatter(self) -> None:
        ast = AST(frontmatter=FrontMatter(data={"name": "FM Name"}))
        assert ast.title == "FM Name"

    def test_module_id(self) -> None:
        ast = AST(frontmatter=FrontMatter(data={"id": "mod-1"}))
        assert ast.module_id == "mod-1"

    def test_version(self) -> None:
        ast = AST(frontmatter=FrontMatter(data={"version": "2.0.0"}))
        assert ast.version == "2.0.0"

    def test_purpose(self) -> None:
        ast = AST(sections=[
            Section(name="Inputs"),
            Section(name="Purpose", raw_content="Do stuff"),
        ])
        assert ast.purpose is not None
        assert ast.purpose.name == "Purpose"

    def test_code_sections(self) -> None:
        sec = Section(name="Python")
        sec.code_blocks.append(CodeBlock(language="python", code="pass"))
        ast = AST(sections=[sec])
        assert len(ast.code_sections) == 1

    def test_all_code_blocks(self) -> None:
        s1 = Section(name="Python")
        s1.code_blocks.append(CodeBlock(language="python", code="a"))
        s2 = Section(name="JS")
        s2.code_blocks.append(CodeBlock(language="javascript", code="b"))
        ast = AST(sections=[s1, s2])
        assert len(ast.all_code_blocks) == 2

    def test_section_names(self) -> None:
        ast = AST(sections=[
            Section(name="Purpose"),
            Section(name="Inputs"),
        ])
        assert ast.section_names == ["Purpose", "Inputs"]

    def test_get_section(self) -> None:
        ast = AST(sections=[Section(name="Purpose")])
        assert ast.get_section("Purpose") is not None
        assert ast.get_section("Missing") is None

    def test_has_section(self) -> None:
        ast = AST(sections=[Section(name="Purpose")])
        assert ast.has_section("Purpose")
        assert not ast.has_section("Missing")

    def test_has_errors(self) -> None:
        ast = AST()
        assert not ast.has_errors()
        ast.errors.append(ParseError(message="err"))
        assert ast.has_errors()

    def test_to_dict(self) -> None:
        ast = AST(
            frontmatter=FrontMatter(data={"id": "test"}),
            sections=[Section(name="Purpose")],
        )
        d = ast.to_dict()
        assert "frontmatter" in d
        assert "sections" in d
        assert len(d["sections"]) == 1

    def test_to_json(self) -> None:
        ast = AST(
            frontmatter=FrontMatter(data={"id": "test"}),
            sections=[Section(name="Purpose")],
        )
        j = ast.to_json()
        parsed = json.loads(j)
        assert "frontmatter" in parsed

    def test_to_markdown(self) -> None:
        fm = FrontMatter(raw="id: test\nversion: 1.0.0", data={"id": "test"})
        sec = Section(name="Purpose", raw_content="Do things.")
        ast = AST(frontmatter=fm, sections=[sec])
        md = ast.to_markdown()
        assert "---" in md
        assert "Purpose" in md
        assert "Do things." in md


class TestParseResult:
    """Tests for ParseResult."""

    def test_basic(self) -> None:
        ast = AST()
        result = ParseResult(ast=ast)
        assert result.success
        assert result.errors == []

    def test_with_errors(self) -> None:
        ast = AST(errors=[ParseError(message="err")])
        result = ParseResult(ast=ast)
        assert not result.success
        assert len(result.errors) == 1

    def test_to_dict(self) -> None:
        result = ParseResult(ast=AST(), source="test.mam.md", parse_time_ms=1.5)
        d = result.to_dict()
        assert d["success"] is True
        assert d["source"] == "test.mam.md"
        assert d["parse_time_ms"] == 1.5

    def test_to_json(self) -> None:
        result = ParseResult(ast=AST())
        j = result.to_json()
        assert '"success"' in j


class TestMAMModule:
    """Tests for MAMModule class."""

    def test_basic(self) -> None:
        module = MAMModule(name="test", version="1.0.0")
        assert module.name == "test"
        assert module.version == "1.0.0"

    def test_builder(self) -> None:
        module = (
            MAMModule.Builder("my-module")
            .version("2.0.0")
            .author("Alice")
            .runtime("python")
            .description("A module")
            .tag("utility")
            .dependency("requests")
            .permission("network")
            .section("Purpose", "Does things.")
            .code_block("python", "x = 1")
            .build()
        )
        assert module.name == "my-module"
        assert module.version == "2.0.0"
        assert module.author == "Alice"
        assert module.runtime == "python"
        assert module.description == "A module"
        assert module.tags == ["utility"]
        assert module.dependencies == ["requests"]
        assert module.permissions == ["network"]
        assert len(module.sections) >= 1

    def test_from_ast(self) -> None:
        ast = AST(
            frontmatter=FrontMatter(data={
                "id": "from-ast",
                "version": "3.0.0",
                "name": "From AST",
                "author": "Bob",
                "runtime": "python",
                "tags": ["test"],
                "dependencies": ["dep1"],
                "permissions": ["net"],
            }),
            sections=[Section(name="Purpose")],
        )
        module = MAMModule.from_ast(ast)
        assert module.name == "From AST"
        assert module.version == "3.0.0"
        assert module.author == "Bob"

    def test_to_dict(self) -> None:
        module = MAMModule(name="test", version="1.0.0", tags=["a"])
        d = module.to_dict()
        assert d["name"] == "test"
        assert d["version"] == "1.0.0"
        assert d["tags"] == ["a"]

    def test_to_json(self) -> None:
        module = MAMModule(name="test")
        j = module.to_json()
        assert '"name"' in j

    def test_to_markdown(self) -> None:
        module = MAMModule(
            name="test-mod",
            version="1.0.0",
            author="Alice",
            runtime="python",
            tags=["a", "b"],
        )
        md = module.to_markdown()
        assert "---" in md
        assert "test-mod" in md
        assert "tags:" in md

    def test_get_section(self) -> None:
        module = MAMModule(name="test", sections=[Section(name="Purpose")])
        assert module.get_section("Purpose") is not None
        assert module.get_section("Missing") is None

    def test_add_section(self) -> None:
        module = MAMModule(name="test")
        section = Section(name="New")
        module.add_section(section)
        assert len(module.sections) == 1

    def test_equality(self) -> None:
        m1 = MAMModule(name="test", version="1.0.0")
        m2 = MAMModule(name="test", version="1.0.0")
        m3 = MAMModule(name="other", version="1.0.0")
        assert m1 == m2
        assert m1 != m3
        assert m1 != "not a module"

    def test_repr(self) -> None:
        module = MAMModule(name="test", version="1.0.0")
        r = repr(module)
        assert "test" in r
        assert "1.0.0" in r


class TestConstants:
    """Tests for module-level constants."""

    def test_standard_sections_order(self) -> None:
        assert "Purpose" in STANDARD_SECTIONS_ORDER
        assert "Inputs" in STANDARD_SECTIONS_ORDER
        assert STANDARD_SECTIONS_ORDER.index("Purpose") < STANDARD_SECTIONS_ORDER.index("Inputs")

    def test_required_sections(self) -> None:
        assert "Purpose" in REQUIRED_SECTIONS

    def test_code_section_names(self) -> None:
        assert "Python" in CODE_SECTION_NAMES
        assert "JavaScript" in CODE_SECTION_NAMES
