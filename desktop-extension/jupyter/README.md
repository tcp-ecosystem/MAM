# MAM for Jupyter

Syntax highlighting and execution support for MAM (Markdown as Module) in
[JupyterLab](https://jupyterlab.readthedocs.io/), consisting of:

| Component | Folder | What it does |
|-----------|--------|--------------|
| **Lab extension** | `.` (`src/index.ts`) | Registers a CodeMirror mode and file types for `.mam` / `.mam.md` |
| **Kernel** | `kernel/` | A Jupyter kernel that runs MAM modules via `@mam/cli mam run` |

The highlighting mirrors the canonical TextMate grammar
(`../vscode/syntaxes/mam.tmLanguage.json`, scopeName `source.mam`) so MAM
looks the same across VS Code and JupyterLab.

## Requirements

- Node.js 18+ and `jlpm` (`npm install -g yarn`; `jlpm` is yarn's Jupyter
  alias) — for the extension
- Python 3.8+, `ipykernel`, and the `@mam/cli` binary on `PATH` — for the
  kernel

Build the CLI/runtime first (repo root):

```bash
pnpm install
pnpm build
```

## Install the Lab extension

```bash
cd desktop-extension/jupyter
jlpm install
jlpm build
jupyter labextension develop . --overwrite
```

Restart JupyterLab. Opening a `.mam` or `.mam.md` file now highlights MAM
syntax, and the file is registered as a text file type.

## Install the kernel

```bash
cd desktop-extension/jupyter
jupyter kernelspec install kernel/ --user
```

See `kernel/README.md` for details. Then start JupyterLab, create a Notebook,
and pick the **MAM** kernel. Cells are saved to a temp `.mam` file and executed
with `mam run <file> --format json`; the result is returned as the cell output.

## Layout

```
jupyter/
├── package.json          # JupyterLab extension manifest
├── tsconfig.json
├── src/index.ts          # extension entry: file types + CodeMirror mode
├── schema/plugin.json    # extension settings schema
└── kernel/
    ├── kernel.json       # Jupyter kernel spec
    ├── kernel.py         # minimal MAM kernel
    ├── requirements.txt
    └── README.md
```