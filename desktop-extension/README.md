# MAM Desktop Extensions

Syntax highlighting, language support, and IDE integrations for MAM
(Markdown as Module) across editors and IDEs.

## Supported editors

| Editor | Folder | Status |
|--------|--------|--------|
| Visual Studio Code | `vscode/` | ✅ TextMate grammar, language config, icons |
| JetBrains (IDEA, PyCharm, WebStorm, GoLand, CLion) | `jetbrains/` | ✅ |
| Eclipse | `eclipse/` | ✅ |
| Vim | `vim/` | ✅ |
| Neovim | `neovim/` | ✅ |
| Emacs | `emacs/` | ✅ |
| Sublime Text | `sublime/` | ✅ |
| Zed | `zed/` | ✅ |
| Cursor (AI, VS Code fork) | `cursor/` | ✅ reuses VS Code extension + `.cursor/rules` |
| Windsurf (AI, VS Code fork) | `windsurf/` | ✅ reuses VS Code extension + rules |
| Trae (AI, VS Code fork) | `trae/` | ✅ reuses VS Code extension + rules |
| Firebase Studio (cloud VS Code) | `firebase-studio/` | ✅ `.idx` install config |
| Visual Studio (full IDE) | `visualstudio/` | ✅ TextMate grammar + VSIX scaffold |
| JupyterLab + Notebook | `jupyter/` | ✅ Lab extension + MAM kernel |

## What each folder provides

- **Syntax highlighting** (TextMate / sublime-syntax / vim / tree-sitter / emacs)
- **File-type detection** for `.mam` and `.mam.md`
- **Installation** instructions in each folder's `README.md`

The canonical grammar lives in `vscode/syntaxes/mam.tmLanguage.json`; other
editors reuse it or provide native equivalents.

## Install from source

```bash
# Build the CLI + runtime first
pnpm install
pnpm build
```

Then follow the per-editor `README.md` in each folder.