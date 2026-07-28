pub mod ast;
pub mod parser;
pub mod plugins;
pub mod runtime;
pub mod validator;

pub use ast::{
    CodeBlock, ContentNode, FrontMatter, Module, Section, SectionKind, SourceLocation,
};
pub use parser::{ParseError, Parser};
pub use plugins::{
    HookPoint, MetadataPlugin, Plugin, PluginError, PluginRegistry, PythonPlugin, MemoryPlugin,
};
pub use runtime::{ExecutionConfig, ExecutionResult, RuntimeError, Runtime};
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
}
