; highlights.scm — tree-sitter highlight queries for MAM.
;
; Zed matches these captures against a tree-sitter parse tree produced by a
; native `mam` grammar. The current release reuses the TextMate grammar
; (grammars/mam.tmLanguage.json) so highlighting is already live without a
; tree; these queries define the semantic mapping for when the tree-sitter
; grammar lands, and use the same scope names as the TextMate grammar for a
; consistent look.
;
; Capture targets used (Zed's standard set):
;   @comment, @keyword, @string, @punctuation, @heading, @tag, @property,
;   @number, @operator

; ---------------------------------------------------------------------------
; Front matter (YAML between `---` markers)
; ---------------------------------------------------------------------------
(frontmatter
  (frontmatter_key) @property)
(frontmatter
  (frontmatter_value) @string)

; ---------------------------------------------------------------------------
; Headings
; ---------------------------------------------------------------------------
; ATX headings (`#` .. `######`) — the hash markers are punctuation and the
; title text is a section heading.
(atx_heading
  (atx_h1_marker) @punctuation)
(atx_heading
  (atx_h2_marker) @punctuation)
(atx_heading
  (atx_h3_marker) @punctuation)
(atx_heading
  (atx_h4_marker) @punctuation)
(atx_heading
  (atx_h5_marker) @punctuation)
(atx_heading
  (atx_h6_marker) @punctuation)
(atx_heading
  (heading_content) @heading)

; ---------------------------------------------------------------------------
; Code blocks
; ---------------------------------------------------------------------------
; Fenced code blocks: the fence ticks and the optional language tag.
(code_fence
  (code_fence_ticks) @punctuation)
(code_fence
  (language_tag) @tag)
(code_fence_content) @comment ; raw/code body — rendered monospace

; Inline code spans (single backticks).
(code_inline) @string

; ---------------------------------------------------------------------------
; Mermaid diagrams (```mermaid fences)
; ---------------------------------------------------------------------------
; When a native grammar recognizes mermaid sub-blocks we highlight the
; vocabulary Zed/tree-sitter-theme expect for diagram sources.
(mermaid_block
  (mermaid_keyword) @keyword)
(mermaid_block
  (mermaid_edge) @operator)

; ---------------------------------------------------------------------------
; MAM section keywords and operators in prose
; ---------------------------------------------------------------------------
; These mirror the keyword captures in the TextMate grammar so the same
; tokens are colored the same way whether parsed by tree-sitter or TextMate.
(section_keyword) @keyword
(arrow_operator) @operator ; `->`
(fat_arrow_operator) @operator ; `=>`

; ---------------------------------------------------------------------------
; Emphasis and links
; ---------------------------------------------------------------------------
(strong_emphasis) @strong
(emphasis) @emphasis
(link
  (link_text) @string)
(link
  (link_url) @string)

; ---------------------------------------------------------------------------
; Lists and tables
; ---------------------------------------------------------------------------
(list_marker) @punctuation
(table_separator) @punctuation