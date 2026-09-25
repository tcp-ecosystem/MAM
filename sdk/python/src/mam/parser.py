"""
MAM Parser for Python.

Full-featured parser for MAM (Markdown as Module) documents. Parses YAML front
matter, Markdown sections, code blocks, tables, lists, blockquotes, and inline
elements into a structured AST with source location tracking and error recovery.
"""

from __future__ import annotations

import re
import time
from typing import Any, Dict, List, Optional, Tuple

import yaml

from .ast import (
    AST,
    CodeBlock,
    ContentNode,
    FrontMatter,
    ListItem,
    NodeType,
    ParseError,
    ParseResult,
    Section,
    SourceLocation,
    Table,
    TableRow,
)

__all__ = ["parse_mam", "MAMParser"]

FRONTMATTER_DELIMITER = "---"
HEADING_PATTERN = re.compile(r"^(#{1,6})\s+(.+)$")
FENCED_CODE_OPEN = re.compile(r"^(`{3,}|~{3,})(\w*)\s*$")
TABLE_SEPARATOR = re.compile(r"^\|?\s*[-:]+[-|:\s]*$")
TABLE_ROW = re.compile(r"^\|(.+)\|?\s*$")
UNORDERED_LIST = re.compile(r"^(\s*)([-*+])\s+(.+)$")
ORDERED_LIST = re.compile(r"^(\s*)(\d+[.)])\s+(.+)$")
BLOCKQUOTE = re.compile(r"^>\s?(.*)$")
HORIZONTAL_RULE = re.compile(r"^(\*{3,}|-{3,}|_{3,})\s*$")
TASK_CHECKED = re.compile(r"^\[x\]\s*", re.IGNORECASE)
TASK_UNCHECKED = re.compile(r"^\[\s?\]\s*")

VALID_ID_PATTERN = re.compile(r"^[a-z][a-z0-9-]{0,63}$")
SEMVER_PATTERN = re.compile(
    r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    r"(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)"
    r"(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?"
    r"(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$"
)

RUNTIME_LANGUAGES = {
    "python": "python",
    "javascript": "javascript",
    "js": "javascript",
    "typescript": "typescript",
    "ts": "typescript",
    "rust": "rust",
    "go": "go",
    "ruby": "ruby",
    "java": "java",
    "bash": "bash",
    "shell": "bash",
}


def _location(
    line: int, col: int = 0, end_line: Optional[int] = None,
    source: Optional[str] = None,
) -> SourceLocation:
    return SourceLocation(line=line, column=col, end_line=end_line, source=source)


class _FrontMatterParser:
    """Handles parsing of YAML front matter between --- delimiters."""

    def __init__(self, lines: List[str], source: Optional[str] = None):
        self._lines = lines
        self._source = source

    def parse(self) -> Tuple[FrontMatter, List[ParseError], int]:
        errors: List[ParseError] = []
        if not self._lines or self._lines[0].strip() != FRONTMATTER_DELIMITER:
            return FrontMatter(), errors, 0

        end_idx = -1
        for i in range(1, len(self._lines)):
            if self._lines[i].strip() == FRONTMATTER_DELIMITER:
                end_idx = i
                break

        if end_idx == -1:
            errors.append(
                ParseError(
                    message="Unclosed front matter: missing closing ---",
                    line=1,
                    severity="error",
                    source=self._source,
                )
            )
            return FrontMatter(), errors, 0

        raw = "\n".join(self._lines[1:end_idx])
        data: Dict[str, Any] = {}
        try:
            parsed = yaml.safe_load(raw)
            if isinstance(parsed, dict):
                data = parsed
            elif parsed is not None:
                errors.append(
                    ParseError(
                        message="Front matter must contain a YAML mapping",
                        line=1,
                        severity="error",
                        source=self._source,
                    )
                )
        except yaml.YAMLError as exc:
            err_line = 1
            if hasattr(exc, "problem_mark") and exc.problem_mark is not None:
                err_line = exc.problem_mark.line + 2
            errors.append(
                ParseError(
                    message=f"Invalid YAML in front matter: {exc}",
                    line=err_line,
                    severity="error",
                    source=self._source,
                )
            )

        location = _location(1, 0, end_idx + 1, self._source)
        fm = FrontMatter(raw=raw, data=data, location=location)
        return fm, errors, end_idx + 1


class _SectionParser:
    """Parses Markdown sections from lines after front matter."""

    def __init__(self, lines: List[str], start_line: int, source: Optional[str] = None):
        self._lines = lines
        self._start_line = start_line
        self._source = source

    def parse(self) -> Tuple[List[Section], List[ParseError]]:
        errors: List[ParseError] = []
        sections: List[Section] = []
        current_heading: Optional[Tuple[int, int, str]] = None
        current_lines: List[str] = []

        for i, line in enumerate(self._lines):
            line_num = self._start_line + i
            match = HEADING_PATTERN.match(line)
            if match:
                if current_heading is not None:
                    section = self._build_section(
                        current_heading, current_lines, line_num
                    )
                    sections.append(section)
                level = len(match.group(1))
                title = match.group(2).strip()
                current_heading = (line_num, level, title)
                current_lines = []
            else:
                current_lines.append(line)

        if current_heading is not None:
            section = self._build_section(
                current_heading, current_lines, self._start_line + len(self._lines)
            )
            sections.append(section)

        for section in sections:
            sec_errors = self._parse_section_content(section)
            errors.extend(sec_errors)

        return sections, errors

    def _build_section(
        self,
        heading: Tuple[int, int, str],
        body_lines: List[str],
        end_line: int,
    ) -> Section:
        line_num, level, title = heading
        raw_content = "\n".join(body_lines).strip()
        location = _location(line_num, 0, end_line, self._source)
        return Section(
            name=title,
            level=level,
            raw_content=raw_content,
            location=location,
        )

    def _parse_section_content(self, section: Section) -> List[ParseError]:
        errors: List[ParseError] = []
        lines = section.raw_content.split("\n") if section.raw_content else []
        i = 0

        while i < len(lines):
            line = lines[i]
            stripped = line.strip()

            if not stripped:
                i += 1
                continue

            code_match = FENCED_CODE_OPEN.match(stripped)
            if code_match:
                block, end_idx, block_errors = self._parse_code_block(
                    lines, i, section.location
                )
                if block:
                    section.code_blocks.append(block)
                errors.extend(block_errors)
                i = end_idx + 1
                continue

            if TABLE_SEPARATOR.match(stripped) and i > 0:
                table, end_idx, table_errors = self._parse_table(lines, i)
                if table:
                    section.tables.append(table)
                errors.extend(table_errors)
                i = end_idx + 1
                continue

            table_row_match = TABLE_ROW.match(stripped)
            if table_row_match and (
                i + 1 < len(lines) and TABLE_SEPARATOR.match(lines[i + 1].strip())
            ):
                table, end_idx, table_errors = self._parse_table(lines, i)
                if table:
                    section.tables.append(table)
                errors.extend(table_errors)
                i = end_idx + 1
                continue

            ul_match = UNORDERED_LIST.match(line)
            ol_match = ORDERED_LIST.match(line)
            if ul_match or ol_match:
                list_items, end_idx = self._parse_list(lines, i, ul_match is not None)
                if list_items:
                    section.lists.append(list_items)
                section.content_nodes.append(
                    ContentNode(
                        node_type=NodeType.LIST,
                        content="\n".join(
                            f"{'  ' * item.level}{item.content}" for item in list_items
                        ),
                        location=_location(
                            self._start_line + i, 0,
                            self._start_line + end_idx, self._source,
                        ),
                    )
                )
                i = end_idx + 1
                continue

            bq_match = BLOCKQUOTE.match(stripped)
            if bq_match:
                bq_lines = [bq_match.group(1)]
                j = i + 1
                while j < len(lines):
                    next_bq = BLOCKQUOTE.match(lines[j].strip())
                    if next_bq:
                        bq_lines.append(next_bq.group(1))
                        j += 1
                    else:
                        break
                section.content_nodes.append(
                    ContentNode(
                        node_type=NodeType.BLOCKQUOTE,
                        content="\n".join(bq_lines),
                        location=_location(
                            self._start_line + i, 0,
                            self._start_line + j - 1, self._source,
                        ),
                    )
                )
                i = j
                continue

            if HORIZONTAL_RULE.match(stripped):
                section.content_nodes.append(
                    ContentNode(
                        node_type=NodeType.HORIZONTAL_RULE,
                        content=stripped,
                        location=_location(self._start_line + i, 0, None, self._source),
                    )
                )
                i += 1
                continue

            para_lines = [stripped]
            j = i + 1
            while j < len(lines):
                next_stripped = lines[j].strip()
                if not next_stripped:
                    break
                if HEADING_PATTERN.match(next_stripped):
                    break
                if FENCED_CODE_OPEN.match(next_stripped):
                    break
                if HORIZONTAL_RULE.match(next_stripped):
                    break
                if TABLE_ROW.match(next_stripped):
                    break
                if UNORDERED_LIST.match(lines[j]) or ORDERED_LIST.match(lines[j]):
                    break
                if BLOCKQUOTE.match(next_stripped):
                    break
                para_lines.append(next_stripped)
                j += 1

            section.content_nodes.append(
                ContentNode(
                    node_type=NodeType.PARAGRAPH,
                    content=" ".join(para_lines),
                    location=_location(
                        self._start_line + i, 0,
                        self._start_line + j - 1, self._source,
                    ),
                )
            )
            i = j

        return errors

    def _parse_code_block(
        self,
        lines: List[str],
        start_idx: int,
        parent_location: Optional[SourceLocation] = None,
    ) -> Tuple[Optional[CodeBlock], int, List[ParseError]]:
        errors: List[ParseError] = []
        match = FENCED_CODE_OPEN.match(lines[start_idx].strip())
        if not match:
            return None, start_idx, errors

        fence_char = match.group(1)[0]
        fence_len = len(match.group(1))
        language = match.group(2).strip()
        code_lines: List[str] = []
        close_pattern = re.compile(f"^{re.escape(fence_char)}{{{fence_len},}}\\s*$")

        i = start_idx + 1
        found_close = False
        while i < len(lines):
            if close_pattern.match(lines[i].strip()):
                found_close = True
                break
            code_lines.append(lines[i])
            i += 1

        if not found_close:
            errors.append(
                ParseError(
                    message=f"Unclosed code block (started with {fence_char * fence_len})",
                    line=self._start_line + start_idx,
                    severity="warning",
                    source=self._source,
                )
            )
            code_lines = lines[start_idx + 1:]

        code = "\n".join(code_lines)
        is_executable = language.lower() in RUNTIME_LANGUAGES
        location = _location(
            self._start_line + start_idx, 0,
            self._start_line + i, self._source,
        )
        block = CodeBlock(
            language=language,
            code=code,
            location=location,
            is_executable=is_executable,
        )
        return block, i, errors

    def _parse_table(
        self, lines: List[str], start_idx: int
    ) -> Tuple[Optional[Table], int, List[ParseError]]:
        errors: List[ParseError] = []
        i = start_idx

        header_match = TABLE_ROW.match(lines[i].strip())
        if not header_match:
            return None, i, errors

        headers = self._split_table_row(header_match.group(1))
        i += 1

        if i >= len(lines) or not TABLE_SEPARATOR.match(lines[i].strip()):
            return None, i, errors

        sep_cells = self._split_table_row(
            TABLE_SEPARATOR.match(lines[i].strip()).group(0)  # type: ignore
        ) if TABLE_SEPARATOR.match(lines[i].strip()) else []
        alignments = [self._detect_alignment(c) for c in sep_cells]
        i += 1

        rows: List[TableRow] = []
        while i < len(lines):
            row_match = TABLE_ROW.match(lines[i].strip())
            if not row_match:
                break
            cells = self._split_table_row(row_match.group(1))
            rows.append(TableRow(cells=cells, is_header=False))
            i += 1

        table = Table(headers=headers, rows=rows, alignments=alignments)
        return table, i - 1, errors

    def _split_table_row(self, content: str) -> List[str]:
        cells = [c.strip() for c in content.split("|")]
        result: List[str] = []
        for i, c in enumerate(cells):
            if c:
                result.append(c)
            elif i > 0 and i < len(cells) - 1:
                result.append("")
        return result

    def _detect_alignment(self, separator: str) -> Optional[str]:
        sep = separator.strip()
        if sep.startswith(":") and sep.endswith(":"):
            return "center"
        if sep.endswith(":"):
            return "right"
        if sep.startswith(":"):
            return "left"
        return None

    def _parse_list(
        self, lines: List[str], start_idx: int, unordered: bool
    ) -> Tuple[List[ListItem], int]:
        items: List[ListItem] = []
        i = start_idx
        pattern = UNORDERED_LIST if unordered else ORDERED_LIST

        while i < len(lines):
            match = pattern.match(lines[i])
            if not match:
                break

            indent = len(match.group(1))
            level = indent // 2
            content = match.group(3)

            checked: Optional[bool] = None
            if unordered:
                checked_match = TASK_CHECKED.match(content)
                if checked_match:
                    checked = True
                    content = content[checked_match.end():]
                else:
                    unchecked_match = TASK_UNCHECKED.match(content)
                    if unchecked_match:
                        checked = False
                        content = content[unchecked_match.end():]

            items.append(
                ListItem(
                    content=content.strip(),
                    level=level,
                    ordered=not unordered,
                    checked=checked,
                )
            )
            i += 1

        return items, i - 1 if items else start_idx


class MAMParser:
    """Full MAM document parser with error recovery.

    Parses MAM (.mam.md) documents into structured ASTs with support for:
    - YAML front matter with validation
    - Hierarchical Markdown sections
    - Fenced code blocks with language detection
    - Tables with alignment detection
    - Ordered and unordered lists with task checkboxes
    - Blockquotes and horizontal rules
    - Source location tracking for all nodes

    Example::

        parser = MAMParser()
        result = parser.parse(source_text, source="module.mam.md")
        if result.success:
            print(result.ast.to_dict())
        else:
            for error in result.errors:
                print(error)
    """

    def __init__(self, strict: bool = False, validate_ids: bool = True):
        self.strict = strict
        self.validate_ids = validate_ids

    def parse(
        self, content: str, source: Optional[str] = None
    ) -> ParseResult:
        start_time = time.monotonic()
        errors: List[ParseError] = []
        warnings: List[ParseError] = []

        lines = content.split("\n")

        fm_parser = _FrontMatterParser(lines, source)
        frontmatter, fm_errors, body_start = fm_parser.parse()
        for e in fm_errors:
            if e.severity == "warning":
                warnings.append(e)
            else:
                errors.append(e)

        if not frontmatter.data and not fm_errors:
            errors.append(
                ParseError(
                    message="Missing required YAML front matter (document must start with ---)",
                    line=1,
                    severity="error",
                    source=source,
                )
            )

        if self.validate_ids:
            id_errors = self._validate_frontmatter(frontmatter, source)
            for e in id_errors:
                if e.severity == "warning":
                    warnings.append(e)
                else:
                    errors.append(e)

        body_lines = lines[body_start:]
        section_parser = _SectionParser(body_lines, body_start + 1, source)
        sections, sec_errors = section_parser.parse()
        for e in sec_errors:
            if e.severity == "warning":
                warnings.append(e)
            else:
                errors.append(e)

        if not sections and not errors:
            warnings.append(
                ParseError(
                    message="No sections found in document",
                    line=1,
                    severity="warning",
                    source=source,
                )
            )

        ast = AST(
            frontmatter=frontmatter,
            sections=sections,
            errors=errors,
            warnings=warnings,
            source=source,
            raw_content=content,
        )

        elapsed = (time.monotonic() - start_time) * 1000
        return ParseResult(ast=ast, source=source, parse_time_ms=elapsed)

    def _validate_frontmatter(
        self, fm: FrontMatter, source: Optional[str]
    ) -> List[ParseError]:
        errors: List[ParseError] = []
        fm_line = fm.location.line if fm.location else 1

        if not fm.id:
            errors.append(
                ParseError(
                    message="Missing required field 'id' in front matter",
                    line=fm_line,
                    severity="warning",
                    source=source,
                )
            )
        elif not VALID_ID_PATTERN.match(str(fm.id)):
            errors.append(
                ParseError(
                    message=(
                        f"Invalid module id '{fm.id}': must be lowercase alphanumeric "
                        "with hyphens, start with a letter, max 64 chars"
                    ),
                    line=fm_line,
                    severity="error",
                    source=source,
                )
            )

        if not fm.version:
            errors.append(
                ParseError(
                    message="Missing required field 'version' in front matter",
                    line=fm_line,
                    severity="warning",
                    source=source,
                )
            )
        elif not SEMVER_PATTERN.match(str(fm.version)):
            errors.append(
                ParseError(
                    message=f"Invalid version '{fm.version}': must follow SemVer 2.0.0",
                    line=fm_line,
                    severity="error",
                    source=source,
                )
            )

        if not fm.name:
            errors.append(
                ParseError(
                    message="Missing required field 'name' in front matter",
                    line=fm_line,
                    severity="warning",
                    source=source,
                )
            )

        if not fm.author:
            errors.append(
                ParseError(
                    message="Missing required field 'author' in front matter",
                    line=fm_line,
                    severity="warning",
                    source=source,
                )
            )

        runtime = fm.runtime
        if runtime and runtime.lower() not in RUNTIME_LANGUAGES:
            errors.append(
                ParseError(
                    message=(
                        f"Unknown runtime '{runtime}': expected one of "
                        f"{sorted(RUNTIME_LANGUAGES.keys())}"
                    ),
                    line=fm_line,
                    severity="warning",
                    source=source,
                )
            )

        if fm.tags and not isinstance(fm.tags, list):
            errors.append(
                ParseError(
                    message="Field 'tags' must be a list",
                    line=fm_line,
                    severity="error",
                    source=source,
                )
            )

        if fm.dependencies and not isinstance(fm.dependencies, list):
            errors.append(
                ParseError(
                    message="Field 'dependencies' must be a list",
                    line=fm_line,
                    severity="error",
                    source=source,
                )
            )

        return errors


def parse_mam(
    content: str, source: Optional[str] = None, strict: bool = False
) -> ParseResult:
    """Parse a MAM document string into a ParseResult containing the AST.

    This is the primary entry point for parsing MAM content. It handles
    front matter extraction, YAML parsing, section parsing, code block
    detection, and structural validation.

    Args:
        content: The raw MAM document string.
        source: Optional source identifier for error reporting.
        strict: If True, treat warnings as errors.

    Returns:
        ParseResult with the parsed AST, errors, and timing info.

    Example::

        result = parse_mam(open("module.mam.md").read(), source="module.mam.md")
        if result.success:
            print(result.ast.frontmatter.id)
            for section in result.ast.sections:
                print(section.name)
    """
    parser = MAMParser(strict=strict)
    return parser.parse(content, source=source)


def parse_mam_safe(
    content: str, source: Optional[str] = None, strict: bool = False
) -> ParseResult:
    """Parse a MAM document, converting unexpected failures into parse errors.

    Unlike :func:`parse_mam` this never raises: any unexpected exception is
    captured as a ``ParseError`` on the returned result.
    """

    try:
        return parse_mam(content, source=source, strict=strict)
    except Exception as exc:  # noqa: BLE001
        ast = AST()
        ast.errors.append(
            ParseError(message=f"Internal parser error: {exc}", source=source)
        )
        return ParseResult(ast=ast, source=source)


def extract_front_matter(content: str) -> Dict[str, Any]:
    """Return the front matter mapping of a MAM document.

    An empty dict is returned when the document has no front matter block or
    when the block is not a YAML mapping.
    """

    if not content:
        return {}
    lines = content.splitlines()
    if not lines:
        return {}
    if lines[0].strip() != FRONTMATTER_DELIMITER:
        return {}
    for index in range(1, len(lines)):
        if lines[index].strip() == FRONTMATTER_DELIMITER:
            raw = "\n".join(lines[1:index])
            try:
                loaded = yaml.safe_load(raw)
            except yaml.YAMLError:
                return {}
            if isinstance(loaded, dict):
                return loaded
            return {}
    return {}


def split_sections(content: str) -> List[Tuple[str, str]]:
    """Split a MAM document into ``(heading, body)`` pairs.

    The front matter block is ignored. Headings at depth 1-6 are recognized and
    each heading's body runs until the next heading at the same or shallower
    depth.
    """

    if not content:
        return []
    lines = content.splitlines()
    start = 0
    if lines and lines[0].strip() == FRONTMATTER_DELIMITER:
        for index in range(1, len(lines)):
            if lines[index].strip() == FRONTMATTER_DELIMITER:
                start = index + 1
                break
    results: List[Tuple[str, str]] = []
    current_name: Optional[str] = None
    current_depth = 0
    buffer: List[str] = []
    for line in lines[start:]:
        match = HEADING_PATTERN.match(line)
        if match:
            if current_name is not None:
                results.append((current_name, "\n".join(buffer).strip("\n")))
            current_name = match.group(2).strip()
            current_depth = len(match.group(1))
            buffer = []
            continue
        if current_name is not None:
            if not line.strip() and not buffer:
                continue
            buffer.append(line)
    if current_name is not None:
        results.append((current_name, "\n".join(buffer).strip("\n")))
    _ = current_depth
    return results


def strip_code_blocks(content: str) -> str:
    """Return the document with every fenced code block replaced by a marker.

    Useful for prose-oriented analysis such as word counts or documentation
    checks where executable content should not be counted.
    """

    if not content:
        return ""
    output: List[str] = []
    fence: Optional[str] = None
    for line in content.splitlines():
        stripped = line.strip()
        if fence is None:
            opening = FENCED_CODE_OPEN.match(stripped)
            if opening:
                fence = opening.group(1)[0] * 3
                output.append("```")
                continue
            output.append(line)
        else:
            if stripped.startswith(fence):
                fence = None
                output.append("```")
            else:
                output.append("```")
    return "\n".join(output)


def count_headings(content: str) -> int:
    """Return the number of Markdown headings in the document."""

    if not content:
        return 0
    return sum(1 for line in content.splitlines() if HEADING_PATTERN.match(line))


def extract_code_blocks(content: str) -> List[CodeBlock]:
    """Return every fenced code block in the document, in order.

    This works on raw text and does not require a full parse, so it is safe to
    use on documents that do not parse cleanly.
    """

    blocks: List[CodeBlock] = []
    if not content:
        return blocks
    fence: Optional[str] = None
    language = ""
    buffer: List[str] = []
    for line in content.splitlines():
        if fence is None:
            opening = FENCED_CODE_OPEN.match(line.strip())
            if opening:
                fence = opening.group(1)[0] * 3
                language = opening.group(2) or ""
                buffer = []
            continue
        if line.strip().startswith(fence):
            blocks.append(
                CodeBlock(language=language, code="\n".join(buffer), is_executable=False)
            )
            fence = None
            language = ""
            buffer = []
            continue
        buffer.append(line)
    return blocks


def normalize_mam(content: str) -> str:
    """Normalize line endings and trailing whitespace for stable output.

    CRLF and CR line endings become LF, trailing whitespace is removed from each
    line, runs of three or more blank lines collapse to one, and the result
    always ends with exactly one newline.
    """

    if not content:
        return ""
    text = content.replace("\r\n", "\n").replace("\r", "\n")
    lines = [line.rstrip() for line in text.split("\n")]
    collapsed: List[str] = []
    blank_run = 0
    for line in lines:
        if line:
            blank_run = 0
            collapsed.append(line)
            continue
        blank_run += 1
        if blank_run <= 1:
            collapsed.append(line)
    while collapsed and not collapsed[-1]:
        collapsed.pop()
    return "\n".join(collapsed) + "\n"


def detect_runtime(content: str) -> Optional[str]:
    """Infer the primary runtime language of a MAM document.

    Front matter wins when it declares a runtime. Otherwise the most common
    code block language is used, mapped to a canonical runtime name. Returns
    None when the document declares and contains nothing conclusive.
    """

    declared = extract_front_matter(content).get("runtime")
    if isinstance(declared, str) and declared.strip():
        return declared.strip()
    counts: Dict[str, int] = {}
    for block in extract_code_blocks(content):
        key = block.language or "unknown"
        counts[key] = counts.get(key, 0) + 1
    if not counts:
        return None
    best = sorted(counts.items(), key=lambda item: (-item[1], item[0]))[0][0]
    aliases = {
        "py": "python",
        "python": "python",
        "js": "javascript",
        "javascript": "javascript",
        "ts": "typescript",
        "typescript": "typescript",
        "sh": "shell",
        "bash": "shell",
        "shell": "shell",
    }
    return aliases.get(best, best)


__all__ = [
    "MAMParser",
    "count_headings",
    "detect_runtime",
    "extract_code_blocks",
    "extract_front_matter",
    "normalize_mam",
    "parse_mam",
    "parse_mam_safe",
    "split_sections",
    "strip_code_blocks",
]
