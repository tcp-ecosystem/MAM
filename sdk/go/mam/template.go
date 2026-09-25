package mam

import (
	"fmt"
	"os"
	"regexp"
	"sort"
	"strings"
	"time"
)

// starterTemplates holds the built-in module starter skeletons. Each
// skeleton uses {{var}} placeholders documented by StarterVariables.
var starterTemplates = map[string]string{
	"module": "---\ntitle: {{name}}\nversion: 0.1.0\nauthor: {{author}}\n---\n\n## Purpose\n\n{{description}}\n\n## Inputs\n\n| Name | Type | Required | Description |\n|------|------|----------|-------------|\n| input | string | true | Primary input |\n\n## Outputs\n\n| Name | Type | Description |\n|------|------|-------------|\n| output | string | Primary output |\n\n## Rules\n\n- Be precise and predictable.\n- Validate all inputs before processing.\n- Document every public interface.\n\n## Examples\n\n```text\n{{name}} processes input into output.\n```\n\n## Tests\n\n- purpose section exists\n- inputs table has one row\n\n## References\n\n- https://mam.dev/specs/module\n",
	"agent":  "---\ntitle: {{name}}\nversion: 0.1.0\nauthor: {{author}}\n---\n\n## Purpose\n\n{{description}}\n\n## Rules\n\n- role: helpful assistant\n- goal: resolve the user query completely\n- escalate when confidence is low\n\n## Inputs\n\n| Name | Type | Required | Description |\n|------|------|----------|-------------|\n| query | string | true | User request |\n| context | string | false | Conversation context |\n\n## Outputs\n\n| Name | Type | Description |\n|------|------|-------------|\n| answer | string | Agent response |\n| confidence | number | Confidence between 0 and 1 |\n\n## Prompt\n\nYou are {{name}}, a helpful assistant.\n\nAnswer concisely and cite sources when available.\n\n## Memory\n\nNo persistent memory configured.\n\n## Examples\n\n```text\nUser: hello\n{{name}}: Hello! How can I help?\n```\n",
	"tool":   "---\ntitle: {{name}}\nversion: 0.1.0\nauthor: {{author}}\n---\n\n## Purpose\n\n{{description}}\n\n## Inputs\n\n| Name | Type | Required | Description |\n|------|------|----------|-------------|\n| payload | string | true | Tool input payload |\n| verbose | boolean | false | Enable verbose output |\n\n## Outputs\n\n| Name | Type | Description |\n|------|------|-------------|\n| result | string | Tool execution result |\n| exit_code | number | Process exit code |\n\n## Capabilities\n\n- execute\n\n## Rules\n\n- exit zero on success and non-zero on failure\n- never print secrets to stdout\n\n## Examples\n\n```text\n{{name}} --help\n{{name}} run --payload hello\n```\n\n## Tests\n\n- tool exits zero on valid payload\n- invalid payload reports an error\n\n## References\n\n- https://mam.dev/specs/tool\n",
}

// starterKindAliases maps friendly aliases to canonical starter kinds.
var starterKindAliases = map[string]string{
	"mod":     "module",
	"bot":     "agent",
	"assistant": "agent",
	"utility": "tool",
	"cli":     "tool",
}

var placeholderPattern = regexp.MustCompile(`\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}`)

// ListStarterKinds returns the available starter template kinds in order.
func ListStarterKinds() []string {
	kinds := make([]string, 0, len(starterTemplates))
	for kind := range starterTemplates {
		kinds = append(kinds, kind)
	}
	sort.Strings(kinds)
	return kinds
}

// GetStarterTemplate returns the raw template for a kind. Aliases are
// resolved and names are matched case-insensitively; unknown kinds
// produce an error listing the valid options, plus a did-you-mean hint
// when the input is a prefix of a kind or alias.
func GetStarterTemplate(kind string) (string, error) {
	canonical, err := canonicalStarterKind(kind)
	if err != nil {
		return "", err
	}
	return starterTemplates[canonical], nil
}

// RenderStarter substitutes {{var}} placeholders with values. Lookup is
// exact first, then case-insensitive, so {{Name}} still resolves a "name"
// entry. Unknown placeholders are left untouched so templates stay
// composable and partially rendered output remains valid input.
func RenderStarter(template string, vars map[string]string) string {
	return placeholderPattern.ReplaceAllStringFunc(template, func(match string) string {
		inner := match[2 : len(match)-2]
		name := strings.TrimSpace(inner)
		if v, ok := vars[name]; ok {
			return v
		}
		lowered := strings.ToLower(name)
		for k, v := range vars {
			if strings.ToLower(strings.TrimSpace(k)) == lowered {
				return v
			}
		}
		return match
	})
}

// StarterVariables lists the distinct placeholder names in a template, in
// order of first appearance.
func StarterVariables(template string) []string {
	var vars []string
	seen := make(map[string]bool)
	for _, m := range placeholderPattern.FindAllStringSubmatch(template, -1) {
		if !seen[m[1]] {
			seen[m[1]] = true
			vars = append(vars, m[1])
		}
	}
	return vars
}

// NewModuleStarter renders a starter for name/kind, filling name,
// description, and author defaults unless overridden by vars.
func NewModuleStarter(name, kind string, vars map[string]string) (string, error) {
	if problems := ValidateStarterName(name); len(problems) > 0 {
		return "", fmt.Errorf("invalid starter name: %s", strings.Join(problems, "; "))
	}
	canonical, err := canonicalStarterKind(kind)
	if err != nil {
		return "", err
	}
	tmpl := starterTemplates[canonical]
	merged := mergeStarterVars(defaultStarterVars(name), vars)
	rendered, err := renderStarterStrict(tmpl, merged)
	if err != nil {
		return "", err
	}
	names, err := getStarterSectionNames(canonical)
	if err != nil {
		return "", err
	}
	if len(names) == 0 {
		return "", fmt.Errorf("starter %q produced no sections", canonical)
	}
	if err := validateStarterTemplate(tmpl); err != nil {
		return "", err
	}
	parsed, err := ParseString(rendered, StarterFileName(name))
	if err != nil {
		return "", fmt.Errorf("rendered starter does not parse: %w", err)
	}
	if err := checkStarterTitle(parsed, merged["name"]); err != nil {
		return "", err
	}
	return rendered, nil
}

// ValidateStarterName returns problems with a starter name, if any.
func ValidateStarterName(name string) []string {
	var problems []string
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		problems = append(problems, "name must not be empty")
	}
	if len(name) > 64 {
		problems = append(problems, "name must be 64 characters or fewer")
	}
	if matched, _ := regexp.MatchString(`[^a-zA-Z0-9 _-]`, name); matched {
		problems = append(problems, "name contains invalid characters (want letters, digits, space, _ or -)")
	}
	if strings.Trim(trimmed, "-_") == "" && trimmed != "" {
		problems = append(problems, "name must contain at least one letter or digit")
	}
	return problems
}

// StarterFileName returns the conventional file name for a starter:
// a lowercased, hyphenated slug of the name with a .mam.md suffix.
// Names that slugify to nothing fall back to "module.mam.md". Slugs
// longer than 64 characters are truncated to keep paths portable.
func StarterFileName(name string) string {
	slug := slugifyStarterName(name)
	if slug == "" {
		slug = "module"
	}
	return slug + ".mam.md"
}

func canonicalStarterKind(kind string) (string, error) {
	normalised := strings.ToLower(strings.TrimSpace(kind))
	if _, ok := starterTemplates[normalised]; ok {
		return normalised, nil
	}
	if canonical, ok := starterKindAliases[normalised]; ok {
		return canonical, nil
	}
	hint := ""
	if suggestion := suggestStarterKind(normalised); suggestion != "" {
		hint = fmt.Sprintf(" (did you mean %q?)", suggestion)
	}
	return "", fmt.Errorf("unknown starter kind %q%s (want one of %s)", kind, hint, strings.Join(ListStarterKinds(), ", "))
}

func suggestStarterKind(input string) string {
	if input == "" {
		return ""
	}
	for _, kind := range ListStarterKinds() {
		if strings.HasPrefix(kind, input) {
			return kind
		}
	}
	for alias, canonical := range starterKindAliases {
		if strings.HasPrefix(alias, input) {
			return canonical
		}
	}
	return ""
}

func defaultStarterVars(name string) map[string]string {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		trimmed = "Untitled Module"
	}
	return map[string]string{
		"name":        trimmed,
		"description": "Describe " + trimmed + ".",
		"author":      defaultStarterAuthor(),
		"year":        currentYear(),
	}
}

func defaultStarterAuthor() string {
	if user := strings.TrimSpace(os.Getenv("USER")); user != "" {
		return user
	}
	if user := strings.TrimSpace(os.Getenv("USERNAME")); user != "" {
		return user
	}
	return ""
}

func currentYear() string {
	return time.Now().Format("2006")
}

func slugifyStarterName(name string) string {
	slug := strings.ToLower(strings.TrimSpace(name))
	slug = regexp.MustCompile(`[^a-z0-9]+`).ReplaceAllString(slug, "-")
	slug = strings.Trim(slug, "-")
	if len(slug) > 64 {
		slug = slug[:64]
	}
	return strings.Trim(slug, "-")
}

func unrenderedStarterVariables(template string, vars map[string]string) []string {
	lowered := make(map[string]bool, len(vars))
	for k := range vars {
		lowered[strings.ToLower(strings.TrimSpace(k))] = true
	}
	var missing []string
	for _, v := range StarterVariables(template) {
		if !lowered[strings.ToLower(v)] {
			missing = append(missing, v)
		}
	}
	return missing
}

func validateStarterVars(template string, vars map[string]string) []string {
	var problems []string
	for _, name := range unrenderedStarterVariables(template, vars) {
		problems = append(problems, fmt.Sprintf("missing template variable %q", name))
	}
	return problems
}

func renderStarterStrict(template string, vars map[string]string) (string, error) {
	if problems := validateStarterVars(template, vars); len(problems) > 0 {
		return "", fmt.Errorf("cannot render: %s", strings.Join(problems, "; "))
	}
	return RenderStarter(template, vars), nil
}

func getStarterSectionNames(kind string) ([]string, error) {
	tmpl, err := GetStarterTemplate(kind)
	if err != nil {
		return nil, err
	}
	return getTemplateSectionNames(tmpl), nil
}

func getTemplateSectionNames(tmpl string) []string {
	var names []string
	for _, line := range strings.Split(tmpl, "\n") {
		if m := sectionHeading.FindStringSubmatch(line); m != nil {
			names = append(names, strings.TrimSpace(m[2]))
		}
	}
	return names
}

func checkStarterTitle(mod *Module, want string) error {
	if mod.FrontMatter == nil {
		return fmt.Errorf("rendered starter has no front matter")
	}
	got := strings.TrimSpace(mod.FrontMatter.Title)
	if got != strings.TrimSpace(want) {
		return fmt.Errorf("rendered starter title %q does not match %q", got, want)
	}
	return nil
}

func validateStarterTemplate(tmpl string) error {
	if !HasFrontMatter(tmpl) {
		return fmt.Errorf("starter template is missing its front matter block")
	}
	if len(getTemplateSectionNames(tmpl)) == 0 {
		return fmt.Errorf("starter template has no sections")
	}
	if unrendered := unrenderedStarterVariables(tmpl, map[string]string{}); len(unrendered) == 0 {
		return fmt.Errorf("starter template defines no placeholders")
	}
	return nil
}

func mergeStarterVars(base, extra map[string]string) map[string]string {
	merged := make(map[string]string, len(base)+len(extra))
	for k, v := range base {
		merged[k] = v
	}
	for k, v := range extra {
		merged[strings.TrimSpace(k)] = v
	}
	return merged
}
