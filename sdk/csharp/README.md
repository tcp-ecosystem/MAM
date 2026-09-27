# MAM C# SDK

A dependency-free SDK for parsing, validating, inspecting, and executing Markdown as Module (MAM) files.

## Build

Mam.Sdk.csproj (`net8.0`, nullable enabled, XML documentation, no package references)

## Quick start

```text
Ast.Module module = Parser.Parse(source, "example.mam.md");
Validator.ValidationResult result = new Validator().Validate(module);
ExecutionResult[] results = new Runtime(ExecutionConfig.Defaults()).ExecuteModule(module);
```

The public model uses `frontmatter`, `sections`, `raw_content`/`rawContent`, and `file_path`/`filePath` as language-idiomatic forms of the shared contract. `SectionKind` contains the nineteen standard kinds plus a custom kind. Content nodes include headings, paragraphs, code blocks, lists, tables, blockquotes, rules, links, images, and text.

## Support modules

`config`, `cache`, `format`, `graph`, `template`, and `doctor` are included in every SDK package.

## Verification status

The package has never been compiled or executed in this environment because the required toolchain is absent. The test suite has never been executed. See `update.md` for exact static checks and first-build risks.

## Dependencies

No third-party dependencies. `System.Text.Json` is part of .NET and is used for SDK config; the Markdown/front-matter parser is local.
