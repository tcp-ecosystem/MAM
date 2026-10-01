# Update — Harden @mam/visualization (7 Per File + 5 New Files)

## Status: DONE except lint (blocked by environment)

All 7 existing `src/` files gained 7 new additive exports, 5 new visual
files (300+ lines each) were created in `src/`, the 6 existing test files
gained >=7 new `it` cases each plus 6 new test files, `typecheck` and
`test` pass. `lint` cannot run: ESLint is missing
`@typescript-eslint/eslint-plugin` in this environment (pre-existing,
repo-wide, unrelated to these changes). Note: this package uses
`"strict": true`.

## Verification results

- `pnpm --filter @mam/visualization typecheck` — PASS
- `pnpm --filter @mam/visualization test` — PASS: 12 files, 200 tests
  (graph 19, mermaid 21, ascii 25, dot 22, html 26, json 24,
  svg 10, csv 10, markdown 11, timeline 10, stats 9, index 13)
- `pnpm --filter @mam/visualization lint` — BLOCKED (missing plugin, see above)

## Fixes applied during integration

1. `src/html.ts` — `extractSvgNodeIds` first matched `id="node-..."`,
   but `HTMLRenderer` emits `<g class="mam-node" data-id="...">`; fixed
   the regex to match `data-id` groups (test caught this).
2. `src/index.ts` — barrel initially missed the 5 renderer helper
   families; added 5 more re-export lines (12 new statements total —
   deliberate deviation from the 7-line plan for barrel completeness).

## Per-file feature list — existing `src/` (7 files x 7)

- `src/graph.ts`: `createGraphNode`, `createGraphEdge`,
  `createEmptyGraph`, `getNodeIds`, `findNodeById`, `getSuccessors`,
  `getPredecessors`
- `src/mermaid.ts`: `sanitizeMermaidId`, `countMermaidCodeLines`,
  `extractMermaidNodeIds`, `extractMermaidEdgePairs`, `hasMermaidNodeId`,
  `getMermaidDiagramHeader`, `isFlowchartCode`
- `src/ascii.ts`: `countAsciiLines`, `getAsciiDimensions`,
  `hasAsciiContent`, `getAsciiLine`, `sliceAsciiLines`,
  `joinAsciiOutputs`, `getAsciiLineWidths`
- `src/dot.ts`: `sanitizeDotId`, `countDotNodes`, `countDotEdges`,
  `extractDotNodeIds`, `hasDotNode`, `validateDotBraces`,
  `getDotRankdirLine`
- `src/html.ts`: `extractSvgNodeIds`, `hasHtmlNode`,
  `countHtmlScriptTags`, `getHtmlTitle`, `hasDarkTheme`,
  `countCssRules`, `isCompleteHtmlDocument`
- `src/json.ts`: `stringifyJsonOutput`, `getJsonOutputFormat`,
  `isJsonOutputFormat`, `minifyJsonString`, `prettifyJsonString`,
  `isValidJsonString`, `getJsonByteLength` (manual UTF-8 counting, no
  node types needed)
- `src/index.ts`: 12 new re-export statements — svg/csv/markdown/
  timeline/stats families, graph helpers, `V2ModuleNode`/`V2EdgeNode`
  types, plus the 5 renderer helper families

## New `src/` files (5 files x 7, all 300+ lines)

- `svg.ts` (303 lines): `SVGConfig`, `SVGOutput`, `SVGRenderer`
  (generateFromModules/generateFromGraph/generateDependencyGraph/
  generateWorkflowGraph, level layout, per-type colors, legend),
  `DEFAULT_SVG_COLORS`, `getSvgColorForType`, `sanitizeSvgId`,
  `createSvgDocument`
- `csv.ts` (308 lines): `CSVConfig`, `CSVOutput`, `CSVExporter`
  (modules/graph/dependency/workflow exports, dialect, header toggle,
  fluent with-ers, combined dumps), `escapeCsvField`,
  `nodesToCsvRecords`, `edgesToCsvRecords`, `CSV_MIME_TYPE`
  (+ CSV parse/validate/column helpers)
- `markdown.ts` (310 lines): `MarkdownConfig`, `MarkdownOutput`,
  `MarkdownReporter` (module/graph/dependency/workflow reports, TOC,
  stats, tables-or-lists, fluent config), `formatMarkdownTable`,
  `escapeMarkdownCell`, `markdownSectionHeading`,
  `DEFAULT_MARKDOWN_TITLE`
- `timeline.ts` (302 lines): `TimelineConfig`, `TimelineRow`,
  `TimelineOutput`, `TimelineGenerator` (modules/graph/workflow/custom
  timelines, duration parsing incl. `30s`/`5m`, scaling, fluent config)
  — note: `TimelineRow` is an 8th supporting type for the row shape;
  the 7 planned features are config/output/class + the 3 scale/format/
  clamp helpers. `scaleTimeToColumns`, `formatDurationLabel`,
  `clampTimelineRange`
- `stats.ts` (300 lines): `StatsConfig`, `StatsOutput`,
  `computeGraphStats` (density, avg/max out-degree, isolated nodes, type
  breakdown, depth), `getInDegrees`, `getOutDegrees`,
  `findIsolatedNodes`, `getGraphDensity` (+ hubs/roots/leaves,
  histograms, reciprocity, rendered reports)

No new dependencies; only `@mam/ast` types, local `./graph.js` types,
and a node builtin (`Buffer` avoided — manual UTF-8 byte counting).

## Per-file additions — `tests/`

- `tests/graph.test.ts`: +7 `it` (node/edge factories, empty graph,
  ids, find, successors, predecessors, multi-edge)
- `tests/mermaid.test.ts`: +7 `it` (sanitize, line count, node/edge
  extraction, presence, headers, flowchart detection)
- `tests/ascii.test.ts`: +7 `it` (lines, dimensions, content, get,
  slice, join, widths)
- `tests/dot.test.ts`: +7 `it` (sanitize, counts, extraction, presence,
  braces, rankdir, real-output analysis)
- `tests/html.test.ts`: +7 `it` (node ids, presence, scripts, title,
  theme, css rules, completeness)
- `tests/json.test.ts`: +7 `it` (stringify, formats, minify, prettify,
  validation, byte length, round-trip)
- `tests/index.test.ts` (new): 13 `it` (all renderer classes + helpers
  via the barrel)
- New: `svg` (10), `csv` (10), `markdown` (11), `timeline` (10),
  `stats` (9)

All additions are append-only; no existing test was modified.

## Known deviations from task.md

1. Barrel has 12 new re-export statements instead of 7 (helper families
   added for consistency — every public API family is barrel-exported).
2. `timeline.ts` exposes `TimelineRow` as an additional supporting type
   (row shape used across 4 methods); the 7 planned features are intact.
