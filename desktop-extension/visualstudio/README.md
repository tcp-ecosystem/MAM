# MAM Language Support — Visual Studio (full IDE)

Syntax highlighting and language support for MAM (Machine Agent Modules) files
(`*.mam` and `*.mam.md`) in the full Visual Studio IDE on Windows.

Visual Studio colorizes files through **TextMate grammars** (the same grammar
technology VS Code uses). The canonical grammar lives at
`../vscode/syntaxes/mam.tmLanguage.json`; this folder ships a byte-identical
copy at `syntaxes/mam.tmLanguage.json` (scope name `source.mam`).

## How Visual Studio consumes TextMate grammars

Visual Studio (2019+) loads TextMate grammars from a **Grammars** folder inside
an installed extension package and registers them through a **`.pkgdef`** file
that writes to the `TextMate` registry root:

```pkgdef
[$RootKey$\TextMate\Repositories]
"MAM"="$PackageFolder$\Grammars"
```

The grammar's `scopeName` (`source.mam`) is what identifies the language. File
extensions are associated with Solution Explorer icons via
`[$RootKey$\ShellFileAssociations]`. For editing features (comment toggling,
bracket matching), VS 2022+ uses a `language-configuration.json` registered
under `[$RootKey$\TextMate\LanguageConfiguration\GrammarMapping]`.

## Path A — Build and install a VSIX (recommended)

1. Install the **Visual Studio extension development** workload (via the Visual
   Studio Installer) and the Visual Studio SDK.
2. Create a new **VSIX Project** (`File > New > Project`, search `vsix`).
3. Add `MAM.vsixmanifest` from this folder as the extension manifest.
   (When packaged, the manifest inside the `.vsix` must be named
   `extension.vsixmanifest`.)
4. Add the grammar so it ships in the package:
   - Create a `Grammars` folder in the project.
   - Add `syntaxes/mam.tmLanguage.json` to it.
   - Set **Build Action = Content**, **Include in VSIX = True** for the file.
5. Add a `languages.pkgdef` file (Content, Include in VSIX = True) that
   registers the grammar repository and file associations:

   ```pkgdef
   ; Registers the MAM grammar repository with Visual Studio
   [$RootKey$\TextMate\Repositories]
   "MAM"="$PackageFolder$\Grammars"

   ; Associate icons with MAM file extensions in Solution Explorer
   [$RootKey$\ShellFileAssociations\.mam]
   "DefaultIconMoniker"="KnownMonikers.MarkdownFile"
   [$RootKey$\ShellFileAssociations\.mam.md]
   "DefaultIconMoniker"="KnownMonikers.MarkdownFile"
   ```

6. Register the `.pkgdef` as an asset in the manifest:

   ```xml
   <Asset Type="Microsoft.VisualStudio.VsPackage" Path="languages.pkgdef" />
   ```

7. Build the project. Press **F5** to launch the Experimental Instance, or
   double-click the generated `.vsix` in `bin\Debug` / `bin\Release` to install
   into your daily instance. Open a `.mam` file and verify colorization.

## Path B — Copy the grammar (quick and simple)

For local/one-off use you can copy the grammar into the built-in TextMate
Starterkit folder that Visual Studio loads at startup:

```
%ProgramFiles(x86)%\Microsoft Visual Studio\<version>\<SKU>\
  Common7\IDE\CommonExtensions\Microsoft\TextMate\Starterkit\Grammars
```

For Visual Studio 2022 (x64) the path is under `%ProgramFiles%` instead of
`%ProgramFiles(x86)%`.

- Requires an elevated (Administrator) copy.
- No packaging or build step needed — restart VS and open a `.mam` file.
- **Caveat**: the folder is part of the VS installation and is reset on repair,
  update, or reinstall. For anything durable or shareable, use Path A (VSIX).

## Project layout

| Path | Purpose |
| --- | --- |
| `README.md` | This guide: VSIX build/install and copy-the-grammar paths |
| `syntaxes/mam.tmLanguage.json` | Byte-identical copy of the canonical MAM TextMate grammar |
| `MAM.vsixmanifest` | VSIX manifest scaffold (identity `MAMLanguage`, v0.1.0) |
| `textmate-grammar-registration.md` | Where and how VS discovers/registers the grammar |

## References

- https://learn.microsoft.com/en-us/visualstudio/extensibility/language-configuration
- https://github.com/microsoft/VSSDK-Extensibility-Samples/tree/master/TextmateGrammar
- https://learn.microsoft.com/en-us/visualstudio/extensibility/anatomy-of-a-vsix-package
- https://macromates.com/manual/en/language_grammars