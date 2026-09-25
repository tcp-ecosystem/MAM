; config.scm — language configuration for the MAM Zed extension.
;
; These queries are consumed by Zed's tree-sitter integration to answer
; "language feature" questions (comments, brackets, folding, word characters)
; without hard-coding them in Rust.
;
; NOTE: The MAM extension currently ships a TextMate grammar
; (grammars/mam.tmLanguage.json, scope `source.mam`) which Zed uses for
; highlighting. These tree-sitter queries are written against the node types
; a future native `mam` tree-sitter grammar would emit, so they are
; future-proof and harmless if the grammar is absent — Zed falls back to
; TextMate captures for everything that has no tree-sitter tree.
;
; Conventions used here follow Zed's built-in markdown/HTML language configs.

; ---------------------------------------------------------------------------
; Comments
; ---------------------------------------------------------------------------
; HTML-style comments (`<!-- ... -->`) are the MAM comment convention,
; mirroring the VS Code language-configuration.json blockComment pair.
(comment) @comment

; ---------------------------------------------------------------------------
; Brackets
; ---------------------------------------------------------------------------
; Inline code spans, link pairs, and emphasis delimiters. Zed uses these for
; auto-closing pairs and bracket navigation.
(code_inline) @bracket
(link) @bracket
(emphasis) @bracket
(strong_emphasis) @bracket

; ---------------------------------------------------------------------------
; Folding markers
; ---------------------------------------------------------------------------
; Fold on section headings and fenced code blocks. MAM documents are
; organized as `##` sections, so folding at the ATX-heading level gives a
; clean outline of a module.
(atx_heading) @fold
(code_fence) @fold

; ---------------------------------------------------------------------------
; Indentation
; ---------------------------------------------------------------------------
; Content inside a fenced code block or a list item is indented relative to
; its parent. Only matters once a native tree-sitter grammar exists.
(code_fence_content) @indent
(list_item) @indent

; ---------------------------------------------------------------------------
; Line comments
; ---------------------------------------------------------------------------
; MAM has no line-comment syntax of its own; HTML comments are block-style.
; Listed here explicitly so language tooling reports "block comments only",
; which matches the VS Code language-configuration.json.
(comment) @line_comment