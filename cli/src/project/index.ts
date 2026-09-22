/**
 * MAM Project — `mam.toml` composition support.
 */

export { parseToml, type TomlTable, type TomlValue } from './toml.js';
export {
  parseManifest,
  validateManifest,
  renderManifest,
  DEFAULT_MODULE_GLOBS,
  DEFAULT_BUILD,
  type ProjectManifest,
  type ProjectInfo,
  type ProjectBuildConfig,
} from './manifest.js';
export {
  Project,
  globToRegExp,
  type LoadedModule,
  type ProjectValidationResult,
} from './loader.js';
export {
  buildProjectGraph,
  graphToMermaid,
  graphToText,
  type ProjectGraph,
  type ProjectGraphNode,
  type ProjectGraphEdge,
} from './graph.js';
