# ruby SDK — Update

## Status: static work only

This package was **never compiled or executed** because `ruby` tooling is not installed. The test suite has never been executed. No build output was created.

## Files and measured line counts

| File | Lines |
| --- | ---: |
| `lib/mam/ast.rb` | 680 |
| `lib/mam/cache.rb` | 531 |
| `lib/mam/config.rb` | 497 |
| `lib/mam/doctor.rb` | 463 |
| `lib/mam/format.rb` | 446 |
| `lib/mam/graph.rb` | 495 |
| `lib/mam/mam.rb` | 434 |
| `lib/mam/parser.rb` | 539 |
| `lib/mam/plugins.rb` | 503 |
| `lib/mam/runtime.rb` | 517 |
| `lib/mam/template.rb` | 486 |
| `lib/mam/validator.rb` | 481 |
| `test/mam_sdk_test.rb` | 84 |

## What was built

- Core AST and parsing with a local supported-YAML-subset parser, defensive collections, source locations, and malformed-input results.
- Validation with Error/Warning/Info diagnostics and extension points.
- Bounded execution configuration and structured process results.
- Plugin interfaces/registry with ordered hooks and cancellation/error handling.
- Six support modules for config, TTL cache, formatting, graph queries, starter templates, and environment diagnostics.
- Package identity/convenience APIs and a 10-case zero-dependency test file.

## Verification performed

The throwaway checker `C:\Users\USER\AppData\Local\Temp\opencode\check_mam_balancing.py` was run over every created source, build, test, and documentation file. It is delimiter-oriented and language-aware for Java/C# comments and strings and Ruby comments, strings, heredocs, and regex/quote forms. The final recorded result was:

```text
PASS
ruby: source files all >= 300 lines; 10 test cases
Checked all created files; 0 structural errors
```

This is not compilation, type checking, linking, or test execution.

## Dependencies

No third-party dependencies. Ruby stdlib `yaml`/Psych parses front matter; `open3`, `timeout`, `json`, `tmpdir`, and `fileutils` are stdlib.

## Most likely first-build failures

1. **Compiler/type inference:** no compiler was available to verify language-specific nullability, overload resolution, or target-framework APIs.
2. **Front-matter edge cases:** Psych or the hand-rolled subset may differ on aliases, unusual quoting, or malformed indentation; malformed input paths are intended to return safe failures.
3. **Process execution:** runtime interpreters may be absent, and platform-specific process/environment behavior is unverified.
4. **Documentation/build metadata:** Maven, .NET, and gemspec metadata were not validated by their native tools.
5. **Test expectations:** all tests are newly authored and have never been executed; assertions may need adjustment after a real toolchain run.

No dependency is referenced without the status above. No files outside `sdk/ruby` were changed for this package.
