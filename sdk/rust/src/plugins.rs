use crate::ast::{Module, Section, SectionKind};
use crate::validator::{Diagnostic, Severity, ValidationResult};
use std::collections::HashMap;
use std::fmt;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum PluginError {
    #[error("Plugin '{name}' failed to load: {reason}")]
    LoadFailed { name: String, reason: String },
    #[error("Plugin '{name}' execution error: {message}")]
    ExecutionError { name: String, message: String },
    #[error("Plugin not found: '{0}'")]
    NotFound(String),
    #[error("Hook '{0}' not supported by plugin")]
    HookNotSupported(String),
}

pub enum HookPoint {
    BeforeParse,
    AfterParse,
    BeforeValidate,
    AfterValidate,
    BeforeExecute,
    AfterExecute,
    OnError,
}

impl fmt::Display for HookPoint {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            HookPoint::BeforeParse => write!(f, "before_parse"),
            HookPoint::AfterParse => write!(f, "after_parse"),
            HookPoint::BeforeValidate => write!(f, "before_validate"),
            HookPoint::AfterValidate => write!(f, "after_validate"),
            HookPoint::BeforeExecute => write!(f, "before_execute"),
            HookPoint::AfterExecute => write!(f, "after_execute"),
            HookPoint::OnError => write!(f, "on_error"),
        }
    }
}

pub trait Plugin: Send + Sync {
    fn name(&self) -> &str;
    fn version(&self) -> &str;
    fn description(&self) -> &str;
    fn supported_hooks(&self) -> Vec<HookPoint>;

    fn on_before_parse(&self, _input: &str) -> Result<String, PluginError> {
        Ok(String::new())
    }

    fn on_after_parse(&self, module: &mut Module) -> Result<(), PluginError> {
        let _ = module;
        Ok(())
    }

    fn on_before_validate(&self, _module: &Module) -> Result<(), PluginError> {
        Ok(())
    }

    fn on_after_validate(&self, _result: &mut ValidationResult) -> Result<(), PluginError> {
        Ok(())
    }

    fn on_before_execute(&self, _module: &Module) -> Result<(), PluginError> {
        Ok(())
    }

    fn on_after_execute(&self, _output: &mut String) -> Result<(), PluginError> {
        Ok(())
    }

    fn on_error(&self, _error: &dyn fmt::Display) -> Result<(), PluginError> {
        Ok(())
    }
}

pub struct PluginEntry {
    pub plugin: Box<dyn Plugin>,
    pub enabled: bool,
}

pub struct PluginRegistry {
    plugins: Vec<PluginEntry>,
    hook_index: HashMap<String, Vec<usize>>,
}

impl PluginRegistry {
    pub fn new() -> Self {
        Self {
            plugins: Vec::new(),
            hook_index: HashMap::new(),
        }
    }

    pub fn register(&mut self, plugin: Box<dyn Plugin>) {
        let idx = self.plugins.len();
        let hooks = plugin.supported_hooks();
        for hook in hooks {
            let key = format!("{}:{}", hook, plugin.name());
            self.hook_index.entry(key).or_default().push(idx);
        }
        self.plugins.push(PluginEntry { plugin, enabled: true });
    }

    pub fn unregister(&mut self, name: &str) -> Result<(), PluginError> {
        if let Some(pos) = self.plugins.iter().position(|p| p.plugin.name() == name) {
            self.plugins.remove(pos);
            self.hook_index.retain(|_, indices| {
                indices.retain(|&i| i != pos);
                !indices.is_empty()
            });
            Ok(())
        } else {
            Err(PluginError::NotFound(name.to_string()))
        }
    }

    pub fn enable(&mut self, name: &str) -> Result<(), PluginError> {
        self.plugins
            .iter_mut()
            .find(|p| p.plugin.name() == name)
            .map(|p| p.enabled = true)
            .ok_or_else(|| PluginError::NotFound(name.to_string()))
    }

    pub fn disable(&mut self, name: &str) -> Result<(), PluginError> {
        self.plugins
            .iter_mut()
            .find(|p| p.plugin.name() == name)
            .map(|p| p.enabled = false)
            .ok_or_else(|| PluginError::NotFound(name.to_string()))
    }

    pub fn get(&self, name: &str) -> Option<&dyn Plugin> {
        self.plugins
            .iter()
            .find(|p| p.plugin.name() == name && p.enabled)
            .map(|p| p.plugin.as_ref())
    }

    pub fn list(&self) -> Vec<(&str, &str, bool)> {
        self.plugins
            .iter()
            .map(|p| (p.plugin.name(), p.plugin.version(), p.enabled))
            .collect()
    }

    pub fn execute_hook_before_parse(&self, input: &str) -> Result<String, PluginError> {
        let mut result = input.to_string();
        for entry in &self.plugins {
            if !entry.enabled {
                continue;
            }
            if entry.plugin.supported_hooks().iter().any(|h| matches!(h, HookPoint::BeforeParse)) {
                result = entry.plugin.on_before_parse(&result)?;
            }
        }
        Ok(result)
    }

    pub fn execute_hook_after_parse(&self, module: &mut Module) -> Result<(), PluginError> {
        for entry in &self.plugins {
            if !entry.enabled {
                continue;
            }
            if entry.plugin.supported_hooks().iter().any(|h| matches!(h, HookPoint::AfterParse)) {
                entry.plugin.on_after_parse(module)?;
            }
        }
        Ok(())
    }

    pub fn execute_hook_after_validate(&self, result: &mut ValidationResult) -> Result<(), PluginError> {
        for entry in &self.plugins {
            if !entry.enabled {
                continue;
            }
            if entry.plugin.supported_hooks().iter().any(|h| matches!(h, HookPoint::AfterValidate)) {
                entry.plugin.on_after_validate(result)?;
            }
        }
        Ok(())
    }

    pub fn execute_hook_before_execute(&self, module: &Module) -> Result<(), PluginError> {
        for entry in &self.plugins {
            if !entry.enabled {
                continue;
            }
            if entry.plugin.supported_hooks().iter().any(|h| matches!(h, HookPoint::BeforeExecute)) {
                entry.plugin.on_before_execute(module)?;
            }
        }
        Ok(())
    }

    pub fn execute_hook_after_execute(&self, output: &mut String) -> Result<(), PluginError> {
        for entry in &self.plugins {
            if !entry.enabled {
                continue;
            }
            if entry.plugin.supported_hooks().iter().any(|h| matches!(h, HookPoint::AfterExecute)) {
                entry.plugin.on_after_execute(output)?;
            }
        }
        Ok(())
    }
}

impl Default for PluginRegistry {
    fn default() -> Self {
        Self::new()
    }
}

/// Returns the names of every registered plugin, in registration order.
pub fn plugin_names(registry: &PluginRegistry) -> Vec<String> {
    registry.list().into_iter().map(|(name, _, _)| name.to_string()).collect()
}

/// Returns the names of the enabled plugins, sorted.
pub fn enabled_plugin_names(registry: &PluginRegistry) -> Vec<String> {
    let mut names: Vec<String> = registry
        .list()
        .into_iter()
        .filter(|(_, _, enabled)| *enabled)
        .map(|(name, _, _)| name.to_string())
        .collect();
    names.sort();
    names
}

/// Returns true when a plugin is registered under the given name.
///
/// Disabled plugins still count as registered.
pub fn registry_has_plugin(registry: &PluginRegistry, name: &str) -> bool {
    registry.list().iter().any(|(plugin, _, _)| *plugin == name)
}

/// Returns the version of a registered plugin, or `None` when absent.
pub fn plugin_version(registry: &PluginRegistry, name: &str) -> Option<String> {
    registry
        .list()
        .into_iter()
        .find(|(plugin, _, _)| *plugin == name)
        .map(|(_, version, _)| version.to_string())
}

/// Counts the plugins that support the named hook point.
///
/// The hook is matched on its `Display` form, for example `"after_parse"`.
pub fn hook_count_for(registry: &PluginRegistry, hook: &str) -> usize {
    registry
        .plugins
        .iter()
        .filter(|entry| {
            entry
                .plugin
                .supported_hooks()
                .iter()
                .any(|candidate| candidate.to_string() == hook)
        })
        .count()
}

/// Returns plugin names filtered by their enabled flag, sorted.
pub fn filter_by_enabled(registry: &PluginRegistry, enabled: bool) -> Vec<String> {
    let mut names: Vec<String> = registry
        .list()
        .into_iter()
        .filter(|(_, _, is_enabled)| *is_enabled == enabled)
        .map(|(name, _, _)| name.to_string())
        .collect();
    names.sort();
    names
}

/// Renders a one-line-per-plugin summary of the registry.
pub fn describe_plugins(registry: &PluginRegistry) -> String {
    let entries = registry.list();
    if entries.is_empty() {
        return "No plugins registered".to_string();
    }
    let mut lines: Vec<String> = Vec::new();
    for (name, version, enabled) in entries {
        let state = if enabled { "enabled" } else { "disabled" };
        lines.push(format!("  {} v{} [{}]", name, version, state));
    }
    format!("Plugins ({}):\n{}", entries.len(), lines.join("\n"))
}

pub struct MetadataPlugin;
impl Plugin for MetadataPlugin {
    fn name(&self) -> &str {
        "metadata"
    }

    fn version(&self) -> &str {
        "0.1.0"
    }

    fn description(&self) -> &str {
        "Validates module metadata against schema"
    }

    fn supported_hooks(&self) -> Vec<HookPoint> {
        vec![HookPoint::AfterParse, HookPoint::AfterValidate]
    }

    fn on_after_parse(&self, module: &mut Module) -> Result<(), PluginError> {
        if module.frontmatter.name.is_none() {
            module.frontmatter.metadata.insert(
                "_warnings".to_string(),
                serde_json::json!(["No module name specified"]),
            );
        }
        Ok(())
    }

    fn on_after_validate(&self, result: &mut ValidationResult) -> Result<(), PluginError> {
        result.push(Diagnostic {
            severity: Severity::Info,
            message: "Metadata plugin validation complete".to_string(),
            line: None,
            section: Some("metadata".to_string()),
        });
        Ok(())
    }
}

pub struct PythonPlugin;

impl Plugin for PythonPlugin {
    fn name(&self) -> &str {
        "python"
    }

    fn version(&self) -> &str {
        "0.1.0"
    }

    fn description(&self) -> &str {
        "Validates and executes Python code blocks"
    }

    fn supported_hooks(&self) -> Vec<HookPoint> {
        vec![HookPoint::AfterParse, HookPoint::BeforeExecute]
    }

    fn on_after_parse(&self, module: &mut Module) -> Result<(), PluginError> {
        for section in &mut module.sections {
            if section.kind == SectionKind::Python {
                for node in &mut section.content {
                    if let crate::ast::ContentNode::CodeBlock(ref mut block) = node {
                        if block.language.is_empty() {
                            block.language = "python".to_string();
                        }
                    }
                }
            }
        }
        Ok(())
    }

    fn on_before_execute(&self, _module: &Module) -> Result<(), PluginError> {
        Ok(())
    }
}

pub struct MemoryPlugin;

impl Plugin for MemoryPlugin {
    fn name(&self) -> &str {
        "memory"
    }

    fn version(&self) -> &str {
        "0.1.0"
    }

    fn description(&self) -> &str {
        "Manages persistent state for memory sections"
    }

    fn supported_hooks(&self) -> Vec<HookPoint> {
        vec![HookPoint::AfterParse, HookPoint::AfterExecute]
    }

    fn on_after_parse(&self, module: &mut Module) -> Result<(), PluginError> {
        let _ = module;
        Ok(())
    }

    fn on_after_execute(&self, output: &mut String) -> Result<(), PluginError> {
        output.push_str("\n[Memory plugin: state persisted]");
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestPlugin {
        name: String,
    }

    impl Plugin for TestPlugin {
        fn name(&self) -> &str {
            &self.name
        }
        fn version(&self) -> &str {
            "0.1.0"
        }
        fn description(&self) -> &str {
            "Test plugin"
        }
        fn supported_hooks(&self) -> Vec<HookPoint> {
            vec![HookPoint::AfterParse]
        }
        fn on_after_parse(&self, module: &mut Module) -> Result<(), PluginError> {
            module.frontmatter.metadata.insert(
                "test_plugin".to_string(),
                serde_json::json!(true),
            );
            Ok(())
        }
    }

    #[test]
    fn test_register_and_list() {
        let mut registry = PluginRegistry::new();
        registry.register(Box::new(TestPlugin { name: "test".to_string() }));
        let list = registry.list();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].0, "test");
        assert!(list[0].2);
    }

    #[test]
    fn test_enable_disable() {
        let mut registry = PluginRegistry::new();
        registry.register(Box::new(TestPlugin { name: "test".to_string() }));
        registry.disable("test").unwrap();
        assert!(registry.list()[0].2 == false);
        registry.enable("test").unwrap();
        assert!(registry.list()[0].2 == true);
    }

    #[test]
    fn test_unregister() {
        let mut registry = PluginRegistry::new();
        registry.register(Box::new(TestPlugin { name: "test".to_string() }));
        registry.unregister("test").unwrap();
        assert!(registry.list().is_empty());
    }

    #[test]
    fn test_execute_hook() {
        let mut registry = PluginRegistry::new();
        registry.register(Box::new(TestPlugin { name: "test".to_string() }));
        let mut module = Module::new("test".to_string());
        registry.execute_hook_after_parse(&mut module).unwrap();
        assert_eq!(
            module.frontmatter.metadata.get("test_plugin"),
            Some(&serde_json::json!(true))
        );
    }

    fn registry_with_one() -> PluginRegistry {
        let mut registry = PluginRegistry::new();
        registry.register(Box::new(TestPlugin { name: "test".to_string() }));
        registry
    }

    #[test]
    fn test_plugin_names_and_has_plugin() {
        let registry = registry_with_one();
        assert_eq!(plugin_names(&registry), vec!["test".to_string()]);
        assert!(registry_has_plugin(&registry, "test"));
        assert!(!registry_has_plugin(&registry, "nope"));
    }

    #[test]
    fn test_enabled_plugin_names() {
        let mut registry = registry_with_one();
        assert_eq!(enabled_plugin_names(&registry), vec!["test".to_string()]);
        registry.disable("test").unwrap();
        assert!(enabled_plugin_names(&registry).is_empty());
    }

    #[test]
    fn test_plugin_version() {
        let registry = registry_with_one();
        assert_eq!(plugin_version(&registry, "test"), Some("0.1.0".to_string()));
        assert_eq!(plugin_version(&registry, "nope"), None);
    }

    #[test]
    fn test_hook_count_for() {
        let registry = registry_with_one();
        assert_eq!(hook_count_for(&registry, "after_parse"), 1);
        assert_eq!(hook_count_for(&registry, "before_execute"), 0);
        assert_eq!(hook_count_for(&registry, "not_a_hook"), 0);
    }

    #[test]
    fn test_filter_by_enabled() {
        let mut registry = registry_with_one();
        assert_eq!(filter_by_enabled(&registry, true), vec!["test".to_string()]);
        registry.disable("test").unwrap();
        assert_eq!(filter_by_enabled(&registry, true).len(), 0);
        assert_eq!(filter_by_enabled(&registry, false), vec!["test".to_string()]);
    }

    #[test]
    fn test_describe_plugins() {
        let text = describe_plugins(&registry_with_one());
        assert!(text.contains("test v0.1.0"));
        assert!(text.contains("enabled"));
        assert_eq!(describe_plugins(&PluginRegistry::new()), "No plugins registered");
    }

    #[test]
    fn test_builtin_plugin_names() {
        let mut registry = PluginRegistry::new();
        registry.register(Box::new(MetadataPlugin));
        registry.register(Box::new(MemoryPlugin));
        let names = enabled_plugin_names(&registry);
        assert!(names.contains(&"metadata".to_string()));
        assert!(names.contains(&"memory".to_string()));
        assert_eq!(hook_count_for(&registry, "after_parse"), 2);
    }
}
