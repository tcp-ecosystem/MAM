# csharp SDK — Update

## Status: static work only

This package was **never compiled or executed** because `csharp` tooling is not installed. The test suite has never been executed. No build output was created.

## Files and measured line counts

| File | Lines |
| --- | ---: |
| `src/Ast.cs` | 473 |
| `src/Cache.cs` | 337 |
| `src/Config.cs` | 341 |
| `src/Doctor.cs` | 332 |
| `src/Format.cs` | 326 |
| `src/Graph.cs` | 331 |
| `src/Mam.cs` | 330 |
| `src/Parser.cs` | 380 |
| `src/Plugins.cs` | 356 |
| `src/Runtime.cs` | 353 |
| `src/Template.cs` | 331 |
| `src/Validator.cs` | 362 |
| `tests/TestHarness.cs` | 33 |

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
csharp: source files all >= 300 lines; 10 test cases
Checked all created files; 0 structural errors
```

This is not compilation, type checking, linking, or test execution.

## Dependencies

No third-party dependencies. `System.Text.Json` is part of .NET and is used for SDK config; the Markdown/front-matter parser is local.

## Most likely first-build failures

1. **Compiler/type inference:** no compiler was available to verify language-specific nullability, overload resolution, or target-framework APIs.
2. **Front-matter edge cases:** Psych or the hand-rolled subset may differ on aliases, unusual quoting, or malformed indentation; malformed input paths are intended to return safe failures.
3. **Process execution:** runtime interpreters may be absent, and platform-specific process/environment behavior is unverified.
4. **Documentation/build metadata:** Maven, .NET, and gemspec metadata were not validated by their native tools.
5. **Test expectations:** all tests are newly authored and have never been executed; assertions may need adjustment after a real toolchain run.

No dependency is referenced without the status above. No files outside `sdk/csharp` were changed for this package.
