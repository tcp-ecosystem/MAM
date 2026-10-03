" mam.vim - Vim syntax file for MAM (Machine Agent Modules), Neovim edition
" Language:    MAM
" Maintainer:  MAM Desktop Extensions <tcp-ecosystems>
" URL:         https://github.com/tcp-ecosystems/MAM
" Description: Syntax highlighting for MAM files (.mam, .mam.md) in Neovim.
"
"   MAM is markdown-based with:
"     - YAML front matter delimited by `---` fences at the top of the file
"     - `##` section headings (Purpose, Inputs, Outputs, Capabilities, ...)
"     - fenced code blocks (``` ... ```), including mermaid diagram blocks
"     - tables, blockquotes, ordered/unordered lists
"     - inline formatting (bold **x**, italic *x*, inline code `x`)
"     - HTML comments and markdown links
"
" Neovim reuses Vim's syntax engine, so this file is intentionally identical
" in spirit to ../vim/syntax/mam.vim and derives from the canonical TextMate
" grammar at desktop-extension/vscode/syntaxes/mam.tmLanguage.json.
"
" If the user has tree-sitter enabled for this buffer, Neovim may prefer the
" injected markdown tree-sitter parser instead; fall back to this legacy
" syntax file with `:set syntax=mam` or by disabling treesitter highlighting.

if exists("b:current_syntax")
  finish
endif

" ---------------------------------------------------------------------------
" Keep syncing from the top of the file. MAM files can be long and contain
" nested constructs; a full top-down sync keeps region boundaries (front
" matter, code fences) accurate without stale state.
" ---------------------------------------------------------------------------
let s:keepcpo = &cpo
set cpo&vim

syn sync fromstart

" ---------------------------------------------------------------------------
" MAM-specific keywords (same set as the TextMate grammar)
" ---------------------------------------------------------------------------
syn keyword mamKeywordSection Purpose Inputs Outputs Capabilities Rules
      \ Workflow Dependencies Permissions Tests Examples References
syn keyword mamKeywordFlag required optional yes no true false
syn match   mamOperatorEdge "->\|=>"

" ---------------------------------------------------------------------------
" Front matter (YAML) delimited by `---` fence lines.
" A nested `syn include` pulls the built-in YAML syntax in so keys/values
" light up like real YAML. If yaml.vim is unavailable (e.g. --clean), fall
" back to plain key/string matching. The fence lines render as PreProc.
" ---------------------------------------------------------------------------
let s:mam_had_yaml = 0
if has("syntax")
  try
    syn include @mamYaml syntax/yaml.vim
    let s:mam_had_yaml = 1
  catch /E484/
    " yaml.vim not installed; fall back to plain key/value matching.
    syn match mamYamlKey "^\s*\w\+:" contained
    syn match mamYamlValue ":.*$" contained
  endtry
endif

if s:mam_had_yaml
  syn region mamFrontmatter start="^---\s*$" end="^---\s*$" keepend
        \ contains=@mamYaml,mamFrontmatterFence
else
  syn region mamFrontmatter start="^---\s*$" end="^---\s*$" keepend
        \ contains=mamYamlKey,mamYamlValue,mamFrontmatterFence
endif

syn match mamFrontmatterFence "^---\s*$" contained

" ---------------------------------------------------------------------------
" Headings: #, ##, ###, ####+  (MAM modules use `##` for section headings).
" The leading `#` marker is punctuation; the heading text is a title.
" ---------------------------------------------------------------------------
syn match mamHeadingMarker "^#\+\ze\s" contained

syn match mamHeadingH1 "^#\s.*$" contains=mamHeadingMarker,@Spell
syn match mamHeadingH2 "^##\s.*$" contains=mamHeadingMarker,@Spell
syn match mamHeadingH3 "^###\s.*$" contains=mamHeadingMarker,@Spell
syn match mamHeadingH4 "^####\s.*$" contains=mamHeadingMarker,@Spell
syn match mamHeadingH5 "^#####\s.*$" contains=mamHeadingMarker,@Spell
syn match mamHeadingH6 "^######\s.*$" contains=mamHeadingMarker,@Spell

" ---------------------------------------------------------------------------
" Fenced code blocks: ```lang ... ```.
" The mermaid variant is declared first so the more specific start pattern
" wins over the generic fence at the same buffer position. Both are declared
" before the inline-code region below so a `` ``` `` fence is consumed by the
" block (matching a ```` ``` ```` fence would otherwise start an inline ``
" region at the very same buffer position).
" ---------------------------------------------------------------------------
syn region mamMermaidBlock start="^```mermaid\s*$" end="^```\s*$" keepend
      \ contains=mamMermaidKeyword,mamMermaidArrow,mamMermaidString
syn keyword mamMermaidKeyword graph flowchart sequenceDiagram classDiagram
      \ stateDiagram erDiagram gantt journey pie contained
syn match  mamMermaidArrow "-->\|-->>\|->\|==>\|--" contained
syn match  mamMermaidString "\"[^\"]*\"" contained

syn region mamCodeBlock start="^```\w*" end="^```\s*$" keepend
      \ contains=mamCodeBlockFence,mamOperatorEdge
syn match  mamCodeBlockFence "^```\w*\|^```\s*$" contained

" ---------------------------------------------------------------------------
" Inline formatting: bold, italic, inline code.
" The inline-code start requires a non-backtick after the opening backtick so
" it can never collide with a ``` fence line (which is handled above).
" ---------------------------------------------------------------------------
syn region mamBold start="\*\*" end="\*\*" keepend contains=mamItalic
syn region mamItalic start="\*[^ \t*]" end="\*" keepend contains=mamBold
syn region mamCodeInline start="`[^`]" end="`" oneline keepend
syn match  mamCodeInlineChar "`" contained

" ---------------------------------------------------------------------------
" Tables (GFF pipe-delimited tables, as in markdown).
" The separator-row pattern requires a leading `|` so `---` front matter and
" horizontal rules are never mistaken for a separator. Both groups are plain
" (non-contained) matches so they fire inside table rows; matches inside
" regions such as code blocks are still excluded by those regions.
" ---------------------------------------------------------------------------
syn match mamTableDelimiter "|"
syn match mamTableSep "^[ \t]*|[ \t]*-\{2,\}[ \t|:=-]*$"

" ---------------------------------------------------------------------------
" Lists: unordered `-`, `*`, `+` and ordered `1.` markers.
" ---------------------------------------------------------------------------
syn match mamListMarker "^\s*[-*+]\s\+"
syn match mamListMarkerOrdered "^\s*\d\+\.\s\+"

" ---------------------------------------------------------------------------
" Blockquotes.
" ---------------------------------------------------------------------------
syn match mamBlockquote "^>\s.*$"

" ---------------------------------------------------------------------------
" HTML comments: <!-- ... -->  (MAM uses these for meta notes).
" ---------------------------------------------------------------------------
syn region mamComment start="<!--" end="-->" contains=@Spell

" ---------------------------------------------------------------------------
" Links: [text](url) -- text and url get distinct groups.
" The URL region is `contained` (only reached through the link-text
" nextgroup) so a stray `(...)` in prose is never highlighted as a link.
" Both regions are single-line to avoid runaway matches.
" ---------------------------------------------------------------------------
syn region mamLinkText matchgroup=mamLinkBracket start="\[" end="\]" oneline
      \ nextgroup=mamLinkURL skipwhite
syn region mamLinkURL matchgroup=mamLinkParen start="(" end=")" oneline
      \ contained contains=@NoSpell

" ---------------------------------------------------------------------------
" Map every MAM group onto standard Vim highlight groups so the colorscheme
" of the user's choice is respected. Everything derives from the default
" highlight groups; no hard-coded colors are used.
" ---------------------------------------------------------------------------
hi def link mamFrontmatterFence     PreProc
hi def link mamYamlKey              Identifier
hi def link mamYamlValue            String
hi def link mamHeadingH1            Title
hi def link mamHeadingH2            Title
hi def link mamHeadingH3            Title
hi def link mamHeadingH4            Title
hi def link mamHeadingH5            Title
hi def link mamHeadingH6            Title
hi def link mamHeadingMarker        Label
hi def link mamBold                 Bold
hi def link mamItalic               Italic
hi def link mamCodeInline           String
hi def link mamCodeInlineChar       Delimiter
hi def link mamMermaidBlock         Special
hi def link mamMermaidKeyword       Statement
hi def link mamMermaidArrow         Operator
hi def link mamMermaidString        String
hi def link mamCodeBlock            Special
hi def link mamCodeBlockFence       PreProc
hi def link mamTableDelimiter       Delimiter
hi def link mamTableSep             PreProc
hi def link mamListMarker           Label
hi def link mamListMarkerOrdered    Label
hi def link mamBlockquote           Comment
hi def link mamComment              Comment
hi def link mamLinkBracket          Delimiter
hi def link mamLinkParen            Delimiter
hi def link mamLinkText             Underlined
hi def link mamLinkURL              String
hi def link mamKeywordSection       Statement
hi def link mamKeywordFlag          Keyword
hi def link mamOperatorEdge         Operator

let b:current_syntax = "mam"

let &cpo = s:keepcpo
unlet s:keepcpo