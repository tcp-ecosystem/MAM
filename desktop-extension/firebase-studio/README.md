# MAM Language Support — Firebase Studio

[Firebase Studio](https://firebase.google.com/docs/studio) (formerly Project
IDX) is Google's cloud, browser-based IDE built on Code OSS — the open-source
core of Visual Studio Code. Because it is a VS Code-based environment, it uses
the **MAM VS Code extension** (`tcp-ecosystems.mam-language`) and the same
TextMate grammar (`source.mam`) as `../vscode/`.

Extensions are installed from the [Open VSX Registry](https://open-vsx.org/),
the registry Code OSS builds consume, rather than the Microsoft Marketplace.

## Install the MAM extension

Two ways to get the extension into a Firebase Studio workspace:

1. **Open VSX (recommended).** Open the Extensions panel in the workspace,
   search for `MAM`, and install `tcp-ecosystems.mam-language`.
2. **Side-load a `.vsix`.** Build the extension from `../vscode/`
   (`pnpm build && pnpm package` or `vsce package`), then install the resulting
   `.vsix` from the Extensions panel (`...` menu → *Install from VSIX...*) or
   from the workspace terminal:

   ```bash
   code --install-extension mam-language-0.1.0.vsix
   ```

## Workspace configuration (`.idx/`)

Firebase Studio reads workspace configuration from the `.idx/` directory at the
project root. This folder provides:

- `.idx/install.json` — a machine-readable list of extensions to install for
  the workspace. The MAM extension is listed by its fully qualified id
  `tcp-ecosystems.mam-language` (`openVsxId` / `vscodeMarketplaceId`).

Firebase Studio's current canonical mechanism is `.idx/dev.nix`, where the same
extension is declared as:

```nix
{ pkgs, ... }: {
  idx.extensions = [ "tcp-ecosystems.mam-language" ];
}
```

You can keep both: `install.json` for tooling that consumes a JSON manifest,
and `idx.extensions` in `dev.nix` for the Firebase Studio workspace itself.

## Using the MAM CLI in the cloud workspace

The workspace is a full Debian VM with terminal access, so the `@mam/cli`
toolchain runs there too. Install it once via the workspace config, for
example in `.idx/dev.nix`:

```nix
{ pkgs, ... }: {
  idx.workspace.onCreate = {
    mam-cli = "npm install -g @mam/cli";
  };
}
```

Or install it directly in the terminal:

```bash
npm install -g @mam/cli
```

Then run the usual MAM commands from the workspace terminal:

```bash
mam validate            # validate all MAM modules
mam validate path/to/module.mam
mam build               # build the module graph / artifacts
mam run <module>        # execute a MAM module
```

## Project layout

| Path | Purpose |
| --- | --- |
| `README.md` | This guide: installing the extension and using the MAM CLI in the cloud |
| `.idx/install.json` | Workspace extension install manifest (lists `tcp-ecosystems.mam-language`) |

## References

- https://firebase.google.com/docs/studio
- https://firebase.google.com/docs/studio/customize-workspace
- https://firebase.google.com/docs/studio/devnix-reference
- https://open-vsx.org/