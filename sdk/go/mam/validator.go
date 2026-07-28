package mam

import (
	"fmt"
	"regexp"
	"strings"
)

// Severity distinguishes errors from warnings.
type Severity string

const (
	SeverityError   Severity = "error"
	SeverityWarning Severity = "warning"
	SeverityInfo    Severity = "info"
)

// Diagnostic is a single validation result.
type Diagnostic struct {
	Severity Severity      `json:"severity"`
	Message  string        `json:"message"`
	Location SourceLocation `json:"location"`
	Rule     string        `json:"rule"`
}

func (d Diagnostic) Error() string {
	return fmt.Sprintf("[%s] %s at %s", d.Severity, d.Message, d.Location)
}

// ValidationReport is the full result of validating a Module.
type ValidationReport struct {
	Valid       bool          `json:"valid"`
	Diagnostics []Diagnostic  `json:"diagnostics"`
}

// Validator checks a parsed Module against the MAM specification.
type Validator struct {
	rules []ValidationRule
}

// ValidationRule is a single check applied during validation.
type ValidationRule struct {
	ID          string
	Description string
	Check       func(*Module) []Diagnostic
}

// NewValidator builds a Validator with the built-in rule set.
func NewValidator() *Validator {
	v := &Validator{}
	v.rules = append(v.rules, builtinRules()...)
	return v
}

// AddRule appends a custom validation rule.
func (v *Validator) AddRule(r ValidationRule) {
	v.rules = append(v.rules, r)
}

// Validate runs every rule against the module and returns the report.
func (v *Validator) Validate(mod *Module) *ValidationReport {
	report := &ValidationReport{Valid: true}
	for _, r := range v.rules {
		diags := r.Check(mod)
		for _, d := range diags {
			if d.Severity == SeverityError {
				report.Valid = false
			}
		}
		report.Diagnostics = append(report.Diagnostics, diags...)
	}
	return report
}

// ---- built-in rules -------------------------------------------------------

func builtinRules() []ValidationRule {
	return []ValidationRule{
		{
			ID:          "frontmatter-exists",
			Description: "Module must have a YAML front matter block",
			Check: func(mod *Module) []Diagnostic {
				if mod.FrontMatter == nil {
					return []Diagnostic{{
						Severity: SeverityError,
						Message:  "missing front matter block (expected --- delimited YAML at start of file)",
						Location: mod.Location,
						Rule:     "frontmatter-exists",
					}}
				}
				return nil
			},
		},
		{
			ID:          "frontmatter-title",
			Description: "Front matter must contain a 'title' field",
			Check: func(mod *Module) []Diagnostic {
				if mod.FrontMatter == nil {
					return nil
				}
				if strings.TrimSpace(mod.FrontMatter.Title) == "" {
					return []Diagnostic{{
						Severity: SeverityError,
						Message:  "front matter is missing required 'title' field",
						Location: mod.FrontMatter.Location,
						Rule:     "frontmatter-title",
					}}
				}
				return nil
			},
		},
		{
			ID:          "frontmatter-version",
			Description: "Front matter must contain a 'version' field",
			Check: func(mod *Module) []Diagnostic {
				if mod.FrontMatter == nil {
					return nil
				}
				if strings.TrimSpace(mod.FrontMatter.Version) == "" {
					return []Diagnostic{{
						Severity: SeverityWarning,
						Message:  "front matter is missing 'version' field",
						Location: mod.FrontMatter.Location,
						Rule:     "frontmatter-version",
					}}
				}
				return nil
			},
		},
		{
			ID:          "section-exists",
			Description: "Module must contain at least one section",
			Check: func(mod *Module) []Diagnostic {
				if len(mod.Sections) == 0 {
					return []Diagnostic{{
						Severity: SeverityError,
						Message:  "module has no sections",
						Location: mod.Location,
						Rule:     "section-exists",
					}}
				}
				return nil
			},
		},
		{
			ID:          "purpose-section",
			Description: "Module should have a 'purpose' section",
			Check: func(mod *Module) []Diagnostic {
				if mod.SectionByType(SectionPurpose) == nil {
					return []Diagnostic{{
						Severity: SeverityWarning,
						Message:  "module is missing a 'purpose' section (recommended)",
						Location: mod.Location,
						Rule:     "purpose-section",
					}}
				}
				return nil
			},
		},
		{
			ID:          "section-level",
			Description: "Section headings must be level 2 (##)",
			Check: func(mod *Module) []Diagnostic {
				var diags []Diagnostic
				for _, s := range mod.Sections {
					if s.Level != 2 {
						diags = append(diags, Diagnostic{
							Severity: SeverityWarning,
							Message:  fmt.Sprintf("section '%s' uses heading level %d; MAM recommends level 2 (##)", s.Title, s.Level),
							Location: s.Location,
							Rule:     "section-level",
						})
					}
				}
				return diags
			},
		},
		{
			ID:          "codeblock-language",
			Description: "Code blocks should specify a language",
			Check: func(mod *Module) []Diagnostic {
				var diags []Diagnostic
				for _, s := range mod.Sections {
					for _, cb := range s.CodeBlocks {
						if strings.TrimSpace(cb.Language) == "" {
							diags = append(diags, Diagnostic{
								Severity: SeverityWarning,
								Message:  fmt.Sprintf("code block in section '%s' is missing a language annotation", s.Title),
								Location: cb.Location,
								Rule:     "codeblock-language",
							})
						}
					}
				}
				return diags
			},
		},
	}
}

// ValidateString is a convenience helper that parses and validates raw content.
func ValidateString(content, filePath string) (*ValidationReport, error) {
	mod, err := ParseString(content, filePath)
	if err != nil {
		return nil, err
	}
	v := NewValidator()
	return v.Validate(mod), nil
}

// ---- helpers exposed for custom rule authors ----------------------------

// IsValidLanguageTag checks whether a string is a valid fenced-code language tag.
func IsValidLanguageTag(lang string) bool {
	allowed := regexp.MustCompile(`^[a-zA-Z0-9_+\-]+$`)
	return allowed.MatchString(lang)
}
