# MAM Java SDK

A dependency-free SDK for parsing, validating, inspecting, and executing Machine Agent Modules (MAM) files.

## Build

pom.xml (Maven coordinates `com.mam:mam-sdk-java`, Java 17)

## Quick start

```text
Ast.Module module = Parser.parse(source, "example.mam.md");
Validator.ValidationResult result = new Validator().validate(module);
Runtime.ExecutionResult[] results = new Runtime(Runtime.ExecutionConfig.defaults()).executeModule(module);
```

The public model uses `frontmatter`, `sections`, `raw_content`/`rawContent`, and `file_path`/`filePath` as language-idiomatic forms of the shared contract. `SectionKind` contains the nineteen standard kinds plus a custom kind. Content nodes include headings, paragraphs, code blocks, lists, tables, blockquotes, rules, links, images, and text.

## Support modules

`config`, `cache`, `format`, `graph`, `template`, and `doctor` are included in every SDK package.

## Verification status

The package has never been compiled or executed in this environment because the required toolchain is absent. The test suite has never been executed. See `update.md` for exact static checks and first-build risks.

## Dependencies

No third-party dependencies. The hand-rolled front-matter subset is parsed locally; Java standard library is used for files, processes, collections, and diagnostics.
