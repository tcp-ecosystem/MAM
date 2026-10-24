Buddy, we can narrow this down. 🔍 Since the oversized, bold `mermaid`, `python`, and `yaml` labels appear only in the right-side minimap of a `.mam` file, I would investigate VS Code's minimap rendering and MAM's syntax-tokenization rules before changing the MAM runtime or parser.

VS Code describes the minimap as a compressed overview of the source file. Its appearance can reflect the text and token styling in the editor, so the screenshot alone does not prove that MAM's grammar is broken.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://code.visualstudio.com\&sz=32)

code.visualstudio.com

+1



## Likely causes, ranked

1\. Minimap rendering makes fence labels unusually prominent

The minimap is displaying actual source characters at a very small scale. Short, high-contrast language identifiers can stand out against the smaller, denser code around them. If the main editor looks correct, this is the leading explanation.

2\. MAM's TextMate grammar assigns unexpected token scopes

If the `.mam` grammar highlights the fence identifier as a heading, markup emphasis, or another unexpected scope, the minimap can make the resulting contrast more noticeable. VS Code's scope inspector can confirm the actual token classification.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://github.com\&sz=32)

GitHub

+1



3\. Minimap settings or theme interaction

Minimap scale and character rendering are configurable. These settings can help establish whether the effect is visual rather than a problem in MAM's syntax definition.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://microsoft.github.io\&sz=32)

Monaco Editor API

+1



## Step 1 — Run a reversible minimap test

In VS Code:

1. Open Preferences: Open User Settings (JSON) from the Command Palette.
2. Temporarily add or adjust these settings:

```
{
  "editor.minimap.enabled": true,
  "editor.minimap.scale": 1,
  "editor.minimap.renderCharacters": true,
  "editor.minimap.maxColumn": 80
}
```

If those keys already exist, edit their existing values rather than creating duplicate JSON properties.

3\. Save and inspect the same `.mam` file again.

The key test is `editor.minimap.scale: 1`. If the labels become less prominent, the problem is likely the minimap's rendering scale. Setting `renderCharacters` to `false` is a second diagnostic test: it replaces the tiny characters with color blocks, although you lose readable text in the minimap.

## Step 2 — Confirm whether MAM's grammar is involved

If the issue persists, place your cursor directly on `mermaid` in the main editor, then run:

Developer: Inspect Editor Tokens and Scopes

Check whether the token has an unexpected scope, such as a Markdown heading or emphasis scope, instead of a code-fence language-identifier scope. This is VS Code's recommended way to diagnose syntax highlighting.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://github.com\&sz=32)

GitHub

+1



## Step 3 — Apply the fix at the correct layer

| Test result                                                  | Recommended action                                                                                            |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Changing minimap scale fixes it                              | Keep the minimap setting adjustment; do not modify MAM grammar.                                               |
| Main-editor token scope is incorrect                         | Fix the narrowest relevant pattern in the MAM TextMate grammar.                                               |
| Token scopes look correct but only the minimap looks unusual | Investigate theme and minimap settings before touching the grammar.                                           |
| The same behavior occurs in Markdown files                   | Compare with VS Code's built-in Markdown language mode to isolate editor settings from MAM-specific behavior. |

My recommendation: do not change the MAM parser, runtime, or language specification for this symptom. The evidence currently points to an editor presentation issue, and we should prove otherwise before modifying syntax highlighting.

Buddy, if you run the scale test and tell me whether it changes the appearance, we can narrow the fix down considerably without risking the syntax highlighting that already works in MAM. 🔧

---

# RESOLVED (Oct 24, 2026) — root cause identified by Extension Bisect

**Culprit: `yoavbls.pretty-ts-errors` (v0.8.7) — NOT the MAM grammar, theme, or VS Code settings.**

Run `Help: Start Extension Bisect` (F1) — after ~5 rounds it identified `yaovbls.pretty-ts-errors` as the extension causing the bold/oversized fenced code rendering (screenshot: `images/bisect-still.png`).

## Mechanism (verified in the shipped bundle)

`pretty-ts-errors` embeds its own TextMate theme engine and **injects a `<style>` into the entire workbench DOM at runtime**, mapping markdown-ish scopes to real CSS:

- `markup.bold` / `strong` → `font-weight: bold`
- fenced-code/heading scopes pick up bold too

Because it's runtime DOM CSS targeting the editor's own token classes (`mtk*`), it restyles the **main editor text and the minimap** — which is why:

- no theme file, setting, or grammar rule ever explained it,
- it survived every MAM extension version (2.0.3 → 2.0.15), and
- it affected `.mam`, `.mam.md`, and plain `.md` files alike.

Upstream state: marketplace latest == installed (0.8.7), no fixed release exists.

## Fix applied

1. `pretty-ts-errors` kept **disabled** (Extension Bisect "Keep this extension disabled") — or uninstall:
   `code --uninstall-extension yoavbls.pretty-ts-errors`
2. No parser/runtime/spec change — confirmed: this was never a MAM bug. The Section above ("do not change the MAM parser... prove otherwise") stands, now proven.
3. MAM extension 2.0.15 hardening (commit `1581440`): fence scopes renamed to collision-proof `.mam` scopes and `meta.separator` renamed — retained as defensive hygiene so no third-party CSS can find a *named* theme-scoped hook inside MAM fences.
4. User-side convenience shipped in 2.0.15: `files.associations` default `*.mam.md → mam` via `configurationDefaults`.

Status: **closed**. If `pretty-ts-errors` ships a fixed version later, it can be re-enabled; verify with Extension Bisect or by re-checking fence rendering immediately after enabling.