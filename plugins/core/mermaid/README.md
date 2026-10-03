# @mam/plugin-mermaid

> Mermaid diagram validation and rendering for MAM modules

Validates Mermaid diagrams structurally, without executing Mermaid, and renders
them for the `html`, `markdown`, `text` and `json` targets. A real render is the
only way to be certain a diagram is valid, so these checks target the mistakes
that are reliably detectable by inspection.

## Installation

```bash
pnpm add @mam/plugin-mermaid
```

## Quick start

```typescript
import mermaidPlugin, { validateMermaidDiagram } from '@mam/plugin-mermaid';

mermaidPlugin.manifest.name;   // '@mam/plugin-mermaid'

const result = validateMermaidDiagram('flowchart TD\n  A-->B');
result.valid;          // true
result.diagramType;    // 'flowchart'
result.nodeCount;      // 2
```

Configured instance:

```typescript
import { createMermaidPlugin } from '@mam/plugin-mermaid';

const plugin = createMermaidPlugin({
  allRules: true,
  targets: ['html', 'json'],
  config: { theme: 'dark' },
});
```

## Validation

```typescript
const result = validateMermaidDiagram(code, { maxLines: 200, maxNodes: 50 });

result.valid;              // no issue at error severity
result.diagramType;        // 'flowchart' | 'stateDiagram-v2' | 'unknown' | ...
result.nodes;              // ['A', 'B', 'C']
result.issues;             // [{ code, message, severity, line, excerpt }]
```

| Code | Meaning |
|------|---------|
| `empty` | nothing to validate |
| `unknown-type` | the header is not a supported diagram type |
| `no-nodes` | no nodes, so nothing can be drawn |
| `no-edges` | no connections (opt-in via `requireEdges`) |
| `unclosed-subgraph` | a `subgraph` with no matching `end` |
| `too-many-lines` / `too-many-nodes` | past a configured limit |
| `not-json`-style parse issues | malformed `%%{init}%%` directives |

`unclosed-subgraph` is the single most common Mermaid authoring mistake, and it
makes the whole diagram fail to render.

### Node and edge extraction

```typescript
extractNodes('flowchart TD\n  A-->B');   // ['A', 'B']
extractNodes('flowchart TD\n A[x]-->A[y]');  // ['A']  — one node, two labels
countArrows('flowchart TD\n A -.-> B');  // 1
```

Every Mermaid edge form is recognised: `-->`, `---`, `-.->`, `==>`, `--o`,
`--x`, `-->>`. Unlabelled nodes count, because `A-->B` is the most common way
to write a flowchart.

## Rendering

```typescript
import { mermaidHtmlRenderer, describeDiagrams, renderDiagram } from '@mam/plugin-mermaid';

mermaidHtmlRenderer.render(content, { theme: 'dark', containerClass: 'my-diagrams' });
```

The HTML target is self-contained: it emits the `mermaid.initialize` call Mermaid
needs before it will draw anything, a unique id per diagram, and a
`data-diagram-type` attribute. Without the init script a `<div class="mermaid">`
silently renders as a text box.

A diagram that fails validation becomes a `role="alert"` placeholder rather than
broken output, and the original source is kept in a `<pre>` so it can be copied
back into the editor.

```typescript
describeDiagrams(content);   // [{ index, id, type, label, source, validation, info }]
mermaidHtmlRenderer.getStyles?.();   // hoisted CSS
mermaidHtmlRenderer.getScripts?.();  // the init script
```

**Diagram source is escaped** on the way into HTML, including the single quote,
because the source is interpolated into an attribute. If you build your own
renderer, escape it too.

The JSON target carries validation and metrics alongside the source:

```json
{
  "version": 1,
  "count": 1,
  "diagrams": [{ "type": "flowchart", "valid": true, "info": { "nodeCount": 2 } }]
}
```

## Diagram info

```typescript
getDiagramInfo(code);   // type, lineCount, nodeCount, arrowCount, complexity, ...
formatDiagramInfo(info); // 'Flowchart: 12 lines, 8 nodes, 9 edges, moderate'
```

`getDiagramInfo` detects the type itself when you don't pass one. Complexity
grading is threshold-driven and overridable:

```typescript
gradeComplexity(info, { complexLines: 50, complexNodes: 30, ... });
```

## Configuration

```typescript
import { mergeConfig, mergeConfigs, normalizeConfig, validateConfig, getConfigForDiagram } from '@mam/plugin-mermaid';

const config = normalizeConfig({ theme: 'dark' });
getConfigForDiagram(code, { fontSize: 16 });   // layered over the type's preset
validateConfig({ theme: 'chartreuse' });        // -> [{ path, message }]
```

`mergeConfig` recurses into the per-diagram sections (`flowchart`, `sequence`,
`gantt`, …). A shallow spread would replace the whole `flowchart` object when
only one of its fields was meant to change, silently dropping the rest.

`validateConfig` flags the combination of `securityLevel: 'strict'` with
`flowchart.htmlLabels: true`, since the labels are ignored under `strict`.

## Rules

| Rule | Catches |
|------|---------|
| `mermaid-empty` | empty code blocks |
| `mermaid-unknown-type` | an unrecognised header |
| `mermaid-subgraph-balance` | `subgraph` without `end` |
| `mermaid-has-nodes` | a diagram that declares no nodes |
| `mermaid-size` | blocks past a configured limit |
| `mermaid-complexity` | diagrams large enough to be hard to read |

```typescript
import { MERMAID_RULES, runMermaidRules, createMermaidValidationRule } from '@mam/plugin-mermaid';

runMermaidRules(module, MERMAID_RULES);
createMermaidValidationRule({ maxNodes: 100 });   // one strict rule
```

## Supported diagram types

18 base types plus the `stateDiagram-v2` variant, which is detected separately
because it is a different renderer:

`flowchart`, `graph`, `sequenceDiagram`, `classDiagram`, `stateDiagram`,
`stateDiagram-v2`, `erDiagram`, `gantt`, `pie`, `gitgraph`, `mindmap`,
`timeline`, `block-beta`, `journey`, `quadrantChart`, `requirementDiagram`,
`xychart`, `sankey`, `architecture`

Detection matches the whole first word, so `graphicalLayout` is not read as
`graph` and `pieChart` is not read as `pie`.

## API surface

- `validateMermaidDiagram`, `detectDiagramType`, `extractNodes`, `countNodes`,
  `countArrows`, `hasArrows`, `hasSubgraphs`, `hasBalancedSubgraphs`,
  `countUnclosedSubgraphs`, `findSubgraphLines`, `extractMermaidBlocks`,
  `stripComments`, `filterIssues`, `formatValidationSummary`
- `mermaidHtmlRenderer`, `mermaidMarkdownRenderer`, `mermaidTextRenderer`,
  `mermaidJsonRenderer`, `describeDiagrams`, `renderDiagram`, `renderInitScript`,
  `escapeHtml`, `escapeScriptContent`
- `getDiagramInfo`, `gradeComplexity`, `mergeConfig`, `mergeConfigs`,
  `normalizeConfig`, `validateConfig`, `DIAGRAM_PRESETS`, `getConfigForDiagram`
- `MERMAID_RULES`, `runMermaidRules`, `createMermaidValidationRule`
- `createMermaidPlugin`, `createMermaidApi`, `describeMermaidPlugin`

## License

MIT
