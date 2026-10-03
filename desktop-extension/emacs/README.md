# MAM for Emacs

A complete major mode for editing **MAM** (Machine Agent Modules) files in
Emacs, covering `.mam` and `.mam.md` extensions.

## What's included

| File | Purpose |
|------|---------|
| `mam-mode.el` | Full major mode: `font-lock-defaults` with rules for YAML front matter (`---` ... `---`), headings, code fences, mermaid blocks, lists, tables, blockquotes, links and inline formatting; a tuned syntax table; an outline/imenu integration; and a `mam-validate` command |

The highlighting rules mirror the canonical TextMate grammar in
`../vscode/syntaxes/mam.tmLanguage.json`. Every token maps to a standard
face (or a `defface` that inherits standard faces), so it follows your
theme.

## Installation

Add the folder to your `load-path` and register the mode on
`auto-mode-alist`. Put this in your init file:

```elisp
(add-to-list 'load-path "~/path/to/MAM/desktop-extension/emacs")
(require 'mam-mode)
(add-to-list 'auto-mode-alist '("\\.mam\\'\\|\\.mam\\.md\\'" . mam-mode))
```

### With `use-package`

```elisp
(use-package mam-mode
  :ensure nil
  :load-path "~/path/to/MAM/desktop-extension/emacs"
  :mode (("\\.mam\\'\\|\\.mam\\.md\\'" . mam-mode))
  :hook (mam-mode . outline-minor-mode))
```

### With `straight.el` / `elpaca`

```elisp
(straight-use-package
  '(mam-mode :type git :host github
             :repo "tcp-ecosystems/MAM"
             :files ("desktop-extension/emacs/*.el")))
```

## Usage

- Open a `.mam` file — highlighting is automatic once `auto-mode-alist` is
  set.
- `M-x mam-validate` (or `C-c C-v`) runs `mam validate FILE` via
  `shell-command` and shows the output in a `*mam-validate*` buffer. The
  `mam` binary must be on your `PATH` (build with `pnpm install &&
  pnpm build` from the repo root).
- `M-x outline-minor-mode` lets you fold/navigate `##` sections (the
  front matter block folds nicely with `outline-hide-body`).

## Notes

- The mode derives from `text-mode`, so it works even without
  `markdown-mode` installed. If you prefer markdown-mode's extras, you can
  bind `mam-mode` as a `markdown-mode`-derived hook — but this mode is
  fully standalone.
- Front matter is highlighted as YAML (keys in the variable-name face,
  values in the string face) and is scoped strictly to the region between
  the first two `---` fences.