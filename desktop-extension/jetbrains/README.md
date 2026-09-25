# MAM Language Support — JetBrains (IntelliJ Platform)

JetBrains IntelliJ Platform plugin scaffold providing syntax highlighting,
color settings, and inline validation for MAM modules (`*.mam` and `*.mam.md`).

The token structure mirrors the canonical TextMate grammar at
`../vscode/syntaxes/mam.tmLanguage.json` (YAML front matter, `##` headings,
mermaid/fenced code blocks, inline code, comments, keywords, operators).

## Prerequisites

- JDK 17 or newer
- Gradle 8.x (a Gradle wrapper is recommended: `gradle wrapper`)
- IntelliJ IDEA Community or Ultimate (2023.2+)

## Setup

1. Open this directory as a Gradle project in IntelliJ IDEA:
   *File | Open* → select `desktop-extension/jetbrains`.
2. Let IntelliJ import `build.gradle.kts` (Gradle sync). The IntelliJ Platform
   SDK dependency is resolved automatically by the `org.jetbrains.intellij`
   Gradle plugin.
3. Optionally configure the target platform in `gradle.properties`:
   - `platformType` — `IC` (IntelliJ IDEA Community) or `IU` (Ultimate)
   - `platformVersion` — IDE version to build against (e.g. `2024.1`)
   - `sinceBuild` / `untilBuild` — plugin compatibility build-number range
4. Use the *Gradle* tool window:
   - `intellij/runIde` (or `gradle runIde`) — launches a development IDE
     with the plugin installed
   - `intellij/buildPlugin` (or `gradle buildPlugin`) — builds the plugin ZIP
     into `build/distributions/`
   - `intellij/verifyPlugin` — structural plugin.xml checks
   - `intellij/runPluginVerifier` — binary compatibility checks against
     configured IDE versions

## Package / distribute

```bash
gradle buildPlugin
```

The distributable archive is written to
`build/distributions/mam-language-jetbrains-0.1.0.zip`. Install it from
*Settings | Plugins | Install Plugin from Disk*, or upload it to the
[JetBrains Marketplace](https://plugins.jetbrains.com).

## Project layout

| Path | Purpose |
| --- | --- |
| `build.gradle.kts` | Gradle build: `org.jetbrains.intellij` + Kotlin |
| `settings.gradle.kts` | Root project name |
| `gradle.properties` | Platform/version settings |
| `src/main/resources/META-INF/plugin.xml` | Plugin descriptor & extension points |
| `src/main/java/com/mam/ide/MamLanguage.java` | `Language` definition (`MAM`) |
| `src/main/java/com/mam/ide/MamFileType.java` | File type for `.mam` / `.mam.md` |
| `src/main/java/com/mam/ide/MamLexerAdapter.java` | Minimal lexer (front matter, headings, code, comments) |
| `src/main/java/com/mam/ide/MamSyntaxHighlighter.java` | Token color map |
| `src/main/java/com/mam/ide/MamSyntaxHighlighterFactory.java` | Highlighter factory extension point |
| `src/main/java/com/mam/ide/MamColorSettingsPage.java` | Colors settings UI |
| `src/main/java/com/mam/ide/MamAnnotator.java` | Runs `mam validate`, annotates errors |

## Extension points (plugin.xml)

- `fileType` — maps the `mam;mam.md` extensions to `MamFileType` / `MAM` language
- `lang.syntaxHighlighterFactory` — wires `MamSyntaxHighlighter`
- `colorSettingsPage` — settings UI for token colors
- `annotator` — `MamAnnotator` (`mam validate` integration)

Note: `.mam.md` uses a two-part extension; the `fileType` contribution
registers both suffixes so IntelliJ can associate the second extension.

## References

- https://plugins.jetbrains.com/docs/intellij/welcome.html
- https://plugins.jetbrains.com/docs/intellij/creating-plugin-project.html
- https://plugins.jetbrains.com/docs/intellij/gradle-guide.html
- https://plugins.jetbrains.com/docs/intellij/tools-gradle-intellij-plugin.html
- https://github.com/JetBrains/gradle-intellij-plugin
- https://plugins.jetbrains.com/docs/intellij/build-number-ranges.html
- https://plugins.jetbrains.com/docs/intellij/syntax-highlighting-and-error-highlighting.html
- https://www.jetbrains.com/idea/download/