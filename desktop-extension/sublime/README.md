# MAM for Sublime Text

Syntax highlighting and file-type detection for MAM (Markdown as Module)
`.mam` and `.mam.md` files.

## Files

| File | Purpose |
|------|---------|
| `mam.sublime-syntax` | YAML-based syntax definition (contexts: `frontmatter`, `heading`, `code-fence`, `mermaid`, `table`, `list`, `comment`, `inline`, `prototype`) |
| `mam.sublime-settings` | File extension mapping (`mam`, `mam.md`), color scheme hint, editor preferences |

The grammar mirrors the canonical TextMate grammar in
`desktop-extension/vscode/syntaxes/mam.tmLanguage.json` and reuses its scope
names (`source.mam`, `markup.heading.*`, `markup.raw`, `keyword.control.section.mam`,
`punctuation.definition.frontmatter.mam`, ...), so themes and snippets stay
consistent across editors.

## What is highlighted

- **YAML front matter** between `---` and `---` (keys as tags, values as strings)
- **`##` sections** and all ATX headings (`#`–`######`)
- **Fenced code blocks** `` ```lang `` → `` ``` ``
- **Mermaid diagrams** inside ``` ```mermaid ``` fences (graph keywords, edges)
- **GFM pipe tables** (separator grid + cell content)
- **Lists** (unordered `-`/`*`/`+` and ordered `1.`)
- **Inline markdown**: bold, italic, `` `code` ``, `[links](url)`, bare URLs
- **HTML comments** (`<!-- ... -->`)
- **MAM section keywords**: `Purpose`, `Inputs`, `Outputs`, `Capabilities`,
  `Rules`, `Workflow`, `Dependencies`, `Permissions`, `Tests`, `Examples`,
  `References`, plus `required`/`optional`/`true`/`false`

## Install

### Option A — per-user (recommended)

1. Open Sublime Text and choose **Preferences ▸ Browse Packages…**.
   This opens your `Packages/` folder.
2. Copy both files into `Packages/User/`:
   - `mam.sublime-syntax`
   - `mam.sublime-settings`
3. Restart Sublime Text (or run **Tools ▸ Developer ▸ Reload Syntax** after
   saving the syntax file). Open a `.mam` or `.mam.md` file and confirm
   **MAM** is selected in **View ▸ Syntax**.

### Option B — as a dedicated package

1. From **Preferences ▸ Browse Packages…**, create a folder named `MAM`.
2. Copy both files into `Packages/MAM/`.
3. Restart Sublime Text.

### Option C — via git (for contributors)

```bash
# From this repo, inside desktop-extension/sublime
cp mam.sublime-syntax mam.sublime-settings \
  "$APPDATA/Sublime Text/Packages/User/"     # Windows
# macOS/Linux: ~/Library/Application Support/Sublime Text/Packages/User/
```

## Verification

The syntax file is plain YAML and can be validated with the repo's `yaml`:

```bash
node -e "require('yaml').parse(require('fs').readFileSync('mam.sublime-syntax','utf8')); console.log('valid YAML')"
```

## Troubleshooting

- **`.mam.md` opens as plain Markdown**: ensure `mam.md` is listed before
  `mam` in `mam.sublime-settings` and restart Sublime Text.
- **No syntax selected**: verify the file was copied to `Packages/User/`
  (not a subfolder) and that the extension `mam` isn't claimed by another
  package (check via **Preferences ▸ Settings** → `ignored_packages`).
- **Color scheme**: the settings pin `Monokai.sublime-color-scheme` as a
  hint; delete the `color_scheme` key to keep your default theme.