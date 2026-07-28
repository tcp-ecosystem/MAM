use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SourceLocation {
    pub file: Option<String>,
    pub line: usize,
    pub column: usize,
    pub offset: usize,
    pub length: usize,
}

impl SourceLocation {
    pub fn new(file: Option<String>, line: usize, column: usize, offset: usize, length: usize) -> Self {
        Self { file, line, column, offset, length }
    }

    pub fn span(start: usize, end: usize, line: usize, column: usize) -> Self {
        Self { file: None, line, column, offset: start, length: end - start }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum SectionKind {
    Metadata,
    Purpose,
    Inputs,
    Outputs,
    Rules,
    Workflow,
    Mermaid,
    Python,
    Prompt,
    Memory,
    Examples,
    Tests,
    References,
    Dependencies,
    Exports,
    Imports,
    Plugins,
    Permissions,
    Capabilities,
    Custom(String),
}

impl SectionKind {
    pub fn as_str(&self) -> &str {
        match self {
            SectionKind::Metadata => "metadata",
            SectionKind::Purpose => "purpose",
            SectionKind::Inputs => "inputs",
            SectionKind::Outputs => "outputs",
            SectionKind::Rules => "rules",
            SectionKind::Workflow => "workflow",
            SectionKind::Mermaid => "mermaid",
            SectionKind::Python => "python",
            SectionKind::Prompt => "prompt",
            SectionKind::Memory => "memory",
            SectionKind::Examples => "examples",
            SectionKind::Tests => "tests",
            SectionKind::References => "references",
            SectionKind::Dependencies => "dependencies",
            SectionKind::Exports => "exports",
            SectionKind::Imports => "imports",
            SectionKind::Plugins => "plugins",
            SectionKind::Permissions => "permissions",
            SectionKind::Capabilities => "capabilities",
            SectionKind::Custom(name) => name,
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "metadata" => SectionKind::Metadata,
            "purpose" => SectionKind::Purpose,
            "inputs" => SectionKind::Inputs,
            "outputs" => SectionKind::Outputs,
            "rules" => SectionKind::Rules,
            "workflow" => SectionKind::Workflow,
            "mermaid" => SectionKind::Mermaid,
            "python" => SectionKind::Python,
            "prompt" => SectionKind::Prompt,
            "memory" => SectionKind::Memory,
            "examples" => SectionKind::Examples,
            "tests" => SectionKind::Tests,
            "references" => SectionKind::References,
            "dependencies" => SectionKind::Dependencies,
            "exports" => SectionKind::Exports,
            "imports" => SectionKind::Imports,
            "plugins" => SectionKind::Plugins,
            "permissions" => SectionKind::Permissions,
            "capabilities" => SectionKind::Capabilities,
            other => SectionKind::Custom(other.to_string()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FrontMatter {
    pub schema_version: Option<String>,
    pub name: Option<String>,
    pub version: Option<String>,
    pub description: Option<String>,
    pub authors: Vec<String>,
    pub tags: Vec<String>,
    pub license: Option<String>,
    pub dependencies: Vec<String>,
    pub metadata: HashMap<String, serde_json::Value>,
}

impl Default for FrontMatter {
    fn default() -> Self {
        Self {
            schema_version: None,
            name: None,
            version: None,
            description: None,
            authors: Vec::new(),
            tags: Vec::new(),
            license: None,
            dependencies: Vec::new(),
            metadata: HashMap::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CodeBlock {
    pub language: String,
    pub code: String,
    pub location: Option<SourceLocation>,
}

impl CodeBlock {
    pub fn new(language: String, code: String, location: Option<SourceLocation>) -> Self {
        Self { language, code, location }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ContentNode {
    Heading { level: u8, text: String },
    Paragraph(String),
    CodeBlock(CodeBlock),
    List { ordered: bool, items: Vec<String> },
    Table { headers: Vec<String>, rows: Vec<Vec<String>> },
    Blockquote(String),
    HorizontalRule,
    Link { text: String, url: String },
    Image { alt: String, url: String },
    Text(String),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Section {
    pub kind: SectionKind,
    pub title: String,
    pub content: Vec<ContentNode>,
    pub location: Option<SourceLocation>,
}

impl Section {
    pub fn new(kind: SectionKind, title: String, location: Option<SourceLocation>) -> Self {
        Self { kind, title, content: Vec::new(), location }
    }

    pub fn add_content(&mut self, node: ContentNode) {
        self.content.push(node);
    }

    pub fn get_text_content(&self) -> String {
        self.content
            .iter()
            .filter_map(|node| match node {
                ContentNode::Paragraph(text) => Some(text.as_str()),
                ContentNode::Text(text) => Some(text.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    pub fn get_code_blocks(&self) -> Vec<&CodeBlock> {
        self.content
            .iter()
            .filter_map(|node| {
                if let ContentNode::CodeBlock(cb) = node {
                    Some(cb)
                } else {
                    None
                }
            })
            .collect()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Module {
    pub frontmatter: FrontMatter,
    pub sections: Vec<Section>,
    pub raw_content: String,
    pub file_path: Option<String>,
}

impl Module {
    pub fn new(raw_content: String) -> Self {
        Self {
            frontmatter: FrontMatter::default(),
            sections: Vec::new(),
            raw_content,
            file_path: None,
        }
    }

    pub fn get_section(&self, kind: &SectionKind) -> Option<&Section> {
        self.sections.iter().find(|s| s.kind == *kind)
    }

    pub fn get_sections(&self, kind: &SectionKind) -> Vec<&Section> {
        self.sections.iter().filter(|s| s.kind == *kind).collect()
    }

    pub fn section_names(&self) -> Vec<&str> {
        self.sections.iter().map(|s| s.kind.as_str()).collect()
    }

    pub fn has_section(&self, kind: &SectionKind) -> bool {
        self.sections.iter().any(|s| s.kind == *kind)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_section_kind_roundtrip() {
        let kinds = vec![
            SectionKind::Metadata,
            SectionKind::Purpose,
            SectionKind::Custom("my_custom".to_string()),
        ];
        for kind in kinds {
            let s = kind.as_str();
            let back = SectionKind::from_str(s);
            assert_eq!(kind, back);
        }
    }

    #[test]
    fn test_module_defaults() {
        let module = Module::new("test".to_string());
        assert_eq!(module.sections.len(), 0);
        assert!(module.frontmatter.authors.is_empty());
    }

    #[test]
    fn test_frontmatter_defaults() {
        let fm = FrontMatter::default();
        assert!(fm.name.is_none());
        assert!(fm.dependencies.is_empty());
    }

    #[test]
    fn test_section_code_blocks() {
        let mut section = Section::new(
            SectionKind::Python,
            "python".to_string(),
            None,
        );
        section.add_content(ContentNode::CodeBlock(CodeBlock::new(
            "python".to_string(),
            "print('hello')".to_string(),
            None,
        )));
        let blocks = section.get_code_blocks();
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].code, "print('hello')");
    }
}
