"""
MAM AST types and utilities.

Provides dataclass-based AST node types for representing parsed MAM modules,
along with a builder-pattern MAMModule class for constructing module instances
with serialization support.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


class NodeType(Enum):
    """Enumeration of all AST node types."""

    PARAGRAPH = "paragraph"
    HEADING = "heading"
    CODE_BLOCK = "code_block"
    TABLE = "table"
    LIST = "list"
    BLOCKQUOTE = "blockquote"
    HORIZONTAL_RULE = "horizontal_rule"
    MERMAID = "mermaid"
    FRONTMATTER = "frontmatter"
    SECTION = "section"
    DOCUMENT = "document"


class SectionType(Enum):
    """Standard MAM section types as defined by the spec."""

    PURPOSE = "Purpose"
    INPUTS = "Inputs"
    OUTPUTS = "Outputs"
    RULES = "Rules"
    WORKFLOW = "Workflow"
    MERMAID = "Mermaid"
    PYTHON = "Python"
    JAVASCRIPT = "JavaScript"
    PROMPT = "Prompt"
    MEMORY = "Memory"
    EXAMPLES = "Examples"
    TESTS = "Tests"
    REFERENCES = "References"
    DEPENDENCIES = "Dependencies"
    EXPORTS = "Exports"
    IMPORTS = "Imports"
    PLUGINS = "Plugins"
    PERMISSIONS = "Permissions"
    CAPABILITIES = "Capabilities"


STANDARD_SECTIONS_ORDER: List[str] = [
    SectionType.PURPOSE.value,
    SectionType.INPUTS.value,
    SectionType.OUTPUTS.value,
    SectionType.RULES.value,
    SectionType.WORKFLOW.value,
    SectionType.MERMAID.value,
    SectionType.PYTHON.value,
    SectionType.JAVASCRIPT.value,
    SectionType.PROMPT.value,
    SectionType.MEMORY.value,
    SectionType.EXAMPLES.value,
    SectionType.TESTS.value,
    SectionType.REFERENCES.value,
    SectionType.DEPENDENCIES.value,
    SectionType.EXPORTS.value,
    SectionType.IMPORTS.value,
    SectionType.PLUGINS.value,
    SectionType.PERMISSIONS.value,
    SectionType.CAPABILITIES.value,
]

REQUIRED_SECTIONS: List[str] = [SectionType.PURPOSE.value]

CODE_SECTION_NAMES: List[str] = [
    SectionType.PYTHON.value,
    SectionType.JAVASCRIPT.value,
]


@dataclass
class SourceLocation:
    """Tracks the origin position of an AST node in the source document."""

    line: int
    column: int = 0
    end_line: Optional[int] = None
    end_column: Optional[int] = None
    source: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        result: Dict[str, Any] = {"line": self.line, "column": self.column}
        if self.end_line is not None:
            result["end_line"] = self.end_line
        if self.end_column is not None:
            result["end_column"] = self.end_column
        if self.source is not None:
            result["source"] = self.source
        return result


@dataclass
class ContentNode:
    """Base content node within a section."""

    node_type: NodeType
    content: str = ""
    children: List[ContentNode] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)
    location: Optional[SourceLocation] = None

    def to_dict(self) -> Dict[str, Any]:
        result: Dict[str, Any] = {
            "node_type": self.node_type.value,
            "content": self.content,
        }
        if self.children:
            result["children"] = [c.to_dict() for c in self.children]
        if self.metadata:
            result["metadata"] = self.metadata
        if self.location:
            result["location"] = self.location.to_dict()
        return result


@dataclass
class CodeBlock:
    """Represents a fenced code block with language and execution metadata."""

    language: str
    code: str
    location: Optional[SourceLocation] = None
    is_executable: bool = False
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        result: Dict[str, Any] = {
            "language": self.language,
            "code": self.code,
            "is_executable": self.is_executable,
        }
        if self.location:
            result["location"] = self.location.to_dict()
        if self.metadata:
            result["metadata"] = self.metadata
        return result


@dataclass
class TableRow:
    """A single row in a Markdown table."""

    cells: List[str] = field(default_factory=list)
    is_header: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {"cells": self.cells, "is_header": self.is_header}


@dataclass
class Table:
    """Represents a Markdown table with header and data rows."""

    headers: List[str] = field(default_factory=list)
    rows: List[TableRow] = field(default_factory=list)
    alignments: List[Optional[str]] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "headers": self.headers,
            "rows": [r.to_dict() for r in self.rows],
            "alignments": self.alignments,
        }


@dataclass
class ListItem:
    """A single item in a Markdown list."""

    content: str
    level: int = 0
    ordered: bool = False
    checked: Optional[bool] = None

    def to_dict(self) -> Dict[str, Any]:
        result: Dict[str, Any] = {
            "content": self.content,
            "level": self.level,
            "ordered": self.ordered,
        }
        if self.checked is not None:
            result["checked"] = self.checked
        return result


@dataclass
class FrontMatter:
    """Represents parsed YAML front matter from a MAM document."""

    raw: str = ""
    data: Dict[str, Any] = field(default_factory=dict)
    location: Optional[SourceLocation] = None

    @property
    def id(self) -> Optional[str]:
        return self.data.get("id")

    @property
    def version(self) -> Optional[str]:
        return self.data.get("version")

    @property
    def name(self) -> Optional[str]:
        return self.data.get("name")

    @property
    def author(self) -> Optional[str]:
        return self.data.get("author")

    @property
    def runtime(self) -> Optional[str]:
        return self.data.get("runtime")

    @property
    def tags(self) -> List[str]:
        return self.data.get("tags", [])

    @property
    def description(self) -> Optional[str]:
        return self.data.get("description")

    @property
    def dependencies(self) -> List[str]:
        return self.data.get("dependencies", [])

    @property
    def permissions(self) -> List[str]:
        return self.data.get("permissions", [])

    def get(self, key: str, default: Any = None) -> Any:
        return self.data.get(key, default)

    def to_dict(self) -> Dict[str, Any]:
        result: Dict[str, Any] = {"data": dict(self.data)}
        if self.location:
            result["location"] = self.location.to_dict()
        return result


@dataclass
class Section:
    """Represents a parsed Markdown section (## heading + body content)."""

    name: str
    level: int = 2
    content_nodes: List[ContentNode] = field(default_factory=list)
    code_blocks: List[CodeBlock] = field(default_factory=list)
    tables: List[Table] = field(default_factory=list)
    lists: List[List[ListItem]] = field(default_factory=list)
    raw_content: str = ""
    location: Optional[SourceLocation] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    @property
    def is_standard(self) -> bool:
        return self.name in [s.value for s in SectionType]

    @property
    def section_type(self) -> Optional[SectionType]:
        try:
            return SectionType(self.name)
        except ValueError:
            return None

    @property
    def has_code(self) -> bool:
        return len(self.code_blocks) > 0

    @property
    def text_content(self) -> str:
        parts: List[str] = []
        for node in self.content_nodes:
            if node.node_type in (NodeType.PARAGRAPH, NodeType.BLOCKQUOTE):
                parts.append(node.content)
        return "\n".join(parts)

    def get_code_by_language(self, language: str) -> Optional[CodeBlock]:
        for block in self.code_blocks:
            if block.language.lower() == language.lower():
                return block
        return None

    def to_dict(self) -> Dict[str, Any]:
        result: Dict[str, Any] = {
            "name": self.name,
            "level": self.level,
            "raw_content": self.raw_content,
        }
        if self.content_nodes:
            result["content_nodes"] = [n.to_dict() for n in self.content_nodes]
        if self.code_blocks:
            result["code_blocks"] = [b.to_dict() for b in self.code_blocks]
        if self.tables:
            result["tables"] = [t.to_dict() for t in self.tables]
        if self.lists:
            result["lists"] = [
                [item.to_dict() for item in lst] for lst in self.lists
            ]
        if self.location:
            result["location"] = self.location.to_dict()
        if self.metadata:
            result["metadata"] = self.metadata
        return result


@dataclass
class ParseError:
    """Represents a parsing error with location and severity info."""

    message: str
    line: int = 0
    column: int = 0
    severity: str = "error"
    source: Optional[str] = None
    context: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        result: Dict[str, Any] = {
            "message": self.message,
            "line": self.line,
            "column": self.column,
            "severity": self.severity,
        }
        if self.source:
            result["source"] = self.source
        if self.context:
            result["context"] = self.context
        return result

    def __str__(self) -> str:
        loc = f"line {self.line}" if self.line else "unknown location"
        return f"[{self.severity}] {self.message} (at {loc})"


@dataclass
class AST:
    """Root AST node representing a fully parsed MAM document."""

    frontmatter: FrontMatter = field(default_factory=FrontMatter)
    sections: List[Section] = field(default_factory=list)
    errors: List[ParseError] = field(default_factory=list)
    warnings: List[ParseError] = field(default_factory=list)
    source: Optional[str] = None
    raw_content: str = ""

    @property
    def title(self) -> Optional[str]:
        if self.sections:
            return self.sections[0].name
        return self.frontmatter.name

    @property
    def module_id(self) -> Optional[str]:
        return self.frontmatter.id

    @property
    def version(self) -> Optional[str]:
        return self.frontmatter.version

    @property
    def purpose(self) -> Optional[Section]:
        for section in self.sections:
            if section.name == SectionType.PURPOSE.value:
                return section
        return None

    @property
    def code_sections(self) -> List[Section]:
        return [s for s in self.sections if s.has_code]

    @property
    def all_code_blocks(self) -> List[CodeBlock]:
        blocks: List[CodeBlock] = []
        for section in self.sections:
            blocks.extend(section.code_blocks)
        return blocks

    @property
    def section_names(self) -> List[str]:
        return [s.name for s in self.sections]

    def get_section(self, name: str) -> Optional[Section]:
        for section in self.sections:
            if section.name == name:
                return section
        return None

    def has_section(self, name: str) -> bool:
        return self.get_section(name) is not None

    def has_errors(self) -> bool:
        return len(self.errors) > 0

    def to_dict(self) -> Dict[str, Any]:
        result: Dict[str, Any] = {
            "frontmatter": self.frontmatter.to_dict(),
            "sections": [s.to_dict() for s in self.sections],
        }
        if self.errors:
            result["errors"] = [e.to_dict() for e in self.errors]
        if self.warnings:
            result["warnings"] = [e.to_dict() for e in self.warnings]
        if self.source:
            result["source"] = self.source
        return result

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.to_dict(), indent=indent, ensure_ascii=False)

    def to_markdown(self) -> str:
        lines: List[str] = []
        if self.frontmatter.raw:
            lines.append("---")
            lines.append(self.frontmatter.raw.strip())
            lines.append("---")
            lines.append("")
        for section in self.sections:
            prefix = "#" * section.level
            lines.append(f"{prefix} {section.name}")
            lines.append("")
            if section.raw_content:
                lines.append(section.raw_content.strip())
                lines.append("")
        return "\n".join(lines)


class ParseResult:
    """Container for parse output including AST, errors, and metadata."""

    def __init__(
        self,
        ast: AST,
        source: Optional[str] = None,
        parse_time_ms: float = 0.0,
    ):
        self.ast = ast
        self.source = source
        self.parse_time_ms = parse_time_ms

    @property
    def success(self) -> bool:
        return not self.ast.has_errors()

    @property
    def errors(self) -> List[ParseError]:
        return self.ast.errors

    @property
    def warnings(self) -> List[ParseError]:
        return self.ast.warnings

    def to_dict(self) -> Dict[str, Any]:
        result: Dict[str, Any] = {
            "success": self.success,
            "ast": self.ast.to_dict(),
            "parse_time_ms": self.parse_time_ms,
        }
        if self.source:
            result["source"] = self.source
        return result

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.to_dict(), indent=indent, ensure_ascii=False)


class MAMModule:
    """High-level module representation with builder pattern for construction.

    Provides a fluent API for building MAM module instances and supports
    serialization to dict, JSON, and Markdown formats.

    Example::

        module = (
            MAMModule.Builder("my-module")
            .version("1.0.0")
            .author("Alice")
            .runtime("python")
            .description("My awesome module")
            .tag("utility")
            .tag("helper")
            .section("Purpose", "Does useful things.")
            .code_block("python", "def process(): pass")
            .build()
        )
        print(module.to_json())
    """

    def __init__(
        self,
        name: str,
        version: str = "0.1.0",
        author: str = "",
        runtime: str = "python",
        description: str = "",
        tags: Optional[List[str]] = None,
        dependencies: Optional[List[str]] = None,
        permissions: Optional[List[str]] = None,
        sections: Optional[List[Section]] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ):
        self.name = name
        self.version = version
        self.author = author
        self.runtime = runtime
        self.description = description
        self.tags: List[str] = list(tags or [])
        self.dependencies: List[str] = list(dependencies or [])
        self.permissions: List[str] = list(permissions or [])
        self.sections: List[Section] = list(sections or [])
        self.metadata: Dict[str, Any] = dict(metadata or {})

    class Builder:
        """Fluent builder for constructing MAMModule instances."""

        def __init__(self, name: str):
            self._name = name
            self._version = "0.1.0"
            self._author = ""
            self._runtime = "python"
            self._description = ""
            self._tags: List[str] = []
            self._dependencies: List[str] = []
            self._permissions: List[str] = []
            self._sections: List[Section] = []
            self._metadata: Dict[str, Any] = {}

        def version(self, v: str) -> MAMModule.Builder:
            self._version = v
            return self

        def author(self, a: str) -> MAMModule.Builder:
            self._author = a
            return self

        def runtime(self, r: str) -> MAMModule.Builder:
            self._runtime = r
            return self

        def description(self, d: str) -> MAMModule.Builder:
            self._description = d
            return self

        def tag(self, t: str) -> MAMModule.Builder:
            self._tags.append(t)
            return self

        def dependency(self, d: str) -> MAMModule.Builder:
            self._dependencies.append(d)
            return self

        def permission(self, p: str) -> MAMModule.Builder:
            self._permissions.append(p)
            return self

        def section(self, name: str, content: str) -> MAMModule.Builder:
            sec = Section(name=name, raw_content=content)
            sec.content_nodes.append(
                ContentNode(node_type=NodeType.PARAGRAPH, content=content)
            )
            self._sections.append(sec)
            return self

        def code_block(self, language: str, code: str) -> MAMModule.Builder:
            block = CodeBlock(language=language, code=code, is_executable=True)
            sec_name = language.capitalize()
            existing = self._find_section(sec_name)
            if existing:
                existing.code_blocks.append(block)
            else:
                sec = Section(name=sec_name, code_blocks=[block])
                self._sections.append(sec)
            return self

        def metadata(self, key: str, value: Any) -> MAMModule.Builder:
            self._metadata[key] = value
            return self

        def _find_section(self, name: str) -> Optional[Section]:
            for sec in self._sections:
                if sec.name == name:
                    return sec
            return None

        def build(self) -> MAMModule:
            return MAMModule(
                name=self._name,
                version=self._version,
                author=self._author,
                runtime=self._runtime,
                description=self._description,
                tags=list(self._tags),
                dependencies=list(self._dependencies),
                permissions=list(self._permissions),
                sections=list(self._sections),
                metadata=dict(self._metadata),
            )

    @classmethod
    def from_ast(cls, ast: AST) -> MAMModule:
        fm = ast.frontmatter
        return cls(
            name=fm.name or ast.title or "unnamed",
            version=fm.version or "0.1.0",
            author=fm.author or "",
            runtime=fm.runtime or "python",
            description=fm.description or "",
            tags=fm.tags,
            dependencies=fm.dependencies,
            permissions=fm.permissions,
            sections=list(ast.sections),
        )

    def to_dict(self) -> Dict[str, Any]:
        result: Dict[str, Any] = {
            "name": self.name,
            "version": self.version,
            "author": self.author,
            "runtime": self.runtime,
            "description": self.description,
            "sections": [s.to_dict() for s in self.sections],
        }
        if self.tags:
            result["tags"] = list(self.tags)
        if self.dependencies:
            result["dependencies"] = list(self.dependencies)
        if self.permissions:
            result["permissions"] = list(self.permissions)
        if self.metadata:
            result["metadata"] = dict(self.metadata)
        return result

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.to_dict(), indent=indent, ensure_ascii=False)

    def to_markdown(self) -> str:
        lines: List[str] = []
        lines.append("---")
        fm_data: Dict[str, Any] = {
            "id": self.name,
            "version": self.version,
            "name": self.name,
        }
        if self.author:
            fm_data["author"] = self.author
        if self.runtime:
            fm_data["runtime"] = self.runtime
        if self.tags:
            fm_data["tags"] = self.tags
        if self.description:
            fm_data["description"] = self.description
        if self.dependencies:
            fm_data["dependencies"] = self.dependencies
        if self.permissions:
            fm_data["permissions"] = self.permissions
        for key, value in fm_data.items():
            if isinstance(value, list):
                lines.append(f"{key}:")
                for item in value:
                    lines.append(f"  - {item}")
            else:
                lines.append(f"{key}: {value}")
        lines.append("---")
        lines.append("")
        lines.append(f"# {self.name}")
        lines.append("")
        for section in self.sections:
            prefix = "#" * section.level
            lines.append(f"{prefix} {section.name}")
            lines.append("")
            if section.raw_content:
                lines.append(section.raw_content.strip())
                lines.append("")
            for block in section.code_blocks:
                lines.append(f"```{block.language}")
                lines.append(block.code.strip())
                lines.append("```")
                lines.append("")
        return "\n".join(lines)

    def get_section(self, name: str) -> Optional[Section]:
        for section in self.sections:
            if section.name == name:
                return section
        return None

    def add_section(self, section: Section) -> MAMModule:
        self.sections.append(section)
        return self

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, MAMModule):
            return NotImplemented
        return (
            self.name == other.name
            and self.version == other.version
            and self.author == other.author
            and self.runtime == other.runtime
            and self.description == other.description
            and self.tags == other.tags
            and self.dependencies == other.dependencies
            and self.permissions == other.permissions
        )

    def __repr__(self) -> str:
        return (
            f"MAMModule(name={self.name!r}, version={self.version!r}, "
            f"sections={len(self.sections)})"
        )


__all__ = [
    "AST",
    "CodeBlock",
    "ContentNode",
    "FrontMatter",
    "ListItem",
    "MAMModule",
    "NodeType",
    "ParseError",
    "ParseResult",
    "Section",
    "SectionType",
    "SourceLocation",
    "STANDARD_SECTIONS_ORDER",
    "REQUIRED_SECTIONS",
    "CODE_SECTION_NAMES",
    "Table",
    "TableRow",
]
