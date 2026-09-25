//! Starter templates for the MAM Rust SDK.
//!
//! Provides ready-to-use MAM module skeletons for common module kinds, along
//! with placeholder rendering and name validation. Templates are plain strings
//! with `{{placeholder}}` markers, so they can be embedded in generators
//! without any additional machinery.

use std::collections::BTreeMap;
use std::fmt;

/// The canonical starter kinds.
pub const STARTER_KINDS: &[&str] = &["agent", "module", "tool"];

/// Maximum accepted starter name length.
pub const MAX_NAME_LENGTH: usize = 64;

/// Returns the canonical starter kinds, sorted.
pub fn list_starter_kinds() -> Vec<String> {
    let mut kinds: Vec<String> = STARTER_KINDS.iter().map(|kind| kind.to_string()).collect();
    kinds.sort();
    kinds
}

/// Resolves an alias to its canonical starter kind.
///
/// Returns an error for unknown kinds.
pub fn resolve_starter_kind(kind: &str) -> Result<String, String> {
    let candidate = kind.trim().to_lowercase();
    let resolved = match candidate.as_str() {
        "module" | "mod" | "package" | "lib" | "library" => "module",
        "agent" | "bot" | "assistant" | "plugin" => "agent",
        "tool" | "utility" | "util" | "cli" | "script" => "tool",
        _ => {
            return Err(format!(
                "Unknown starter kind '{}'. Known kinds: {}",
                kind,
                STARTER_KINDS.join(", ")
            ))
        }
    };
    Ok(resolved.to_string())
}

/// Returns the template for a starter kind or alias.
pub fn get_starter_template(kind: &str) -> Result<String, String> {
    let resolved = resolve_starter_kind(kind)?;
    let template = match resolved.as_str() {
        "module" => MODULE_TEMPLATE,
        "agent" => AGENT_TEMPLATE,
        _ => TOOL_TEMPLATE,
    };
    Ok(template.to_string())
}

fn is_identifier(text: &str) -> bool {
    let mut chars = text.chars();
    match chars.next() {
        Some(first) if first.is_ascii_alphabetic() || first == '_' => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Returns the placeholder names in a template, in first-seen order.
///
/// Only well-formed `{{identifier}}` markers are reported, so literal braces
/// in embedded code are ignored.
pub fn starter_variables(template: &str) -> Vec<String> {
    let chars: Vec<char> = template.chars().collect();
    let mut found: Vec<String> = Vec::new();
    let mut index = 0usize;
    while index + 1 < chars.len() {
        if chars[index] == '{' && chars[index + 1] == '{' {
            let mut cursor = index + 2;
            let mut name = String::new();
            let mut closed = false;
            while cursor + 1 < chars.len() {
                if chars[cursor] == '}' && chars[cursor + 1] == '}' {
                    closed = true;
                    break;
                }
                name.push(chars[cursor]);
                cursor += 1;
            }
            if closed {
                let trimmed = name.trim().to_string();
                if is_identifier(&trimmed) && !found.contains(&trimmed) {
                    found.push(trimmed);
                }
                index = cursor + 2;
                continue;
            }
        }
        index += 1;
    }
    found
}

/// Substitutes placeholders in a template.
///
/// Names match case-insensitively. A placeholder with no supplied value is left
/// untouched, so incomplete output stays obvious rather than silently blank.
/// Braces that are not a well-formed placeholder are copied verbatim.
pub fn render_starter(template: &str, variables: &BTreeMap<String, String>) -> String {
    let chars: Vec<char> = template.chars().collect();
    let lowered: BTreeMap<String, String> = variables
        .iter()
        .map(|(key, value)| (key.to_lowercase(), value.clone()))
        .collect();

    let mut output = String::new();
    let mut index = 0usize;
    while index < chars.len() {
        let starts_marker = index + 1 < chars.len() && chars[index] == '{' && chars[index + 1] == '{';
        if !starts_marker {
            output.push(chars[index]);
            index += 1;
            continue;
        }

        let mut cursor = index + 2;
        let mut name = String::new();
        let mut closed = false;
        while cursor + 1 < chars.len() {
            if chars[cursor] == '}' && chars[cursor + 1] == '}' {
                closed = true;
                break;
            }
            name.push(chars[cursor]);
            cursor += 1;
        }

        if !closed {
            output.push(chars[index]);
            index += 1;
            continue;
        }

        match lowered.get(&name.trim().to_lowercase()) {
            Some(value) => output.push_str(value),
            None => {
                output.push_str("{{");
                output.push_str(&name);
                output.push_str("}}");
            }
        }
        index = cursor + 2;
    }
    output
}

/// Returns a lowercase, dash-separated identifier derived from a name.
pub fn slugify(name: &str) -> String {
    let mut slug = String::new();
    let mut pending_dash = false;
    for character in name.trim().chars() {
        if character.is_ascii_alphanumeric() {
            if pending_dash && !slug.is_empty() {
                slug.push('-');
            }
            pending_dash = false;
            slug.push(character.to_ascii_lowercase());
        } else {
            pending_dash = true;
        }
    }
    slug
}

/// Validates a starter name and returns the problems found.
///
/// An empty vector means the name is acceptable.
pub fn validate_starter_name(name: &str) -> Vec<String> {
    let mut problems: Vec<String> = Vec::new();
    let candidate = name.trim();

    if candidate.is_empty() {
        problems.push("Starter name must not be empty".to_string());
        return problems;
    }
    if candidate.chars().count() > MAX_NAME_LENGTH {
        problems.push(format!(
            "Starter name must be at most {} characters",
            MAX_NAME_LENGTH
        ));
    }
    let first = candidate.chars().next().unwrap_or(' ');
    if !(first.is_ascii_alphanumeric() || first == '_') {
        problems.push("Starter name must start with a letter, digit, or underscore".to_string());
    }
    let invalid = candidate
        .chars()
        .any(|c| !(c.is_ascii_alphanumeric() || c == ' ' || c == '_' || c == '.' || c == '-'));
    if invalid {
        problems.push(
            "Starter name may only contain letters, digits, spaces, dots, dashes, and underscores"
                .to_string(),
        );
    }
    if slugify(candidate).is_empty() {
        problems.push("Starter name must contain at least one alphanumeric character".to_string());
    }
    problems
}

/// Returns the default variable map used by [`new_module_starter`].
pub fn default_variables(name: &str, runtime: &str) -> BTreeMap<String, String> {
    let mut variables = BTreeMap::new();
    variables.insert("id".to_string(), slugify(name));
    variables.insert("name".to_string(), name.trim().to_string());
    variables.insert("version".to_string(), "0.1.0".to_string());
    variables.insert("author".to_string(), "unknown".to_string());
    variables.insert("runtime".to_string(), runtime.to_string());
    variables.insert(
        "description".to_string(),
        format!("Describe what {} does.", name.trim()),
    );
    variables
}

/// Renders a complete starter module.
pub fn new_module_starter(name: &str, kind: &str, runtime: &str) -> Result<String, String> {
    let problems = validate_starter_name(name);
    if !problems.is_empty() {
        return Err(format!("Invalid starter name: {}", problems.join("; ")));
    }
    let template = get_starter_template(kind)?;
    let variables = default_variables(name, runtime);
    Ok(render_starter(&template, &variables))
}

/// Renders every starter kind for a name, for use in tests or scaffolding.
pub fn render_all_starters(name: &str, runtime: &str) -> Vec<(String, Result<String, String>)> {
    list_starter_kinds()
        .into_iter()
        .map(|kind| {
            let rendered = new_module_starter(name, &kind, runtime);
            (kind, rendered)
        })
        .collect()
}

impl fmt::Display for TemplateError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            TemplateError::UnknownKind(kind) => write!(f, "Unknown starter kind: {}", kind),
            TemplateError::InvalidName(problems) => {
                write!(f, "Invalid starter name: {}", problems.join("; "))
            }
        }
    }
}

/// Errors produced by the template module.
#[derive(Debug)]
pub enum TemplateError {
    /// The requested kind is not recognized.
    UnknownKind(String),
    /// The supplied name failed validation.
    InvalidName(Vec<String>),
}

impl std::error::Error for TemplateError {}

const MODULE_TEMPLATE: &str = r#"---
id: {{id}}
name: {{name}}
version: {{version}}
author: {{author}}
runtime: {{runtime}}
description: {{description}}
tags:
  - utility
---

## Purpose

{{description}}

## Inputs

Describe the inputs this module consumes.

## Outputs

Describe the outputs this module produces.

## Rules

- State the invariants this module must uphold.

## Workflow

1. Receive inputs
2. Validate inputs
3. Produce outputs

## Python

```python
def process(payload):
    # Process the payload and return the result.
    return {"payload": payload}
```

## Tests

```python
def test_process():
    assert process({"a": 1}) == {"a": 1}
```

## Exports

- `process`
"#;

const AGENT_TEMPLATE: &str = r#"---
id: {{id}}
name: {{name}}
version: {{version}}
author: {{author}}
runtime: python
description: {{description}}
tags:
  - agent
permissions:
  - read
---

## Purpose

{{name}} is an agent that {{description}}

## Role

You are {{name}}. Your job is to {{description}}

## Inputs

- The user request
- Relevant context supplied by the caller

## Outputs

- A clear, actionable response
- Supporting reasoning when asked

## Rules

- Never invent facts about the environment
- State uncertainty explicitly
- Prefer concise, structured answers

## Workflow

1. Understand the request
2. Identify the missing information
3. Respond with a concrete plan or answer

## Prompt

You are {{name}}. Respond to the user's request using the rules above.

## Permissions

- read

## Capabilities

- reason
- summarize
"#;

const TOOL_TEMPLATE: &str = r#"---
id: {{id}}
name: {{name}}
version: {{version}}
author: {{author}}
runtime: {{runtime}}
description: {{description}}
tags:
  - tool
---

## Purpose

{{description}}

## Capabilities

- Command line entry point
- Structured JSON output

## Inputs

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| `input` | string | yes | The value to transform |

## Outputs

| Name | Type | Description |
| --- | --- | --- |
| `result` | string | The transformed value |

## Rules

- Validate the format before processing
- Exit non-zero on invalid input

## Usage

```
{{id}} --input "value"
```

## Python

```python
import argparse
import json


def main():
    parser = argparse.ArgumentParser(prog="{{id}}")
    parser.add_argument("--input", required=True)
    parser.add_argument("--format", default="text", choices=["text", "json"])
    args = parser.parse_args()
    payload = {"input": args.input, "format": args.format}
    if args.format == "json":
        print(json.dumps(payload, indent=2))
    else:
        print(payload["input"])
    return 0
```

## Exports

- `main`
"#;

#[cfg(test)]
mod tests {
    use super::*;

    fn vars(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs
            .iter()
            .map(|(key, value)| (key.to_string(), value.to_string()))
            .collect()
    }

    #[test]
    fn test_list_starter_kinds() {
        assert_eq!(list_starter_kinds(), vec!["agent", "module", "tool"]);
    }

    #[test]
    fn test_templates_have_placeholders() {
        let template = get_starter_template("module").unwrap();
        assert!(template.contains("{{name}}"));
        assert!(template.contains("## Purpose"));
    }

    #[test]
    fn test_aliases_resolve() {
        assert_eq!(resolve_starter_kind("bot").unwrap(), "agent");
        assert_eq!(resolve_starter_kind("  MOD  ").unwrap(), "module");
        assert_eq!(resolve_starter_kind("cli").unwrap(), "tool");
        assert!(resolve_starter_kind("spaceship").is_err());
        assert!(resolve_starter_kind("").is_err());
    }

    #[test]
    fn test_render_substitutes_and_preserves() {
        assert_eq!(render_starter("Hi {{name}}!", &vars(&[("name", "MAM")])), "Hi MAM!");
        assert_eq!(render_starter("Hi {{missing}}!", &vars(&[])), "Hi {{missing}}!");
        assert_eq!(render_starter("{{Name}}", &vars(&[("name", "x")])), "x");
        assert_eq!(render_starter("", &vars(&[])), "");
    }

    #[test]
    fn test_render_leaves_literal_braces() {
        let rendered = render_starter("{{\"payload\": 1}}", &vars(&[("name", "x")]));
        assert_eq!(rendered, "{{\"payload\": 1}}");
        assert_eq!(render_starter("{single}", &vars(&[])), "{single}");
    }

    #[test]
    fn test_starter_variables() {
        assert_eq!(starter_variables("{{a}} {{b}} {{a}}"), vec!["a", "b"]);
        assert!(starter_variables("none").is_empty());
        assert!(starter_variables("").is_empty());
        assert!(starter_variables("{{\"payload\": 1}}").is_empty());
    }

    #[test]
    fn test_slugify() {
        assert_eq!(slugify("My Module"), "my-module");
        assert_eq!(slugify("A  B"), "a-b");
        assert_eq!(slugify("  "), "");
        assert_eq!(slugify("already-slug"), "already-slug");
    }

    #[test]
    fn test_validate_starter_name() {
        assert!(validate_starter_name("Good Name-1").is_empty());
        assert!(validate_starter_name("demo").is_empty());
        assert!(!validate_starter_name("   ").is_empty());
        assert!(!validate_starter_name("bad/name").is_empty());
        assert!(!validate_starter_name(&"a".repeat(MAX_NAME_LENGTH + 1)).is_empty());
        assert!(!validate_starter_name("!!!").is_empty());
    }

    #[test]
    fn test_new_module_starter_renders_completely() {
        let rendered = new_module_starter("Demo", "module", "python").unwrap();
        assert!(rendered.contains("id: demo"));
        assert!(rendered.contains("name: Demo"));
        assert!(rendered.contains("## Purpose"));
        assert!(starter_variables(&rendered).is_empty());
    }

    #[test]
    fn test_new_module_starter_kinds_and_errors() {
        assert!(new_module_starter("Bot", "agent", "python").unwrap().contains("## Role"));
        assert!(new_module_starter("Runner", "tool", "go").unwrap().contains("runtime: go"));
        assert!(new_module_starter("   ", "module", "python").is_err());
        assert!(new_module_starter("Demo", "spaceship", "python").is_err());
    }

    #[test]
    fn test_render_all_starters() {
        let rendered = render_all_starters("Demo", "python");
        assert_eq!(rendered.len(), 3);
        assert!(rendered.iter().all(|(_, outcome)| outcome.is_ok()));
    }

    #[test]
    fn test_error_display() {
        let unknown = TemplateError::UnknownKind("spaceship".to_string());
        assert!(format!("{}", unknown).contains("spaceship"));
        let invalid = TemplateError::InvalidName(vec!["too short".to_string()]);
        assert!(format!("{}", invalid).contains("too short"));
    }
}
