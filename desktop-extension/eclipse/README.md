# MAM Language Support — Eclipse

Eclipse plugin scaffold providing an editor, syntax coloring, content types,
and a validation builder for MAM modules (`*.mam` and `*.mam.md`).

The partition rules mirror the canonical TextMate grammar at
`../vscode/syntaxes/mam.tmLanguage.json` (YAML front matter, `##` headings,
mermaid/fenced code blocks, inline code, comments).

## Prerequisites

- JDK 17
- Eclipse IDE for Eclipse Committers / RCP and RAP Developers (includes PDE):
  https://www.eclipse.org/downloads/packages/
- Apache Maven 3.8+ (for headless Tycho builds): https://maven.apache.org/

## Project layout

| Path | Purpose |
| --- | --- |
| `pom.xml` | Tycho build (target platform, eclipse-plugin packaging) |
| `META-INF/MANIFEST.MF` | OSGi bundle manifest (`com.mam.ide.eclipse`) |
| `plugin.xml` | Extension points: content types, editor, builder, markers |
| `src/com/mam/ide/eclipse/MamEditor.java` | `TextEditor` + `MamSourceViewerConfiguration` |
| `src/com/mam/ide/eclipse/MamColorManager.java` | SWT color provider |
| `src/com/mam/ide/eclipse/MamPartitionScanner.java` | Partitions: front matter, code, comments |
| `src/com/mam/ide/eclipse/MamBuilder.java` | `IncrementalProjectBuilder` running `mam validate` |

## Run / debug with PDE

1. *File | Import | Plug-in Development | Existing Projects into Workspace*,
   select this directory.
2. The bundle appears as `com.mam.ide.eclipse`. Open the manifest editor:
   - *Overview* tab → *Launch an Eclipse application* → `MAM Eclipse Application`
   - *Overview* tab → *Launch an Eclipse application in Debug mode* for
     debugging (breakpoints under `src/com/mam/ide/eclipse/`).
3. In the runtime workbench, create `demo.mam` — the MAM editor opens with
   partition-aware syntax coloring. Add the MAM nature/builder to the project
   to run `mam validate` and see problem markers.

## Build with Tycho (headless)

```bash
mvn clean verify
```

The target platform is resolved from the p2 repository declared in `pom.xml`
(`https://download.eclipse.org/releases/2024-06/`). Build output is written to
`target/`.

## Multi-module / repository layout

For a larger product workspace, promote this directory to a Tycho aggregator:

```xml
<packaging>pom</packaging>
<modules>
  <module>com.mam.ide.eclipse</module>
  <module>com.mam.ide.eclipse.feature</module>
  <module>com.mam.ide.eclipse.repository</module>
</modules>
```

where `com.mam.ide.eclipse` is the `eclipse-plugin` module, the feature module
uses `eclipse-feature` packaging, and the repository module uses
`eclipse-repository` packaging.

## Extension points (plugin.xml)

- `org.eclipse.core.contenttype.contentTypes` — `com.mam.ide.eclipse.contentType`
  for `mam,mam.md` (base type text)
- `org.eclipse.ui.editors` — MAM editor bound to the content type via
  `contentTypeBinding` (covers both `*.mam` and `*.mam.md`)
- `org.eclipse.core.resources.builders` + `org.eclipse.core.resources.natures` —
  `MamBuilder`
- `org.eclipse.core.resources.markers` — `com.mam.ide.eclipse.marker` problem marker

## References

- https://www.eclipse.org/pde/
- https://www.eclipse.org/tycho/
- https://wiki.eclipse.org/Tycho
- https://download.eclipse.org/releases/2024-06/
- https://www.vogella.com/tutorials/EclipsePDE/article.html
- https://www.vogella.com/tutorials/EclipseTycho/article.html
- https://www.eclipse.org/articles/Article-Text-Editors/Article-Text-Editors.html