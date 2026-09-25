//! Text formatters for the MAM Rust SDK.
//!
//! Renders modules, validation issues, and execution results as human-readable
//! text. Every formatter is pure: it never mutates its input and returns a
//! `String`, so the output is safe to print, log, or write to disk.

use crate::ast::{ContentNode, FrontMatter, Module};
use crate::runtime::{ExecutionResult, RuntimeError};
use crate::validator::{Diagnostic, Severity, ValidationResult};
use std::collections::HashMap;

fn placeholder(value: &Option<String>, fallback: &str) -> String {
    match value {
        Some(text) if !text.trim().is_empty() => text.clone(),
        _ => fallback.to_string(),
    }
}

/// Returns a short summary of a module.
pub fn format_module_summary(module: &Module) -> String {
    let name = match &module.frontmatter.name {
        Some(text) if !text.trim().is_empty() => text.clone(),
        _ => "(untitled)".to_string(),
    };
    let blocks: usize = module
        .sections
        .iter()
        .map(|section| section.get_code_blocks().len())
        .sum();

    let mut lines: Vec<String> = Vec::new();
    lines.push(format!("Module: {}", name));
    lines.push(format!("  version: {}", placeholder(&module.frontmatter.version, "(none)")));
    lines.push(format!("  description: {}", placeholder(&module.frontmatter.description, "(none)")));
    if !module.frontmatter.authors.is_empty() {
        lines.push(format!("  authors: {}", module.frontmatter.authors.join(", ")));
    }
    if !module.frontmatter.tags.is_empty() {
        lines.push(format!("  tags: {}", module.frontmatter.tags.join(", ")));
    }
    lines.push(format!("  sections: {}", module.sections.len()));
    lines.push(format!("  code blocks: {}", blocks));
    lines.join("\n")
}

/// Serializes a module as pretty-printed JSON.
pub fn format_ast_json(module: &Module) -> String {
    match serde_json::to_string_pretty(module) {
        Ok(text) => text,
        Err(error) => format!("(unable to serialize module: {})", error),
    }
}

/// Returns a list of section titles with their content counts.
pub fn format_section_list(module: &Module) -> String {
    if module.sections.is_empty() {
        return "(no sections)".to_string();
    }
    let mut lines: Vec<String> = Vec::new();
    for (index, section) in module.sections.iter().enumerate() {
        lines.push(format!(
            "{}. {} [{}] ({} nodes)",
            index + 1,
            section.title,
            section.kind.as_str(),
            section.content.len()
        ));
    }
    lines.join("\n")
}

/// Returns a table of contents for the module.
pub fn format_toc(module: &Module) -> String {
    if module.sections.is_empty() {
        return "(no sections)".to_string();
    }
    let mut lines: Vec<String> = vec!["Contents:".to_string()];
    for (index, section) in module.sections.iter().enumerate() {
        let blocks = section.get_code_blocks().len();
        let marker = if blocks > 0 { " *" } else { "" };
        lines.push(format!("  {}. {}{}", index + 1, section.title, marker));
    }
    lines.join("\n")
}

/// Returns a list of code blocks with language and line counts.
pub fn format_code_block_list(module: &Module) -> String {
    let mut lines: Vec<String> = Vec::new();
    let mut total = 0usize;
    for section in &module.sections {
        for block in section.get_code_blocks() {
            total += 1;
            let language = if block.language.trim().is_empty() {
                "unknown".to_string()
            } else {
                block.language.clone()
            };
            let count = block.code.lines().count();
            let line = match block.location.as_ref() {
                Some(location) => format!("L{}", location.line),
                None => "L?".to_string(),
            };
            lines.push(format!("{}. {} ({} lines, {})", total, language, count, line));
        }
    }
    if lines.is_empty() {
        return "(no code blocks)".to_string();
    }
    lines.join("\n")
}

/// Renders the front matter fields as aligned key/value lines.
pub fn format_front_matter(front_matter: &FrontMatter) -> String {
    let mut pairs: Vec<(String, String)> = Vec::new();

    pairs.push(("schema_version".to_string(), placeholder(&front_matter.schema_version, "")));
    pairs.push(("name".to_string(), placeholder(&front_matter.name, "")));
    pairs.push(("version".to_string(), placeholder(&front_matter.version, "")));
    pairs.push(("description".to_string(), placeholder(&front_matter.description, "")));
    pairs.push(("license".to_string(), placeholder(&front_matter.license, "")));
    if !front_matter.authors.is_empty() {
        pairs.push(("authors".to_string(), front_matter.authors.join(", ")));
    }
    if !front_matter.tags.is_empty() {
        pairs.push(("tags".to_string(), front_matter.tags.join(", ")));
    }

    let present: Vec<(String, String)> = pairs
        .into_iter()
        .filter(|(_, value)| !value.is_empty())
        .collect();

    if present.is_empty() && front_matter.metadata.is_empty() {
        return "(no front matter)".to_string();
    }

    let width = present
        .iter()
        .map(|(key, _)| key.len())
        .max()
        .unwrap_or(0);

    let mut lines: Vec<String> = Vec::new();
    for (key, value) in &present {
        lines.push(format!("{}: {}", pad_right(key, width), value));
    }
    for key in front_matter.metadata.keys() {
        lines.push(format!("{}: (custom)", pad_right(key, width)));
    }
    lines.join("\n")
}

fn pad_right(text: &str, width: usize) -> String {
    let mut padded = text.to_string();
    while padded.len() < width {
        padded.push(' ');
    }
    padded
}

/// Returns a grouped table of declared dependencies.
pub fn format_dependency_table(front_matter: &FrontMatter) -> String {
    if front_matter.dependencies.is_empty() {
        return "(no dependencies)".to_string();
    }
    let mut lines: Vec<String> = vec!["Dependencies:".to_string()];
    let width = front_matter
        .dependencies
        .iter()
        .map(|name| name.len())
        .max()
        .unwrap_or(0);
    for dependency in &front_matter.dependencies {
        let group = if dependency.starts_with("npm:") {
            "npm"
        } else if dependency.starts_with("pip:") {
            "pip"
        } else if dependency.starts_with("cargo:") {
            "cargo"
        } else {
            "other"
        };
        lines.push(format!("  {}  [{}]", pad_right(dependency, width), group));
    }
    lines.push(format!("Total: {}", front_matter.dependencies.len()));
    lines.join("\n")
}

/// Renders a validation report grouped by severity.
pub fn format_validation_report(result: &ValidationResult) -> String {
    if result.diagnostics.is_empty() {
        return "No issues found.".to_string();
    }

    let groups: Vec<(Severity, Vec<&Diagnostic>)> = vec![
        (Severity::Error, collect(&result.diagnostics, &Severity::Error)),
        (Severity::Warning, collect(&result.diagnostics, &Severity::Warning)),
        (Severity::Info, collect(&result.diagnostics, &Severity::Info)),
    ];

    let mut lines: Vec<String> = Vec::new();
    for (severity, bucket) in groups {
        if bucket.is_empty() {
            continue;
        }
        lines.push(format!("{} ({})", severity.to_string().to_uppercase(), bucket.len()));
        for diagnostic in bucket {
            let location = match (&diagnostic.section, diagnostic.line) {
                (Some(section), Some(line)) => format!("({}) [{}] L{}", section, line, diagnostic.message),
                (Some(section), None) => format!("({}) [{}] {}", section, diagnostic.message),
                (None, Some(line)) => format!("L{} {}", line, diagnostic.message),
                (None, None) => format!("{}", diagnostic.message),
            };
            lines.push(format!("  {}", location));
        }
    }
    lines.join("\n")
}

/// Renders a flat one-line-per-diagnostic report.
pub fn format_diagnostics(diagnostics: &[Diagnostic]) -> String {
    if diagnostics.is_empty() {
        return "No issues found.".to_string();
    }
    let mut lines: Vec<String> = Vec::new();
    for diagnostic in diagnostics {
        lines.push(diagnostic.to_string());
    }
    lines.join("\n")
}

fn collect<'a>(diagnostics: &'a [Diagnostic], severity: &Severity) -> Vec<&'a Diagnostic> {
    diagnostics
        .iter()
        .filter(|diagnostic| diagnostic.severity == *severity)
        .collect()
}

/// Renders the output of an execution map.
pub fn format_execution_report(
    results: &HashMap<String, Result<ExecutionResult, RuntimeError>>,
) -> String {
    if results.is_empty() {
        return "(no execution results)".to_string();
    }
    let mut names: Vec<&String> = results.keys().collect();
    names.sort();

    let mut lines: Vec<String> = Vec::new();
    for name in names {
        let entry = &results[name];
        match entry {
            Ok(execution) => {
                let state = if execution.success() { "ok" } else { "failed" };
                lines.push(format!("  {} [{}] ({} ms)", name, state, execution.duration_ms));
                let stdout = execution.stdout.trim_end();
                if !stdout.is_empty() {
                    lines.push(format!("    stdout: {}", stdout));
                }
                let stderr = execution.stderr.trim_end();
                if !stderr.is_empty() {
                    lines.push(format!("    stderr: {}", stderr));
                }
            }
            Err(error) => {
                lines.push(format!("  {} [error]", name));
                lines.push(format!("    {}", error));
            }
        }
    }
    lines.join("\n")
}

/// Returns a breakdown of the content node types in a module.
pub fn format_content_breakdown(module: &Module) -> String {
    let mut headings = 0usize;
    let mut paragraphs = 0usize;
    let mut code_blocks = 0usize;
    let mut lists = 0usize;
    let mut tables = 0usize;
    let mut other = 0usize;

    for section in &module.sections {
        for node in &section.content {
            match node {
                ContentNode::Heading { .. } => headings += 1,
                ContentNode::Paragraph(_) | ContentNode::Text(_) => paragraphs += 1,
                ContentNode::CodeBlock(_) => code_blocks += 1,
                ContentNode::List { .. } => lists += 1,
                ContentNode::Table { .. } => tables += 1,
                _ => other += 1,
            }
        }
    }

    format!(
        "Content: {} headings, {} paragraphs, {} code blocks, {} lists, {} tables, {} other",
        headings, paragraphs, code_blocks, lists, tables, other
    )
}

/// Renders the text content of every section, one block at a time.
pub fn format_section_text(module: &Module) -> String {
    let mut lines: Vec<String> = Vec::new();
    for section in &module.sections {
        let text = section.get_text_content();
        if text.trim().is_empty() {
            continue;
        }
        lines.push(format!("## {}", section.title));
        lines.push(text);
        lines.push(String::new());
    }
    if lines.is_empty() {
        return "(no text content)".to_string();
    }
    lines.join("\n").trim_end().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::Parser;

    fn fixture() -> Module {
        let input = "---\nid: fmt\nname: Format Me\nversion: 2.0.0\n\
                     author: Tester\ndescription: Formatter fixture\n\
                     dependencies:\n  - pip:requests\n  - npm:left-pad\n---\n\n\
                     ## Purpose\n\nA module for formatting.\n\n\
                     ## Python\n\n```python\nprint(1)\n```\n";
        Parser::new().parse(input, None).unwrap()
    }

    fn empty() -> Module {
        Module::new(String::new())
    }

    #[test]
    fn test_module_summary_reports_totals() {
        let text = format_module_summary(&fixture());
        assert!(text.contains("Module: Format Me"));
        assert!(text.contains("version: 2.0.0"));
        assert!(text.contains("Tester"));
        assert!(text.contains("sections: 2"));
        assert!(text.contains("code blocks: 1"));
    }

    #[test]
    fn test_module_summary_falls_back() {
        let text = format_module_summary(&empty());
        assert!(text.contains("(untitled)"));
        assert!(text.contains("(none)"));
    }

    #[test]
    fn test_section_list_and_toc() {
        let list = format_section_list(&fixture());
        assert!(list.contains("1. Purpose"));
        assert!(list.contains("2. Python"));
        assert_eq!(format_section_list(&empty()), "(no sections)");

        let toc = format_toc(&fixture());
        assert!(toc.contains("Contents:"));
        assert!(toc.contains("*"));
        assert_eq!(format_toc(&empty()), "(no sections)");
    }

    #[test]
    fn test_code_block_list() {
        let text = format_code_block_list(&fixture());
        assert!(text.contains("1. python"));
        assert!(text.contains("1 lines"));
        assert_eq!(format_code_block_list(&empty()), "(no code blocks)");
    }

    #[test]
    fn test_front_matter_is_aligned() {
        let text = format_front_matter(&fixture().frontmatter);
        assert!(text.contains("version"));
        assert!(text.contains("2.0.0"));
        assert!(text.contains("authors"));
        assert_eq!(format_front_matter(&empty().frontmatter), "(no front matter)");
    }

    #[test]
    fn test_dependency_table() {
        let text = format_dependency_table(&fixture().frontmatter);
        assert!(text.contains("[pip]"));
        assert!(text.contains("[npm]"));
        assert!(text.contains("Total: 2"));
        assert_eq!(format_dependency_table(&empty().frontmatter), "(no dependencies)");
    }

    #[test]
    fn test_validation_report() {
        let result = ValidationResult::new();
        assert_eq!(format_validation_report(&result), "No issues found.");
        assert_eq!(format_diagnostics(&[]), "No issues found.");

        let mut populated = ValidationResult::new();
        populated.push(Diagnostic {
            severity: Severity::Error,
            message: "Missing required section: purpose".to_string(),
            line: Some(4),
            section: Some("purpose".to_string()),
        });
        populated.push(Diagnostic {
            severity: Severity::Warning,
            message: "Duplicate section".to_string(),
            line: None,
            section: None,
        });
        let report = format_validation_report(&populated);
        assert!(report.contains("ERROR (1)"));
        assert!(report.contains("WARNING (1)"));
        assert!(report.contains("L4"));
        assert!(format_diagnostics(&populated.diagnostics).contains("Missing required"));
    }

    #[test]
    fn test_execution_report() {
        assert_eq!(format_execution_report(&HashMap::new()), "(no execution results)");

        let mut results: HashMap<String, Result<ExecutionResult, RuntimeError>> = HashMap::new();
        results.insert(
            "Python".to_string(),
            Ok(ExecutionResult {
                exit_code: 0,
                stdout: "1\n".to_string(),
                stderr: String::new(),
                duration_ms: 12,
            }),
        );
        results.insert(
            "Broken".to_string(),
            Err(RuntimeError::ExecutionFailed("boom".to_string())),
        );
        let report = format_execution_report(&results);
        assert!(report.contains("Python [ok]"));
        assert!(report.contains("stdout: 1"));
        assert!(report.contains("Broken [error]"));
        assert!(report.contains("boom"));
    }

    #[test]
    fn test_content_breakdown_and_text() {
        let breakdown = format_content_breakdown(&fixture());
        assert!(breakdown.contains("1 code blocks"));
        assert!(breakdown.contains("1 paragraphs"));
        let text = format_section_text(&fixture());
        assert!(text.contains("## Purpose"));
        assert!(text.contains("A module for formatting."));
        assert_eq!(format_section_text(&empty()), "(no text content)");
    }

    #[test]
    fn test_ast_json_is_valid_json() {
        let text = format_ast_json(&fixture());
        let parsed: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert!(parsed.is_object());
    }
}
