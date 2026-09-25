use crate::ast::{CodeBlock, Module, SectionKind};
use std::collections::HashMap;
use std::process::Command;
use thiserror::Error;
use tokio::process::Command as TokioCommand;

#[derive(Error, Debug)]
pub enum RuntimeError {
    #[error("No executable code block found in section '{section}'")]
    NoCodeBlock { section: String },
    #[error("Unsupported language: '{language}'")]
    UnsupportedLanguage { language: String },
    #[error("Execution failed: {0}")]
    ExecutionFailed(String),
    #[error("Process error: {0}")]
    ProcessError(String),
    #[error("Timeout after {ms}ms")]
    Timeout { ms: u64 },
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Debug, Clone)]
pub struct ExecutionResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u64,
}

impl ExecutionResult {
    pub fn success(&self) -> bool {
        self.exit_code == 0
    }
}

#[derive(Debug, Clone, Default)]
pub struct ExecutionConfig {
    pub timeout_ms: Option<u64>,
    pub env: HashMap<String, String>,
    pub working_dir: Option<String>,
    pub max_output_bytes: Option<usize>,
}

pub struct Runtime {
    config: ExecutionConfig,
}

impl Runtime {
    pub fn new() -> Self {
        Self { config: ExecutionConfig::default() }
    }

    pub fn with_config(config: ExecutionConfig) -> Self {
        Self { config }
    }

    pub fn execute_code_block(&self, block: &CodeBlock) -> Result<ExecutionResult, RuntimeError> {
        let interpreter = match block.language.as_str() {
            "python" | "python3" => "python3",
            "javascript" | "js" | "node" => "node",
            "bash" | "sh" | "shell" => "sh",
            "rust" => "rustc",
            "go" => "go",
            lang => return Err(RuntimeError::UnsupportedLanguage { language: lang.to_string() }),
        };

        let mut cmd = Command::new(interpreter);

        match block.language.as_str() {
            "python" | "python3" => {
                cmd.arg("-c").arg(&block.code);
            }
            "javascript" | "js" | "node" => {
                cmd.arg("-e").arg(&block.code);
            }
            "bash" | "sh" | "shell" => {
                cmd.arg("-c").arg(&block.code);
            }
            _ => {}
        }

        if let Some(ref dir) = self.config.working_dir {
            cmd.current_dir(dir);
        }

        for (key, value) in &self.config.env {
            cmd.env(key, value);
        }

        let output = cmd.output().map_err(RuntimeError::Io)?;

        Ok(ExecutionResult {
            exit_code: output.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            duration_ms: 0,
        })
    }

    pub async fn execute_code_block_async(&self, block: &CodeBlock) -> Result<ExecutionResult, RuntimeError> {
        let interpreter = match block.language.as_str() {
            "python" | "python3" => "python3",
            "javascript" | "js" | "node" => "node",
            "bash" | "sh" | "shell" => "sh",
            lang => return Err(RuntimeError::UnsupportedLanguage { language: lang.to_string() }),
        };

        let mut cmd = TokioCommand::new(interpreter);

        match block.language.as_str() {
            "python" | "python3" => {
                cmd.arg("-c").arg(&block.code);
            }
            "javascript" | "js" | "node" => {
                cmd.arg("-e").arg(&block.code);
            }
            "bash" | "sh" | "shell" => {
                cmd.arg("-c").arg(&block.code);
            }
            _ => {}
        }

        if let Some(ref dir) = self.config.working_dir {
            cmd.current_dir(dir);
        }

        for (key, value) in &self.config.env {
            cmd.env(key, value);
        }

        let timeout = self.config.timeout_ms.unwrap_or(30_000);
        let output = tokio::time::timeout(
            std::time::Duration::from_millis(timeout),
            cmd.output(),
        )
        .await
        .map_err(|_| RuntimeError::Timeout { ms: timeout })?
        .map_err(RuntimeError::Io)?;

        Ok(ExecutionResult {
            exit_code: output.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            duration_ms: 0,
        })
    }

    pub fn execute_section(&self, module: &Module, section: &SectionKind) -> Result<ExecutionResult, RuntimeError> {
        let sec = module.get_section(section)
            .ok_or_else(|| RuntimeError::NoCodeBlock { section: section.as_str().to_string() })?;

        let blocks = sec.get_code_blocks();
        let block = blocks.first()
            .ok_or_else(|| RuntimeError::NoCodeBlock { section: section.as_str().to_string() })?;

        self.execute_code_block(block)
    }

    pub fn execute_all(&self, module: &Module) -> HashMap<String, Result<ExecutionResult, RuntimeError>> {
        let mut results = HashMap::new();
        for section in &module.sections {
            let blocks = section.get_code_blocks();
            if !blocks.is_empty() {
                let block = blocks[0];
                results.insert(
                    section.kind.as_str().to_string(),
                    self.execute_code_block(block),
                );
            }
        }
        results
    }
}

impl Default for Runtime {
    fn default() -> Self {
        Self::new()
    }
}

/// Convenience wrapper mirroring `ExecutionResult::success`.
pub fn result_is_success(result: &ExecutionResult) -> bool {
    result.success()
}

/// Returns the distinct languages of the module's code blocks, in first-seen order.
///
/// `ExecutionResult` does not record which language produced it, so the
/// languages are read from the module that was executed.
pub fn collect_languages(module: &Module) -> Vec<String> {
    crate::ast::code_block_languages(module)
}

/// Returns the section names whose execution failed.
pub fn collect_failures(
    results: &HashMap<String, Result<ExecutionResult, RuntimeError>>,
) -> Vec<String> {
    let mut failures: Vec<String> = Vec::new();
    for (name, value) in results {
        let failed = match value {
            Ok(execution) => !execution.success(),
            Err(_) => true,
        };
        if failed {
            failures.push(name.clone());
        }
    }
    failures.sort();
    failures
}

/// Counts the successful entries in an execution map.
pub fn count_successes(
    results: &HashMap<String, Result<ExecutionResult, RuntimeError>>,
) -> usize {
    results
        .values()
        .filter(|value| match value {
            Ok(execution) => execution.success(),
            Err(_) => false,
        })
        .count()
}

/// Sums the reported duration of every successful execution.
pub fn total_duration_ms(
    results: &HashMap<String, Result<ExecutionResult, RuntimeError>>,
) -> u64 {
    results
        .values()
        .filter_map(|value| match value {
            Ok(execution) if execution.success() => Some(execution.duration_ms),
            _ => None,
        })
        .sum()
}

/// Returns a one-line summary of an execution map.
pub fn summarize_execution(
    results: &HashMap<String, Result<ExecutionResult, RuntimeError>>,
) -> String {
    let passed = count_successes(results);
    let total = results.len();
    let failures = collect_failures(results);
    let state = if failures.is_empty() { "succeeded" } else { "failed" };
    let mut summary = format!("Execution {}: {}/{} blocks succeeded", state, passed, total);
    if !failures.is_empty() {
        summary.push_str(" (failed: ");
        summary.push_str(&failures.join(", "));
        summary.push(')');
    }
    summary
}

/// Renders per-section execution output for terminal display.
pub fn format_execution_output(
    results: &HashMap<String, Result<ExecutionResult, RuntimeError>>,
) -> String {
    if results.is_empty() {
        return "(no output)".to_string();
    }
    let mut names: Vec<&String> = results.keys().collect();
    names.sort();
    let mut lines: Vec<String> = Vec::new();
    for name in names {
        match &results[name] {
            Ok(execution) => {
                lines.push(format!("  {}: {}", name, if execution.success() { "ok" } else { "failed" }));
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
                lines.push(format!("  {}: error ({})", name, error));
            }
        }
    }
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ast::CodeBlock;

    #[test]
    fn test_execute_python() {
        let runtime = Runtime::new();
        let block = CodeBlock::new(
            "python".to_string(),
            "print('hello from python')".to_string(),
            None,
        );
        let result = runtime.execute_code_block(&block).unwrap();
        assert!(result.success());
        assert!(result.stdout.contains("hello from python"));
    }

    #[test]
    fn test_execute_unsupported_language() {
        let runtime = Runtime::new();
        let block = CodeBlock::new(
            "brainfuck".to_string(),
            "++++++++[>++++[>++>+++>+++>+<<<<-]>+>+>->>+[<]<-]>>.>---.+++++++..+++.>>.<-.<.+++.------.--------.>>+.>++.".to_string(),
            None,
        );
        let result = runtime.execute_code_block(&block);
        assert!(result.is_err());
    }

    #[test]
    fn test_execute_with_env() {
        let mut config = ExecutionConfig::default();
        config.env.insert("TEST_VAR".to_string(), "rust_works".to_string());
        let runtime = Runtime::with_config(config);
        let block = CodeBlock::new(
            "python".to_string(),
            "import os; print(os.environ.get('TEST_VAR', 'not_found'))".to_string(),
            None,
        );
        let result = runtime.execute_code_block(&block).unwrap();
        assert!(result.stdout.contains("rust_works"));
    }

    fn ok_result(stdout: &str) -> Result<ExecutionResult, RuntimeError> {
        Ok(ExecutionResult {
            exit_code: 0,
            stdout: stdout.to_string(),
            stderr: String::new(),
            duration_ms: 5,
        })
    }

    fn err_result() -> Result<ExecutionResult, RuntimeError> {
        Err(RuntimeError::ExecutionFailed("boom".to_string()))
    }

    fn sample_map() -> HashMap<String, Result<ExecutionResult, RuntimeError>> {
        let mut map = HashMap::new();
        map.insert("Python".to_string(), ok_result("hi"));
        map.insert("JavaScript".to_string(), ok_result("hi"));
        map.insert("Broken".to_string(), err_result());
        map
    }

    #[test]
    fn test_result_is_success() {
        let good = ok_result("x").unwrap();
        let bad = ExecutionResult {
            exit_code: 1,
            stdout: String::new(),
            stderr: String::new(),
            duration_ms: 0,
        };
        assert!(result_is_success(&good));
        assert!(!result_is_success(&bad));
    }

    #[test]
    fn test_count_successes() {
        assert_eq!(count_successes(&sample_map()), 2);
        assert_eq!(count_successes(&HashMap::new()), 0);
    }

    #[test]
    fn test_collect_failures_is_sorted() {
        let mut map = HashMap::new();
        map.insert("Zeta".to_string(), err_result());
        map.insert("Alpha".to_string(), err_result());
        assert_eq!(collect_failures(&map), vec!["Alpha".to_string(), "Zeta".to_string()]);
        assert!(collect_failures(&HashMap::new()).is_empty());
    }

    #[test]
    fn test_collect_languages_reads_the_module() {
        use crate::parser::Parser;
        let input = "## Python\n\n```python\nprint(1)\n```\n\n\
                     ## JavaScript\n\n```javascript\nconsole.log(1)\n```\n";
        let module = Parser::new().parse(input, None).unwrap();
        assert_eq!(
            collect_languages(&module),
            vec!["python".to_string(), "javascript".to_string()]
        );
    }

    #[test]
    fn test_total_duration_ms() {
        assert_eq!(total_duration_ms(&sample_map()), 10);
        assert_eq!(total_duration_ms(&HashMap::new()), 0);
    }

    #[test]
    fn test_summarize_execution() {
        let summary = summarize_execution(&sample_map());
        assert!(summary.contains("failed"));
        assert!(summary.contains("2/3"));
        assert!(summary.contains("Broken"));
        let clean = HashMap::new();
        assert!(summarize_execution(&clean).contains("succeeded"));
    }

    #[test]
    fn test_format_execution_output() {
        let text = format_execution_output(&sample_map());
        assert!(text.contains("Python: ok"));
        assert!(text.contains("stdout: hi"));
        assert!(text.contains("Broken: error"));
        assert_eq!(format_execution_output(&HashMap::new()), "(no output)");
    }
}
