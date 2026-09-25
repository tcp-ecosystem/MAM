//! Environment diagnostics for the MAM Rust SDK.
//!
//! Performs self-checks on the SDK installation: reports the availability of
//! the language interpreters the runtime can execute, validates the resolved
//! SDK configuration, and summarizes overall environment health.
//!
//! This module deliberately avoids executing anything: it only inspects
//! configuration and asks the operating system whether a command exists.

use crate::config::{
    find_sdk_config, load_sdk_config, resolve_sdk_config_path, validate_sdk_config, SdkConfig,
};
use std::fmt;
use std::path::Path;

/// Health status of a single diagnostic check.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum DiagnosticStatus {
    /// The check passed.
    Ok,
    /// The check found something worth knowing about.
    Warn,
    /// The check failed and something is wrong.
    Fail,
}

impl DiagnosticStatus {
    /// Returns the short label used in reports.
    pub fn as_str(self) -> &'static str {
        match self {
            DiagnosticStatus::Ok => "PASS",
            DiagnosticStatus::Warn => "WARN",
            DiagnosticStatus::Fail => "FAIL",
        }
    }
}

impl fmt::Display for DiagnosticStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// A single diagnostic result.
#[derive(Debug, Clone, PartialEq)]
pub struct DiagnosticCheck {
    /// Check identifier, for example `runtime:python`.
    pub name: String,
    /// Outcome.
    pub status: DiagnosticStatus,
    /// Human-readable explanation.
    pub message: String,
}

impl DiagnosticCheck {
    /// Creates a passing check.
    pub fn ok(name: &str, message: &str) -> Self {
        Self {
            name: name.to_string(),
            status: DiagnosticStatus::Ok,
            message: message.to_string(),
        }
    }

    /// Creates a warning check.
    pub fn warn(name: &str, message: &str) -> Self {
        Self {
            name: name.to_string(),
            status: DiagnosticStatus::Warn,
            message: message.to_string(),
        }
    }

    /// Creates a failing check.
    pub fn fail(name: &str, message: &str) -> Self {
        Self {
            name: name.to_string(),
            status: DiagnosticStatus::Fail,
            message: message.to_string(),
        }
    }

    /// Returns true unless the check failed.
    pub fn is_ok(&self) -> bool {
        self.status != DiagnosticStatus::Fail
    }
}

/// The aggregate outcome of a diagnostics run.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct DiagnosticReport {
    /// Every check that ran, in order.
    pub checks: Vec<DiagnosticCheck>,
}

impl DiagnosticReport {
    /// Creates an empty report.
    pub fn new() -> Self {
        Self::default()
    }

    /// Appends a check and returns the report.
    pub fn push(&mut self, check: DiagnosticCheck) -> &mut Self {
        self.checks.push(check);
        self
    }

    /// Returns the number of checks that failed.
    pub fn failure_count(&self) -> usize {
        self.checks
            .iter()
            .filter(|check| check.status == DiagnosticStatus::Fail)
            .count()
    }

    /// Returns the number of checks that warned.
    pub fn warning_count(&self) -> usize {
        self.checks
            .iter()
            .filter(|check| check.status == DiagnosticStatus::Warn)
            .count()
    }

    /// Returns true when nothing failed.
    pub fn is_ok(&self) -> bool {
        self.failure_count() == 0
    }

    /// Returns the worst status across all checks.
    pub fn status(&self) -> DiagnosticStatus {
        if self.failure_count() > 0 {
            return DiagnosticStatus::Fail;
        }
        if self.warning_count() > 0 {
            return DiagnosticStatus::Warn;
        }
        DiagnosticStatus::Ok
    }

    /// Returns the checks with the given status.
    pub fn with_status(&self, status: DiagnosticStatus) -> Vec<&DiagnosticCheck> {
        self.checks
            .iter()
            .filter(|check| check.status == status)
            .collect()
    }
}

/// The interpreters and tools the runtime knows how to invoke.
pub const KNOWN_COMMANDS: &[(&str, &[&str])] = &[
    ("python", &["python3", "python"]),
    ("javascript", &["node"]),
    ("shell", &["sh", "bash"]),
    ("rust", &["rustc"]),
    ("go", &["go"]),
];

/// Checks whether a command can be found on `PATH`.
///
/// This never runs the command; it only asks the operating system to resolve it.
pub fn command_exists(command: &str) -> Option<String> {
    if command.is_empty() {
        return None;
    }
    let path_var = std::env::var_os("PATH")?;
    for directory in std::env::split_paths(&path_var) {
        if directory.as_os_str().is_empty() {
            continue;
        }
        let candidate = directory.join(command);
        if candidate.is_file() {
            return Some(candidate.display().to_string());
        }
    }
    None
}

/// Checks the interpreters the runtime can execute.
///
/// A missing interpreter is a warning by default, because the SDK still parses
/// and validates without it. Pass `require_all` to make absences fail.
pub fn check_language_runtimes(languages: &[&str], require_all: bool) -> Vec<DiagnosticCheck> {
    let mut checks: Vec<DiagnosticCheck> = Vec::new();
    for language in languages {
        let candidates = KNOWN_COMMANDS
            .iter()
            .find(|(name, _)| name == language)
            .map(|(_, commands)| *commands)
            .unwrap_or(&[]);

        if candidates.is_empty() {
            checks.push(DiagnosticCheck::warn(
                &format!("runtime:{}", language),
                &format!("no known interpreter for '{}'", language),
            ));
            continue;
        }

        let mut found: Option<String> = None;
        for candidate in candidates {
            if let Some(path) = command_exists(candidate) {
                found = Some(path);
                break;
            }
        }

        match found {
            Some(path) => checks.push(DiagnosticCheck::ok(
                &format!("runtime:{}", language),
                &format!("{} runtime found at {}", language, path),
            )),
            None => {
                let message = format!(
                    "{} runtime not found (looked for {})",
                    language,
                    candidates.join(", ")
                );
                let name = format!("runtime:{}", language);
                if require_all {
                    checks.push(DiagnosticCheck::fail(&name, &message));
                } else {
                    checks.push(DiagnosticCheck::warn(&name, &message));
                }
            }
        }
    }
    checks
}

/// Checks that the resolved SDK configuration loads and validates.
pub fn check_sdk_config(work_dir: Option<&str>) -> DiagnosticCheck {
    let path = match work_dir {
        Some(dir) if !dir.trim().is_empty() => std::path::PathBuf::from(dir).join(crate::config::CONFIG_FILENAME),
        _ => resolve_sdk_config_path(None),
    };

    if !path.is_file() {
        let discovered = find_sdk_config(None);
        let detail = match discovered {
            Some(found) => format!("; nearest config is {}", found.display()),
            None => String::new(),
        };
        return DiagnosticCheck::ok(
            "sdk-config",
            &format!("no SDK config at {}; using defaults{}", path.display(), detail),
        );
    }

    match load_sdk_config(Some(path.as_path())) {
        Err(error) => DiagnosticCheck::fail("sdk-config", &error.to_string()),
        Ok(config) => {
            let problems = validate_sdk_config(&config);
            if problems.is_empty() {
                DiagnosticCheck::ok(
                    "sdk-config",
                    &format!("SDK config loaded from {}", path.display()),
                )
            } else {
                DiagnosticCheck::fail("sdk-config", &problems.join("; "))
            }
        }
    }
}

/// Reports the toolchain context the SDK is running in.
pub fn check_environment() -> DiagnosticCheck {
    let version = env!("CARGO_PKG_VERSION");
    DiagnosticCheck::ok(
        "environment",
        &format!("mam-sdk v{} (Rust edition 2021)", version),
    )
}

/// Reports whether a config file can be discovered by walking up the tree.
pub fn check_config_discovery(start: Option<&Path>) -> DiagnosticCheck {
    match find_sdk_config(start) {
        Some(path) => DiagnosticCheck::ok(
            "config-discovery",
            &format!("found config at {}", path.display()),
        ),
        None => DiagnosticCheck::warn(
            "config-discovery",
            "no SDK config found in any parent directory; defaults apply",
        ),
    }
}

/// Validates a config supplied directly, without touching the filesystem.
pub fn check_config_value(config: &SdkConfig) -> DiagnosticCheck {
    let problems = validate_sdk_config(config);
    if problems.is_empty() {
        DiagnosticCheck::ok("config-value", "supplied config is valid")
    } else {
        DiagnosticCheck::fail("config-value", &problems.join("; "))
    }
}

/// Runs every diagnostic check and returns the aggregate report.
pub fn run_diagnostics(languages: &[&str], work_dir: Option<&str>, require_all: bool) -> DiagnosticReport {
    let mut report = DiagnosticReport::new();
    report.push(check_environment());
    report.push(check_sdk_config(work_dir));
    report.push(check_config_discovery(
        work_dir.map(std::path::PathBuf::from).as_deref(),
    ));
    for check in check_language_runtimes(languages, require_all) {
        report.push(check);
    }
    report
}

/// Renders a diagnostics report as readable text.
pub fn format_diagnostics(report: &DiagnosticReport) -> String {
    if report.checks.is_empty() {
        return "No diagnostics were run.".to_string();
    }
    let width = report
        .checks
        .iter()
        .map(|check| check.name.len())
        .max()
        .unwrap_or(0);

    let mut lines: Vec<String> = vec![format!(
        "MAM SDK diagnostics: {}",
        report.status().to_string().to_uppercase()
    )];
    for check in &report.checks {
        let mut padded = check.name.clone();
        while padded.len() < width {
            padded.push(' ');
        }
        lines.push(format!("[{}] {}  {}", check.status, padded, check.message));
    }
    lines.push(String::new());
    lines.push(format!(
        "{} checks, {} failed, {} warnings",
        report.checks.len(),
        report.failure_count(),
        report.warning_count()
    ));
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::SdkConfig;

    #[test]
    fn test_status_labels() {
        assert_eq!(DiagnosticStatus::Ok.as_str(), "PASS");
        assert_eq!(DiagnosticStatus::Warn.as_str(), "WARN");
        assert_eq!(DiagnosticStatus::Fail.as_str(), "FAIL");
        assert_eq!(format!("{}", DiagnosticStatus::Fail), "FAIL");
    }

    #[test]
    fn test_status_ordering_reports_worst() {
        assert!(DiagnosticStatus::Fail > DiagnosticStatus::Warn);
        assert!(DiagnosticStatus::Warn > DiagnosticStatus::Ok);
    }

    #[test]
    fn test_check_constructors() {
        assert!(DiagnosticCheck::ok("a", "fine").is_ok());
        assert!(DiagnosticCheck::warn("b", "meh").is_ok());
        assert!(!DiagnosticCheck::fail("c", "bad").is_ok());
    }

    #[test]
    fn test_report_status_and_counts() {
        let mut report = DiagnosticReport::new();
        report.push(DiagnosticCheck::ok("a", "fine"));
        assert_eq!(report.status(), DiagnosticStatus::Ok);
        assert!(report.is_ok());
        assert_eq!(report.with_status(DiagnosticStatus::Ok).len(), 1);

        report.push(DiagnosticCheck::warn("b", "meh"));
        assert_eq!(report.status(), DiagnosticStatus::Warn);
        assert_eq!(report.warning_count(), 1);

        report.push(DiagnosticCheck::fail("c", "bad"));
        assert_eq!(report.status(), DiagnosticStatus::Fail);
        assert!(!report.is_ok());
        assert_eq!(report.failure_count(), 1);
    }

    #[test]
    fn test_empty_report_formats() {
        let report = DiagnosticReport::new();
        assert!(report.is_ok());
        assert_eq!(format_diagnostics(&report), "No diagnostics were run.");
    }

    #[test]
    fn test_command_exists_handles_edge_cases() {
        assert!(command_exists("").is_none());
        assert!(command_exists("definitely-not-a-real-command-xyz").is_none());
    }

    #[test]
    fn test_language_runtime_checks() {
        let checks = check_language_runtimes(&["definitely-not-a-language"], false);
        assert_eq!(checks.len(), 1);
        assert!(checks[0].is_ok());

        let strict = check_language_runtimes(&["definitely-not-a-language"], true);
        assert_eq!(strict[0].status, DiagnosticStatus::Fail);
    }

    #[test]
    fn test_check_config_value() {
        assert_eq!(check_config_value(&SdkConfig::default()).status, DiagnosticStatus::Ok);
        let mut broken = SdkConfig::default();
        broken.target = "cobol".to_string();
        assert_eq!(check_config_value(&broken).status, DiagnosticStatus::Fail);
    }

    #[test]
    fn test_check_config_discovery() {
        let check = check_config_discovery(None);
        assert!(check.is_ok());
    }

    #[test]
    fn test_check_environment_reports_version() {
        let check = check_environment();
        assert_eq!(check.status, DiagnosticStatus::Ok);
        assert!(check.message.contains(env!("CARGO_PKG_VERSION")));
    }

    #[test]
    fn test_run_and_format_diagnostics() {
        let report = run_diagnostics(&["definitely-not-a-language"], None, false);
        assert!(report.checks.len() >= 4);
        assert!(report.is_ok());
        let text = format_diagnostics(&report);
        assert!(text.contains("MAM SDK diagnostics"));
        assert!(text.contains("checks,"));
    }
}
