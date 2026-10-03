# MAM for Zed

Language support for MAM (Machine Agent Modules) in the [Zed](https://zed.dev)
editor: syntax highlighting for `.mam` and `.mam.md` files.

## Files

| Path | Purpose |
|------|---------|
| `extension.json` | Zed extension manifest (name, version, authors, repository, grammar + language registration) |
| `grammars/mam.tmLanguage.json` | TextMate grammar for MAM — a byte-for-byte copy of the canonical grammar in `desktop-extension/vscode/syntaxes/mam.tmLanguage.json` |
| `grammars/grammars.json` | Maps the `source.mam` scope to the TextMate grammar file |
| `languages/mam/config.scm` | Tree-sitter language config (comments, brackets, folds) |
| `languages/mam/highlights.scm` | Tree-sitter highlight queries (future-proof native grammar mapping) |

## How highlighting works

Zed uses the TextMate grammar (scope `source.mam`) for highlighting, exactly
like VS Code. The tree-sitter `.scm` files describe the mapping a future
native `mam` tree-sitter grammar will use and are a no-op today.

## Install

### Option A — develop against a checkout (recommended for contributors)

Zed can load an extension directly from a folder on disk.

1. Symlink the extension folder into Zed's extension directory:

   - **macOS / Linux**

     ```bash
     mkdir -p ~/.local/share/zed/extensions/dev
     ln -s /absolute/path/to/desktop-extension/zed ~/.local/share/zed/extensions/dev/mam
     ```

   - **Windows**

     ```powershell
     New-Item -ItemType Junction -Path "$env:LOCALAPPDATA\zed\extensions\dev\mam" `
       -Target "C:\path\to\desktop-extension\zed"
     ```

2. Restart Zed.

3. Open a `.mam` or `.mam.md` file. The syntax selector should show
   **MAM** (scope `source.mam`).

> The `dev/` subfolder tells Zed to treat the extension as a development
> build and to re-scan it on restart — no packaging step needed.

### Option B — in-extension command

With Zed open, run the command palette (Ctrl/Cmd+Shift+P) and choose
**zed: install dev extension**, then pick the `desktop-extension/zed` folder.

## File-type detection

- `.mam`
- `.mam.md`

Zed associates both with the `mam` language name registered in
`extension.json`.

## Validation

`extension.json` and `grammars/grammars.json` are plain JSON and can be
checked with Node:

```bash
node -e "JSON.parse(require('fs').readFileSync('extension.json','utf8'))"
node -e "JSON.parse(require('fs').readFileSync('grammars/grammars.json','utf8'))"
```

## Troubleshooting

- **No highlighting**: confirm the symlink/junction target is the
  `zed/` folder (not `desktop-extension/`) and that `grammars/mam.tmLanguage.json`
  exists. Restart Zed after adding the extension.
- **`.mam.md` opens as Markdown**: `mam.md` may be claimed by Zed's bundled
  Markdown extension. In the language picker, select **MAM**; the association
  is per-language-name and should stick once the extension loads.