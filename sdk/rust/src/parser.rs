use crate::ast::{
    CodeBlock, ContentNode, FrontMatter, Module, Section, SectionKind, SourceLocation,
};
use regex::Regex;
use std::collections::HashMap;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ParseError {
    #[error("Missing frontmatter delimiter (---)")]
    MissingFrontmatterDelimiter,
    #[error("Invalid YAML in frontmatter: {0}")]
    InvalidYaml(String),
    #[error("Invalid section heading at line {line}: {message}")]
    InvalidSectionHeading { line: usize, message: String },
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Parse error at line {line}, column {column}: {message}")]
    Generic { line: usize, column: usize, message: String },
}

pub struct Parser;

impl Parser {
    pub fn new() -> Self {
        Self
    }

    pub fn parse(&self, content: &str, file_path: Option<&str>) -> Result<Module, ParseError> {
        let mut module = Module::new(content.to_string());
        module.file_path = file_path.map(|s| s.to_string());

        let lines: Vec<&str> = content.lines().collect();
        let mut cursor = 0;

        // Parse frontmatter
        if lines.first() == Some(&"---") {
            let mut end_index = None;
            for (i, line) in lines.iter().enumerate().skip(1) {
                if *line == "---" {
                    end_index = Some(i);
                    break;
                }
            }
            let end = end_index.ok_or(ParseError::MissingFrontmatterDelimiter)?;
            let fm_text = lines[1..end].join("\n");
            module.frontmatter = parse_frontmatter(&fm_text)?;
            cursor = end + 1;
        }

        // Parse sections
        let section_re = Regex::new(r"^##\s+(.+)").unwrap();
        let code_block_start = Regex::new(r"^```(\w*)").unwrap();

        let mut current_section: Option<Section> = None;
        let mut in_code_block = false;
        let mut code_lang = String::new();
        let mut code_lines: Vec<String> = Vec::new();
        let mut code_start_line = 0;

        for (line_idx, line) in lines[cursor..].iter().enumerate() {
            let abs_line = cursor + line_idx + 1;

            if let Some(caps) = section_re.captures(line) {
                // Save previous section
                if let Some(mut sec) = current_section.take() {
                    module.sections.push(sec);
                }

                let title = caps[1].trim().to_string();
                let kind = SectionKind::from_str(&title);
                current_section = Some(Section::new(
                    kind,
                    title,
                    Some(SourceLocation::new(
                        file_path.map(|s| s.to_string()),
                        abs_line,
                        0,
                        0,
                        line.len(),
                    )),
                ));
                in_code_block = false;
                code_lines.clear();
                continue;
            }

            if let Some(caps) = code_block_start.captures(line) {
                if in_code_block {
                    // End of code block
                    let code = code_lines.join("\n");
                    if let Some(ref mut sec) = current_section {
                        sec.add_content(ContentNode::CodeBlock(CodeBlock::new(
                            code_lang.clone(),
                            code,
                            Some(SourceLocation::new(
                                file_path.map(|s| s.to_string()),
                                code_start_line,
                                0,
                                0,
                                0,
                            )),
                        )));
                    }
                    in_code_block = false;
                    code_lines.clear();
                    code_lang.clear();
                } else {
                    // Start of code block
                    in_code_block = true;
                    code_lang = caps.get(1).map_or("", |m| m.as_str()).to_string();
                    code_start_line = abs_line;
                }
                continue;
            }

            if in_code_block {
                code_lines.push(line.to_string());
                continue;
            }

            // Regular content
            if let Some(ref mut sec) = current_section {
                let node = if line.starts_with("- ") || line.starts_with("* ") {
                    ContentNode::List {
                        ordered: false,
                        items: lines[cursor + line_idx..]
                            .iter()
                            .take_while(|l| l.starts_with("- ") || l.starts_with("* "))
                            .map(|l| l.trim_start_matches(|c| c == '-' || c == '*').trim().to_string())
                            .collect(),
                    }
                } else if line.starts_with("> ") {
                    ContentNode::Blockquote(line[2..].to_string())
                } else if line.starts_with("# ") {
                    ContentNode::Heading {
                        level: 1,
                        text: line[2..].to_string(),
                    }
                } else if line.starts_with("### ") {
                    ContentNode::Heading {
                        level: 3,
                        text: line[4..].to_string(),
                    }
                } else if line.starts_with("#### ") {
                    ContentNode::Heading {
                        level: 4,
                        text: line[5..].to_string(),
                    }
                } else if *line == "---" || *line == "***" {
                    ContentNode::HorizontalRule
                } else if !line.trim().is_empty() {
                    ContentNode::Paragraph(line.to_string())
                } else {
                    continue;
                };
                sec.add_content(node);
            }
        }

        // Save last section
        if let Some(sec) = current_section {
            module.sections.push(sec);
        }

        // Handle unclosed code block
        if in_code_block && !code_lines.is_empty() {
            if let Some(ref mut sec) = current_section {
                sec.add_content(ContentNode::CodeBlock(CodeBlock::new(
                    code_lang,
                    code_lines.join("\n"),
                    None,
                )));
            }
        }

        Ok(module)
    }
}

fn parse_frontmatter(yaml_text: &str) -> Result<FrontMatter, ParseError> {
    let parsed: HashMap<String, serde_yaml::Value> =
        serde_yaml::from_str(yaml_text).map_err(|e| ParseError::InvalidYaml(e.to_string()))?;

    let mut fm = FrontMatter::default();

    if let Some(v) = parsed.get("schema_version").or_else(|| parsed.get("schema-version")) {
        fm.schema_version = v.as_str().map(|s| s.to_string());
    }
    if let Some(v) = parsed.get("name") {
        fm.name = v.as_str().map(|s| s.to_string());
    }
    if let Some(v) = parsed.get("version") {
        fm.version = v.as_str().map(|s| s.to_string());
    }
    if let Some(v) = parsed.get("description") {
        fm.description = v.as_str().map(|s| s.to_string());
    }
    if let Some(v) = parsed.get("authors") {
        if let Some(arr) = v.as_sequence() {
            fm.authors = arr
                .iter()
                .filter_map(|x| x.as_str().map(|s| s.to_string()))
                .collect();
        }
    }
    if let Some(v) = parsed.get("tags") {
        if let Some(arr) = v.as_sequence() {
            fm.tags = arr
                .iter()
                .filter_map(|x| x.as_str().map(|s| s.to_string()))
                .collect();
        }
    }
    if let Some(v) = parsed.get("license") {
        fm.license = v.as_str().map(|s| s.to_string());
    }
    if let Some(v) = parsed.get("dependencies") {
        if let Some(arr) = v.as_sequence() {
            fm.dependencies = arr
                .iter()
                .filter_map(|x| x.as_str().map(|s| s.to_string()))
                .collect();
        }
    }

    // Store remaining fields in metadata
    let known_keys: &[&str] = &[
        "schema_version", "schema-version", "name", "version", "description",
        "authors", "tags", "license", "dependencies",
    ];
    for (key, value) in &parsed {
        if !known_keys.contains(&key.as_str()) {
            let json_val = serde_yaml_to_json(value);
            fm.metadata.insert(key.clone(), json_val);
        }
    }

    Ok(fm)
}

fn serde_yaml_to_json(val: &serde_yaml::Value) -> serde_json::Value {
    match val {
        serde_yaml::Value::Null => serde_json::Value::Null,
        serde_yaml::Value::Bool(b) => serde_json::Value::Bool(*b),
        serde_yaml::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                serde_json::Value::Number(i.into())
            } else if let Some(f) = n.as_f64() {
                serde_json::json!(f)
            } else {
                serde_json::Value::Null
            }
        }
        serde_yaml::Value::String(s) => serde_json::Value::String(s.clone()),
        serde_yaml::Value::Sequence(arr) => {
            serde_json::Value::Array(arr.iter().map(serde_yaml_to_json).collect())
        }
        serde_yaml::Value::Mapping(map) => {
            let obj: serde_json::Map<String, serde_json::Value> = map
                .iter()
                .map(|(k, v)| {
                    let key = match k {
                        serde_yaml::Value::String(s) => s.clone(),
                        _ => k.to_string(),
                    };
                    (key, serde_yaml_to_json(v))
                })
                .collect();
            serde_json::Value::Object(obj)
        }
        _ => serde_json::Value::Null,
    }
}

impl Default for Parser {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_minimal() {
        let input = "## Metadata\n\nname: test";
        let parser = Parser::new();
        let module = parser.parse(input, None).unwrap();
        assert_eq!(module.sections.len(), 1);
        assert_eq!(module.sections[0].kind, SectionKind::Metadata);
    }

    #[test]
    fn test_parse_with_frontmatter() {
        let input = "---\nname: my-module\nversion: 1.0.0\n---\n\n## Purpose\n\nTest module.";
        let parser = Parser::new();
        let module = parser.parse(input, None).unwrap();
        assert_eq!(module.frontmatter.name.as_deref(), Some("my-module"));
        assert_eq!(module.frontmatter.version.as_deref(), Some("1.0.0"));
        assert_eq!(module.sections.len(), 1);
    }

    #[test]
    fn test_parse_code_block() {
        let input = "## Python\n\n```python\nprint('hello')\n```";
        let parser = Parser::new();
        let module = parser.parse(input, None).unwrap();
        assert_eq!(module.sections.len(), 1);
        let blocks = module.sections[0].get_code_blocks();
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].language, "python");
        assert_eq!(blocks[0].code, "print('hello')");
    }

    #[test]
    fn test_parse_multiple_sections() {
        let input = "## Metadata\n\nname: x\n\n## Purpose\n\nDo stuff.\n\n## Rules\n\n- rule 1\n- rule 2";
        let parser = Parser::new();
        let module = parser.parse(input, None).unwrap();
        assert_eq!(module.sections.len(), 3);
        assert!(module.has_section(&SectionKind::Metadata));
        assert!(module.has_section(&SectionKind::Purpose));
        assert!(module.has_section(&SectionKind::Rules));
    }

    #[test]
    fn test_missing_frontmatter_delimiter() {
        let input = "---\nname: test\n\n## Purpose\n\nHello.";
        let parser = Parser::new();
        let result = parser.parse(input, None);
        assert!(result.is_err());
    }
}
