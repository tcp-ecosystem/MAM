package mam

import (
	"fmt"
	"strings"
)

// SourceLocation tracks the origin position of an AST node within the source file.
type SourceLocation struct {
	Line   int    `json:"line"`
	Column int    `json:"column"`
	Offset int    `json:"offset"`
	File   string `json:"file,omitempty"`
}

// String returns a human-readable representation of the source location.
func (s SourceLocation) String() string {
	if s.File != "" {
		return fmt.Sprintf("%s:%d:%d", s.File, s.Line, s.Column)
	}
	return fmt.Sprintf("line %d, col %d", s.Line, s.Column)
}

// NodeType enumerates every kind of node the AST can represent.
type NodeType string

const (
	NodeModule     NodeType = "module"
	NodeFrontMatter NodeType = "frontmatter"
	NodeSection     NodeType = "section"
	NodeCodeBlock   NodeType = "codeblock"
	NodeContent     NodeType = "content"
	NodeList        NodeType = "list"
	NodeTable       NodeType = "table"
	NodeHeading     NodeType = "heading"
	NodeParagraph   NodeType = "paragraph"
	NodeBlockquote  NodeType = "blockquote"
)

// ContentNode is the base type embedded in every AST node.
type ContentNode struct {
	Type     NodeType       `json:"type"`
	Location SourceLocation `json:"location"`
	Children []ContentNode  `json:"children,omitempty"`
}

// FrontMatter holds the YAML metadata block found at the top of a .mam.md file.
type FrontMatter struct {
	ContentNode
	Title       string            `json:"title"`
	Version     string            `json:"version"`
	Author      string            `json:"author,omitempty"`
	Description string            `json:"description,omitempty"`
	Tags        []string          `json:"tags,omitempty"`
	Metadata    map[string]string `json:"metadata,omitempty"`
	RawYAML     string            `json:"raw_yaml"`
}

// SectionType enumerates the recognised MAM section kinds.
type SectionType string

const (
	SectionMetadata    SectionType = "metadata"
	SectionPurpose     SectionType = "purpose"
	SectionInputs      SectionType = "inputs"
	SectionOutputs     SectionType = "outputs"
	SectionRules       SectionType = "rules"
	SectionWorkflow    SectionType = "workflow"
	SectionMermaid     SectionType = "mermaid"
	SectionPython      SectionType = "python"
	SectionPrompt      SectionType = "prompt"
	SectionMemory      SectionType = "memory"
	SectionExamples    SectionType = "examples"
	SectionTests       SectionType = "tests"
	SectionReferences  SectionType = "references"
	SectionDependencies SectionType = "dependencies"
	SectionExports     SectionType = "exports"
	SectionImports     SectionType = "imports"
	SectionPlugins     SectionType = "plugins"
	SectionPermissions SectionType = "permissions"
	SectionCapabilities SectionType = "capabilities"
)

// KnownSections returns all section types recognised by the MAM specification.
func KnownSections() []SectionType {
	return []SectionType{
		SectionMetadata, SectionPurpose, SectionInputs, SectionOutputs,
		SectionRules, SectionWorkflow, SectionMermaid, SectionPython,
		SectionPrompt, SectionMemory, SectionExamples, SectionTests,
		SectionReferences, SectionDependencies, SectionExports, SectionImports,
		SectionPlugins, SectionPermissions, SectionCapabilities,
	}
}

// Section represents a markdown section inside a MAM module (## heading ...).
type Section struct {
	ContentNode
	Name        string      `json:"name"`
	SectionType SectionType `json:"section_type"`
	Level       int         `json:"level"`
	Title       string      `json:"title"`
	Content     string      `json:"content"`
	CodeBlocks  []CodeBlock `json:"code_blocks,omitempty"`
}

// CodeBlock represents an embedded code block with a language tag.
type CodeBlock struct {
	ContentNode
	Language string `json:"language"`
	Code     string `json:"code"`
}

// Module is the root AST node produced by the MAM parser.
type Module struct {
	ContentNode
	FrontMatter *FrontMatter `json:"frontmatter"`
	Sections    []Section    `json:"sections"`
	Path        string       `json:"path"`
}

// SectionByType returns the first section matching the given type, or nil.
func (m *Module) SectionByType(t SectionType) *Section {
	for i := range m.Sections {
		if m.Sections[i].SectionType == t {
			return &m.Sections[i]
		}
	}
	return nil
}

// SectionByName returns the first section whose Name field matches (case-insensitive).
func (m *Module) SectionByName(name string) *Section {
	lower := strings.ToLower(name)
	for i := range m.Sections {
		if strings.ToLower(m.Sections[i].Name) == lower {
			return &m.Sections[i]
		}
	}
	return nil
}

// AllCodeBlocks collects every CodeBlock from every section.
func (m *Module) AllCodeBlocks() []CodeBlock {
	var blocks []CodeBlock
	for _, s := range m.Sections {
		blocks = append(blocks, s.CodeBlocks...)
	}
	return blocks
}

// ValidateSectionType checks whether a string is a recognised MAM section type.
func ValidateSectionType(s string) (SectionType, bool) {
	for _, st := range KnownSections() {
		if string(st) == s {
			return st, true
		}
	}
	return "", false
}
