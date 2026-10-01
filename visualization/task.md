# Task — Harden @mam/visualization with 7 New Features Per File + 5 New Files

## Objective

Add exactly **7 new features to each existing `.ts` file** in
`visualization/src` (7 files), **create 5 new visual files** in
`visualization/src/` with 7 exports each (300+ lines each), and add
**>=7 new `it` cases to each test file** in `visualization/tests`
(6 files) plus new `tests/index.test.ts` and 5 new test files —
49 + 35 = 84 src additions total — **without interrupting anything that
already works**.

## Hard Constraints

1. **Additive only.** Never modify, rename, remove, or change the
   behavior/signature of any existing export, type, class, or method.
   Existing tests must keep passing untouched. (Note: this package uses
   `"strict": true` — new code must be null-safe.)
2. **No new dependencies.** Only `@mam/ast`, `@mam/parser` (declared) and
   node built-ins.
3. **No comments** in new code (project rule).
4. **Exactly 7 new exported symbols per file** (function, class, constant,
   interface/type, or re-export). Genuinely useful, no trivial aliases, no
   duplicates. New renderer helpers analyze renderer *outputs* (new
   capability) instead of duplicating private render logic.
5. **New source files live in `src/`** (flat layout).
6. **Style:** match the host file (ESM `.js` suffixes for local imports,
   JSDoc-free new code, existing naming conventions).
7. **Tests:** the 6 existing test files gain **>=7 new `it` cases** each;
   new `tests/index.test.ts` + `svg/csv/markdown/timeline/stats.test.ts`
   cover the new files and barrel.
8. **Verification (must pass):**
   - `pnpm --filter @mam/visualization typecheck`
   - `pnpm --filter @mam/visualization test`
   - (`lint` is blocked repo-wide: missing
     `@typescript-eslint/eslint-plugin` in this environment.)

---

## Plan — existing `src/` files (7 files x 7)

| File | The 7 features |
|---|---|
| `src/graph.ts` | `createGraphNode(id, label, type)`, `createGraphEdge(from, to, type?)`, `createEmptyGraph()`, `getNodeIds(graph)`, `findNodeById(graph, id)`, `getSuccessors(graph, id)`, `getPredecessors(graph, id)` |
| `src/mermaid.ts` | `sanitizeMermaidId(id)`, `countMermaidCodeLines(output)`, `extractMermaidNodeIds(code)`, `extractMermaidEdgePairs(code)`, `hasMermaidNodeId(code, id)`, `getMermaidDiagramHeader(type, direction)`, `isFlowchartCode(code)` |
| `src/ascii.ts` | `countAsciiLines(output)`, `getAsciiDimensions(output)`, `hasAsciiContent(output)`, `getAsciiLine(output, index)`, `sliceAsciiLines(output, start, end)`, `joinAsciiOutputs(outputs)`, `getAsciiLineWidths(output)` |
| `src/dot.ts` | `sanitizeDotId(id)`, `countDotNodes(output)`, `countDotEdges(output)`, `extractDotNodeIds(output)`, `hasDotNode(output, id)`, `validateDotBraces(output)`, `getDotRankdirLine(rankdir)` |
| `src/html.ts` | `extractSvgNodeIds(html)`, `hasHtmlNode(html, id)`, `countHtmlScriptTags(output)`, `getHtmlTitle(html)`, `hasDarkTheme(css)`, `countCssRules(css)`, `isCompleteHtmlDocument(html)` |
| `src/json.ts` | `stringifyJsonOutput(output, indent?)`, `getJsonOutputFormat(output)`, `isJsonOutputFormat(output, format)`, `minifyJsonString(json)`, `prettifyJsonString(json, indent?)`, `isValidJsonString(text)`, `getJsonByteLength(output)` |
| `src/index.ts` | 7 new re-export statements: svg, csv, markdown, timeline, stats families + graph-helpers line + `V2ModuleNode`/`V2EdgeNode` types from `@mam/ast` |

---

## Plan — new `src/` files (5 files x 7, 300+ lines each)

| File | The 7 features |
|---|---|
| `src/svg.ts` | `SVGConfig`, `SVGOutput`, `SVGRenderer` class (generateFromModules/generateFromGraph/generateDependencyGraph/generateWorkflowGraph + layout/colors/escape internals), `DEFAULT_SVG_COLORS` const, `getSvgColorForType(type)`, `sanitizeSvgId(id)`, `createSvgDocument(width, height, body)` |
| `src/csv.ts` | `CSVConfig`, `CSVOutput`, `CSVExporter` class (generateFromModules/generateFromGraph + nodes/edges CSV builders), `escapeCsvField(field)`, `nodesToCsvRecords(nodes)`, `edgesToCsvRecords(edges)`, `CSV_MIME_TYPE` const |
| `src/markdown.ts` | `MarkdownConfig`, `MarkdownOutput`, `MarkdownReporter` class (generateFromModules/generateFromGraph + sections/tables/stats), `formatMarkdownTable(headers, rows)`, `escapeMarkdownCell(cell)`, `markdownSectionHeading(title, level?)`, `DEFAULT_MARKDOWN_TITLE` const |
| `src/timeline.ts` | `TimelineConfig`, `TimelineOutput`, `TimelineGenerator` class (generateFromModules/generateFromGraph/generateWorkflowTimeline + scaling/rows), `scaleTimeToColumns(value, min, max, columns)`, `formatDurationLabel(ms)`, `clampTimelineRange(start, end)` |
| `src/stats.ts` | `StatsConfig`, `StatsOutput`, `computeGraphStats(data)`, `getInDegrees(data)`, `getOutDegrees(data)`, `findIsolatedNodes(data)`, `getGraphDensity(data)` (+ private degree/type/histogram helpers) |

---

## Plan — `tests/` (6 existing + 6 new files)

| File | The additions |
|---|---|
| `tests/graph.test.ts` | >=7 new `it` for the 7 graph helpers |
| `tests/mermaid.test.ts` | >=7 new `it` for the 7 mermaid output helpers |
| `tests/ascii.test.ts` | >=7 new `it` for the 7 ascii output helpers |
| `tests/dot.test.ts` | >=7 new `it` for the 7 dot output helpers |
| `tests/html.test.ts` | >=7 new `it` for the 7 html output helpers |
| `tests/json.test.ts` | >=7 new `it` for the 7 json output helpers |
| `tests/index.test.ts` (new) | >=7 `it` for the barrel (svg/csv/markdown/timeline/stats/graph-helper/ast-type exports) |
| `tests/svg/csv/markdown/timeline/stats.test.ts` (new) | coverage per new file |

---

## Execution Order

1. Extend the 7 existing src files (disjoint; no cross-file edits).
2. Create the 5 new `src/` files.
3. Extend the 6 test files + add 6 new test files.
4. Run typecheck + test; fix any regressions.
5. Record results in `update.md`.
