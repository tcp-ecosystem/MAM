/**
 * MAM Parser Module
 * 
 * Exports the parser and related types for parsing MAM tokens into AST.
 */

export {
  MAMParser,
  parse,
  parseMarkdown,
  type ParserOptions,
  type ParseResult,
  type ParserStats,
  type MAMModule,
  type FrontMatter,
  type Section,
  type SectionAttributes,
  type ModuleMetadata,
} from './mam.js';

export {
  type FrontMatterData,
  parseFrontMatter,
  type FrontMatterResult,
} from './frontmatter.js';

export {
  type SectionData,
  type ContentNode,
  type ParagraphNode,
  type ListNode,
  type ListItem,
  type CodeBlockNode,
  type TableNode,
  type MermaidNode,
  type HeadingNode,
  type BlockquoteNode,
  type HorizontalRuleNode,
  type InlineNode,
  type SourceLocation,
  type SectionParseResult,
  parseSections,
} from './sections.js';

export {
  ParseError,
  ParseErrorCode,
  ParseWarning,
  ParseWarningCode,
} from './errors.js';

export {
  DSLParser,
  parseDSL,
  type DSLParserOptions,
  type DSLParseResult,
} from './dsl/index.js';