# MAM Go SDK

Go SDK for the **MAM (Markdown as Module)** specification.

> **Write once. Read by humans. Execute by agents.**

## Installation

```bash
go get github.com/LifeJiggy/MAM/sdk/go/mam
```

## Quick Start

```go
package main

import (
	"context"
	"fmt"
	"log"

	"github.com/LifeJiggy/MAM/sdk/go/mam"
)

func main() {
	// Parse a .mam.md file
	mod, err := mam.ParseFile("module.mam.md")
	if err != nil {
		log.Fatal(err)
	}

	// Validate the module
	report := mam.NewValidator().Validate(mod)
	if !report.Valid {
		for _, d := range report.Diagnostics {
			fmt.Printf("[%s] %s\n", d.Severity, d.Message)
		}
		return
	}

	// Execute all code blocks
	rt := mam.NewRuntime(mam.RuntimeConfig{
		Timeout: 30 * time.Second,
	})
	results, err := rt.ExecuteModule(context.Background(), mod)
	if err != nil {
		log.Fatal(err)
	}
	for _, r := range results {
		fmt.Printf("[%s] exit=%d stdout=%s\n", r.Language, r.ExitCode, r.Stdout)
	}
}
```

## Package Overview

| Package  | Description                                    |
|----------|------------------------------------------------|
| `mam`    | Convenience functions (Parse, Validate, Execute) |
| `mam`    | AST types (Module, Section, CodeBlock, etc.)    |
| `mam`    | Parser for `.mam.md` files                      |
| `mam`    | Validator with built-in and custom rules         |
| `mam`    | Runtime executor (code blocks via os/exec)       |
| `mam`    | Plugin interface and registry                    |

## AST Types

- `Module` — root node representing the entire file
- `FrontMatter` — YAML metadata block
- `Section` — a `## heading` section
- `CodeBlock` — a fenced code block with language tag
- `ContentNode` — base node with type and source location
- `SourceLocation` — file, line, column tracking

## Parser

```go
mod, err := mam.ParseFile("path/to/module.mam.md")
// or
mod, err := mam.ParseString(content, "input.md")
```

The parser extracts:
- YAML front matter (title, version, author, tags, custom metadata)
- Named sections (## heading)
- Fenced code blocks with language annotations

## Validator

```go
v := mam.NewValidator()

// Add a custom rule
v.AddRule(mam.ValidationRule{
	ID:          "no-draft-sections",
	Description: "Sections must not contain 'TODO' or 'DRAFT'",
	Check: func(mod *mam.Module) []mam.Diagnostic {
		// custom logic
	},
})

report := v.Validate(mod)
```

Built-in rules:
- `frontmatter-exists` — module must have YAML front matter
- `frontmatter-title` — front matter must include `title`
- `frontmatter-version` — front matter should include `version`
- `section-exists` — module must contain at least one section
- `purpose-section` — recommend a `purpose` section
- `section-level` — sections should use `##` headings
- `codeblock-language` — code blocks should specify a language

## Runtime

```go
rt := mam.NewRuntime(mam.RuntimeConfig{
	Timeout:          30 * time.Second,
	WorkingDir:       "/tmp",
	Env:              []string{"MY_VAR=value"},
	AllowedLanguages: []string{"python", "bash"},
})

results, err := rt.ExecuteModule(ctx, mod)
```

Supported languages: Python, JavaScript/Node, Go, Bash, Ruby, Perl.

## Plugin System

```go
registry := mam.NewPluginRegistry()

registry.Register(&mam.FuncPlugin{
	NameVal:    "logger",
	VersionVal: "1.0.0",
	HooksVal:   []mam.Hook{mam.HookBeforeExecute, mam.HookAfterExecute},
	Handler: func(h mam.Hook, ctx *mam.PluginContext) error {
		fmt.Printf("[logger] hook=%s module=%s\n", h, ctx.Module.Path)
		return nil
	},
})
```

Available hooks:
- `HookBeforeParse` / `HookAfterParse`
- `HookBeforeExecute` / `HookAfterExecute`
- `HookOnError`

## License

MIT
