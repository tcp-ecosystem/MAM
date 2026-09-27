/**
 * MAM Visitor Module
 *
 * Exports visitor pattern implementations for MAM AST traversal.
 */

export {
  type MAMVisitor,
  DefaultMAMVisitor,
  MAMTransformer,
  MAMCollector,
  traverse,
  traverseWithHooks,
  findFirstNode,
  collectNodeTypes,
  MAMProfiler,
} from './visitor.js';

export {
  findNodes,
  countNodes,
  collectText,
  findNodesByType,
  getMaxDepth,
  traverse as traverseTree,
} from './traverser.js';
