package mam

import (
	"os"
	"path/filepath"
	"testing"
)

func TestParseMinimal(t *testing.T) {
	lines := []string{"Just some text.", "", "More text."}
	mod, err := ParseLines(lines, "test.mam.md")
	if err != nil {
		t.Fatalf("ParseLines() error: %v", err)
	}
	if mod == nil {
		t.Fatal("ParseLines() returned nil module")
	}
	if mod.Path != "test.mam.md" {
		t.Errorf("Path = %q, want %q", mod.Path, "test.mam.md")
	}
	if mod.FrontMatter != nil {
		t.Error("expected nil FrontMatter for minimal input")
	}
	if len(mod.Sections) != 0 {
		t.Errorf("Sections len = %d, want 0", len(mod.Sections))
	}
}

func TestParseWithFrontmatter(t *testing.T) {
	lines := []string{
		"---",
		"title: My Module",
		"version: 2.0.0",
		"author: tester",
		"description: Test desc",
		"tags:",
		"  - alpha",
		"  - beta",
		"custom_key: custom_value",
		"---",
		"",
		"## Purpose",
		"This is the purpose section.",
	}
	mod, err := ParseLines(lines, "fm.mam.md")
	if err != nil {
		t.Fatalf("ParseLines() error: %v", err)
	}
	if mod.FrontMatter == nil {
		t.Fatal("expected non-nil FrontMatter")
	}
	fm := mod.FrontMatter
	if fm.Title != "My Module" {
		t.Errorf("Title = %q, want %q", fm.Title, "My Module")
	}
	if fm.Version != "1.0.0" {
		t.Errorf("Version = %q, want %q", fm.Version, "1.0.0")
	}
	if fm.Author != "tester" {
		t.Errorf("Author = %q, want %q", fm.Author, "tester")
	}
	if fm.Description != "Test desc" {
		t.Errorf("Description = %q, want %q", fm.Description, "Test desc")
	}
	if len(fm.Tags) != 2 {
		t.Errorf("Tags len = %d, want 2", len(fm.Tags))
	} else {
		if fm.Tags[0] != "alpha" {
			t.Errorf("Tags[0] = %q, want %q", fm.Tags[0], "alpha")
		}
		if fm.Tags[1] != "beta" {
			t.Errorf("Tags[1] = %q, want %q", fm.Tags[1], "beta")
		}
	}
	if fm.Metadata["custom_key"] != "custom_value" {
		t.Errorf("Metadata[custom_key] = %q, want %q", fm.Metadata["custom_key"], "custom_value")
	}
	if fm.Type != NodeFrontMatter {
		t.Errorf("Type = %q, want %q", fm.Type, NodeFrontMatter)
	}
}

func TestParseWithCodeBlocks(t *testing.T) {
	lines := []string{
		"## Python",
		"```python",
		"print('hello')",
		"x = 42",
		"```",
		"",
		"Some text after code.",
	}
	mod, err := ParseLines(lines, "code.mam.md")
	if err != nil {
		t.Fatalf("ParseLines() error: %v", err)
	}
	if len(mod.Sections) != 1 {
		t.Fatalf("Sections len = %d, want 1", len(mod.Sections))
	}
	sec := mod.Sections[0]
	if sec.Title != "Python" {
		t.Errorf("Title = %q, want %q", sec.Title, "Python")
	}
	if len(sec.CodeBlocks) != 1 {
		t.Fatalf("CodeBlocks len = %d, want 1", len(sec.CodeBlocks))
	}
	cb := sec.CodeBlocks[0]
	if cb.Language != "python" {
		t.Errorf("Language = %q, want %q", cb.Language, "python")
	}
	if cb.Code != "print('hello')\nx = 42" {
		t.Errorf("Code = %q, want %q", cb.Code, "print('hello')\nx = 42")
	}
}

func TestParseMultipleSections(t *testing.T) {
	lines := []string{
		"## Purpose",
		"Module purpose text.",
		"",
		"## Inputs",
		"Input parameters.",
		"",
		"## Outputs",
		"Output description.",
		"",
		"## Python",
		"```python",
		"result = process(inputs)",
		"```",
	}
	mod, err := ParseLines(lines, "multi.mam.md")
	if err != nil {
		t.Fatalf("ParseLines() error: %v", err)
	}
	if len(mod.Sections) != 4 {
		t.Fatalf("Sections len = %d, want 4", len(mod.Sections))
	}

	expectedTitles := []string{"Purpose", "Inputs", "Outputs", "Python"}
	for i, title := range expectedTitles {
		if mod.Sections[i].Title != title {
			t.Errorf("Sections[%d].Title = %q, want %q", i, mod.Sections[i].Title, title)
		}
	}

	if mod.Sections[0].SectionType != SectionPurpose {
		t.Errorf("Section[0].SectionType = %q, want %q", mod.Sections[0].SectionType, SectionPurpose)
	}
	if mod.Sections[1].SectionType != SectionInputs {
		t.Errorf("Section[1].SectionType = %q, want %q", mod.Sections[1].SectionType, SectionInputs)
	}
	if mod.Sections[2].SectionType != SectionOutputs {
		t.Errorf("Section[2].SectionType = %q, want %q", mod.Sections[2].SectionType, SectionOutputs)
	}
	if mod.Sections[3].SectionType != SectionPython {
		t.Errorf("Section[3].SectionType = %q, want %q", mod.Sections[3].SectionType, SectionPython)
	}

	allBlocks := mod.AllCodeBlocks()
	if len(allBlocks) != 1 {
		t.Fatalf("AllCodeBlocks() len = %d, want 1", len(allBlocks))
	}
}

func TestParseSectionLevels(t *testing.T) {
	lines := []string{
		"# Top Level Heading",
		"Top content.",
		"## Section A",
		"A content.",
		"### Subsection",
		"Sub content.",
		"## Section B",
		"B content.",
	}
	mod, err := ParseLines(lines, "levels.mam.md")
	if err != nil {
		t.Fatalf("ParseLines() error: %v", err)
	}
	if len(mod.Sections) != 4 {
		t.Fatalf("Sections len = %d, want 4", len(mod.Sections))
	}
	for i, sec := range mod.Sections {
		if sec.Location.File != "levels.mam.md" {
			t.Errorf("Sections[%d].Location.File = %q, want %q", i, sec.Location.File, "levels.mam.md")
		}
		if sec.Location.Line == 0 {
			t.Errorf("Sections[%d].Location.Line should not be 0", i)
		}
	}
}

func TestParseWithFrontmatterOnly(t *testing.T) {
	lines := []string{
		"---",
		"title: Only Frontmatter",
		"version: 2.0.0",
		"---",
	}
	mod, err := ParseLines(lines, "fmonly.mam.md")
	if err != nil {
		t.Fatalf("ParseLines() error: %v", err)
	}
	if mod.FrontMatter == nil {
		t.Fatal("expected non-nil FrontMatter")
	}
	if mod.FrontMatter.Title != "Only Frontmatter" {
		t.Errorf("Title = %q, want %q", mod.FrontMatter.Title, "Only Frontmatter")
	}
	if len(mod.Sections) != 0 {
		t.Errorf("Sections len = %d, want 0", len(mod.Sections))
	}
}

func TestParseEmptyLines(t *testing.T) {
	lines := []string{}
	mod, err := ParseLines(lines, "empty.mam.md")
	if err != nil {
		t.Fatalf("ParseLines() error: %v", err)
	}
	if mod == nil {
		t.Fatal("ParseLines() returned nil module")
	}
	if mod.FrontMatter != nil {
		t.Error("expected nil FrontMatter for empty input")
	}
	if len(mod.Sections) != 0 {
		t.Errorf("Sections len = %d, want 0", len(mod.Sections))
	}
}

func TestParseFileValid(t *testing.T) {
	content := `---
title: File Module
version: 2.0.0
---

## Purpose
Read from file.

## Python
` + "```python" + `
print("file module")
` + "```" + `
`
	tmpFile := filepath.Join(t.TempDir(), "test_module.mam.md")
	if err := os.WriteFile(tmpFile, []byte(content), 0644); err != nil {
		t.Fatalf("failed to write temp file: %v", err)
	}

	mod, err := ParseFile(tmpFile)
	if err != nil {
		t.Fatalf("ParseFile() error: %v", err)
	}
	if mod.FrontMatter == nil {
		t.Fatal("expected non-nil FrontMatter")
	}
	if mod.FrontMatter.Title != "File Module" {
		t.Errorf("Title = %q, want %q", mod.FrontMatter.Title, "File Module")
	}
	if len(mod.Sections) != 2 {
		t.Fatalf("Sections len = %d, want 2", len(mod.Sections))
	}
}

func TestParseFileNotFound(t *testing.T) {
	_, err := ParseFile("/nonexistent/path/to/file.mam.md")
	if err == nil {
		t.Fatal("expected error for nonexistent file")
	}
}

func TestParseFileEmpty(t *testing.T) {
	tmpFile := filepath.Join(t.TempDir(), "empty.mam.md")
	if err := os.WriteFile(tmpFile, []byte(""), 0644); err != nil {
		t.Fatalf("failed to write temp file: %v", err)
	}
	mod, err := ParseFile(tmpFile)
	if err != nil {
		t.Fatalf("ParseFile() error: %v", err)
	}
	if mod.FrontMatter != nil {
		t.Error("expected nil FrontMatter for empty file")
	}
}

func TestParseString(t *testing.T) {
	content := `---
title: String Module
version: 2.0.0
---

## Purpose
Parsed from string.
`
	mod, err := ParseString(content, "<test>")
	if err != nil {
		t.Fatalf("ParseString() error: %v", err)
	}
	if mod.FrontMatter == nil {
		t.Fatal("expected non-nil FrontMatter")
	}
	if mod.FrontMatter.Title != "String Module" {
		t.Errorf("Title = %q, want %q", mod.FrontMatter.Title, "String Module")
	}
	if len(mod.Sections) != 1 {
		t.Fatalf("Sections len = %d, want 1", len(mod.Sections))
	}
}

func TestParseMultipleCodeBlocks(t *testing.T) {
	lines := []string{
		"## Workflow",
		"```python",
		"import os",
		"```",
		"Some text.",
		"```bash",
		"echo hello",
		"```",
	}
	mod, err := ParseLines(lines, "multicode.mam.md")
	if err != nil {
		t.Fatalf("ParseLines() error: %v", err)
	}
	if len(mod.Sections) != 1 {
		t.Fatalf("Sections len = %d, want 1", len(mod.Sections))
	}
	blocks := mod.Sections[0].CodeBlocks
	if len(blocks) != 2 {
		t.Fatalf("CodeBlocks len = %d, want 2", len(blocks))
	}
	if blocks[0].Language != "python" {
		t.Errorf("block[0].Language = %q, want %q", blocks[0].Language, "python")
	}
	if blocks[1].Language != "bash" {
		t.Errorf("block[1].Language = %q, want %q", blocks[1].Language, "bash")
	}
}

func TestParseCodeBlockNoLanguage(t *testing.T) {
	lines := []string{
		"## Code",
		"```",
		"some code",
		"```",
	}
	mod, err := ParseLines(lines, "nolang.mam.md")
	if err != nil {
		t.Fatalf("ParseLines() error: %v", err)
	}
	if len(mod.Sections[0].CodeBlocks) != 1 {
		t.Fatalf("CodeBlocks len = %d, want 1", len(mod.Sections[0].CodeBlocks))
	}
	if mod.Sections[0].CodeBlocks[0].Language != "" {
		t.Errorf("Language = %q, want empty", mod.Sections[0].CodeBlocks[0].Language)
	}
}

func TestParseSourceLocations(t *testing.T) {
	lines := []string{
		"---",
		"title: Loc Test",
		"version: 2.0.0",
		"---",
		"## Purpose",
		"Content here.",
	}
	mod, err := ParseLines(lines, "loc.mam.md")
	if err != nil {
		t.Fatalf("ParseLines() error: %v", err)
	}
	if mod.Location.File != "loc.mam.md" {
		t.Errorf("mod.Location.File = %q, want %q", mod.Location.File, "loc.mam.md")
	}
	if mod.Location.Line != 1 {
		t.Errorf("mod.Location.Line = %d, want 1", mod.Location.Line)
	}
	if mod.FrontMatter == nil {
		t.Fatal("expected non-nil FrontMatter")
	}
	if mod.FrontMatter.Location.File != "loc.mam.md" {
		t.Errorf("FrontMatter.Location.File = %q, want %q", mod.FrontMatter.Location.File, "loc.mam.md")
	}
}

func TestParseFrontmatterWithoutVersion(t *testing.T) {
	lines := []string{
		"---",
		"title: No Version",
		"---",
		"## Purpose",
		"Content.",
	}
	mod, err := ParseLines(lines, "noversion.mam.md")
	if err != nil {
		t.Fatalf("ParseLines() error: %v", err)
	}
	if mod.FrontMatter == nil {
		t.Fatal("expected non-nil FrontMatter")
	}
	if mod.FrontMatter.Title != "No Version" {
		t.Errorf("Title = %q, want %q", mod.FrontMatter.Title, "No Version")
	}
	if mod.FrontMatter.Version != "" {
		t.Errorf("Version = %q, want empty", mod.FrontMatter.Version)
	}
}
