# MAM for Trae

Language support for MAM (Markdown as Module) in [Trae](https://www.trae.ai):
syntax highlighting for `.mam` and `.mam.md` files, plus a `rules/mam.md` file
that teaches Trae's AI assistant the MAM spec and CLI workflow.

Trae is a VS Code-based editor, so it runs standard VS Code extensions
(`.vsix`) and supports the VS Code Marketplace. The MAM extension lives in
`desktop-extension/vscode/`.

## Files

| Path | Purpose |
|------|---------|
| `README.md` | This file |
| `rules/mam.md` | Trae rules file — teaches the AI assistant MAM structure, spec, and `mam` CLI commands |

## Install

### Option A — install the `.vsix`

```bash
trae --install-extension /path/to/mam-language-0.1.0.vsix
```

### Option B — VS Code Marketplace

Trae supports the VS Code Marketplace. In the Extensions panel
(Ctrl/Cmd+Shift+X) search for **MAM - Markdown as Module** (publisher
`tcp-ecosystems`) and install.

### Option C — copy into Trae's extension directory

Copy the extension folder into Trae's extensions directory (e.g.
`~/.trae/extensions`) and restart Trae.

## Usage

After install, `.mam` and `.mam.md` files get MAM highlighting (scope
`source.mam`).

The MAM CLI drives the workflow:

```bash
mam validate module.mam.md    # validate a module (or `mam validate` for the project)
mam run module.mam.md         # run a module natively (or `mam run` for the entry)
mam build module.mam.md       # compile to targets
mam test module.mam.md        # run the module's test suite
```

## AI rules

`rules/mam.md` gives Trae's assistant the MAM spec: frontmatter fields (`id`,
`version`, `type`, `runtime`, `capabilities`, `permissions`, `dependencies`,
...), the section layout, and the `mam` CLI commands.