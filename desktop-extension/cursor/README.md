# MAM for Cursor

Language support for MAM (Machine Agent Modules) in [Cursor](https://cursor.com):
syntax highlighting for `.mam` and `.mam.md` files, plus a Cursor Rules file
(`.cursor/rules/mam.mdc`) that teaches Cursor's AI assistant the MAM spec and
CLI workflow.

Cursor is a fork of VS Code, so it runs standard VS Code extensions (`.vsix`)
and supports the VS Code Marketplace out of the box. The MAM extension lives in
`desktop-extension/vscode/`.

## Files

| Path | Purpose |
|------|---------|
| `README.md` | This file |
| `.cursor/rules/mam.mdc` | Cursor Rules file — teaches the AI assistant MAM structure, spec, and `mam` CLI commands |

## Install

### Option A — Cursor CLI

With Cursor installed on your `PATH`:

```bash
cursor --install-extension /path/to/mam-language-0.1.0.vsix
```

### Option B — VS Code Marketplace

Cursor ships with Marketplace support. In the Extensions panel (Ctrl/Cmd+Shift+X)
search for **MAM - Machine Agent Modules** (publisher `tcp-ecosystems`) and install.

### Option C — copy into Cursor's extension directory

Copy the extension folder into `~/.cursor/extensions` and restart Cursor:

```bash
cp -r desktop-extension/vscode ~/.cursor/extensions/mam-language
```

On Windows, the directory is `%USERPROFILE%\.cursor\extensions`.

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

`.cursor/rules/mam.mdc` is `alwaysApply` and gives Cursor's assistant the MAM
spec: frontmatter fields (`id`, `version`, `type`, `runtime`, `capabilities`,
`permissions`, `dependencies`, ...), the section layout, and the `mam` CLI
commands. See `@cursor/rules/mam.mdc` for details.