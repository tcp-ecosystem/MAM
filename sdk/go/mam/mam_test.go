package mam

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

// createTempMAMFile is a helper shared across test files.
func createTempMAMFile(t *testing.T, content string) string {
	t.Helper()
	tmpFile := filepath.Join(t.TempDir(), "test.mam.md")
	if err := os.WriteFile(tmpFile, []byte(content), 0644); err != nil {
		t.Fatalf("failed to write temp file: %v", err)
	}
	return tmpFile
}

func TestParseConvenience(t *testing.T) {
	content := `---
title: Convenience Parse
version: 1.0.0
---

## Purpose
Parsed via convenience function.
`
	tmpFile := createTempMAMFile(t, content)
	mod, err := Parse(tmpFile)
	if err != nil {
		t.Fatalf("Parse() error: %v", err)
	}
	if mod.FrontMatter == nil {
		t.Fatal("expected non-nil FrontMatter")
	}
	if mod.FrontMatter.Title != "Convenience Parse" {
		t.Errorf("Title = %q, want %q", mod.FrontMatter.Title, "Convenience Parse")
	}
	if len(mod.Sections) != 1 {
		t.Fatalf("Sections len = %d, want 1", len(mod.Sections))
	}
	if mod.Sections[0].Title != "Purpose" {
		t.Errorf("Sections[0].Title = %q, want %q", mod.Sections[0].Title, "Purpose")
	}
}

func TestParseConvenienceNotFound(t *testing.T) {
	_, err := Parse("/nonexistent/path.mam.md")
	if err == nil {
		t.Fatal("expected error for nonexistent file")
	}
}

func TestParseRawConvenience(t *testing.T) {
	content := `---
title: Raw Parse
version: 2.0.0
---

## Purpose
Parsed via ParseRaw.
`
	mod, err := ParseRaw(content)
	if err != nil {
		t.Fatalf("ParseRaw() error: %v", err)
	}
	if mod.FrontMatter == nil {
		t.Fatal("expected non-nil FrontMatter")
	}
	if mod.FrontMatter.Title != "Raw Parse" {
		t.Errorf("Title = %q, want %q", mod.FrontMatter.Title, "Raw Parse")
	}
	if mod.FrontMatter.Version != "2.0.0" {
		t.Errorf("Version = %q, want %q", mod.FrontMatter.Version, "2.0.0")
	}
	if len(mod.Sections) != 1 {
		t.Fatalf("Sections len = %d, want 1", len(mod.Sections))
	}
}

func TestParseRawEmpty(t *testing.T) {
	mod, err := ParseRaw("")
	if err != nil {
		t.Fatalf("ParseRaw() error: %v", err)
	}
	if mod == nil {
		t.Fatal("ParseRaw() returned nil module")
	}
	if mod.FrontMatter != nil {
		t.Error("expected nil FrontMatter for empty input")
	}
}

func TestValidateConvenience(t *testing.T) {
	content := `---
title: Validate Convenience
version: 1.0.0
---

## Purpose
Valid module.
`
	tmpFile := createTempMAMFile(t, content)
	mod, report, err := Validate(tmpFile)
	if err != nil {
		t.Fatalf("Validate() error: %v", err)
	}
	if mod == nil {
		t.Fatal("Validate() returned nil module")
	}
	if report == nil {
		t.Fatal("Validate() returned nil report")
	}
	if !report.Valid {
		t.Errorf("expected valid report, got %d diagnostics", len(report.Diagnostics))
		for _, d := range report.Diagnostics {
			t.Logf("  [%s] %s", d.Severity, d.Message)
		}
	}
}

func TestValidateConvenienceInvalid(t *testing.T) {
	content := `---
version: 1.0.0
---

## Purpose
Missing title.
`
	tmpFile := createTempMAMFile(t, content)
	_, report, err := Validate(tmpFile)
	if err != nil {
		t.Fatalf("Validate() error: %v", err)
	}
	if report.Valid {
		t.Error("expected invalid report for missing title")
	}
}

func TestValidateConvenienceNotFound(t *testing.T) {
	_, _, err := Validate("/nonexistent/path.mam.md")
	if err == nil {
		t.Fatal("expected error for nonexistent file")
	}
}

func TestExecuteConvenience(t *testing.T) {
	content := `---
title: Execute Convenience
version: 1.0.0
---

## Purpose
Test execution convenience.

## Python
` + "```python" + `
print('convenience executed')
` + "```" + `
`
	tmpFile := createTempMAMFile(t, content)
	ctx := context.Background()
	cfg := RuntimeConfig{}

	results, report, err := Execute(ctx, tmpFile, cfg)
	if err != nil {
		t.Fatalf("Execute() error: %v", err)
	}
	if !report.Valid {
		t.Error("expected valid report")
	}
	if len(results) != 1 {
		t.Fatalf("results len = %d, want 1", len(results))
	}
	if got := trimNewline(results[0].Stdout); got != "convenience executed" {
		t.Errorf("Stdout = %q, want %q", got, "convenience executed")
	}
}

func TestExecuteConvenienceInvalidModule(t *testing.T) {
	content := `no frontmatter
## Purpose
Invalid.
`
	tmpFile := createTempMAMFile(t, content)
	ctx := context.Background()

	_, _, err := Execute(ctx, tmpFile, RuntimeConfig{})
	if err == nil {
		t.Fatal("expected error for invalid module")
	}
}

func TestVersionConstant(t *testing.T) {
	if Version == "" {
		t.Error("Version constant is empty")
	}
	if Version != "0.1.0" {
		t.Errorf("Version = %q, want %q", Version, "0.1.0")
	}
}

func TestNodeTypeConstants(t *testing.T) {
	tests := []struct {
		constant NodeType
		value    string
	}{
		{NodeModule, "module"},
		{NodeFrontMatter, "frontmatter"},
		{NodeSection, "section"},
		{NodeCodeBlock, "codeblock"},
		{NodeContent, "content"},
		{NodeList, "list"},
		{NodeTable, "table"},
		{NodeHeading, "heading"},
		{NodeParagraph, "paragraph"},
		{NodeBlockquote, "blockquote"},
	}
	for _, tt := range tests {
		t.Run(string(tt.constant), func(t *testing.T) {
			if string(tt.constant) != tt.value {
				t.Errorf("constant = %q, want %q", tt.constant, tt.value)
			}
		})
	}
}

func TestSeverityConstants(t *testing.T) {
	if SeverityError != "error" {
		t.Errorf("SeverityError = %q, want %q", SeverityError, "error")
	}
	if SeverityWarning != "warning" {
		t.Errorf("SeverityWarning = %q, want %q", SeverityWarning, "warning")
	}
	if SeverityInfo != "info" {
		t.Errorf("SeverityInfo = %q, want %q", SeverityInfo, "info")
	}
}
