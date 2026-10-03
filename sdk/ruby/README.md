# MAM Ruby SDK

A dependency-free SDK for parsing, validating, inspecting, and executing Machine Agent Modules (MAM) files.

## Build

mam-sdk-ruby.gemspec (Ruby >= 3.0; no gem dependencies)

## Quick start

```text
module_value = Mam::Parser.parse(source, "example.mam.md")
result = Mam::Validator.new.validate(module_value)
results = Mam::Runtime.new.execute_module(module_value)
```

The public model uses `frontmatter`, `sections`, `raw_content`/`rawContent`, and `file_path`/`filePath` as language-idiomatic forms of the shared contract. `SectionKind` contains the nineteen standard kinds plus a custom kind. Content nodes include headings, paragraphs, code blocks, lists, tables, blockquotes, rules, links, images, and text.

## Support modules

`config`, `cache`, `format`, `graph`, `template`, and `doctor` are included in every SDK package.

## Verification status

The package has never been compiled or executed in this environment because the required toolchain is absent. The test suite has never been executed. See `update.md` for exact static checks and first-build risks.

## Dependencies

No third-party dependencies. Ruby stdlib `yaml`/Psych parses front matter; `open3`, `timeout`, `json`, `tmpdir`, and `fileutils` are stdlib.
