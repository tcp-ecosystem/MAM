# MAM for Windsurf

Language support for MAM (Markdown as Module) in
[Windsurf](https://windsurf.com): syntax highlighting for `.mam` and `.mam.md`
files, plus a `.windsurfrules` file that teaches Windsurf's Cascade AI assistant
the MAM spec and CLI workflow.

Windsurf is a VS Code-compatible editor, so it runs standard VS Code
extensions (`.vsix`) and supports the VS Code Marketplace. The MAM extension
lives in `desktop-extension/vscode/`.

## Files

| Path | Purpose |
|------|---------|
| `README.md` | This file |
| `.windsurfrules` | Windsurf rules file — teaches Cascade MAM structure, spec, and `mam` CLI commands |

## Install

### Option A — install the `.vsix`

```bash
windsurf --install-extension /path/to/mam-language-0.1.0.vsix
```

### Option B — VS Code Marketplace

Windsurf supports the VS Code Marketplace. In the Extensions panel
(Ctrl/Cmd+Shift+X) search for **MAM - Markdown as Module** (publisher
`tcp-ecosystems`) and install.

### Option C — copy into Windsurf's extension directory

Copy the extension folder into `~/.windsurf/extensions` and restart Windsurf.

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

`.windsurfrules` is picked up automatically by Cascade and gives it the MAM
spec: frontmatter fields (`id`, `version`, `type`, `runtime`, `capabilities`,
`permissions`, `dependencies`, ...), the section layout, and the `mam` CLI
commands.