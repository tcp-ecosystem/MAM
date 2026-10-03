# @mam/ast

Abstract Syntax Tree for Machine Agent Modules (MAM) documents. Provides node definitions, visitor pattern, traverser utilities, and serialization for MAM v1 and v2 (SDL) ASTs.

## Installation

```bash
pnpm add @mam/ast
```

## Quick Start

```ts
import {
  MAMModule,
  serializeToJSON,
  deserializeFromJSON,
  traverse,
  DefaultMAMVisitor,
} from '@mam/ast';

// Parse produces a MAMModule (use @mam/parser)
const ast: MAMModule = /* ... */;

// Serialize to JSON
const json = serializeToJSON(ast);

// Deserialize back
const restored = deserializeFromJSON(json);

// Traverse with a visitor
class SectionLogger extends DefaultMAMVisitor<void> {
  visitSection(node) {
    console.log(`Section: ${node.name}`);
  }
}
traverse(ast, new SectionLogger());
```

## API Reference

### Location Types

```ts
import {
  SourceLocation,
  Position,
  createPosition,
  createLocation,
  mergeLocations,
  locationToString,
} from '@mam/ast';
```

| Export | Description |
|---|---|
| `createPosition(line, column, offset)` | Create a `Position` object |
| `createLocation(startLine, startCol, startOffset, endLine, endCol, endOffset, source)` | Create a `SourceLocation` |
| `mergeLocations(a, b)` | Merge two locations into one covering both |
| `locationToString(loc)` | Format as `"source:line:col"` |

### Span Utilities

```ts
import {
  createSpan,
  spanContains,
  spanMerge,
  spanOverlap,
  offsetToPosition,
  positionToOffset,
} from '@mam/ast';
```

| Export | Description |
|---|---|
| `createSpan(startLine, startCol, endLine, endCol)` | Create a `SourceSpan` |
| `spanContains(span, line, column)` | Check if span contains a position |
| `spanMerge(a, b)` | Merge two spans into a covering span |
| `spanOverlap(a, b)` | Check if two spans overlap |
| `offsetToPosition(text, offset)` | Convert linear offset to line:column |
| `positionToOffset(text, pos)` | Convert line:column to linear offset |

Additional span helpers: `spanFromLocation`, `spanAt`, `spanContainsLine`, `spanLineCount`, `spanLength`, `spanCompare`, `spanEquals`, `splitSpanAt`, `spanOffset`, `spanToString`, `spanToLineRange`.

### V1 Node Types

```ts
import {
  MAMModule, FrontMatter, Section,
  ContentNode, Paragraph, List, CodeBlock, Table, MermaidDiagram, Heading, Blockquote,
  InlineNode, InlineText, InlineCode, Bold, Italic, Link, Image,
} from '@mam/ast';
```

**Module structure:**

- `MAMModule` -- root node with `frontmatter`, `sections`, `metadata`
- `FrontMatter` -- YAML front matter (`id`, `version`, `name`, `author`, `runtime`, `tags`, `permissions`, etc.)
- `Section` -- named section with `name`, `level`, `content: ContentNode[]`, `attributes`

**Content nodes:**

| Node | Key Fields |
|---|---|
| `Paragraph` | `value`, `inlineNodes` |
| `List` | `ordered`, `items: ListItem[]` |
| `CodeBlock` | `language`, `value`, `metadata`, `executable` |
| `Table` | `headers`, `rows`, `alignments` |
| `MermaidDiagram` | `value`, `diagramType` |
| `Heading` | `level` (1-6), `value`, `content` |
| `Blockquote` | `value`, `children` |

**Inline nodes:**

| Node | Key Fields |
|---|---|
| `InlineText` | `value` |
| `InlineCode` | `value` |
| `Bold` | `content: InlineNode[]` |
| `Italic` | `content: InlineNode[]` |
| `Link` | `url`, `title`, `content` |
| `Image` | `url`, `alt`, `title` |

**Helpers:**

```ts
REQUIRED_SECTIONS   // ['Purpose']
STANDARD_SECTIONS   // ['Purpose', 'Inputs', 'Outputs', ...]
isStandardSection(name)
isRequiredSection(name)
getNodeType(node)
isNodeType<T>(node, type)
```

### V2 SDL Node Types

```ts
import {
  V2ModuleNode, V2AgentNode, V2ToolNode, V2MemoryNode,
  V2WorkflowNode, V2TeamNode, V2PolicyNode, V2SystemNode,
  MODULE_TYPE_KEYWORDS, VALID_MODULE_TYPES,
  isModuleType, getModuleTypeDefinition,
} from '@mam/ast';
```

| Node | Description |
|---|---|
| `V2ModuleNode` | Generic module with `moduleType`, ports, capabilities, events, state, lifecycle |
| `V2AgentNode` | AI agent with `role`, `goal`, `tools`, `memory`, `handoff`, `permissions` |
| `V2ToolNode` | Executable tool with `provider`, `permissions`, `capabilities` |
| `V2MemoryNode` | Persistent store with `format`, `backend`, `scope`, `ttl` |
| `V2WorkflowNode` | Process with `steps: V2StepNode[]`, `edges: V2EdgeNode[]` |
| `V2TeamNode` | Agent team with `members`, `policy` |
| `V2PolicyNode` | Behavioral policy with `allow`, `deny`, `permissions` |
| `V2SystemNode` | Complete system composing agents, modules, tools, memory, policy |

Supporting types: `V2PortDefinition`, `V2PermissionSet`, `V2EventDefinition`, `V2StateDefinition`, `V2LifecycleDefinition`, `V2MemoryReference`.

**Module type system:**

```ts
VALID_MODULE_TYPES  // 19 types: module, agent, tool, memory, workflow, team, policy, system, ...
isModuleType(value) // type guard
getModuleTypeDefinition(type) // returns { requiredFields, optionalFields, capabilities, ... }
```

### Section-Specific Nodes

Each section type has its own AST node with factory functions, validation, type guards, and helpers:

```ts
import {
  CapabilitiesNode, DependenciesNode, ExamplesNode, ExportsNode,
  ImportsNode, InputsNode, MemoryNode, MermaidNode, MetadataNode,
  OutputsNode, PermissionsNode, PluginsNode, PromptNode, PurposeNode,
  PythonNode, ReferencesNode, RulesNode, TestsNode, WorkflowNode,
} from '@mam/ast';
```

| Node | Purpose |
|---|---|
| `CapabilitiesNode` | Module capabilities with ports, requirements, levels |
| `DependenciesNode` | External dependencies with source and type |
| `ExamplesNode` | Usage examples |
| `ExportsNode` | Exported items with types |
| `ImportsNode` | Imported items with selective imports |
| `InputsNode` | Input ports with types and validation |
| `MemoryNode` | Memory configuration (format, backend, scope, TTL) |
| `MermaidNode` | Mermaid diagram with parsed nodes/edges |
| `MetadataNode` | Module metadata (runtime, permissions, dependencies) |
| `OutputsNode` | Output ports with schemas |
| `PermissionsNode` | Permission entries with levels and conditions |
| `PluginsNode` | Plugin references |
| `PromptNode` | Prompt templates with variables and roles |
| `PurposeNode` | Module purpose with goals and success criteria |
| `PythonNode` | Python code with imports, functions, classes |
| `ReferencesNode` | External references |
| `RulesNode` | Rules with priority, severity, category |
| `TestsNode` | Test cases with status |
| `WorkflowNode` | Workflow steps and edges |

### Visitor Pattern

```ts
import {
  MAMVisitor,
  DefaultMAMVisitor,
  MAMTransformer,
  MAMCollector,
  traverse,
} from '@mam/ast';
```

| Export | Description |
|---|---|
| `MAMVisitor<T>` | Visitor interface with `visit*` methods for every node type |
| `DefaultMAMVisitor<T>` | Base class that recursively traverses the full AST |
| `MAMTransformer` | Abstract visitor that returns modified nodes (immutable transform) |
| `MAMCollector<T>` | Visitor that gathers results from a collector function |
| `traverse(ast, visitor)` | Start traversal from a `MAMModule` root |

**Example -- collect all code block languages:**

```ts
class LanguageCollector extends MAMCollector<string> {
  constructor() {
    super((node) => {
      if (node.type === 'CodeBlock') return (node as CodeBlock).language;
      return null;
    });
  }
}

const collector = new LanguageCollector();
traverse(ast, collector);
console.log(collector.getResults()); // ['python', 'javascript', ...]
```

**Example -- transform all inline text to uppercase:**

```ts
class UpperCaseTransformer extends MAMTransformer {
  visitInlineText(node: InlineText): InlineText {
    return { ...node, value: node.value.toUpperCase() };
  }
}

const transformer = new UpperCaseTransformer();
const transformed = transformer.visitMAMModule(ast);
```

### Traverser

```ts
import { findNodes, countNodes, collectText } from '@mam/ast';
```

| Export | Description |
|---|---|
| `findNodes(node, predicate)` | Find all nodes matching a predicate |
| `countNodes(node)` | Count total nodes in subtree |
| `collectText(node)` | Concatenate all `value` fields into a string |

```ts
const codeBlocks = findNodes(ast, (n) => n.type === 'CodeBlock');
const total = countNodes(ast);
const text = collectText(ast);
```

### Serialization

```ts
import {
  serializeToJSON,
  deserializeFromJSON,
  prettyPrint,
  getASTStats,
  serializeToYAML,
  deserializeFromYAML,
  compactSerialize,
  astToJSON,
  patchAST,
  validateJSONSchema,
} from '@mam/ast';
```

| Export | Description |
|---|---|
| `serializeToJSON(ast, format?)` | Serialize to JSON (`'json'`, `'compact'`, `'yaml-compatible'`) |
| `deserializeFromJSON(json)` | Parse JSON back to `MAMModule` |
| `prettyPrint(ast)` | Human-readable tree string |
| `getASTStats(ast)` | Return `{ totalNodes, totalSections, totalCodeBlocks, totalTables, totalLists, languages }` |
| `serializeToYAML(ast, options?)` | Serialize to YAML with configurable indent, quoting, depth |
| `deserializeFromYAML(yaml)` | Parse YAML back to `MAMModule` |
| `compactSerialize(ast)` | Minified JSON (no whitespace, no location, no metadata) |
| `astToJSON(ast)` | Deep-clone and normalize to plain object |
| `patchAST(original, patch)` | Apply partial patch preserving unmodified fields |
| `validateJSONSchema(data)` | Validate JSON structure, returns `{ valid, errors }` |

**JSON serialization options:**

```ts
serializeToJSON(ast, {
  indent: 2,             // 0 for compact
  includeLocation: true, // strip location data
  maxDepth: 0,           // 0 = unlimited
  includeMetadata: true, // strip metadata/attributes
  replacer: (key, val) => val,
});
```

**YAML serialization options:**

```ts
serializeToYAML(ast, {
  indent: 2,
  lineWidth: 80,
  quotingType: 'auto',   // 'single' | 'double' | 'auto'
  sortKeys: false,
  documentMarker: true,  // include '---'
  includeLocation: false,
  maxDepth: 0,
});
```

## Contributing

```bash
pnpm install
pnpm --filter @mam/ast build
pnpm --filter @mam/ast test
pnpm --filter @mam/ast lint
pnpm --filter @mam/ast typecheck
```

## License

MIT
