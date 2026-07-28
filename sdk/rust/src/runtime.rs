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
}
