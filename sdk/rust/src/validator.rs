use crate::ast::{Module, SectionKind};
use thiserror::Error;
use std::fmt;

#[derive(Error, Debug)]
pub enum ValidationError {
    #[error("Missing required section: {section}")]
    MissingSection { section: String },
    #[error("Missing required frontmatter field: {field}")]
    MissingFrontmatterField { field: String },
    #[error("Invalid section order: '{actual}' should come before '{expected}'")]
    InvalidSectionOrder { actual: String, expected: String },
    #[error("Empty module: no sections found")]
    EmptyModule,
    #[error("Empty code block in section '{section}'")]
    EmptyCodeBlock { section: String },
    #[error("Duplicate section: '{section}' found {count} times")]
    DuplicateSection { section: String, count: usize },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Severity {
    Error,
    Warning,
    Info,
}

impl fmt::Display for Severity {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Severity::Error => write!(f, "ERROR"),
            Severity::Warning => write!(f, "WARNING"),
            Severity::Info => write!(f, "INFO"),
        }
    }
}

#[derive(Debug, Clone)]
pub struct Diagnostic {
    pub severity: Severity,
    pub message: String,
    pub line: Option<usize>,
    pub section: Option<String>,
}

impl fmt::Display for Diagnostic {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let loc = match (&self.line, &self.section) {
            (Some(l), Some(s)) => format!(" [{}:L{}]", s, l),
            (Some(l), None) => format!(" [L{}]", l),
            (None, Some(s)) => format!(" [{}]", s),
            (None, None) => String::new(),
        };
        write!(f, "{}{}: {}", self.severity, loc, self.message)
    }
}

#[derive(Debug, Clone)]
pub struct ValidationResult {
    pub diagnostics: Vec<Diagnostic>,
    pub is_valid: bool,
}

impl ValidationResult {
    pub fn new() -> Self {
        Self { diagnostics: Vec::new(), is_valid: true }
    }

    pub fn push(&mut self, diag: Diagnostic) {
        if diag.severity == Severity::Error {
            self.is_valid = false;
        }
        self.diagnostics.push(diag);
    }

    pub fn errors(&self) -> Vec<&Diagnostic> {
        self.diagnostics.iter().filter(|d| d.severity == Severity::Error).collect()
    }

    pub fn warnings(&self) -> Vec<&Diagnostic> {
        self.diagnostics.iter().filter(|d| d.severity == Severity::Warning).collect()
    }
}

impl Default for ValidationResult {
    fn default() -> Self {
        Self::new()
    }
}

const REQUIRED_SECTIONS: &[SectionKind] = &[
    SectionKind::Metadata,
    SectionKind::Purpose,
];

const RECOMMENDED_SECTIONS: &[SectionKind] = &[
    SectionKind::Inputs,
    SectionKind::Outputs,
    SectionKind::Rules,
];

const EXPECTED_ORDER: &[SectionKind] = &[
    SectionKind::Metadata,
    SectionKind::Purpose,
    SectionKind::Inputs,
    SectionKind::Outputs,
    SectionKind::Rules,
    SectionKind::Workflow,
    SectionKind::Python,
    SectionKind::Prompt,
    SectionKind::Memory,
    SectionKind::Examples,
    SectionKind::Tests,
    SectionKind::References,
    SectionKind::Dependencies,
    SectionKind::Exports,
    SectionKind::Imports,
    SectionKind::Plugins,
    SectionKind::Permissions,
    SectionKind::Capabilities,
];

pub struct Validator {
    strict: bool,
}

impl Validator {
    pub fn new() -> Self {
        Self { strict: true }
    }

    pub fn strict(mut self, strict: bool) -> Self {
        self.strict = strict;
        self
    }

    pub fn validate(&self, module: &Module) -> ValidationResult {
        let mut result = ValidationResult::new();

        // Empty module check
        if module.sections.is_empty() {
            result.push(Diagnostic {
                severity: Severity::Error,
                message: "Empty module: no sections found".to_string(),
                line: None,
                section: None,
            });
            return result;
        }

        // Frontmatter validation
        self.validate_frontmatter(module, &mut result);

        // Required sections
        self.validate_required_sections(module, &mut result);

        // Recommended sections
        self.validate_recommended_sections(module, &mut result);

        // Section ordering
        self.validate_section_order(module, &mut result);

        // Duplicate sections
        self.validate_no_duplicates(module, &mut result);

        // Code block validation
        self.validate_code_blocks(module, &mut result);

        result
    }

    fn validate_frontmatter(&self, module: &Module, result: &mut ValidationResult) {
        let required_fields = if self.strict {
            vec!["name", "version"]
        } else {
            vec!["name"]
        };

        for field in required_fields {
            let missing = match field {
                "name" => module.frontmatter.name.is_none(),
                "version" => module.frontmatter.version.is_none(),
                _ => false,
            };
            if missing {
                result.push(Diagnostic {
                    severity: Severity::Error,
                    message: format!("Missing required frontmatter field: {}", field),
                    line: Some(1),
                    section: Some("frontmatter".to_string()),
                });
            }
        }

        if module.frontmatter.name.is_some() {
            let name = module.frontmatter.name.as_ref().unwrap();
            if name.is_empty() || name.contains(' ') {
                result.push(Diagnostic {
                    severity: Severity::Warning,
                    message: "Module name should not contain spaces".to_string(),
                    line: Some(1),
                    section: Some("frontmatter".to_string()),
                });
            }
        }
    }

    fn validate_required_sections(&self, module: &Module, result: &mut ValidationResult) {
        for required in REQUIRED_SECTIONS {
            if !module.has_section(required) {
                result.push(Diagnostic {
                    severity: Severity::Error,
                    message: format!("Missing required section: {}", required.as_str()),
                    line: None,
                    section: Some(required.as_str().to_string()),
                });
            }
        }
    }

    fn validate_recommended_sections(&self, module: &Module, result: &mut ValidationResult) {
        for recommended in RECOMMENDED_SECTIONS {
            if !module.has_section(recommended) {
                result.push(Diagnostic {
                    severity: Severity::Info,
                    message: format!("Recommended section missing: {}", recommended.as_str()),
                    line: None,
                    section: Some(recommended.as_str().to_string()),
                });
            }
        }
    }

    fn validate_section_order(&self, module: &Module, result: &mut ValidationResult) {
        let mut last_index: isize = -1;
        let order_map: std::collections::HashMap<&str, usize> = EXPECTED_ORDER
            .iter()
            .enumerate()
            .map(|(i, k)| (k.as_str(), i))
            .collect();

        for section in &module.sections {
            if let Some(&idx) = order_map.get(section.kind.as_str()) {
                if (idx as isize) < last_index {
                    if let Some(prev) = EXPECTED_ORDER.iter().find(|k| {
                        order_map.get(k.as_str()).map_or(false, |&v| v as isize == last_index)
                    }) {
                        result.push(Diagnostic {
                            severity: Severity::Warning,
                            message: format!(
                                "Section '{}' should come before '{}'",
                                section.kind.as_str(),
                                prev.as_str()
                            ),
                            line: section.location.as_ref().map(|l| l.line),
                            section: Some(section.kind.as_str().to_string()),
                        });
                    }
                }
                last_index = idx as isize;
            }
        }
    }

    fn validate_no_duplicates(&self, module: &Module, result: &mut ValidationResult) {
        use std::collections::HashMap;
        let mut counts: HashMap<&str, usize> = HashMap::new();
        for section in &module.sections {
            *counts.entry(section.kind.as_str()).or_insert(0) += 1;
        }
        for (name, count) in counts {
            if count > 1 {
                result.push(Diagnostic {
                    severity: Severity::Warning,
                    message: format!("Duplicate section '{}' found {} times", name, count),
                    line: None,
                    section: Some(name.to_string()),
                });
            }
        }
    }

    fn validate_code_blocks(&self, module: &Module, result: &mut ValidationResult) {
        for section in &module.sections {
            for block in section.get_code_blocks() {
                if block.code.trim().is_empty() {
                    result.push(Diagnostic {
                        severity: Severity::Warning,
                        message: format!("Empty code block in section '{}'", section.kind.as_str()),
                        line: block.location.as_ref().map(|l| l.line),
                        section: Some(section.kind.as_str().to_string()),
                    });
                }
            }
        }
    }
}

impl Default for Validator {
    fn default() -> Self {
        Self::new()
    }
}

/// Counts diagnostics as `(errors, warnings, info)`.
pub fn count_by_severity(result: &ValidationResult) -> (usize, usize, usize) {
    let mut errors = 0usize;
    let mut warnings = 0usize;
    let mut info = 0usize;
    for diagnostic in &result.diagnostics {
        match diagnostic.severity {
            Severity::Error => errors += 1,
            Severity::Warning => warnings += 1,
            Severity::Info => info += 1,
        }
    }
    (errors, warnings, info)
}

/// Returns true when any diagnostic is an error.
pub fn has_errors(result: &ValidationResult) -> bool {
    result.diagnostics.iter().any(|d| d.severity == Severity::Error)
}

/// Returns true when any diagnostic is a warning.
pub fn has_warnings(result: &ValidationResult) -> bool {
    result
        .diagnostics
        .iter()
        .any(|d| d.severity == Severity::Warning)
}

/// Returns the diagnostics with the requested severity.
pub fn diagnostics_of_severity<'a>(
    result: &'a ValidationResult,
    severity: &Severity,
) -> Vec<&'a Diagnostic> {
    result
        .diagnostics
        .iter()
        .filter(|d| d.severity == *severity)
        .collect()
}

/// Returns the diagnostic messages in order.
pub fn diagnostic_messages(result: &ValidationResult) -> Vec<String> {
    result
        .diagnostics
        .iter()
        .map(|d| d.message.clone())
        .collect()
}

/// Returns true when the result carries no error diagnostics.
pub fn result_is_valid(result: &ValidationResult) -> bool {
    !has_errors(result)
}

/// Returns a one-line summary such as `2 errors, 1 warning`.
pub fn summarize_result(result: &ValidationResult) -> String {
    let (errors, warnings, info) = count_by_severity(result);
    let mut parts: Vec<String> = Vec::new();
    if errors > 0 {
        parts.push(format!("{} error{}", errors, if errors == 1 { "" } else { "s" }));
    }
    if warnings > 0 {
        parts.push(format!("{} warning{}", warnings, if warnings == 1 { "" } else { "s" }));
    }
    if info > 0 {
        parts.push(format!("{} info", info));
    }
    if parts.is_empty() {
        return "no issues".to_string();
    }
    parts.join(", ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ast::{CodeBlock, ContentNode, Module, Section, SectionKind};
    use crate::parser::Parser;

    fn make_module(content: &str) -> Module {
        let parser = Parser::new();
        parser.parse(content, None).unwrap()
    }

    #[test]
    fn test_valid_module() {
        let input = "---\nname: test-module\nversion: 2.0.0\n---\n\n## Metadata\n\nname: test\n\n## Purpose\n\nTest module.";
        let module = make_module(input);
        let validator = Validator::new();
        let result = validator.validate(&module);
        assert!(result.is_valid);
    }

    #[test]
    fn test_missing_required_section() {
        let input = "---\nname: test-module\nversion: 2.0.0\n---\n\n## Metadata\n\nname: test";
        let module = make_module(input);
        let validator = Validator::new();
        let result = validator.validate(&module);
        assert!(!result.is_valid);
        assert!(result.errors().iter().any(|e| e.message.contains("Purpose")));
    }

    #[test]
    fn test_missing_frontmatter_name() {
        let input = "---\nversion: 2.0.0\n---\n\n## Metadata\n\nx\n\n## Purpose\n\ny";
        let module = make_module(input);
        let validator = Validator::new();
        let result = validator.validate(&module);
        assert!(!result.is_valid);
    }

    #[test]
    fn test_empty_module() {
        let module = Module::new(String::new());
        let validator = Validator::new();
        let result = validator.validate(&module);
        assert!(!result.is_valid);
        assert!(result.errors().iter().any(|e| e.message.contains("Empty")));
    }

    #[test]
    fn test_duplicate_sections() {
        let input = "---\nname: test\nversion: 1.0\n---\n\n## Purpose\n\nA\n\n## Purpose\n\nB";
        let module = make_module(input);
        let validator = Validator::new();
        let result = validator.validate(&module);
        assert!(result.warnings().iter().any(|e| e.message.contains("Duplicate")));
    }

    fn mixed_result() -> ValidationResult {
        let mut result = ValidationResult::new();
        result.push(Diagnostic {
            severity: Severity::Error,
            message: "bad id".to_string(),
            line: Some(1),
            section: Some("frontmatter".to_string()),
        });
        result.push(Diagnostic {
            severity: Severity::Error,
            message: "missing version".to_string(),
            line: Some(1),
            section: Some("frontmatter".to_string()),
        });
        result.push(Diagnostic {
            severity: Severity::Warning,
            message: "out of order".to_string(),
            line: None,
            section: Some("purpose".to_string()),
        });
        result.push(Diagnostic {
            severity: Severity::Info,
            message: "style nit".to_string(),
            line: None,
            section: None,
        });
        result
    }

    #[test]
    fn test_count_by_severity() {
        assert_eq!(count_by_severity(&mixed_result()), (2, 1, 1));
        assert_eq!(count_by_severity(&ValidationResult::new()), (0, 0, 0));
    }

    #[test]
    fn test_has_errors_and_warnings() {
        let result = mixed_result();
        assert!(has_errors(&result));
        assert!(has_warnings(&result));
        let clean = ValidationResult::new();
        assert!(!has_errors(&clean));
        assert!(!has_warnings(&clean));
    }

    #[test]
    fn test_diagnostics_of_severity() {
        let result = mixed_result();
        let errors = diagnostics_of_severity(&result, &Severity::Error);
        assert_eq!(errors.len(), 2);
        assert!(errors.iter().all(|d| d.severity == Severity::Error));
        assert!(diagnostics_of_severity(&result, &Severity::Info).len() == 1);
    }

    #[test]
    fn test_diagnostic_messages() {
        let messages = diagnostic_messages(&mixed_result());
        assert_eq!(messages[0], "bad id");
        assert_eq!(messages.len(), 4);
        assert!(diagnostic_messages(&ValidationResult::new()).is_empty());
    }

    #[test]
    fn test_result_is_valid() {
        assert!(result_is_valid(&ValidationResult::new()));
        assert!(!result_is_valid(&mixed_result()));
    }

    #[test]
    fn test_summarize_result() {
        assert_eq!(summarize_result(&ValidationResult::new()), "no issues");
        let summary = summarize_result(&mixed_result());
        assert!(summary.contains("2 errors"));
        assert!(summary.contains("1 warning"));
        assert!(summary.contains("1 info"));
    }

    #[test]
    fn test_summarize_result_singular_and_info_only() {
        let mut single = ValidationResult::new();
        single.push(Diagnostic {
            severity: Severity::Warning,
            message: "one warning".to_string(),
            line: None,
            section: None,
        });
        assert_eq!(summarize_result(&single), "1 warning");

        let mut only_info = ValidationResult::new();
        only_info.push(Diagnostic {
            severity: Severity::Info,
            message: "just info".to_string(),
            line: None,
            section: None,
        });
        assert_eq!(summarize_result(&only_info), "1 info");
        assert!(result_is_valid(&only_info));
    }
}
