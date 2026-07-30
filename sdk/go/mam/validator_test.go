package mam

import (
	"testing"
)

func validModuleAST() *Module {
	return &Module{
		ContentNode: ContentNode{Type: NodeModule, Location: SourceLocation{File: "test.mam.md", Line: 1, Column: 1}},
		Path:        "test.mam.md",
		FrontMatter: &FrontMatter{
			ContentNode: ContentNode{Type: NodeFrontMatter, Location: SourceLocation{File: "test.mam.md", Line: 2, Column: 1}},
			Title:       "Valid Module",
			Version:     "1.0.0",
			Metadata:    make(map[string]string),
		},
		Sections: []Section{
			{
				ContentNode: ContentNode{Type: NodeSection, Location: SourceLocation{File: "test.mam.md", Line: 7, Column: 1}},
				Name:        "purpose",
				SectionType: SectionPurpose,
				Level:       2,
				Title:       "Purpose",
			},
			{
				ContentNode: ContentNode{Type: NodeSection, Location: SourceLocation{File: "test.mam.md", Line: 10, Column: 1}},
				Name:        "inputs",
				SectionType: SectionInputs,
				Level:       2,
				Title:       "Inputs",
			},
		},
	}
}

func TestValidateValidModule(t *testing.T) {
	v := NewValidator()
	mod := validModuleAST()
	report := v.Validate(mod)
	if !report.Valid {
		t.Errorf("expected valid module, got %d diagnostics:", len(report.Diagnostics))
		for _, d := range report.Diagnostics {
			t.Logf("  [%s] %s", d.Severity, d.Message)
		}
	}
}

func TestValidateMissingFrontmatter(t *testing.T) {
	v := NewValidator()
	mod := &Module{
		ContentNode: ContentNode{Type: NodeModule, Location: SourceLocation{File: "test.mam.md", Line: 1}},
		FrontMatter: nil,
		Sections: []Section{
			{SectionType: SectionPurpose, Level: 2, Title: "Purpose"},
		},
	}
	report := v.Validate(mod)
	if report.Valid {
		t.Error("expected invalid module for missing frontmatter")
	}
	found := false
	for _, d := range report.Diagnostics {
		if d.Rule == "frontmatter-exists" {
			found = true
			if d.Severity != SeverityError {
				t.Errorf("severity = %q, want %q", d.Severity, SeverityError)
			}
		}
	}
	if !found {
		t.Error("expected diagnostic with rule 'frontmatter-exists'")
	}
}

func TestValidateMissingTitle(t *testing.T) {
	v := NewValidator()
	mod := &Module{
		ContentNode: ContentNode{Type: NodeModule, Location: SourceLocation{File: "test.mam.md", Line: 1}},
		FrontMatter: &FrontMatter{
			ContentNode: ContentNode{Type: NodeFrontMatter, Location: SourceLocation{File: "test.mam.md", Line: 2}},
			Title:       "",
			Version:     "1.0.0",
			Metadata:    make(map[string]string),
		},
		Sections: []Section{
			{SectionType: SectionPurpose, Level: 2, Title: "Purpose"},
		},
	}
	report := v.Validate(mod)
	if report.Valid {
		t.Error("expected invalid module for missing title")
	}
	found := false
	for _, d := range report.Diagnostics {
		if d.Rule == "frontmatter-title" {
			found = true
		}
	}
	if !found {
		t.Error("expected diagnostic with rule 'frontmatter-title'")
	}
}

func TestValidateMissingVersion(t *testing.T) {
	v := NewValidator()
	mod := &Module{
		ContentNode: ContentNode{Type: NodeModule, Location: SourceLocation{File: "test.mam.md", Line: 1}},
		FrontMatter: &FrontMatter{
			ContentNode: ContentNode{Type: NodeFrontMatter, Location: SourceLocation{File: "test.mam.md", Line: 2}},
			Title:       "Has Title",
			Version:     "",
			Metadata:    make(map[string]string),
		},
		Sections: []Section{
			{SectionType: SectionPurpose, Level: 2, Title: "Purpose"},
		},
	}
	report := v.Validate(mod)
	found := false
	for _, d := range report.Diagnostics {
		if d.Rule == "frontmatter-version" {
			found = true
			if d.Severity != SeverityWarning {
				t.Errorf("severity = %q, want %q", d.Severity, SeverityWarning)
			}
		}
	}
	if !found {
		t.Error("expected diagnostic with rule 'frontmatter-version'")
	}
}

func TestValidateEmptyModule(t *testing.T) {
	v := NewValidator()
	mod := &Module{
		ContentNode: ContentNode{Type: NodeModule, Location: SourceLocation{File: "empty.mam.md", Line: 1}},
		FrontMatter: nil,
		Sections:    []Section{},
	}
	report := v.Validate(mod)
	if report.Valid {
		t.Error("expected invalid module for empty module")
	}
	if len(report.Diagnostics) < 2 {
		t.Errorf("expected at least 2 diagnostics for empty module, got %d", len(report.Diagnostics))
	}
}

func TestValidateMissingSections(t *testing.T) {
	v := NewValidator()
	mod := &Module{
		ContentNode: ContentNode{Type: NodeModule, Location: SourceLocation{File: "test.mam.md", Line: 1}},
		FrontMatter: &FrontMatter{
			ContentNode: ContentNode{Type: NodeFrontMatter, Location: SourceLocation{File: "test.mam.md", Line: 2}},
			Title:       "No Sections",
			Version:     "1.0.0",
			Metadata:    make(map[string]string),
		},
		Sections: []Section{},
	}
	report := v.Validate(mod)
	if report.Valid {
		t.Error("expected invalid module for no sections")
	}
	found := false
	for _, d := range report.Diagnostics {
		if d.Rule == "section-exists" {
			found = true
		}
	}
	if !found {
		t.Error("expected diagnostic with rule 'section-exists'")
	}
}

func TestValidateMissingPurposeSection(t *testing.T) {
	v := NewValidator()
	mod := &Module{
		ContentNode: ContentNode{Type: NodeModule, Location: SourceLocation{File: "test.mam.md", Line: 1}},
		FrontMatter: &FrontMatter{
			ContentNode: ContentNode{Type: NodeFrontMatter, Location: SourceLocation{File: "test.mam.md", Line: 2}},
			Title:       "No Purpose",
			Version:     "1.0.0",
			Metadata:    make(map[string]string),
		},
		Sections: []Section{
			{SectionType: SectionInputs, Level: 2, Title: "Inputs", ContentNode: ContentNode{Location: SourceLocation{File: "test.mam.md", Line: 7}}},
		},
	}
	report := v.Validate(mod)
	found := false
	for _, d := range report.Diagnostics {
		if d.Rule == "purpose-section" {
			found = true
			if d.Severity != SeverityWarning {
				t.Errorf("severity = %q, want %q", d.Severity, SeverityWarning)
			}
		}
	}
	if !found {
		t.Error("expected diagnostic with rule 'purpose-section'")
	}
}

func TestValidateSectionLevel(t *testing.T) {
	v := NewValidator()
	mod := &Module{
		ContentNode: ContentNode{Type: NodeModule, Location: SourceLocation{File: "test.mam.md", Line: 1}},
		FrontMatter: &FrontMatter{
			ContentNode: ContentNode{Type: NodeFrontMatter, Location: SourceLocation{File: "test.mam.md", Line: 2}},
			Title:       "Level Test",
			Version:     "1.0.0",
			Metadata:    make(map[string]string),
		},
		Sections: []Section{
			{
				ContentNode: ContentNode{Type: NodeSection, Location: SourceLocation{File: "test.mam.md", Line: 7}},
				SectionType: SectionPurpose,
				Level:       1,
				Title:       "Purpose",
			},
			{
				ContentNode: ContentNode{Type: NodeSection, Location: SourceLocation{File: "test.mam.md", Line: 10}},
				SectionType: SectionInputs,
				Level:       3,
				Title:       "Inputs",
			},
		},
	}
	report := v.Validate(mod)
	foundCount := 0
	for _, d := range report.Diagnostics {
		if d.Rule == "section-level" {
			foundCount++
		}
	}
	if foundCount != 2 {
		t.Errorf("expected 2 section-level diagnostics, got %d", foundCount)
	}
}

func TestValidateCodeBlockMissingLanguage(t *testing.T) {
	v := NewValidator()
	mod := &Module{
		ContentNode: ContentNode{Type: NodeModule, Location: SourceLocation{File: "test.mam.md", Line: 1}},
		FrontMatter: &FrontMatter{
			ContentNode: ContentNode{Type: NodeFrontMatter, Location: SourceLocation{File: "test.mam.md", Line: 2}},
			Title:       "Code Test",
			Version:     "1.0.0",
			Metadata:    make(map[string]string),
		},
		Sections: []Section{
			{
				ContentNode: ContentNode{Type: NodeSection, Location: SourceLocation{File: "test.mam.md", Line: 7}},
				SectionType: SectionPython,
				Level:       2,
				Title:       "Python",
				CodeBlocks: []CodeBlock{
					{
						ContentNode: ContentNode{Type: NodeCodeBlock, Location: SourceLocation{File: "test.mam.md", Line: 8}},
						Language:    "",
						Code:        "print('hello')",
					},
				},
			},
		},
	}
	report := v.Validate(mod)
	found := false
	for _, d := range report.Diagnostics {
		if d.Rule == "codeblock-language" {
			found = true
			if d.Severity != SeverityWarning {
				t.Errorf("severity = %q, want %q", d.Severity, SeverityWarning)
			}
		}
	}
	if !found {
		t.Error("expected diagnostic with rule 'codeblock-language'")
	}
}

func TestValidateCodeBlockWithLanguage(t *testing.T) {
	v := NewValidator()
	mod := &Module{
		ContentNode: ContentNode{Type: NodeModule, Location: SourceLocation{File: "test.mam.md", Line: 1}},
		FrontMatter: &FrontMatter{
			ContentNode: ContentNode{Type: NodeFrontMatter, Location: SourceLocation{File: "test.mam.md", Line: 2}},
			Title:       "Code OK",
			Version:     "1.0.0",
			Metadata:    make(map[string]string),
		},
		Sections: []Section{
			{
				ContentNode: ContentNode{Type: NodeSection, Location: SourceLocation{File: "test.mam.md", Line: 7}},
				SectionType: SectionPython,
				Level:       2,
				Title:       "Python",
				CodeBlocks: []CodeBlock{
					{
						ContentNode: ContentNode{Type: NodeCodeBlock, Location: SourceLocation{File: "test.mam.md", Line: 8}},
						Language:    "python",
						Code:        "print('hello')",
					},
				},
			},
		},
	}
	report := v.Validate(mod)
	for _, d := range report.Diagnostics {
		if d.Rule == "codeblock-language" {
			t.Error("unexpected codeblock-language diagnostic when language is set")
		}
	}
}

func TestValidateAddCustomRule(t *testing.T) {
	v := NewValidator()
	v.AddRule(ValidationRule{
		ID:          "custom-check",
		Description: "Custom check that always fails",
		Check: func(mod *Module) []Diagnostic {
			return []Diagnostic{{
				Severity: SeverityError,
				Message:  "custom check failed",
				Rule:     "custom-check",
			}}
		},
	})
	mod := validModuleAST()
	report := v.Validate(mod)
	if report.Valid {
		t.Error("expected invalid module from custom rule")
	}
	found := false
	for _, d := range report.Diagnostics {
		if d.Rule == "custom-check" {
			found = true
		}
	}
	if !found {
		t.Error("expected diagnostic with rule 'custom-check'")
	}
}

func TestDiagnosticErrorString(t *testing.T) {
	d := Diagnostic{
		Severity: SeverityError,
		Message:  "test message",
		Location: SourceLocation{File: "test.mam.md", Line: 5, Column: 3},
		Rule:     "test-rule",
	}
	s := d.Error()
	if s == "" {
		t.Error("Diagnostic.Error() returned empty string")
	}
}

func TestValidationReportDefaults(t *testing.T) {
	report := &ValidationReport{}
	if report.Valid {
		t.Error("zero-value report.Valid should be false")
	}
	if len(report.Diagnostics) != 0 {
		t.Errorf("default diagnostics len = %d, want 0", len(report.Diagnostics))
	}
}

func TestValidateString(t *testing.T) {
	content := `---
title: Valid String Module
version: 1.0.0
---

## Purpose
This works.
`
	report, err := ValidateString(content, "<test>")
	if err != nil {
		t.Fatalf("ValidateString() error: %v", err)
	}
	if !report.Valid {
		t.Errorf("expected valid report, got %d diagnostics", len(report.Diagnostics))
	}
}

func TestIsValidLanguageTag(t *testing.T) {
	tests := []struct {
		lang string
		want bool
	}{
		{"python", true},
		{"javascript", true},
		{"go", true},
		{"bash", true},
		{"node-js", true},
		{"c++", true},
		{"objective-c", true},
		{"ruby3", true},
		{"", false},
		{"has space", false},
		{"has@special", false},
		{"has dollar$", false},
	}
	for _, tt := range tests {
		t.Run(tt.lang, func(t *testing.T) {
			got := IsValidLanguageTag(tt.lang)
			if got != tt.want {
				t.Errorf("IsValidLanguageTag(%q) = %v, want %v", tt.lang, got, tt.want)
			}
		})
	}
}
