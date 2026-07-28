// Package mam provides a Go SDK for the MAM (Markdown as Module) specification.
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
