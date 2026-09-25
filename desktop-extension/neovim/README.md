# MAM for Neovim

Syntax highlighting, file-type detection, buffer options, and a `mam
validate` integration for **MAM** (Markdown as Module) in Neovim.

## What's included

| File | Purpose |
|------|---------|
| `ftdetect/mam.lua` | Auto-detects `*.mam` and `*.mam.md` (via `vim.filetype.add`) |
| `syntax/mam.vim` | Complete MAM syntax: YAML front matter, headings, lists, tables, blockquotes, inline formatting, fenced code blocks, mermaid blocks |
| `plugin/mam.lua` | Sets buffer options (`commentstring`, `shiftwidth`, `expandtab`, front-matter folding) and provides `:MamValidate` |

The syntax file is the same one Vim uses (Neovim reuses Vim's syntax
engine) and is a native port of the canonical TextMate grammar in
`../vscode/syntaxes/mam.tmLanguage.json`.

## Requirements

- Neovim 0.8+ (uses `vim.filetype.add` and `nvim_create_*` APIs).
- The `mam` CLI on your `PATH` for `:MamValidate`. Build it from the repo
  root with `pnpm install && pnpm build`; the binary ships as `mam`.

## Installation

### lazy.nvim

```lua
{
  'tcp-ecosystems/MAM',
  ft = { 'mam' },
  config = function()
    -- The plugin auto-loads: ftdetect, syntax, and plugin/mam.lua
  end,
}
```

If you are not using the full monorepo, point lazy at the folder directly:

```lua
{
  dir = '~/path/to/MAM/desktop-extension/neovim',
  ft = { 'mam' },
}
```

### packer.nvim

```lua
use 'tcp-ecosystems/MAM'
-- or, for just this folder:
use { 'tcp-ecosystems/MAM', rtp = 'desktop-extension/neovim' }
```

### vim-plug

```vim
" Using the monorepo subfolder as a plugin root:
Plug 'tcp-ecosystems/MAM', { 'rtp': 'desktop-extension/neovim' }
```

After installing, restart Neovim and open a `.mam` file. Check the filetype
with `:set filetype?` (expect `mam`).

## Usage

- `:MamValidate` — runs `mam validate %` on the current file via
  `vim.fn.system`. On success it echoes `mam validate: OK`; on failure it
  prints the errors and opens the quickfix list (`:copen`) so you can jump
  between problems.
- Folding: `:foldclose`/`z c` collapses the YAML front matter (the first
  `---` ... `---` block) to a single line.

## Tree-sitter (optional)

Neovim's tree-sitter (markdown / markdown_inline parsers) can provide
finer-grained highlighting. MAM highlights correctly either way; the
bundled `syntax/mam.vim` is always a reliable fallback. If you see mixed
highlighting, disable the treesitter highlighter for this filetype with:

```lua
vim.treesitter.start(0, 'markdown') -- or:
vim.bo.syntax = 'mam' -- force legacy syntax
```