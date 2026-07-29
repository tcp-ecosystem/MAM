# MAM AST Specification
# Version: 1.0.0
# Complete AST node type definitions and serialization format

# ============================================================================
# Overview
# ============================================================================

# The MAM Abstract Syntax Tree (AST) represents the parsed structure of a MAM
# document. Each node in the tree corresponds to a syntactic element from the
# grammar. The AST is the primary intermediate representation used by the
# compiler, validator, and code generator.

# ============================================================================
# Source Location
# ============================================================================

# Every AST node carries source location information for error reporting
# and debugging. Locations are 1-indexed (first line is line 1).

# SourceLocation {
#   start: Position
#   end: Position
#   source: string (optional, filename)
# }

# Position {
#   line: number    # 1-indexed line number
#   column: number  # 1-indexed column number
#   offset: number  # 0-indexed byte offset from start of file
# }

# ============================================================================
# Base Node Interface
# ============================================================================

# All AST nodes implement the following base interface:

# Node {
#   type: NodeType              # Discriminant string for node type
#   loc: SourceLocation         # Source location of the node
#   leadingComments?: Comment[]  # Comments before this node
#   trailingComments?: Comment[] # Comments after this node
# }

# ============================================================================
# Node Type Enum
# ============================================================================

# NodeType ::= "Document" | "FrontMatter" | "FrontMatterEntry"
#            | "ModuleDeclaration" | "Section" | "SectionHeader"
#            | "TypeSection" | "RoleSection" | "GoalSection"
#            | "DescriptionSection" | "ProviderSection" | "FormatSection"
#            | "BackendSection" | "ScopeSection" | "TTLSection"
#            | "RequiresSection" | "InputsSection" | "OutputsSection"
#            | "ToolsSection" | "MemorySection" | "HandoffSection"
#            | "MembersSection" | "StepsSection" | "EdgesSection"
#            | "AllowSection" | "DenySection" | "PermissionsSection"
#            | "CapabilitiesSection" | "EdgeDeclaration" | "EdgeCondition"
#            | "ConditionalBlock" | "IfBlock" | "ElifBlock" | "ElseBlock"
#            | "LoopBlock" | "ForEachLoop" | "WhileLoop"
#            | "ErrorHandlingBlock" | "TryBlock" | "CatchBlock"
#            | "FinallyBlock" | "Paragraph" | "TextLine"
#            | "BulletList" | "NumberedList" | "TaskList"
#            | "ListItem" | "TaskItem" | "CodeBlock" | "CodeMetadata"
#            | "Table" | "TableHeader" | "TableRow" | "TableCell"
#            | "Blockquote" | "HorizontalRule" | "MermaidBlock"
#            | "Bold" | "Italic" | "Strikethrough" | "InlineCode"
#            | "Link" | "Image" | "FootnoteReference"
#            | "FootnoteDefinition" | "CitationReference"
#            | "CitationDefinition" | "MathInline" | "MathDisplay"
#            | "EscapeSequence" | "PlainText" | "Identifier"
#            | "StringLiteral" | "NumberLiteral" | "BooleanLiteral"
#            | "NullLiteral" | "Comment"

# ============================================================================
# Document Node
# ============================================================================

# Document {
#   type: "Document"
#   loc: SourceLocation
#   frontmatter: FrontMatter | null
#   declarations: Declaration[]
#   footer: Comment[]
# }

# FrontMatter {
#   type: "FrontMatter"
#   loc: SourceLocation
#   entries: FrontMatterEntry[]
# }

# FrontMatterEntry {
#   type: "FrontMatterEntry"
#   loc: SourceLocation
#   key: Identifier
#   value: Value
# }

# ============================================================================
# Declaration Nodes
# ============================================================================

# Declaration ::= ModuleDeclaration | Section | EdgeDeclaration
#              | ConditionalBlock | LoopBlock | ErrorHandlingBlock

# ModuleDeclaration {
#   type: "ModuleDeclaration"
#   loc: SourceLocation
#   keyword: string
#   name: Identifier
#   body: ModuleSection[]
# }

# ModuleSection ::= TypeSection | RoleSection | GoalSection
#                | DescriptionSection | ProviderSection | FormatSection
#                | BackendSection | ScopeSection | TTLSection
#                | RequiresSection | InputsSection | OutputsSection
#                | ToolsSection | MemorySection | HandoffSection
#                | MembersSection | StepsSection | EdgesSection
#                | AllowSection | DenySection | PermissionsSection
#                | CapabilitiesSection

# ============================================================================
# Section Nodes
# ============================================================================

# Section {
#   type: "Section"
#   loc: SourceLocation
#   header: SectionHeader
#   content: ContentElement[]
# }

# SectionHeader {
#   type: "SectionHeader"
#   loc: SourceLocation
#   marker: string
#   name: Identifier
# }

# TypeSection {
#   type: "TypeSection"
#   loc: SourceLocation
#   value: string
# }

# RoleSection {
#   type: "RoleSection"
#   loc: SourceLocation
#   value: string
# }

# GoalSection {
#   type: "GoalSection"
#   loc: SourceLocation
#   value: string
# }

# DescriptionSection {
#   type: "DescriptionSection"
#   loc: SourceLocation
#   content: ContentElement[]
# }

# ProviderSection {
#   type: "ProviderSection"
#   loc: SourceLocation
#   value: string
# }

# FormatSection {
#   type: "FormatSection"
#   loc: SourceLocation
#   value: string
# }

# BackendSection {
#   type: "BackendSection"
#   loc: SourceLocation
#   value: string
# }

# ScopeSection {
#   type: "ScopeSection"
#   loc: SourceLocation
#   value: string
# }

# TTLSection {
#   type: "TTLSection"
#   loc: SourceLocation
#   duration: number
#   unit: string
# }

# RequiresSection {
#   type: "RequiresSection"
#   loc: SourceLocation
#   items: string[]
# }

# InputsSection {
#   type: "InputsSection"
#   loc: SourceLocation
#   parameters: Parameter[]
# }

# Parameter {
#   type: "Parameter"
#   loc: SourceLocation
#   paramName: string
#   paramType: string
# }

# OutputsSection {
#   type: "OutputsSection"
#   loc: SourceLocation
#   parameters: Parameter[]
# }

# ToolsSection {
#   type: "ToolsSection"
#   loc: SourceLocation
#   tools: ToolItem[]
# }

# ToolItem {
#   type: "ToolItem"
#   loc: SourceLocation
#   name: string
#   details: ToolDetail[]
# }

# ToolDetail {
#   type: "ToolDetail"
#   loc: SourceLocation
#   key: string
#   value: string
# }

# MemorySection {
#   type: "MemorySection"
#   loc: SourceLocation
#   value: string | MemoryBlock
# }

# MemoryBlock {
#   type: "MemoryBlock"
#   loc: SourceLocation
#   fields: MemoryField[]
# }

# MemoryField {
#   type: "MemoryField"
#   loc: SourceLocation
#   key: string
#   value: string
# }

# HandoffSection {
#   type: "HandoffSection"
#   loc: SourceLocation
#   targets: string[]
# }

# MembersSection {
#   type: "MembersSection"
#   loc: SourceLocation
#   members: MemberItem[]
# }

# MemberItem {
#   type: "MemberItem"
#   loc: SourceLocation
#   name: string
#   details: MemberDetail[]
# }

# MemberDetail {
#   type: "MemberDetail"
#   loc: SourceLocation
#   key: string
#   value: string
# }

# StepsSection {
#   type: "StepsSection"
#   loc: SourceLocation
#   steps: StepItem[]
# }

# StepItem {
#   type: "StepItem"
#   loc: SourceLocation
#   name: string
#   details: StepDetail[]
# }

# StepDetail {
#   type: "StepDetail"
#   loc: SourceLocation
#   key: string
#   value: string
# }

# EdgesSection {
#   type: "EdgesSection"
#   loc: SourceLocation
#   edges: EdgeDeclaration[]
# }

# AllowSection {
#   type: "AllowSection"
#   loc: SourceLocation
#   items: string[]
# }

# DenySection {
#   type: "DenySection"
#   loc: SourceLocation
#   items: string[]
# }

# PermissionsSection {
#   type: "PermissionsSection"
#   loc: SourceLocation
#   permissions: PermissionItem[]
# }

# PermissionItem {
#   type: "PermissionItem"
#   loc: SourceLocation
#   key: string
#   value: string
# }

# CapabilitiesSection {
#   type: "CapabilitiesSection"
#   loc: SourceLocation
#   capabilities: string[]
# }

# ============================================================================
# Edge Declaration
# ============================================================================

# EdgeDeclaration {
#   type: "EdgeDeclaration"
#   loc: SourceLocation
#   source: string
#   target: string
#   condition: EdgeCondition | null
# }

# EdgeCondition {
#   type: "EdgeCondition"
#   loc: SourceLocation
#   expression: string
# }

# ============================================================================
# Control Flow Nodes (v3)
# ============================================================================

# ConditionalBlock {
#   type: "ConditionalBlock"
#   loc: SourceLocation
#   ifBlock: IfBlock
#   elifBlocks: ElifBlock[]
#   elseBlock: ElseBlock | null
# }

# IfBlock {
#   type: "IfBlock"
#   loc: SourceLocation
#   condition: string
#   body: Declaration[]
# }

# ElifBlock {
#   type: "ElifBlock"
#   loc: SourceLocation
#   condition: string
#   body: Declaration[]
# }

# ElseBlock {
#   type: "ElseBlock"
#   loc: SourceLocation
#   body: Declaration[]
# }

# LoopBlock {
#   type: "LoopBlock"
#   loc: SourceLocation
#   loop: ForEachLoop | WhileLoop
# }

# ForEachLoop {
#   type: "ForEachLoop"
#   loc: SourceLocation
#   variable: string
#   source: string
#   body: Declaration[]
# }

# WhileLoop {
#   type: "WhileLoop"
#   loc: SourceLocation
#   condition: string
#   body: Declaration[]
# }

# ErrorHandlingBlock {
#   type: "ErrorHandlingBlock"
#   loc: SourceLocation
#   tryBlock: TryBlock
#   catchBlocks: CatchBlock[]
#   finallyBlock: FinallyBlock | null
# }

# TryBlock {
#   type: "TryBlock"
#   loc: SourceLocation
#   body: Declaration[]
# }

# CatchBlock {
#   type: "CatchBlock"
#   loc: SourceLocation
#   errorType: string
#   errorVar: string | null
#   body: Declaration[]
# }

# FinallyBlock {
#   type: "FinallyBlock"
#   loc: SourceLocation
#   body: Declaration[]
# }

# ============================================================================
# Content Elements
# ============================================================================

# ContentElement ::= Paragraph | BulletList | NumberedList | TaskList
#                 | CodeBlock | Table | Blockquote | HorizontalRule
#                 | MermaidBlock

# Paragraph {
#   type: "Paragraph"
#   loc: SourceLocation
#   lines: TextLine[]
# }

# TextLine {
#   type: "TextLine"
#   loc: SourceLocation
#   content: InlineElement[]
# }

# BulletList {
#   type: "BulletList"
#   loc: SourceLocation
#   items: ListItem[]
# }

# NumberedList {
#   type: "NumberedList"
#   loc: SourceLocation
#   items: ListItem[]
# }

# TaskList {
#   type: "TaskList"
#   loc: SourceLocation
#   items: TaskItem[]
# }

# ListItem {
#   type: "ListItem"
#   loc: SourceLocation
#   content: InlineElement[]
# }

# TaskItem {
#   type: "TaskItem"
#   loc: SourceLocation
#   checked: boolean
#   content: InlineElement[]
# }

# ============================================================================
# Code Block Node
# ============================================================================

# CodeBlock {
#   type: "CodeBlock"
#   loc: SourceLocation
#   fence: string
#   language: string | null
#   metadata: CodeMetadata[]
#   content: string
# }

# CodeMetadata {
#   type: "CodeMetadata"
#   loc: SourceLocation
#   prefix: string
#   key: string
#   value: string | number | boolean | string[]
# }

# ============================================================================
# Table Node
# ============================================================================

# Table {
#   type: "Table"
#   loc: SourceLocation
#   header: TableHeader
#   rows: TableRow[]
# }

# TableHeader {
#   type: "TableHeader"
#   loc: SourceLocation
#   cells: TableCell[]
# }

# TableRow {
#   type: "TableRow"
#   loc: SourceLocation
#   cells: TableCell[]
# }

# TableCell {
#   type: "TableCell"
#   loc: SourceLocation
#   content: InlineElement[]
#   alignment: "left" | "center" | "right" | null
# }

# ============================================================================
# Block Elements
# ============================================================================

# Blockquote {
#   type: "Blockquote"
#   loc: SourceLocation
#   content: InlineElement[]
# }

# HorizontalRule {
#   type: "HorizontalRule"
#   loc: SourceLocation
#   marker: string
# }

# MermaidBlock {
#   type: "MermaidBlock"
#   loc: SourceLocation
#   content: string
# }

# ============================================================================
# Inline Element Nodes
# ============================================================================

# Bold {
#   type: "Bold"
#   loc: SourceLocation
#   content: InlineElement[]
# }

# Italic {
#   type: "Italic"
#   loc: SourceLocation
#   content: InlineElement[]
# }

# Strikethrough {
#   type: "Strikethrough"
#   loc: SourceLocation
#   content: InlineElement[]
# }

# InlineCode {
#   type: "InlineCode"
#   loc: SourceLocation
#   content: string
# }

# Link {
#   type: "Link"
#   loc: SourceLocation
#   text: InlineElement[]
#   url: string
#   title: string | null
# }

# Image {
#   type: "Image"
#   loc: SourceLocation
#   alt: InlineElement[]
#   url: string
#   title: string | null
# }

# FootnoteReference {
#   type: "FootnoteReference"
#   loc: SourceLocation
#   identifier: string
# }

# FootnoteDefinition {
#   type: "FootnoteDefinition"
#   loc: SourceLocation
#   identifier: string
#   content: InlineElement[]
# }

# CitationReference {
#   type: "CitationReference"
#   loc: SourceLocation
#   key: string
# }

# CitationDefinition {
#   type: "CitationDefinition"
#   loc: SourceLocation
#   key: string
#   fields: CitationField[]
# }

# CitationField {
#   type: "CitationField"
#   loc: SourceLocation
#   name: string
#   value: string
# }

# MathInline {
#   type: "MathInline"
#   loc: SourceLocation
#   content: string
# }

# MathDisplay {
#   type: "MathDisplay"
#   loc: SourceLocation
#   content: string
# }

# EscapeSequence {
#   type: "EscapeSequence"
#   loc: SourceLocation
#   character: string
# }

# PlainText {
#   type: "PlainText"
#   loc: SourceLocation
#   content: string
# }

# ============================================================================
# Literal Nodes
# ============================================================================

# Identifier {
#   type: "Identifier"
#   loc: SourceLocation
#   name: string
# }

# StringLiteral {
#   type: "StringLiteral"
#   loc: SourceLocation
#   value: string
# }

# NumberLiteral {
#   type: "NumberLiteral"
#   loc: SourceLocation
#   value: number
# }

# BooleanLiteral {
#   type: "BooleanLiteral"
#   loc: SourceLocation
#   value: boolean
# }

# NullLiteral {
#   type: "NullLiteral"
#   loc: SourceLocation
# }

# ============================================================================
# Comment Node
# ============================================================================

# Comment {
#   type: "Comment"
#   loc: SourceLocation
#   content: string
#   style: "line" | "block"
# }

# ============================================================================
# Visitor Pattern Interface
# ============================================================================

# The AST supports the visitor pattern for traversal and transformation.

# Visitor<T> {
#   visitDocument(node: Document): T
#   visitFrontMatter(node: FrontMatter): T
#   visitFrontMatterEntry(node: FrontMatterEntry): T
#   visitModuleDeclaration(node: ModuleDeclaration): T
#   visitSection(node: Section): T
#   visitSectionHeader(node: SectionHeader): T
#   visitTypeSection(node: TypeSection): T
#   visitRoleSection(node: RoleSection): T
#   visitGoalSection(node: GoalSection): T
#   visitDescriptionSection(node: DescriptionSection): T
#   visitProviderSection(node: ProviderSection): T
#   visitFormatSection(node: FormatSection): T
#   visitBackendSection(node: BackendSection): T
#   visitScopeSection(node: ScopeSection): T
#   visitTTLSection(node: TTLSection): T
#   visitRequiresSection(node: RequiresSection): T
#   visitInputsSection(node: InputsSection): T
#   visitOutputsSection(node: OutputsSection): T
#   visitToolsSection(node: ToolsSection): T
#   visitMemorySection(node: MemorySection): T
#   visitHandoffSection(node: HandoffSection): T
#   visitMembersSection(node: MembersSection): T
#   visitStepsSection(node: StepsSection): T
#   visitEdgesSection(node: EdgesSection): T
#   visitAllowSection(node: AllowSection): T
#   visitDenySection(node: DenySection): T
#   visitPermissionsSection(node: PermissionsSection): T
#   visitCapabilitiesSection(node: CapabilitiesSection): T
#   visitEdgeDeclaration(node: EdgeDeclaration): T
#   visitConditionalBlock(node: ConditionalBlock): T
#   visitIfBlock(node: IfBlock): T
#   visitElifBlock(node: ElifBlock): T
#   visitElseBlock(node: ElseBlock): T
#   visitLoopBlock(node: LoopBlock): T
#   visitForEachLoop(node: ForEachLoop): T
#   visitWhileLoop(node: WhileLoop): T
#   visitErrorHandlingBlock(node: ErrorHandlingBlock): T
#   visitTryBlock(node: TryBlock): T
#   visitCatchBlock(node: CatchBlock): T
#   visitFinallyBlock(node: FinallyBlock): T
#   visitParagraph(node: Paragraph): T
#   visitTextLine(node: TextLine): T
#   visitBulletList(node: BulletList): T
#   visitNumberedList(node: NumberedList): T
#   visitTaskList(node: TaskList): T
#   visitListItem(node: ListItem): T
#   visitTaskItem(node: TaskItem): T
#   visitCodeBlock(node: CodeBlock): T
#   visitCodeMetadata(node: CodeMetadata): T
#   visitTable(node: Table): T
#   visitTableHeader(node: TableHeader): T
#   visitTableRow(node: TableRow): T
#   visitTableCell(node: TableCell): T
#   visitBlockquote(node: Blockquote): T
#   visitHorizontalRule(node: HorizontalRule): T
#   visitMermaidBlock(node: MermaidBlock): T
#   visitBold(node: Bold): T
#   visitItalic(node: Italic): T
#   visitStrikethrough(node: Strikethrough): T
#   visitInlineCode(node: InlineCode): T
#   visitLink(node: Link): T
#   visitImage(node: Image): T
#   visitFootnoteReference(node: FootnoteReference): T
#   visitFootnoteDefinition(node: FootnoteDefinition): T
#   visitCitationReference(node: CitationReference): T
#   visitCitationDefinition(node: CitationDefinition): T
#   visitMathInline(node: MathInline): T
#   visitMathDisplay(node: MathDisplay): T
#   visitEscapeSequence(node: EscapeSequence): T
#   visitPlainText(node: PlainText): T
#   visitIdentifier(node: Identifier): T
#   visitStringLiteral(node: StringLiteral): T
#   visitNumberLiteral(node: NumberLiteral): T
#   visitBooleanLiteral(node: BooleanLiteral): T
#   visitNullLiteral(node: NullLiteral): T
#   visitComment(node: Comment): T
# }

# ============================================================================
# Serialization Format (JSON)
# ============================================================================

# The AST is serialized as JSON with the following conventions:
# - All node types include a "type" field as discriminator
# - Source locations use 1-indexed line/column numbers
# - Arrays use [] bracket notation
# - Null values represent absent optional fields
# - String values use double-quoted JSON strings

# Example JSON structure for a simple module:

# {
#   "type": "Document",
#   "loc": {
#     "start": { "line": 1, "column": 1, "offset": 0 },
#     "end": { "line": 15, "column": 1, "offset": 250 }
#   },
#   "frontmatter": {
#     "type": "FrontMatter",
#     "loc": { ... },
#     "entries": [
#       {
#         "type": "FrontMatterEntry",
#         "loc": { ... },
#         "key": { "type": "Identifier", "name": "name" },
#         "value": { "type": "StringLiteral", "value": "my-agent" }
#       }
#     ]
#   },
#   "declarations": [
#     {
#       "type": "ModuleDeclaration",
#       "loc": { ... },
#       "keyword": "agent",
#       "name": { "type": "Identifier", "name": "my-agent" },
#       "body": [
#         {
#           "type": "TypeSection",
#           "loc": { ... },
#           "value": "agent"
#         },
#         {
#           "type": "RoleSection",
#           "loc": { ... },
#           "value": "An intelligent assistant"
#         }
#       ]
#     }
#   ],
#   "footer": []
# }

# ============================================================================
# Node Traversal Utilities
# ============================================================================

# Helper functions for working with the AST:

# traverse(node, visitor)      - Depth-first traversal calling visitor
# findNode(node, predicate)    - Find first node matching predicate
# findAllNodes(node, predicate) - Find all nodes matching predicate
# getNodeById(node, id)        - Find node by unique ID
# getParentMap(node)           - Build child-to-parent mapping
# getDepth(node)               - Calculate nesting depth
# cloneNode(node)              - Deep clone a node
# printAST(node, indent)       - Debug print AST structure
