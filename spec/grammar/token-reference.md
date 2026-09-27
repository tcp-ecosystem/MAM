# MAM Token Reference
# version: 2.0.0
# Complete token reference with regex patterns and lexer rules

# ============================================================================
# Token Overview
# ============================================================================

# Tokens are the smallest meaningful units in the MAM language. The lexer
# scans input text and produces a stream of tokens consumed by the parser.
# Each token has a type, lexeme (matched text), and source location.

# ============================================================================
# Special Tokens
# ============================================================================

# Token Type         | Regex Pattern         | Description
# -------------------|-----------------------|----------------------------------
# EOF                | $                     | End of file/stream
# ERROR              | .                     | Unexpected/unrecognized character
# NEWLINE            | \n                    | Line terminator
# WHITESPACE         | [ \t]+               | Horizontal whitespace
# INDENT             | ^([ ]{2}|\t)+        | Indentation (start of line)
# COMMENT            | #[^\n]*              | Line comment

# ============================================================================
# Front Matter Tokens
# ============================================================================

# Token Type              | Regex Pattern         | Description
# ------------------------|-----------------------|----------------------------------
# FRONTMATTER_OPEN        | ^---\s*\n             | Front matter start delimiter
# FRONTMATTER_CLOSE       | ^---\s*\n             | Front matter end delimiter
# YAML_KEY                | ^[a-zA-Z_][\w-]*     | YAML dictionary key
# YAML_COLON              | :                     | Key-value separator
# YAML_VALUE              | [^\n]+                | YAML value content
# YAML_LIST_MARKER        | ^-                    | YAML list item marker
# YAML_COMMENT            | ^#[^\n]*              | YAML comment

# ============================================================================
# Heading Tokens
# ============================================================================

# Token Type   | Regex Pattern        | Description
# -------------|----------------------|----------------------------------
# HEADING_1    | ^#\s+                | Level 1 heading marker
# HEADING_2    | ^##\s+               | Level 2 heading marker
# HEADING_3    | ^###\s+              | Level 3 heading marker
# HEADING_4    | ^####\s+             | Level 4 heading marker
# HEADING_5    | ^#####\s+            | Level 5 heading marker
# HEADING_6    | ^######\s+           | Level 6 heading marker
# HEADING_TEXT | [^\n]+               | Heading content text

# ============================================================================
# Code Tokens
# ============================================================================

# Token Type              | Regex Pattern         | Description
# ------------------------|-----------------------|----------------------------------
# CODE_FENCE_BACKTICK     | ^`{3,}               | Backtick code fence (3+)
# CODE_FENCE_TILDE        | ^~{3,}               | Tilde code fence (3+)
# CODE_LANGUAGE           | [a-zA-Z0-9_\-]+      | Code block language identifier
# CODE_METADATA           | #\s*@mam:             | MAM metadata comment prefix
# CODE_METADATA_KEY       | [a-zA-Z_][\w.]*      | Metadata key
# CODE_METADATA_EQUALS    | =                     | Metadata assignment
# CODE_METADATA_VALUE     | [^\n]+                | Metadata value
# CODE_CONTENT            | [^\n]*                | Code line content
# INLINE_CODE_OPEN        | `                     | Inline code delimiter (single)
# INLINE_CODE_OPEN2       | ``                    | Inline code delimiter (double)
# INLINE_CODE_CONTENT     | [^`]+                 | Inline code content

# ============================================================================
# List Tokens
# ============================================================================

# Token Type       | Regex Pattern         | Description
# -----------------|-----------------------|----------------------------------
# BULLET_MARKER    | [-*+]\s               | Unordered list marker
# NUMBERED_MARKER  | \d+\.\s               | Ordered list marker
# TASK_CHECKED     | \[[xX]\]              | Checked task checkbox
# TASK_UNCHECKED   | \[ \]                 | Unchecked task checkbox
# LIST_INDENT      | ^(\s{2,})             | List item continuation indent

# ============================================================================
# Table Tokens
# ============================================================================

# Token Type        | Regex Pattern         | Description
# ------------------|-----------------------|----------------------------------
# TABLE_PIPE        | \|                    | Table cell separator
# TABLE_HYPHEN      | [-:]+                 | Table separator row content
# TABLE_ALIGN_LEFT  | :-+                   | Left-aligned column
# TABLE_ALIGN_RIGHT | -:+                   | Right-aligned column
# TABLE_ALIGN_CENTER| :-+:                  | Center-aligned column
# TABLE_HEADER_SEP  | \|[-|:]+\|           | Complete separator row

# ============================================================================
# Block Element Tokens
# ============================================================================

# Token Type        | Regex Pattern         | Description
# ------------------|-----------------------|----------------------------------
# BLOCKQUOTE_MARKER | ^>\s?                 | Blockquote prefix
# HORIZONTAL_RULE   | ^[-*_]{3,}\s*$        | Horizontal rule (3+ chars)
# INDENTED_CODE     | ^([ ]{4}|\t)          | Indented code block start

# ============================================================================
# Inline Formatting Tokens
# ============================================================================

# Token Type           | Regex Pattern         | Description
# ---------------------|-----------------------|----------------------------------
# BOLD_OPEN            | \*\*                  | Bold start delimiter
# BOLD_CLOSE           | \*\*                  | Bold end delimiter
# ITALIC_OPEN          | (?<!\*)\*(?!\*)       | Italic start (single *)
# ITALIC_CLOSE         | (?<!\*)\*(?!\*)       | Italic end (single *)
# BOLD_ITALIC_OPEN     | \*\*\*                | Bold+italic start
# BOLD_ITALIC_CLOSE    | \*\*\*                | Bold+italic end
# STRIKETHROUGH_OPEN   | ~~                    | Strikethrough start
# STRIKETHROUGH_CLOSE  | ~~                    | Strikethrough end

# ============================================================================
# Link and Image Tokens
# ============================================================================

# Token Type        | Regex Pattern         | Description
# ------------------|-----------------------|----------------------------------
# LINK_OPEN         | \[                    | Link text start
# LINK_CLOSE        | \]                    | Link text end
# LINK_URL_OPEN     | \(                    | Link URL start
# LINK_URL_CLOSE    | \)                    | Link URL end
# IMAGE_MARKER      | !                     | Image prefix
# AUTOLINK_OPEN     | <                     | Auto-link start
# AUTOLINK_CLOSE    | >                     | Auto-link end
# URL               | https?:\/\/[^\s>]+    | HTTP/HTTPS URL

# ============================================================================
# Footnote and Citation Tokens
# ============================================================================

# Token Type          | Regex Pattern         | Description
# --------------------|-----------------------|----------------------------------
# FOOTNOTE_REF_OPEN   | \[\^                  | Footnote reference start
# FOOTNOTE_REF_CLOSE  | \]                    | Footnote reference end
# FOOTNOTE_DEF_OPEN   | \[\^                  | Footnote definition start
# FOOTNOTE_DEF_SEP    | \]:                   | Footnote definition separator
# CITATION_REF_OPEN   | \[@                   | Citation reference start
# CITATION_REF_CLOSE  | \]                    | Citation reference end
# CITATION_DEF_OPEN   | \[@                   | Citation definition start
# CITATION_DEF_SEP    | \]:                   | Citation definition separator

# ============================================================================
# Math Tokens
# ============================================================================

# Token Type          | Regex Pattern         | Description
# --------------------|-----------------------|----------------------------------
# MATH_INLINE_OPEN    | (?<!\$)\$(?!\$)       | Inline math start ($)
# MATH_INLINE_CLOSE   | (?<!\$)\$(?!\$)       | Inline math end ($)
# MATH_DISPLAY_OPEN   | \$\$                  | Display math start ($$)
# MATH_DISPLAY_CLOSE  | \$\$                  | Display math end ($$)
# MATH_CONTENT        | [^$]+                 | Math expression content

# ============================================================================
# Escape and Entity Tokens
# ============================================================================

# Token Type     | Regex Pattern         | Description
# ---------------|-----------------------|----------------------------------
# ESCAPE         | \\[\\`*_\[\]{}()!#|~] | Backslash escape sequence
# HTML_ENTITY    | &[a-zA-Z]+;           | Named HTML entity
# HTML_DECIMAL   | &#\d+;                | Decimal HTML entity
# HTML_HEX       | &#x[0-9a-fA-F]+;     | Hexadecimal HTML entity

# ============================================================================
# DSL Keywords (v2/v3)
# ============================================================================

# Token Type      | Pattern               | Description
# ----------------|-----------------------|----------------------------------
# KW_MODULE       | module                | Module declaration keyword
# KW_AGENT        | agent                 | Agent declaration keyword
# KW_TOOL         | tool                  | Tool declaration keyword
# KW_MEMORY       | memory                | Memory declaration keyword
# KW_WORKFLOW     | workflow              | Workflow declaration keyword
# KW_TEAM         | team                  | Team declaration keyword
# KW_POLICY       | policy                | Policy declaration keyword
# KW_SYSTEM       | system                | System declaration keyword
# KW_TYPE         | type:                 | Type section keyword
# KW_ROLE         | role:                 | Role section keyword
# KW_GOAL         | goal:                 | Goal section keyword
# KW_DESCRIPTION  | description:          | Description section keyword
# KW_PROVIDER     | provider:             | Provider section keyword
# KW_FORMAT       | format:               | Format section keyword
# KW_BACKEND      | backend:              | Backend section keyword
# KW_SCOPE        | scope:                | Scope section keyword
# KW_TTL          | ttl:                  | TTL section keyword
# KW_REQUIRES     | requires:             | Requires section keyword
# KW_INPUTS       | inputs:               | Inputs section keyword
# KW_OUTPUTS      | outputs:              | Outputs section keyword
# KW_TOOLS        | tools:                | Tools section keyword
# KW_HANDOFF      | handoff:              | Handoff section keyword
# KW_MEMBERS      | members:              | Members section keyword
# KW_STEPS        | steps:                | Steps section keyword
# KW_EDGES        | edges:                | Edges section keyword
# KW_ALLOW        | allow:                | Allow section keyword
# KW_DENY         | deny:                 | Deny section keyword
# KW_PERMISSIONS  | permissions:          | Permissions section keyword
# KW_CAPABILITIES | capabilities:         | Capabilities section keyword

# ============================================================================
# Control Flow Keywords (v3)
# ============================================================================

# Token Type   | Pattern                | Description
# -------------|------------------------|----------------------------------
# KW_IF        | if                     | Conditional start
# KW_ELIF      | elif                   | Else-if branch
# KW_ELSE      | else                   | Else branch
# KW_FOR       | for                    | For-each loop start
# KW_WHILE     | while                  | While loop start
# KW_IN        | in                     | Loop source indicator
# KW_TRY       | try                    | Error handling try block
# KW_CATCH     | catch                  | Error handling catch block
# KW_FINALLY   | finally                | Error handling finally block
# KW_AND       | and                    | Logical AND
# KW_OR        | or                     | Logical OR
# KW_NOT       | not                    | Logical NOT
# KW_HAS       | has                    | Feature check operator
# KW_CALL      | call                   | Action call keyword

# ============================================================================
# Operator Tokens
# ============================================================================

# Token Type     | Regex Pattern  | Description
# ---------------|----------------|----------------------------------
# ARROW          | ->             | Edge/flow operator
# EQUALS         | =              | Assignment operator
# EQUALS_CMP     | ==             | Equality comparison
# NOT_EQUALS     | !=             | Inequality comparison
# LESS_THAN      | <              | Less than
# GREATER_THAN   | >              | Greater than
# LESS_EQ        | <=             | Less than or equal
# GREATER_EQ     | >=             | Greater than or equal
# PLUS           | +              | Addition
# MINUS          | -              | Subtraction
# STAR           | *              | Multiplication
# SLASH          | /              | Division
# PERCENT        | %              | Modulo
# DOT            | .              | Property access
# COMMA          | ,              | Separator
# COLON          | :              | Key-value separator
# LPAREN         | (              | Left parenthesis
# RPAREN         | )              | Right parenthesis
# LBRACKET       | [              | Left bracket
# RBRACKET       | ]              | Right bracket
# LBRACE         | {              | Left brace
# RBRACE         | }              | Right brace

# ============================================================================
# Literal Tokens
# ============================================================================

# Token Type     | Regex Pattern         | Description
# ---------------|-----------------------|----------------------------------
# STRING_DQ      | "[^"]*"              | Double-quoted string
# STRING_SQ      | '[^']*'              | Single-quoted string
# NUMBER_INT     | -?\d+                | Integer literal
# NUMBER_FLOAT   | -?\d+\.\d+           | Floating-point literal
# NUMBER_HEX     | 0x[0-9a-fA-F]+      | Hexadecimal literal
# BOOLEAN_TRUE   | true|yes|on          | Boolean true
# BOOLEAN_FALSE  | false|no|off         | Boolean false
# NULL_LIT       | null|NULL|~          | Null literal
# IDENTIFIER     | [a-zA-Z_][\w]*       | General identifier

# ============================================================================
# Token Precedence Rules
# ============================================================================

# When multiple token patterns can match at the same position, the lexer
# uses the following precedence rules (highest first):

# 1. Longest match wins (maximal munch)
# 2. Special tokens over general tokens
# 3. Keyword tokens over identifier tokens
# 4. Delimiter tokens over operator tokens

# Conflict resolution examples:
# - "**" matches BOLD_OPEN before two STAR operators
# - "---" matches HORIZONTAL_RULE before three MINUS operators
# - "module" matches KW_MODULE before IDENTIFIER
# - "# @mam:key=val" matches CODE_METADATA before COMMENT

# ============================================================================
# Token Grouping Rules
# ============================================================================

# Tokens are grouped into the following categories:

# Group         | Token Types
# --------------|-------------------------------------------------------
# Whitespace    | NEWLINE, WHITESPACE, INDENT
# Delimiters    | LPAREN, RPAREN, LBRACKET, RBRACKET, LBRACE, RBRACE
# Operators     | EQUALS, NOT_EQUALS, LESS_THAN, etc.
# Literals      | STRING_*, NUMBER_*, BOOLEAN_*, NULL_LIT
# Keywords      | KW_*
# Formatting    | BOLD_*, ITALIC_*, STRIKETHROUGH_*
# Structural    | HEADING_*, TABLE_*, BLOCKQUOTE_*, etc.
# Inline        | LINK_*, IMAGE_*, MATH_*, CODE_*

# ============================================================================
# Lexer State Machine
# ============================================================================

# The lexer operates in the following states:

# State: NORMAL
#   - Default state for parsing top-level content
#   - Transitions to FRONTMATTER on "---" at line start
#   - Transitions to HEADING on "#" at line start
#   - Transitions to CODE_FENCE on "```" or "~~~" at line start
#   - Transitions to BLOCKQUOTE on ">" at line start

# State: FRONTMATTER
#   - Active between opening and closing "---" delimiters
#   - Parses YAML key-value pairs
#   - Transitions to NORMAL on closing "---"

# State: CODE_BLOCK
#   - Active inside fenced code blocks
#   - Captures all content as raw text
#   - Transitions to NORMAL on closing fence
#   - Nested fence tracking with depth counter

# State: INLINE
#   - Active when parsing inline content
#   - Handles bold, italic, links, images
#   - Tracks delimiter stack for nesting

# State: TABLE
#   - Active inside table rows
#   - Parses pipe-separated cells
#   - Handles alignment markers in separator row

# State: MATH
#   - Active inside math expressions
#   - Handles $ (inline) and $$ (display) delimiters
#   - Tracks nesting depth

# ============================================================================
# Error Token Handling
# ============================================================================

# When the lexer encounters an unrecognized character:

# 1. Emit an ERROR token with the unexpected character
# 2. Advance past the problematic character
# 3. Attempt to resume lexing from the next character
# 4. Track error count for error recovery strategies

# Common error scenarios:
# - Unmatched delimiters (e.g., "**" without closing "**")
# - Invalid UTF-8 sequences
# - Null bytes in input
# - Characters outside valid Unicode ranges
# - Malformed HTML entities

# Error recovery strategies:
# - Skip single bad character and continue
# - Skip to next newline on severe errors
# - Skip to next balanced delimiter
# - Emit synthetic closing tokens for unmatched opens

# ============================================================================
# Unicode Support Rules
# ============================================================================

# The MAM lexer supports the following Unicode features:

# 1. Input encoding must be UTF-8 (with or without BOM)
# 2. Identifiers may use Unicode letters (Unicode category L)
# 3. Math content supports full Unicode math symbols
# 4. String content supports all Unicode characters
# 5. Comments support all Unicode characters
# 6. Normalization: NFC normalization applied to identifiers

# Unicode character classes used:
# - \p{L}    : Letters (any script)
# - \p{N}    : Numbers
# - \p{Z}    : Separators (spaces)
# - \p{S}    : Symbols
# - \p{P}    : Punctuation
# - \p{C}    : Control characters (excluded from content)

# BOM handling:
# - UTF-8 BOM (EF BB BF) is stripped if present at file start
# - UTF-16 and UTF-32 BOMs are not supported
# - No BOM detection for other encodings

# ============================================================================
# Token Definitions (BNF)
# ============================================================================

IDENTIFIER ::= [a-zA-Z_][a-zA-Z0-9_]*
STRING_DQ ::= "\"" [^"]* "\""
STRING_SQ ::= "'" [^']* "'"
NUMBER ::= [0-9]+ ("." [0-9]+)?
BOOLEAN ::= "true" | "false" | "yes" | "no" | "on" | "off"
NULL ::= "null" | "NULL" | "~"
NEWLINE ::= "\n"
WHITESPACE ::= [ \t]+
INDENT ::= ("  " | "\t")+
COMMENT ::= "#" [^\n]*
ARROW ::= "->"
