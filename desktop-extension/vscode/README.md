# MAM Language Support for VS Code

First-class language support for **MAM** (Markdown as Module) — `.mam` / `.mam.md`
files — with the same richness you expect from `.py` or `.js`: rich syntax
highlighting, snippets, real CLI-based diagnostics, commands, formatting,
folding, symbols, hover, and a status bar.

> MAM is a system-description language where Markdown remains the source of
> truth. YAML front matter provides the machine-readable identity; sections
> (Purpose, Inputs, Outputs, Capabilities, Rules, Workflow, Python, Tests,
> Examples, References) define the module. See `plan-doc/full-mam.md`.

## Features

- **Rich syntax highlighting** — nested YAML frontmatter (keys, strings, lists,
  booleans, inline arrays, structured `runtime`/`permissions`/`capabilities`/
  `dependencies`), headings, tables, blockquotes, task lists, links & images,
  strikethrough, HTML comments, code fences with embedded Mermaid
  (`source.mermaid`), full section keyword list, module type keywords, and
  workflow edges (`->`, `=>`).
- **Snippets** — scaffold a full module or any individual section with tabstops.
- **Real CLI diagnostics** — runs `mam validate` (debounced) and maps every
  diagnostic into the Problems panel. Falls back to lightweight structural
  checks when the CLI is not installed.
- **Commands** — validate, run, build, compile, scaffold new modules, and run
  the project entry, all through the `@mam/cli` binary.
- **Formatting** — trim trailing whitespace, enforce a single trailing newline,
  and normalize frontmatter indentation.
- **Folding** — frontmatter, heading sections, and fenced code blocks.
- **Outline / symbols** — module (`#`), sections (`##`), sub-sections (`###`).
- **Hover** — inline context for section headings and frontmatter keys.
- **Status bar** — a MAM status item while editing `.mam`/`.mam.md` files.

## Requirements

- VS Code `^1.85.0`.
- The MAM CLI (`@mam/cli`, command `mam`) should be on your `PATH` for full
  diagnostics and all commands. If it is missing, validation degrades to
  lightweight structural checks (frontmatter + Purpose section) and commands
  show a helpful warning.

## Install

1. Open this folder in VS Code.
2. Press `F5` to launch the Extension Development Host, or package with:
   ```bash
   npm install
   npm run build
   npx vsce package
   code --install-extension mam-language-1.0.0.vsix
   ```

## Commands

All commands are in the **MAM** category.

| Command               | ID             | Description                                          |
| --------------------- | -------------- | ---------------------------------------------------- |
| MAM: Validate Module  | `mam.validate` | Run `mam validate` on the active document            |
| MAM: Run Module       | `mam.run`      | Run the active module via `mam run --format json`    |
| MAM: Build Project    | `mam.build`    | Run `mam build` in the workspace folder              |
| MAM: Compile Module   | `mam.compile`  | Compile to a target (`mam compile <file> -t <target>`) |
| MAM: New Module       | `mam.newModule`| Scaffold a new module with `mam new <type> <name>`   |
| MAM: Run Project      | `mam.runProject` | Run the project entry (`mam run` in the workspace) |

## Keybindings

| Key           | Command             |
| ------------- | ------------------- |
| `Ctrl+Alt+V`  | MAM: Validate Module |
| `Ctrl+Alt+R`  | MAM: Run Module      |

(When editing a `.mam`/`.mam.md` file.)

## Configuration

| Setting                 | Default    | Description                                          |
| ----------------------- | ---------- | ---------------------------------------------------- |
| `mam.cliPath`           | `mam`      | Path to the MAM CLI binary.                          |
| `mam.validateOnSave`    | `true`     | Run `mam validate` automatically on save.            |
| `mam.defaultTarget`     | `python`   | Default compile/run target (`python`/`javascript`/`go`/`rust`). |
| `mam.showStatusBar`     | `true`     | Show the MAM status bar item while editing MAM docs. |

## Grammar notes

- **Scope name**: `source.mam`.
- **Embedded languages**: Mermaid blocks (` ```mermaid `) are scoped to
  `source.mermaid` and declared in `embeddedLanguages` so the Mermaid extension
  can take over inside diagrams.
- **Frontmatter** is a `---`-delimited block at the top of the file. Nested
  structured keys (`runtime.language`, `runtime.version`, and list keys
  `capabilities`, `permissions`, `dependencies`, `tags`, ...) receive dedicated
  scopes.

## Development

```bash
npm run build   # compile TypeScript with tsc -p .
npm run package # package the extension with vsce
```

Source layout:

```
src/extension.ts      activation, commands, status bar, wiring
src/cli.ts            CliService — spawns the mam binary
src/diagnostics.ts    MamDiagnostics — Problems-panel integration
src/providers.ts      formatting, folding, symbols, hover providers
syntaxes/mam.tmLanguage.json
snippets/mam.code-snippets
language-configuration.json
```