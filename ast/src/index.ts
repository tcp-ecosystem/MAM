/**
 * MAM AST
 * 
 * Abstract Syntax Tree for Markdown as Module (MAM) documents.
 * Provides node definitions, visitor pattern, and serialization.
 */

// Location types
export {
  type SourceLocation,
  type Position,
  createPosition,
  createLocation,
  mergeLocations,
  locationToString,
} from './location/index.js';

// Node definitions (v1)
export {
  type NodeType,
  type BaseNode,
  type MAMModule,
  type FrontMatter,
  type FrontMatterData,
  type RuntimeType,
  type Permission,
  type Section,
  type SectionName,
  type SectionAttributes,
  type ContentType,
  type ContentNode,
  type Paragraph,
  type InlineNode,
  type InlineText,
  type InlineCode,
  type Bold,
  type Italic,
  type Link,
  type Image,
  type List,
  type ListItem,
  type CodeBlock,
  type Language,
  type CodeMetadata,
  type Table,
  type TableCell,
  type TableRow,
  type TableColumnAlignment,
  type MermaidDiagram,
  type MermaidDiagramType,
  type Heading,
  type Blockquote,
  REQUIRED_SECTIONS,
  STANDARD_SECTIONS,
  isStandardSection,
  isRequiredSection,
  getNodeType,
  isNodeType,
} from './nodes/index.js';

// Node definitions (v2 - SDL)
export {
  type V2NodeType,
  type V2BaseNode,
  type ModuleType,
  type ModuleTypeDefinition,
  type V2ModuleNode,
  type V2AgentNode,
  type V2ToolNode,
  type V2MemoryNode,
  type V2MemoryReference,
  type V2WorkflowNode,
  type V2StepNode,
  type V2EdgeNode,
  type V2TeamNode,
  type V2PolicyNode,
  type V2SystemNode,
  type V2PortDefinition,
  type V2PermissionSet,
  type V2EventDefinition,
  type V2StateDefinition,
  type V2LifecycleDefinition,
  MODULE_TYPE_KEYWORDS,
  V2_SECTION_KEYWORDS,
  VALID_MODULE_TYPES,
  isModuleType,
  getModuleTypeDefinition,
} from './nodes/v2/index.js';

// Visitor pattern
export {
  type MAMVisitor,
  DefaultMAMVisitor,
  MAMTransformer,
  MAMCollector,
  traverse,
} from './visitor/index.js';

// Serialization
export {
  type SerializationFormat,
  serializeToJSON,
  deserializeFromJSON,
  prettyPrint,
  getASTStats,
  type ASTStats,
} from './serializer/index.js';