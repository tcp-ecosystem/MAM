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
} from './visitor.js';

export {
  findNodes,
  countNodes,
  collectText,
} from './traverser.js';
