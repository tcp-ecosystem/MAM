# MAM Rust SDK

Rust SDK for [MAM (Markdown as Module)](https://github.com/mam-project/mam) — parse, validate, and execute `.mam.md` modules.

## Installation

Add to your `Cargo.toml`:

```toml
[dependencies]
mam-sdk = "0.1.0"
```

Or from git:

```toml
[dependencies]
mam-sdk = { git = "https://github.com/mam-project/mam", path = "sdk/rust" }
```

## Quick Start

```rust
use mam::{parse, validate, execute};

fn main() {
    let input = r#"---
name: hello-world
version: 2.0.0
description: A simple hello world module
---

## Metadata

name: hello-world
version: 2.0.0

## Purpose

Demonstrate basic MAM module structure.

## Python

```python
print("Hello from MAM!")
```
"#;

    // Parse
    let module = parse(input).expect("Failed to parse");

    // Validate
    let result = validate(&module);
    println!("Valid: {}", result.is_valid);
    for diag in &result.diagnostics {
        println!("  {}", diag);
    }

    // Execute
    if result.is_valid {
        let outputs = execute(&module);
        for (section, output) in outputs {
            match output {
                Ok(result) => println!("[{}] exit={}, stdout={}", section, result.exit_code, result.stdout),
                Err(e) => println!("[{}] error: {}", section, e),
            }
        }
    }
}
```

## Features

### Parsing

Parse `.mam.md` files into a structured AST:

```rust
use mam::{Parser, Module};

let parser = Parser::new();
let module = parser.parse(content, Some("example.mam.md"))?;

// Access frontmatter
println!("Name: {:?}", module.frontmatter.name);
println!("Version: {:?}", module.frontmatter.version);

// Access sections
for section in &module.sections {
    println!("Section: {}", section.kind.as_str());
    println!("Content: {}", section.get_text_content());
}
```

### Validation

Validate module structure against the MAM spec:

```rust
use mam::{Validator, Severity};

let validator = Validator::new();
let result = validator.validate(&module);

if !result.is_valid {
    for error in result.errors() {
        eprintln!("Error: {}", error);
    }
}

// Custom strictness
let validator = Validator::new().strict(false);
let result = validator.validate(&module);
```

### Execution

Execute code blocks embedded in modules:

```rust
use mam::{Runtime, ExecutionConfig};
use std::collections::HashMap;

let mut config = ExecutionConfig::default();
config.timeout_ms = Some(5_000);
config.env.insert("API_KEY".to_string(), "secret".to_string());

let runtime = Runtime::with_config(config);

// Execute a specific section
let result = runtime.execute_section(&module, &SectionKind::Python)?;

// Execute all code blocks
let results = runtime.execute_all(&module);
```

### Plugins

Extend functionality with plugins:

```rust
use mam::{PluginRegistry, MetadataPlugin, PythonPlugin};

let mut registry = PluginRegistry::new();
registry.register(Box::new(MetadataPlugin));
registry.register(Box::new(PythonPlugin));

// Hook into the pipeline
let result = registry.execute_hook_before_parse(input)?;
let mut module = parse(&result)?;
registry.execute_hook_after_parse(&mut module)?;
```

## API Reference

### Types

| Type | Description |
|------|-------------|
| `Module` | Top-level parsed MAM module |
| `FrontMatter` | YAML frontmatter metadata |
| `Section` | A content section (## heading) |
| `SectionKind` | Enum of section types |
| `CodeBlock` | Embedded code block |
| `ContentNode` | AST content node |
| `SourceLocation` | Source position tracking |
| `Parser` | MAM file parser |
| `Validator` | Module structure validator |
| `Runtime` | Code execution engine |
| `PluginRegistry` | Plugin management |

### Error Types

| Type | Description |
|------|-------------|
| `ParseError` | Parser errors |
| `ValidationError` | Validator errors |
| `RuntimeError` | Execution errors |
| `PluginError` | Plugin errors |

## Section Types

MAM supports these built-in section types:

- `Metadata` — Module identity and version info
- `Purpose` — Module description and goals
- `Inputs` — Expected inputs and parameters
- `Outputs` — Expected outputs
- `Rules` — Behavior rules and constraints
- `Workflow` — Execution workflow steps
- `Python` — Python code blocks
- `Prompt` — LLM prompt templates
- `Memory` — Persistent state management
- `Examples` — Usage examples
- `Tests` — Test cases
- `References` — External references
- `Dependencies` — Module dependencies
- `Exports` — Exported symbols
- `Imports` — Imported symbols
- `Plugins` — Plugin configuration
- `Permissions` — Security permissions
- `Capabilities` — Required capabilities
- `Mermaid` — Diagram definitions

## Feature Flags

| Feature | Description |
|---------|-------------|
| `async-runtime` | Enable async execution with tokio |
| `plugin-dynamic` | Enable dynamic plugin loading with libloading |

## License

MIT
