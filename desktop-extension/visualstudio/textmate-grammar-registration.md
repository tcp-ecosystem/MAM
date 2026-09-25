# TextMate grammar registration in Visual Studio

This note explains where Visual Studio picks up the MAM TextMate grammar
(`source.mam`) and what it takes for `.mam` / `.mam.md` files to be colorized.

## 1. Grammar discovery via the TextMate repository registry

Visual Studio's TextMate engine reads a registry root that maps repository
names to grammar folders. Extension authors write this registry through a
`.pkgdef` file that ships inside the VSIX:

```pkgdef
[$RootKey$\TextMate\Repositories]
"MAM"="$PackageFolder$\Grammars"
```

`$PackageFolder$` resolves to the folder where the VSIX is unpacked on disk:

```
%LocalAppData%\Microsoft\VisualStudio\<version>\Extensions\<guid>\
```

All `*.tmLanguage`, `*.tmLanguage.json`, `*.plist`, and `*.json` grammar files
in that `Grammars` folder are loaded. The MAM grammar file
`syntaxes/mam.tmLanguage.json` declares `"scopeName": "source.mam"`, which
becomes the language's registered scope.

## 2. File association

Associating `.mam` and `.mam.md` with the language and giving them icons in
Solution Explorer is also done in the `.pkgdef`:

```pkgdef
[$RootKey$\ShellFileAssociations\.mam]
"DefaultIconMoniker"="KnownMonikers.MarkdownFile"
[$RootKey$\ShellFileAssociations\.mam.md]
"DefaultIconMoniker"="KnownMonikers.MarkdownFile"
```

## 3. Content type and language configuration (VS 2022+)

For comment toggling, bracket matching, and other editing behaviors, VS 2022+
supports Language Configuration files. They are registered by grammar scope
and by content type under `[$RootKey$\TextMate\LanguageConfiguration]`:

```pkgdef
[$RootKey$\TextMate\LanguageConfiguration\GrammarMapping]
"source.mam"="$PackageFolder$\mam-language-configuration.json"
```

When no language service (LSP) claims the content type, the editor falls back
to the TextMate grammar for colorization.

## 4. The built-in Starterkit location (manual / copy path)

Outside of a VSIX, grammars placed in the built-in Starterkit folder are
discovered at startup:

```
%ProgramFiles(x86)%\Microsoft Visual Studio\<version>\<SKU>\
  Common7\IDE\CommonExtensions\Microsoft\TextMate\Starterkit\Grammars
```

Visual Studio 2022 (x64) uses the equivalent path under `%ProgramFiles%`.
This path requires administrator rights and is reset on VS repair/update, so
it is only recommended for quick local testing.

## 5. Quick reference

| What | Where it lives |
| --- | --- |
| Grammar repository registration | `[$RootKey$\TextMate\Repositories]` in a `.pkgdef` inside the VSIX |
| Grammar files on disk | `%LocalAppData%\Microsoft\VisualStudio\<version>\Extensions\<guid>\Grammars\` |
| File extension → icon | `[$RootKey$\ShellFileAssociations\.mam]` and `.mam.md` |
| Scope name | `source.mam` (declared in `syntaxes/mam.tmLanguage.json`) |
| Language configuration mapping | `[$RootKey$\TextMate\LanguageConfiguration\GrammarMapping]` |
| Manual grammar location | `...\TextMate\Starterkit\Grammars\` under the VS install dir |