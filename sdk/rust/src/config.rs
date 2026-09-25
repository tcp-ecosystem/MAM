//! SDK configuration for the MAM Rust SDK.
//!
//! Provides loading, validation, merging, and persistence of the SDK
//! configuration file (`mam.sdk.json`). Serialization uses `serde_json`, which
//! is already a declared dependency; nothing new is introduced here.

use std::collections::BTreeMap;
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};

/// Name of the configuration file.
pub const CONFIG_FILENAME: &str = "mam.sdk.json";

/// Supported execution targets, in canonical form.
pub const SUPPORTED_TARGETS: &[&str] = &[
    "go",
    "javascript",
    "markdown",
    "python",
    "rust",
    "shell",
    "typescript",
];

/// Returns true when the target is supported, accepting common aliases.
pub fn is_supported_target(target: &str) -> bool {
    !normalize_target(target).is_empty()
}

/// Returns the supported targets, sorted.
pub fn list_sdk_targets() -> Vec<String> {
    let mut targets: Vec<String> = SUPPORTED_TARGETS.iter().map(|t| t.to_string()).collect();
    targets.sort();
    targets
}

/// Maps a target alias to its canonical name.
///
/// Unknown values are returned lowercased and trimmed, so callers can still
/// report them; an empty input yields an empty string.
pub fn normalize_target(target: &str) -> String {
    let candidate = target.trim().to_lowercase();
    match candidate.as_str() {
        "py" | "python3" => "python".to_string(),
        "js" | "node" => "javascript".to_string(),
        "ts" => "typescript".to_string(),
        "golang" => "go".to_string(),
        "bash" | "sh" => "shell".to_string(),
        "md" => "markdown".to_string(),
        _ => candidate,
    }
}

/// Errors produced while loading or saving configuration.
#[derive(Debug)]
pub enum ConfigError {
    /// The requested file does not exist.
    NotFound(String),
    /// The file exists but could not be understood.
    Invalid(String),
    /// The file could not be read or written.
    Io(String),
}

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ConfigError::NotFound(path) => write!(f, "Config file not found: {}", path),
            ConfigError::Invalid(message) => write!(f, "Invalid config: {}", message),
            ConfigError::Io(message) => write!(f, "Config IO error: {}", message),
        }
    }
}

impl std::error::Error for ConfigError {}

/// Configuration for the MAM SDK.
#[derive(Debug, Clone, PartialEq)]
pub struct SdkConfig {
    /// Config schema version.
    pub version: String,
    /// Default working directory for module operations.
    pub work_dir: String,
    /// Default execution target language.
    pub target: String,
    /// Whether commands should emit verbose output.
    pub verbose: bool,
    /// Arbitrary additional settings, preserved across load and save.
    pub extra: BTreeMap<String, String>,
}

impl Default for SdkConfig {
    fn default() -> Self {
        Self {
            version: "1.0.0".to_string(),
            work_dir: ".".to_string(),
            target: "python".to_string(),
            verbose: false,
            extra: BTreeMap::new(),
        }
    }
}

impl SdkConfig {
    /// Returns the default configuration.
    pub fn new() -> Self {
        Self::default()
    }

    /// Returns an independent copy.
    pub fn copy_config(&self) -> Self {
        self.clone()
    }

    /// Looks up a setting, falling back to the `extra` map.
    pub fn get(&self, key: &str) -> Option<String> {
        match key {
            "version" => Some(self.version.clone()),
            "work_dir" => Some(self.work_dir.clone()),
            "target" => Some(self.target.clone()),
            "verbose" => Some(self.verbose.to_string()),
            other => self.extra.get(other).cloned(),
        }
    }

    /// Serializes the config as pretty-printed JSON.
    pub fn to_json(&self) -> String {
        let mut map = serde_json::Map::new();
        map.insert("version".to_string(), serde_json::Value::String(self.version.clone()));
        map.insert("work_dir".to_string(), serde_json::Value::String(self.work_dir.clone()));
        map.insert("target".to_string(), serde_json::Value::String(self.target.clone()));
        map.insert("verbose".to_string(), serde_json::Value::Bool(self.verbose));
        for (key, value) in &self.extra {
            map.insert(key.clone(), serde_json::Value::String(value.clone()));
        }
        match serde_json::to_string_pretty(&serde_json::Value::Object(map)) {
            Ok(text) => text,
            Err(_) => "{}".to_string(),
        }
    }

    /// Builds a config from a JSON value.
    pub fn from_json_value(value: &serde_json::Value) -> Result<Self, ConfigError> {
        let object = match value.as_object() {
            Some(object) => object,
            None => {
                return Err(ConfigError::Invalid(
                    "config must be a JSON object".to_string(),
                ))
            }
        };

        let defaults = SdkConfig::default();
        let known = ["version", "work_dir", "target", "verbose"];

        let mut extra: BTreeMap<String, String> = BTreeMap::new();
        for (key, item) in object {
            if known.contains(&key.as_str()) {
                continue;
            }
            let rendered = match item {
                serde_json::Value::String(text) => text.clone(),
                other => other.to_string(),
            };
            extra.insert(key.clone(), rendered);
        }

        let version = match object.get("version").and_then(|item| item.as_str()) {
            Some(text) if !text.trim().is_empty() => text.to_string(),
            _ => defaults.version.clone(),
        };
        let work_dir = match object.get("work_dir").and_then(|item| item.as_str()) {
            Some(text) if !text.trim().is_empty() => text.to_string(),
            _ => defaults.work_dir.clone(),
        };
        let target = match object.get("target").and_then(|item| item.as_str()) {
            Some(text) if !text.trim().is_empty() => normalize_target(text),
            _ => defaults.target.clone(),
        };
        let verbose = object
            .get("verbose")
            .and_then(|item| item.as_bool())
            .unwrap_or(false);

        Ok(SdkConfig {
            version,
            work_dir,
            target,
            verbose,
            extra,
        })
    }
}

/// Validates a config and returns human-readable problems.
///
/// An empty vector means the config is valid.
pub fn validate_sdk_config(config: &SdkConfig) -> Vec<String> {
    let mut problems: Vec<String> = Vec::new();

    if config.version.trim().is_empty() {
        problems.push("field 'version' must not be empty".to_string());
    } else if config.version.split('.').count() < 2 {
        problems.push(format!(
            "field 'version' should look like a semantic version, got '{}'",
            config.version
        ));
    }

    if config.work_dir.trim().is_empty() {
        problems.push("field 'work_dir' must not be empty".to_string());
    }

    if config.target.trim().is_empty() {
        problems.push("field 'target' must not be empty".to_string());
    } else if !SUPPORTED_TARGETS.contains(&config.target.as_str()) {
        problems.push(format!(
            "field 'target' must be one of {}, got '{}'",
            list_sdk_targets().join(", "),
            config.target
        ));
    }

    problems
}

/// Merges two configs, with `override` winning for populated fields.
///
/// Neither input is modified. `extra` entries from both sides are combined,
/// with the override winning on conflicts.
pub fn merge_sdk_configs(base: &SdkConfig, over: &SdkConfig) -> SdkConfig {
    let mut extra = base.extra.clone();
    for (key, value) in &over.extra {
        extra.insert(key.clone(), value.clone());
    }
    SdkConfig {
        version: if over.version.trim().is_empty() {
            base.version.clone()
        } else {
            over.version.clone()
        },
        work_dir: if over.work_dir.trim().is_empty() {
            base.work_dir.clone()
        } else {
            over.work_dir.clone()
        },
        target: if over.target.trim().is_empty() {
            base.target.clone()
        } else {
            over.target.clone()
        },
        verbose: over.verbose || base.verbose,
        extra,
    }
}

/// Searches for a config file by walking up from `start`.
///
/// Returns the first config found, or `None` when no parent directory holds one.
pub fn find_sdk_config(start: Option<&Path>) -> Option<PathBuf> {
    let begin = match start {
        Some(path) => {
            if path.is_dir() {
                path.to_path_buf()
            } else {
                path.parent()?.to_path_buf()
            }
        }
        None => std::env::current_dir().ok()?,
    };

    for directory in begin.ancestors() {
        let candidate = directory.join(CONFIG_FILENAME);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// Returns the path a config would be read from or written to.
///
/// `work_dir` is treated as a directory. When it is `None`, the
/// `MAM_SDK_CONFIG` environment variable wins, then the nearest config found by
/// walking up, then the current directory.
pub fn resolve_sdk_config_path(work_dir: Option<&str>) -> PathBuf {
    if let Some(dir) = work_dir {
        if !dir.trim().is_empty() {
            return Path::new(dir).join(CONFIG_FILENAME);
        }
    }
    if let Ok(env_path) = std::env::var("MAM_SDK_CONFIG") {
        if !env_path.trim().is_empty() {
            return PathBuf::from(env_path);
        }
    }
    if let Some(found) = find_sdk_config(None) {
        return found;
    }
    match std::env::current_dir() {
        Ok(dir) => dir.join(CONFIG_FILENAME),
        Err(_) => PathBuf::from(CONFIG_FILENAME),
    }
}

/// Loads a config from disk.
///
/// When `path` is `None` the config is discovered via
/// [`resolve_sdk_config_path`]; if none exists the defaults are returned. When
/// `path` is given explicitly and is missing, [`ConfigError::NotFound`] is
/// returned.
pub fn load_sdk_config(path: Option<&Path>) -> Result<SdkConfig, ConfigError> {
    let explicit = path.is_some();
    let target = match path {
        Some(given) => given.to_path_buf(),
        None => match find_sdk_config(None) {
            Some(found) => found,
            None => {
                let env_candidate = std::env::var("MAM_SDK_CONFIG")
                    .ok()
                    .filter(|value| !value.trim().is_empty())
                    .map(PathBuf::from);
                match env_candidate {
                    Some(candidate) if candidate.is_file() => candidate,
                    _ => return Ok(SdkConfig::default()),
                }
            }
        },
    };

    if !target.is_file() {
        if explicit {
            return Err(ConfigError::NotFound(target.display().to_string()));
        }
        return Ok(SdkConfig::default());
    }

    let raw = fs::read_to_string(&target)
        .map_err(|error| ConfigError::Io(format!("{}: {}", target.display(), error)))?;

    if raw.trim().is_empty() {
        return Ok(SdkConfig::default());
    }

    let value: serde_json::Value = serde_json::from_str(&raw).map_err(|error| {
        ConfigError::Invalid(format!("{} is not valid JSON: {}", target.display(), error))
    })?;

    let config = SdkConfig::from_json_value(&value)?;
    let problems = validate_sdk_config(&config);
    if !problems.is_empty() {
        return Err(ConfigError::Invalid(format!(
            "{}: {}",
            target.display(),
            problems.join("; ")
        )));
    }
    Ok(config)
}

/// Writes a config to disk and returns the path written.
///
/// Parent directories are created as needed. The write is refused when the
/// config fails validation.
pub fn save_sdk_config(config: &SdkConfig, path: Option<&Path>) -> Result<String, ConfigError> {
    let problems = validate_sdk_config(config);
    if !problems.is_empty() {
        return Err(ConfigError::Invalid(format!(
            "refusing to save invalid config: {}",
            problems.join("; ")
        )));
    }

    let destination = match path {
        Some(given) => given.to_path_buf(),
        None => resolve_sdk_config_path(None),
    };

    if let Some(parent) = destination.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|error| ConfigError::Io(format!("{}: {}", parent.display(), error)))?;
        }
    }

    let rendered = format!("{}\n", config.to_json());
    fs::write(&destination, rendered)
        .map_err(|error| ConfigError::Io(format!("{}: {}", destination.display(), error)))?;
    Ok(destination.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let unique = format!(
            "mam-rust-config-{}-{}",
            tag,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        );
        let dir = std::env::temp_dir().join(unique);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn test_default_config_is_valid() {
        let config = SdkConfig::default();
        assert!(validate_sdk_config(&config).is_empty());
        assert_eq!(config.target, "python");
    }

    #[test]
    fn test_targets_and_aliases() {
        assert!(is_supported_target("python"));
        assert!(is_supported_target("golang"));
        assert!(is_supported_target("  JS "));
        assert!(!is_supported_target("cobol"));
        assert!(!is_supported_target(""));
        assert!(list_sdk_targets().contains(&"go".to_string()));
    }

    #[test]
    fn test_validation_reports_problems() {
        let mut config = SdkConfig::default();
        config.target = "cobol".to_string();
        config.work_dir = String::new();
        let problems = validate_sdk_config(&config);
        assert!(problems.iter().any(|p| p.contains("cobol")));
        assert!(problems.iter().any(|p| p.contains("work_dir")));
    }

    #[test]
    fn test_merge_does_not_mutate_inputs() {
        let base = SdkConfig::default();
        let mut over = SdkConfig::default();
        over.target = "go".to_string();
        over.extra.insert("team".to_string(), "core".to_string());
        let merged = merge_sdk_configs(&base, &over);
        assert_eq!(merged.target, "go");
        assert_eq!(merged.extra.get("team").map(String::as_str), Some("core"));
        assert_eq!(base.target, "python");
        assert!(base.extra.is_empty());
    }

    #[test]
    fn test_json_round_trip() {
        let mut config = SdkConfig::default();
        config.target = "rust".to_string();
        config.verbose = true;
        config.extra.insert("team".to_string(), "core".to_string());
        let value: serde_json::Value = serde_json::from_str(&config.to_json()).unwrap();
        let restored = SdkConfig::from_json_value(&value).unwrap();
        assert_eq!(restored.target, "rust");
        assert!(restored.verbose);
        assert_eq!(restored.extra.get("team").map(String::as_str), Some("core"));
    }

    #[test]
    fn test_json_rejects_non_object() {
        let value = serde_json::json!([1, 2, 3]);
        assert!(SdkConfig::from_json_value(&value).is_err());
    }

    #[test]
    fn test_save_and_load_round_trip() {
        let dir = temp_dir("roundtrip");
        let path = dir.join(CONFIG_FILENAME);
        let mut config = SdkConfig::default();
        config.target = "go".to_string();
        let written = save_sdk_config(&config, Some(&path)).unwrap();
        assert_eq!(written, path.display().to_string());
        let loaded = load_sdk_config(Some(&path)).unwrap();
        assert_eq!(loaded.target, "go");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_load_missing_explicit_path_errors() {
        let dir = temp_dir("missing");
        let missing = dir.join("nope.json");
        assert!(load_sdk_config(Some(&missing)).is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_save_invalid_config_is_refused() {
        let dir = temp_dir("invalid");
        let mut config = SdkConfig::default();
        config.target = "cobol".to_string();
        let path = dir.join(CONFIG_FILENAME);
        assert!(save_sdk_config(&config, Some(&path)).is_err());
        assert!(!path.exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_find_config_walks_up() {
        let dir = temp_dir("walkup");
        fs::write(
            dir.join(CONFIG_FILENAME),
            "{\"target\": \"rust\"}".to_string(),
        )
        .unwrap();
        let nested = dir.join("a").join("b");
        fs::create_dir_all(&nested).unwrap();
        let found = find_sdk_config(Some(&nested));
        assert_eq!(found, Some(dir.join(CONFIG_FILENAME)));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_resolve_path_uses_work_dir() {
        let resolved = resolve_sdk_config_path(Some("some-dir"));
        assert!(resolved.ends_with(CONFIG_FILENAME));
        assert!(resolved.parent().map(|p| p.ends_with("some-dir")).unwrap_or(false));
    }

    #[test]
    fn test_get_reads_extra() {
        let mut config = SdkConfig::default();
        config.extra.insert("custom".to_string(), "7".to_string());
        assert_eq!(config.get("custom"), Some("7".to_string()));
        assert_eq!(config.get("target"), Some("python".to_string()));
        assert_eq!(config.get("absent"), None);
    }
}
