# MAM Specification Changelog

## [1.0.0] - 2026-07-24

### Added
- Initial MAM specification release
- 19 standard section types: Purpose, Inputs, Outputs, Rules, Workflow, Mermaid, Python, JavaScript, TypeScript, Prompt, Memory, Examples, Tests, References, Dependencies, Exports, Imports, Plugins, Permissions, Capabilities
- YAML front matter schema with required fields: id, version, name, author, runtime
- JSON Schema validation (`mam.schema.json`)
- Code block metadata comments (`@mam:key=value`)
- Task list support (`- [x]` / `- [ ]`)
- Table syntax support
- Inline formatting (bold, italic, strikethrough, code, links, images)
- BNF grammar definition
- Semantic versioning for specification
- Plugin API contract for extensibility
- Validation levels: syntax, schema, semantic, strict
- Source location tracking for all AST nodes

### Section Types
- **Purpose**: Module objective description (required)
- **Inputs**: Expected input parameters (table format)
- **Outputs**: Expected output values (table format)
- **Rules**: Behavioral constraints and guidelines
- **Workflow**: Process definition (Mermaid diagrams)
- **Mermaid**: Visual diagram definitions
- **Python**: Python code blocks for execution
- **JavaScript**: JavaScript code blocks for execution
- **TypeScript**: TypeScript code blocks for execution
- **Prompt**: LLM instruction content
- **Memory**: Persistent state and knowledge
- **Examples**: Usage demonstrations
- **Tests**: Validation rules and test cases
- **References**: External links and documentation
- **Dependencies**: Required module dependencies
- **Exports**: Public interface definitions
- **Imports**: Required imports
- **Plugins**: Plugin requirements
- **Permissions**: Security permission declarations
- **Capabilities**: System capability requirements