// Package mam provides a Go SDK for the MAM (Machine Agent Modules) specification.
//
// MAM transforms Markdown files into an executable intermediate representation
// that both humans and AI agents can understand.  A typical .mam.md file
// contains a YAML front matter block followed by named sections, some of which
// may embed code blocks.
//
// Quick start:
//
//	mod, err := mam.ParseFile("example.mam.md")
//	if err != nil { ... }
//
//	report := mam.NewValidator().Validate(mod)
//	if !report.Valid { ... }
//
//	results, err := mam.NewRuntime(mam.RuntimeConfig{}).ExecuteModule(ctx, mod)
//
package mam

import (
	"context"
	"fmt"
	"strings"
)

// Parse is a convenience wrapper that parses a .mam.md file at the given path.
func Parse(path string) (*Module, error) {
	return ParseFile(path)
}

// ParseString parses raw MAM content without touching the filesystem.
func ParseRaw(content string) (*Module, error) {
	return ParseString(content, "<string>")
}

// Validate is a convenience function that parses and validates a file in one
// call.
func Validate(path string) (*Module, *ValidationReport, error) {
	mod, err := ParseFile(path)
	if err != nil {
		return nil, nil, fmt.Errorf("parse: %w", err)
	}
	report := NewValidator().Validate(mod)
	return mod, report, nil
}

// Execute parses, validates, and runs all code blocks in a module.
func Execute(ctx context.Context, path string, cfg RuntimeConfig) ([]*ExecutionResult, *ValidationReport, error) {
	return ExecuteModuleFromPath(ctx, path, cfg)
}

// Version is the semantic version of this SDK.
const Version = "0.1.0"

// SDKName identifies this SDK in user agents and diagnostics.
const SDKName = "mam-go"

// UserAgent returns the SDK identifier string (e.g. "mam-go/0.1.0").
func UserAgent() string {
	return SDKName + "/" + Version
}

// ParseBytes parses raw MAM content supplied as bytes.
func ParseBytes(data []byte, filePath string) (*Module, error) {
	return ParseString(string(data), filePath)
}

// MustParse parses raw MAM content and panics on error. It is intended
// for tests and static fixtures, not production paths.
func MustParse(content string) *Module {
	mod, err := ParseString(content, "<string>")
	if err != nil {
		panic(err)
	}
	return mod
}

// IsValidModule reports whether the module is non-nil and passes validation.
func IsValidModule(mod *Module) bool {
	if mod == nil {
		return false
	}
	return NewValidator().Validate(mod).Valid
}

// ValidateModule validates an already-parsed module.
func ValidateModule(mod *Module) *ValidationReport {
	return NewValidator().Validate(mod)
}

// ModuleSummary returns a one-line human-readable summary of the module.
func ModuleSummary(mod *Module) string {
	if mod == nil {
		return "nil module"
	}
	title := ""
	if mod.FrontMatter != nil {
		title = mod.FrontMatter.Title
	}
	title = strings.TrimSpace(title)
	if title == "" {
		title = "(untitled)"
	}
	return fmt.Sprintf("%s: %d sections, %d code blocks", title, len(mod.Sections), len(mod.AllCodeBlocks()))
}
