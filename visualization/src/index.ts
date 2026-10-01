/**
 * MAM Visualization Engine
 *
 * Generates visual representations of MAM modules and systems.
 */

export { GraphVisualizer, type GraphConfig, type GraphData, type GraphNode, type GraphEdge, type GraphMetadata } from './graph.js';
export { MermaidGenerator, type MermaidConfig, type MermaidOutput } from './mermaid.js';
export { ASCIIArt, type ASCIIConfig, type ASCIIOutput } from './ascii.js';
export { HTMLRenderer, type HTMLConfig, type HTMLNodeStyle, type HTMLOutput } from './html.js';
export { DOTRenderer, type DOTConfig, type DOTOutput } from './dot.js';
export { JSONExporter, type JSONConfig, type JSONOutput } from './json.js';
export { SVGRenderer, type SVGConfig, type SVGOutput, DEFAULT_SVG_COLORS, getSvgColorForType, sanitizeSvgId, createSvgDocument } from './svg.js';
export { CSVExporter, type CSVConfig, type CSVOutput, escapeCsvField, nodesToCsvRecords, edgesToCsvRecords, CSV_MIME_TYPE } from './csv.js';
export { MarkdownReporter, type MarkdownConfig, type MarkdownOutput, formatMarkdownTable, escapeMarkdownCell, markdownSectionHeading, DEFAULT_MARKDOWN_TITLE } from './markdown.js';
export { TimelineGenerator, type TimelineConfig, type TimelineOutput, scaleTimeToColumns, formatDurationLabel, clampTimelineRange } from './timeline.js';
export { type StatsConfig, type StatsOutput, computeGraphStats, getInDegrees, getOutDegrees, findIsolatedNodes, getGraphDensity } from './stats.js';
export { createGraphNode, createGraphEdge, createEmptyGraph, getNodeIds, findNodeById, getSuccessors, getPredecessors } from './graph.js';
export {
  type KnowledgeGraphConfig,
  graphDataFromKnowledge,
  knowledgeGraphToMermaid,
  knowledgeGraphToDot,
  knowledgeGraphToSvg,
  computeMetadata,
  summarizeKnowledgeGraph,
} from './knowledge-graph.js';
export type { V2ModuleNode, V2EdgeNode } from '@mam/ast';
export { sanitizeMermaidId, countMermaidCodeLines, extractMermaidNodeIds, extractMermaidEdgePairs, hasMermaidNodeId, getMermaidDiagramHeader, isFlowchartCode } from './mermaid.js';
export { countAsciiLines, getAsciiDimensions, hasAsciiContent, getAsciiLine, sliceAsciiLines, joinAsciiOutputs, getAsciiLineWidths } from './ascii.js';
export { sanitizeDotId, countDotNodes, countDotEdges, extractDotNodeIds, hasDotNode, validateDotBraces, getDotRankdirLine } from './dot.js';
export { extractSvgNodeIds, hasHtmlNode, countHtmlScriptTags, getHtmlTitle, hasDarkTheme, countCssRules, isCompleteHtmlDocument } from './html.js';
export { stringifyJsonOutput, getJsonOutputFormat, isJsonOutputFormat, minifyJsonString, prettifyJsonString, isValidJsonString, getJsonByteLength } from './json.js';
