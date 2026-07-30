package mam

import (
	"testing"
)

func TestSourceLocationString(t *testing.T) {
	tests := []struct {
		name string
		loc  SourceLocation
		want string
	}{
		{
			name: "with file",
			loc:  SourceLocation{File: "test.mam.md", Line: 10, Column: 5},
			want: "test.mam.md:10:5",
		},
		{
			name: "without file",
			loc:  SourceLocation{Line: 3, Column: 1},
			want: "line 3, col 1",
		},
		{
			name: "zero values",
			loc:  SourceLocation{},
			want: "line 0, col 0",
		},
		{
			name: "without file high line",
			loc:  SourceLocation{Line: 999, Column: 42},
			want: "line 999, col 42",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.loc.String()
			if got != tt.want {
				t.Errorf("SourceLocation.String() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestFrontMatterDefaults(t *testing.T) {
	fm := FrontMatter{
		ContentNode: ContentNode{Type: NodeFrontMatter},
		Metadata:    make(map[string]string),
	}
	if fm.Title != "" {
		t.Errorf("default Title = %q, want empty", fm.Title)
	}
	if fm.Version != "" {
		t.Errorf("default Version = %q, want empty", fm.Version)
	}
	if fm.Author != "" {
		t.Errorf("default Author = %q, want empty", fm.Author)
	}
	if fm.Description != "" {
		t.Errorf("default Description = %q, want empty", fm.Description)
	}
	if len(fm.Tags) != 0 {
		t.Errorf("default Tags len = %d, want 0", len(fm.Tags))
	}
	if len(fm.Metadata) != 0 {
		t.Errorf("default Metadata len = %d, want 0", len(fm.Metadata))
	}
	if fm.Type != NodeFrontMatter {
		t.Errorf("default Type = %q, want %q", fm.Type, NodeFrontMatter)
	}
}

func TestFrontMatterWithValues(t *testing.T) {
	fm := FrontMatter{
		Title:       "Test Module",
		Version:     "1.0.0",
		Author:      "tester",
		Description: "A test module",
		Tags:        []string{"test", "example"},
		Metadata:    map[string]string{"custom": "value"},
		RawYAML:     "title: Test Module\nversion: 1.0.0",
	}
	if fm.Title != "Test Module" {
		t.Errorf("Title = %q, want %q", fm.Title, "Test Module")
	}
	if fm.Version != "1.0.0" {
		t.Errorf("Version = %q, want %q", fm.Version, "1.0.0")
	}
	if fm.Author != "tester" {
		t.Errorf("Author = %q, want %q", fm.Author, "tester")
	}
	if fm.Description != "A test module" {
		t.Errorf("Description = %q, want %q", fm.Description, "A test module")
	}
	if len(fm.Tags) != 2 {
		t.Errorf("Tags len = %d, want 2", len(fm.Tags))
	}
	if fm.Metadata["custom"] != "value" {
		t.Errorf("Metadata[custom] = %q, want %q", fm.Metadata["custom"], "value")
	}
}

func TestModuleSectionByType(t *testing.T) {
	mod := &Module{
		Sections: []Section{
			{SectionType: SectionPurpose, Title: "Purpose"},
			{SectionType: SectionInputs, Title: "Inputs"},
			{SectionType: SectionOutputs, Title: "Outputs"},
			{SectionType: SectionPurpose, Title: "Duplicate Purpose"},
		},
	}

	t.Run("found", func(t *testing.T) {
		sec := mod.SectionByType(SectionInputs)
		if sec == nil {
			t.Fatal("SectionByType returned nil for existing type")
		}
		if sec.Title != "Inputs" {
			t.Errorf("Title = %q, want %q", sec.Title, "Inputs")
		}
	})

	t.Run("returns first match", func(t *testing.T) {
		sec := mod.SectionByType(SectionPurpose)
		if sec == nil {
			t.Fatal("SectionByType returned nil for existing type")
		}
		if sec.Title != "Purpose" {
			t.Errorf("Title = %q, want %q", sec.Title, "Purpose")
		}
	})

	t.Run("not found", func(t *testing.T) {
		sec := mod.SectionByType(SectionPython)
		if sec != nil {
			t.Errorf("SectionByType returned non-nil for missing type: %+v", sec)
		}
	})
}

func TestModuleSectionByName(t *testing.T) {
	mod := &Module{
		Sections: []Section{
			{Name: "purpose", Title: "Purpose"},
			{Name: "inputs", Title: "Inputs"},
		},
	}

	t.Run("found exact", func(t *testing.T) {
		sec := mod.SectionByName("inputs")
		if sec == nil {
			t.Fatal("SectionByName returned nil for existing name")
		}
		if sec.Title != "Inputs" {
			t.Errorf("Title = %q, want %q", sec.Title, "Inputs")
		}
	})

	t.Run("found case insensitive", func(t *testing.T) {
		sec := mod.SectionByName("PURPOSE")
		if sec == nil {
			t.Fatal("SectionByName returned nil for case-insensitive match")
		}
		if sec.Title != "Purpose" {
			t.Errorf("Title = %q, want %q", sec.Title, "Purpose")
		}
	})

	t.Run("not found", func(t *testing.T) {
		sec := mod.SectionByName("nonexistent")
		if sec != nil {
			t.Errorf("SectionByName returned non-nil for missing name: %+v", sec)
		}
	})
}

func TestModuleAllCodeBlocks(t *testing.T) {
	mod := &Module{
		Sections: []Section{
			{
				Title: "Section 1",
				CodeBlocks: []CodeBlock{
					{Language: "python", Code: "print('a')"},
					{Language: "bash", Code: "echo a"},
				},
			},
			{
				Title:      "Section 2",
				CodeBlocks: []CodeBlock{},
			},
			{
				Title: "Section 3",
				CodeBlocks: []CodeBlock{
					{Language: "go", Code: `fmt.Println("b")`},
				},
			},
		},
	}

	blocks := mod.AllCodeBlocks()
	if len(blocks) != 3 {
		t.Fatalf("AllCodeBlocks() len = %d, want 3", len(blocks))
	}
	if blocks[0].Language != "python" {
		t.Errorf("block[0].Language = %q, want %q", blocks[0].Language, "python")
	}
	if blocks[1].Language != "bash" {
		t.Errorf("block[1].Language = %q, want %q", blocks[1].Language, "bash")
	}
	if blocks[2].Language != "go" {
		t.Errorf("block[2].Language = %q, want %q", blocks[2].Language, "go")
	}
}

func TestModuleAllCodeBlocksEmpty(t *testing.T) {
	mod := &Module{Sections: []Section{}}
	blocks := mod.AllCodeBlocks()
	if len(blocks) != 0 {
		t.Errorf("AllCodeBlocks() len = %d, want 0", len(blocks))
	}
}

func TestValidateSectionType(t *testing.T) {
	tests := []struct {
		input    string
		wantType SectionType
		wantOK   bool
	}{
		{"metadata", SectionMetadata, true},
		{"purpose", SectionPurpose, true},
		{"inputs", SectionInputs, true},
		{"outputs", SectionOutputs, true},
		{"rules", SectionRules, true},
		{"workflow", SectionWorkflow, true},
		{"mermaid", SectionMermaid, true},
		{"python", SectionPython, true},
		{"prompt", SectionPrompt, true},
		{"memory", SectionMemory, true},
		{"examples", SectionExamples, true},
		{"tests", SectionTests, true},
		{"references", SectionReferences, true},
		{"dependencies", SectionDependencies, true},
		{"exports", SectionExports, true},
		{"imports", SectionImports, true},
		{"plugins", SectionPlugins, true},
		{"permissions", SectionPermissions, true},
		{"capabilities", SectionCapabilities, true},
		{"nonexistent", "", false},
		{"", "", false},
		{"RANDOM", "", false},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			gotType, gotOK := ValidateSectionType(tt.input)
			if gotOK != tt.wantOK {
				t.Errorf("ValidateSectionType(%q) ok = %v, want %v", tt.input, gotOK, tt.wantOK)
			}
			if gotType != tt.wantType {
				t.Errorf("ValidateSectionType(%q) type = %q, want %q", tt.input, gotType, tt.wantType)
			}
		})
	}
}

func TestKnownSections(t *testing.T) {
	sections := KnownSections()
	if len(sections) == 0 {
		t.Fatal("KnownSections() returned empty")
	}
	seen := make(map[SectionType]bool)
	for _, s := range sections {
		if seen[s] {
			t.Errorf("KnownSections() contains duplicate %q", s)
		}
		seen[s] = true
	}
	required := []SectionType{SectionPurpose, SectionInputs, SectionOutputs, SectionPython}
	for _, r := range required {
		if !seen[r] {
			t.Errorf("KnownSections() missing required type %q", r)
		}
	}
}

func TestCodeBlockFields(t *testing.T) {
	cb := CodeBlock{
		ContentNode: ContentNode{Type: NodeCodeBlock},
		Language:    "python",
		Code:        "x = 1",
	}
	if cb.Type != NodeCodeBlock {
		t.Errorf("Type = %q, want %q", cb.Type, NodeCodeBlock)
	}
	if cb.Language != "python" {
		t.Errorf("Language = %q, want %q", cb.Language, "python")
	}
	if cb.Code != "x = 1" {
		t.Errorf("Code = %q, want %q", cb.Code, "x = 1")
	}
}

func TestSectionFields(t *testing.T) {
	sec := Section{
		ContentNode: ContentNode{Type: NodeSection},
		Name:        "purpose",
		SectionType: SectionPurpose,
		Level:       2,
		Title:       "Purpose",
		Content:     "This module does things",
		CodeBlocks:  []CodeBlock{},
	}
	if sec.Type != NodeSection {
		t.Errorf("Type = %q, want %q", sec.Type, NodeSection)
	}
	if sec.SectionType != SectionPurpose {
		t.Errorf("SectionType = %q, want %q", sec.SectionType, SectionPurpose)
	}
	if sec.Level != 2 {
		t.Errorf("Level = %d, want 2", sec.Level)
	}
}
