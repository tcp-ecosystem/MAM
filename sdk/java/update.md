# java SDK — Update

## Status: static work only

This package was **never compiled or executed** because `java` tooling is not installed. The test suite has never been executed. No build output was created.

## Files and measured line counts

| File | Lines |
| --- | ---: |
| `src/main/java/com/mam/Ast.java` | 401 |
| `src/main/java/com/mam/Cache.java` | 321 |
| `src/main/java/com/mam/Config.java` | 303 |
| `src/main/java/com/mam/ConfigJson.java` | 326 |
| `src/main/java/com/mam/Doctor.java` | 304 |
| `src/main/java/com/mam/Format.java` | 309 |
| `src/main/java/com/mam/Graph.java` | 320 |
| `src/main/java/com/mam/Mam.java` | 300 |
| `src/main/java/com/mam/Parser.java` | 408 |
| `src/main/java/com/mam/Plugins.java` | 309 |
| `src/main/java/com/mam/Runtime.java` | 311 |
| `src/main/java/com/mam/Template.java` | 300 |
| `src/main/java/com/mam/Validator.java` | 332 |
| `src/test/java/com/mam/AstTest.java` | 32 |

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
java: source files all >= 300 lines; 10 test cases
Checked all created files; 0 structural errors
```

This is not compilation, type checking, linking, or test execution.

## Dependencies

No third-party dependencies. The hand-rolled front-matter subset is parsed locally; Java standard library is used for files, processes, collections, and diagnostics.

## Most likely first-build failures

1. **Compiler/type inference:** no compiler was available to verify language-specific nullability, overload resolution, or target-framework APIs.
2. **Front-matter edge cases:** Psych or the hand-rolled subset may differ on aliases, unusual quoting, or malformed indentation; malformed input paths are intended to return safe failures.
3. **Process execution:** runtime interpreters may be absent, and platform-specific process/environment behavior is unverified.
4. **Documentation/build metadata:** Maven, .NET, and gemspec metadata were not validated by their native tools.
5. **Test expectations:** all tests are newly authored and have never been executed; assertions may need adjustment after a real toolchain run.

No dependency is referenced without the status above. No files outside `sdk/java` were changed for this package.
