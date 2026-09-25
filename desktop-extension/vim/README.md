# MAM for Vim

Syntax highlighting and file-type detection for **MAM** (Markdown as Module)
in Vim. MAM files use the `.mam` and `.mam.md` extensions.

## What's included

| File | Purpose |
|------|---------|
| `syntax/mam.vim` | Complete MAM syntax: YAML front matter (`---` fences with real YAML highlighting), headings, lists, blockquotes, tables, inline formatting, fenced code blocks, and mermaid diagram blocks |
| `ftdetect/mam.vim` | Auto-detects `*.mam` and `*.mam.md` and sets `filetype=mam` |

The syntax is a native Vim port of the canonical TextMate grammar in
`../vscode/syntaxes/mam.tmLanguage.json`. Every token is mapped to a
standard Vim highlight group (`Title`, `Comment`, `String`, `PreProc`,
`Special`, ...) via `hi def link`, so it follows your colorscheme.

## Installation

### Option A — copy into `~/.vim` (no plugin manager)

```bash
# Unix / macOS
mkdir -p ~/.vim/syntax ~/.vim/ftdetect
cp syntax/mam.vim    ~/.vim/syntax/
cp ftdetect/mam.vim  ~/.vim/ftdetect/

# Windows
mkdir "$HOME\vimfiles\syntax" "$HOME\vimfiles\ftdetect"
copy syntax\mam.vim   "%USERPROFILE%\vimfiles\syntax\"
copy ftdetect\mam.vim "%USERPROFILE%\vimfiles\ftdetect\"
```

`~/.vim` and `~/.vimrc` are already on the runtime path, so no further
configuration is needed. Restart Vim and open a `.mam` file.

### Option B — add the folder to `'runtimepath'`

Add this to your `~/.vimrc`:

```vim
set runtimepath+=~/path/to/desktop-extension/vim
```

Then open a `.mam` file. The `ftdetect` and `syntax` directories under the
added path are picked up automatically.

### Option C — plugin managers

- **vim-plug**: `Plug 'tcp-ecosystems/MAM', { 'rtp': 'desktop-extension/vim' }`
- **Pathogen**: symlink or clone the `desktop-extension/vim` folder into
  `~/.vim/bundle/mam`.

## Usage

- File type detection is automatic; check with `:set filetype?` (expect `mam`).
- Force the type manually: `:setfiletype mam`.

## Notes

- If `syntax/yaml.vim` is present (it ships with Vim 8+/Vim 9 as of recent
  distributions, or via plugins), the front matter is highlighted as YAML.
  Without it, a plain key/value fallback is used.
- Mermaid blocks (` ```mermaid `) get keyword and arrow highlighting.