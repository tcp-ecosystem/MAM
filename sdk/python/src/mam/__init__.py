"""
MAM Python Package.

Provides Python bindings for MAM (Markdown as Module) parsing, validation,
execution, and plugin management.

Example::

    from mam import parse_mam, validate, MAMModule

    result = parse_mam(open("module.mam.md").read())
    issues = validate(result.ast)
    module = MAMModule.from_ast(result.ast)
"""

from .ast import (
    AST,
    CODE_SECTION_NAMES,
    CodeBlock,
    ContentNode,
    FrontMatter,
    ListItem,
    MAMModule,
    NodeType,
    ParseError,
    ParseResult,
    REQUIRED_SECTIONS,
    Section,
    SectionType,
    SourceLocation,
    STANDARD_SECTIONS_ORDER,
    Table,
    TableRow,
)
from .cli import main as cli_main
from .parser import MAMParser, parse_mam
from .plugins import (
    Plugin,
    PluginHook,
    PluginLifecycle,
    PluginManager,
    PluginMeta,
)
from .runtime import (
    ExecutionContext,
    ExecutionConfig,
    ExecutionResult,
    ExecutionStatus,
    MAMRuntime,
    execute,
)
from .validator import (
    MAMValidator,
    ValidationIssue,
    ValidationRule,
    ValidationSeverity,
    validate,
)

__all__ = [
    # AST types
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
    "Table",
    "TableRow",
    "STANDARD_SECTIONS_ORDER",
    "REQUIRED_SECTIONS",
    "CODE_SECTION_NAMES",
    # Parser
    "parse_mam",
    "MAMParser",
    # Validator
    "validate",
    "MAMValidator",
    "ValidationIssue",
    "ValidationRule",
    "ValidationSeverity",
    # Runtime
    "execute",
    "MAMRuntime",
    "ExecutionResult",
    "ExecutionConfig",
    "ExecutionContext",
    "ExecutionStatus",
    # Plugins
    "Plugin",
    "PluginManager",
    "PluginHook",
    "PluginLifecycle",
    "PluginMeta",
    # CLI
    "cli_main",
]
