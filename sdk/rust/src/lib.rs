pub mod ast;
pub mod cache;
pub mod config;
pub mod diagnostics;
pub mod format;
pub mod graph;
pub mod parser;
pub mod plugins;
pub mod runtime;
pub mod template;
pub mod validator;

pub use ast::{
    CodeBlock, ContentNode, FrontMatter, Module, Section, SectionKind, SourceLocation,
};
pub use cache::{
    CacheEntry, CacheError, CacheStats, ResultCache, create_result_cache, format_cache_stats,
    hash_cache_key, is_valid_cache_key,
};
pub use config::{
    ConfigError, SdkConfig, find_sdk_config, is_supported_target, list_sdk_targets,
    load_sdk_config, merge_sdk_configs, resolve_sdk_config_path, save_sdk_config,
    validate_sdk_config,
};
pub use diagnostics::{
    DiagnosticCheck, DiagnosticReport, DiagnosticStatus, check_language_runtimes,
    check_sdk_config, command_exists, format_diagnostics, run_diagnostics,
};
pub use format::{
    format_ast_json, format_code_block_list, format_dependency_table, format_execution_report,
    format_front_matter, format_module_summary, format_section_list, format_toc,
    format_validation_report,
};
pub use graph::{
    DependencyGraph, GraphEdge, GraphNode, build_graph, node_names, topological_sort,
};
pub use parser::{ParseError, Parser};
pub use plugins::{
    HookPoint, MetadataPlugin, Plugin, PluginError, PluginRegistry, PythonPlugin, MemoryPlugin,
};
pub use runtime::{ExecutionConfig, ExecutionResult, RuntimeError, Runtime};
pub use template::{
    TemplateError, get_starter_template, new_module_starter, render_starter, starter_variables,
    validate_starter_name,
};
pub use validator::{Diagnostic, Severity, ValidationError, ValidationResult, Validator};

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

pub fn parse(content: &str) -> Result<Module, ParseError> {
    let parser = Parser::new();
    parser.parse(content, None)
}

pub fn parse_file(path: &str) -> Result<Module, ParseError> {
    let content = std::fs::read_to_string(path)?;
    let parser = Parser::new();
    parser.parse(&content, Some(path))
}

pub fn validate(module: &Module) -> ValidationResult {
    let validator = Validator::new();
    validator.validate(module)
}

pub fn execute(module: &Module) -> HashMap<String, Result<ExecutionResult, RuntimeError>> {
    let runtime = Runtime::new();
    runtime.execute_all(module)
}

use std::collections::HashMap;

pub fn parse_and_validate(content: &str) -> Result<(Module, ValidationResult), ParseError> {
    let module = parse(content)?;
    let result = validate(&module);
    Ok((module, result))
}

/// Returns the module's declared name, or its id, or `(untitled)`.
pub fn module_name(module: &Module) -> String {
    module
        .frontmatter
        .name
        .clone()
        .or_else(|| module.frontmatter.metadata.get("id").map(|v| v.to_string()))
        .unwrap_or_else(|| "(untitled)".to_string())
}

/// Returns a short human-readable summary of a module.
pub fn module_summary(module: &Module) -> String {
    let mut lines: Vec<String> = Vec::new();
    lines.push(format!("Module: {}", module_name(module)));
    let version = module.frontmatter.version.clone().unwrap_or_else(|| "(none)".to_string());
    lines.push(format!("  version: {}", version));
    let runtime = module.frontmatter.metadata.get("runtime").map(|v| v.to_string());
    lines.push(format!("  runtime: {}", runtime.unwrap_or_else(|| "(none)".to_string())));
    lines.push(format!("  sections: {}", module.sections.len()));
    lines.push(format!("  code blocks: {}", ast::count_code_blocks(module)));
    lines.join("\n")
}

/// Returns true when the module validates without errors.
pub fn module_is_valid(module: &Module) -> bool {
    validate(module).is_valid
}

/// Returns the module's section names, in document order.
pub fn module_section_names(module: &Module) -> Vec<String> {
    module
        .sections
        .iter()
        .map(|section| section.title.clone())
        .collect()
}

/// Returns the distinct code block languages used by the module.
pub fn module_code_languages(module: &Module) -> Vec<String> {
    ast::code_block_languages(module)
}

/// Parses content while recording the originating file path.
pub fn parse_with_source(content: &str, file_path: &str) -> Result<Module, ParseError> {
    Parser::new().parse(content, Some(file_path))
}

/// Returns a one-line description of the SDK and the crate version.
pub fn sdk_info() -> String {
    format!("mam-sdk v{} — parse, validate, and execute MAM modules", VERSION)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_and_validate() {
        let input = "---\nname: test\nversion: 1.0\n---\n\n## Metadata\n\nname: test\n\n## Purpose\n\nTest module.";
        let (module, result) = parse_and_validate(input).unwrap();
        assert!(result.is_valid);
        assert_eq!(module.frontmatter.name.as_deref(), Some("test"));
    }

    #[test]
    fn test_version() {
        assert!(!VERSION.is_empty());
    }

    fn fixture() -> Module {
        parse("---\nid: demo\nname: Demo\nversion: 2.0.0\n---\n\n\
               ## Purpose\n\nDoes things.\n\n\
               ## Python\n\n```python\nprint(1)\n```\n")
            .unwrap()
    }

    #[test]
    fn test_module_name() {
        assert_eq!(module_name(&fixture()), "Demo");
        assert_eq!(module_name(&Module::new(String::new())), "(untitled)");
    }

    #[test]
    fn test_module_summary() {
        let text = module_summary(&fixture());
        assert!(text.contains("Module: Demo"));
        assert!(text.contains("version: 2.0.0"));
        assert!(text.contains("sections: 2"));
        assert!(text.contains("code blocks: 1"));
    }

    #[test]
    fn test_module_is_valid() {
        assert!(module_is_valid(&fixture()));
        assert!(!module_is_valid(&Module::new(String::new())));
    }

    #[test]
    fn test_module_section_names() {
        assert_eq!(module_section_names(&fixture()), vec!["Purpose", "Python"]);
        assert!(module_section_names(&Module::new(String::new())).is_empty());
    }

    #[test]
    fn test_module_code_languages() {
        assert_eq!(module_code_languages(&fixture()), vec!["python".to_string()]);
        assert!(module_code_languages(&Module::new(String::new())).is_empty());
    }

    #[test]
    fn test_parse_with_source_records_path() {
        let module = parse_with_source("## Purpose\n\nHi.\n", "demo.mam.md").unwrap();
        assert_eq!(module.file_path.as_deref(), Some("demo.mam.md"));
    }

    #[test]
    fn test_sdk_info_mentions_version() {
        assert!(sdk_info().contains(VERSION));
    }
}
