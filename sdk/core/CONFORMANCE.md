# MAM SDK Conformance

This directory is the normative cross-language contract for the MAM SDK family.
A language SDK is conformant when it exposes the same semantic surface and
matches the fixtures in `fixtures/`. Names are camelCase where the language
requires it, but the meanings and canonical values below do not change.

## Parsing surface

Every SDK exposes `parse`, `parseFile`, `parseString`, and `mustParse`. A
successful parse returns a `Module` with `frontmatter`, `sections`,
`raw_content`, and `file_path`. `parseString` accepts source text without
filesystem access. `parseFile` reads a file and reports read errors through
the documented error path. `mustParse` is for static fixtures and throws when
the input is invalid.

Malformed frontmatter and unterminated frontmatter are parse errors. A module
without frontmatter can be parsed when the SDK exposes the missing-frontmatter
validation diagnostic; `mustParse` requires frontmatter.

## Types

- `Module`: frontmatter, sections, raw content, and file path.
- `FrontMatter`: `schema_version`, `name`, `version`, `description`,
  `authors[]`, `tags[]`, `license`, `dependencies[]`, and a string-keyed
  metadata map. Unknown scalar fields are retained in metadata.
- `Section`: `kind`, `title`, content nodes, and source location.
- `CodeBlock`: language, code, and source location.
- `ContentNode`: `Heading`, `Paragraph`, `CodeBlock`, `List`, `Table`,
  `Blockquote`, `HorizontalRule`, `Link`, `Image`, or `Text`.
- `SourceLocation`: line, column, offset, and file.
- `SectionKind`: the standard values below plus `Custom`.
- `ParseError`: code, message, and source location.
- `Diagnostic`: code, severity, message, line, section, and optional location.
- `ValidationResult`: diagnostics and `is_valid`; it is valid only with no
  `Error` diagnostic.
- `ExecutionResult`: exit code, stdout, stderr, and duration in milliseconds.
- `ExecutionConfig`: timeout milliseconds, environment map, working directory,
  and maximum output bytes.
- `Plugin`: name, version, hooks, and handler/interface method.
- `PluginRegistry`: deterministic registration and ordered hook dispatch.
- `HookPoint`: before/after parse, before/after validate, before/after execute,
  and on-error points.

Convenience exports are `VERSION`, `SDK_NAME`, `userAgent()`,
`moduleSummary()`, and `isValidModule()`.

## Section kinds and canonical order

The request names 19 standard kinds and one `Custom` variant, for 20 total
`SectionKind` values. The canonical order is:

`metadata`, `purpose`, `inputs`, `outputs`, `rules`, `workflow`, `mermaid`,
`python`, `prompt`, `memory`, `examples`, `tests`, `references`,
`dependencies`, `exports`, `imports`, `plugins`, `permissions`, `capabilities`.

Unknown titles are not discarded: they are parsed with `kind = Custom`.
A standard section heading is conventionally level 2; validation may report a
warning for a different level. Duplicate standard kinds are errors. Required
sections for the reference validator are `metadata` and `purpose`.

## Frontmatter and schemas

Frontmatter starts on the first line with `---` and closes with a later `---`.
Scalar strings, inline lists, and block lists of strings are normative. The
JSON Schemas in `schema/` define the typed fields; `additionalProperties` is
allowed in frontmatter because unknown values belong in metadata. `name` is
required for a valid module; `version` is recommended and `schema_version` is
informative. `authors`, `tags`, and `dependencies` must be arrays of strings.

## Diagnostics

Severities are exactly `Error`, `Warning`, and `Info`. Error diagnostics make
validation fail. Warning and Info diagnostics are retained and do not make a
result invalid. Codes are stable fixture identifiers. The reference codes
include `FRONTMATTER_MISSING`, `FRONTMATTER_NAME_REQUIRED`,
`SECTION_MISSING`, `SECTION_DUPLICATE`, `SECTION_ORDER`,
`CODEBLOCK_LANGUAGE`, `CODEBLOCK_EMPTY`, and `SECTION_UNKNOWN`.

## Support modules

- `config`: default config, target validation, merge without input mutation,
  environment overrides, and JSON load/save.
- `cache`: bounded in-memory cache with TTL expiry, hit/miss statistics, and
  deterministic keys.
- `format`: stable summaries, section lists, validation and execution reports,
  and JSON output.
- `graph`: deterministic module graph, deduplication, and cycle-aware
  topological ordering.
- `template`: module/agent/tool starters, placeholder rendering, name
  validation, and parseable output.
- `doctor`: environment checks with pass/warn/fail statuses and non-failing
  reports for optional dependencies.

## Fixture protocol

Each fixture has a `.mam.md` file and an adjacent `expected.json`. The expected
file uses this shape:

```json
{
  "parse": true,
  "validate_clean": true,
  "diagnostics": [{"code": "SECTION_UNKNOWN", "severity": "Info"}]
}
```

`diagnostics` is an exact multiset of required code/severity pairs for the
reference validator. `validate_clean` means `is_valid` is true. A fixture with
`parse: false` must fail through the SDK parse-error path. Unknown sections are
expected to parse and validate as `Info`, not as fatal errors.
