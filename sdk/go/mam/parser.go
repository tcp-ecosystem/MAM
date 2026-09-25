package mam

import (
	"bufio"
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

var (
	frontMatterStart = regexp.MustCompile(`^---\s*$`)
	sectionHeading   = regexp.MustCompile(`^(#{1,6})\s+(.+)$`)
	codeBlockStart   = regexp.MustCompile("^```(\\w+)?\\s*$")
	codeBlockEnd     = regexp.MustCompile("^```\\s*$")
)

// ParseFile reads a .mam.md file and returns a Module AST.
func ParseFile(path string) (*Module, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", path, err)
	}
	defer f.Close()

	var lines []string
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		lines = append(lines, scanner.Text())
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("reading %s: %w", path, err)
	}
	return ParseLines(lines, path)
}

// ParseString is a convenience wrapper that splits raw content into lines and
// delegates to ParseLines.
func ParseString(content, filePath string) (*Module, error) {
	lines := strings.Split(content, "\n")
	return ParseLines(lines, filePath)
}

// ParseLines builds a Module AST from pre-split lines.
func ParseLines(lines []string, filePath string) (*Module, error) {
	mod := &Module{
		ContentNode: ContentNode{Type: NodeModule, Location: SourceLocation{File: filePath, Line: 1, Column: 1}},
		Path:        filePath,
	}

	pos := 0

	// ---- front matter ----
	if pos < len(lines) && frontMatterStart.MatchString(strings.TrimSpace(lines[pos])) {
		pos++ // skip opening ---
		var fmLines []string
		for pos < len(lines) && !frontMatterStart.MatchString(strings.TrimSpace(lines[pos])) {
			fmLines = append(fmLines, lines[pos])
			pos++
		}
		if pos < len(lines) {
			pos++ // skip closing ---
		}

		raw := strings.Join(fmLines, "\n")
		fm := &FrontMatter{
			ContentNode: ContentNode{Type: NodeFrontMatter, Location: SourceLocation{File: filePath, Line: 2, Column: 1}},
			RawYAML:     raw,
			Metadata:    make(map[string]string),
		}

		var meta map[string]interface{}
		if err := yaml.Unmarshal([]byte(raw), &meta); err == nil {
			if v, ok := meta["title"].(string); ok {
				fm.Title = v
			}
			if v, ok := meta["version"].(string); ok {
				fm.Version = v
			}
			if v, ok := meta["author"].(string); ok {
				fm.Author = v
			}
			if v, ok := meta["description"].(string); ok {
				fm.Description = v
			}
			if arr, ok := meta["tags"].([]interface{}); ok {
				for _, t := range arr {
					if s, ok := t.(string); ok {
						fm.Tags = append(fm.Tags, s)
					}
				}
			}
			// collect remaining keys as metadata
			known := map[string]bool{"title": true, "version": true, "author": true, "description": true, "tags": true}
			for k, v := range meta {
				if !known[k] {
					fm.Metadata[k] = fmt.Sprintf("%v", v)
				}
			}
		}
		mod.FrontMatter = fm
	}

	// ---- sections ----
	for pos < len(lines) {
		line := lines[pos]
		if m := sectionHeading.FindStringSubmatch(line); m != nil {
			level, _ := strconv.Atoi(m[1])
			title := strings.TrimSpace(m[2])
			sec := Section{
				ContentNode: ContentNode{
					Type:     NodeSection,
					Location: SourceLocation{File: filePath, Line: pos + 1, Column: 1},
				},
				Name:  strings.ToLower(title),
				Title: title,
				Level: level,
			}

			// classify section type by heading text
			lower := strings.ToLower(title)
			for _, st := range KnownSections() {
				if strings.Contains(lower, string(st)) {
					sec.SectionType = st
					break
				}
			}

			pos++

			// collect body until next heading or EOF
			var bodyLines []string
			for pos < len(lines) && !sectionHeading.MatchString(lines[pos]) {
				bodyLines = append(bodyLines, lines[pos])
				pos++
			}
			body := strings.Join(bodyLines, "\n")
			sec.Content = strings.TrimSpace(body)

			// extract code blocks from the body
			sec.CodeBlocks = extractCodeBlocks(body, filePath, sec.Location.Line)

			mod.Sections = append(mod.Sections, sec)
		} else {
			pos++
		}
	}

	return mod, nil
}

// HasFrontMatter reports whether the content starts with a YAML front
// matter delimiter.
func HasFrontMatter(content string) bool {
	lines := strings.Split(content, "\n")
	if len(lines) == 0 {
		return false
	}
	return frontMatterStart.MatchString(strings.TrimSpace(lines[0]))
}

// ExtractFrontMatterRaw returns the raw YAML text between the opening and
// closing front matter delimiters, or "" when there is no block.
func ExtractFrontMatterRaw(content string) string {
	lines := strings.Split(content, "\n")
	if len(lines) == 0 || !frontMatterStart.MatchString(strings.TrimSpace(lines[0])) {
		return ""
	}
	var fmLines []string
	for _, line := range lines[1:] {
		if frontMatterStart.MatchString(strings.TrimSpace(line)) {
			break
		}
		fmLines = append(fmLines, line)
	}
	return strings.Join(fmLines, "\n")
}

// ListSectionTitles returns the heading titles of every section in order.
func ListSectionTitles(content string) []string {
	var titles []string
	for _, line := range strings.Split(content, "\n") {
		if m := sectionHeading.FindStringSubmatch(line); m != nil {
			titles = append(titles, strings.TrimSpace(m[2]))
		}
	}
	return titles
}

// CountCodeBlocks returns the number of fenced code blocks in the content.
func CountCodeBlocks(content string) int {
	count := 0
	inBlock := false
	for _, line := range strings.Split(content, "\n") {
		if !inBlock {
			if codeBlockStart.MatchString(line) {
				inBlock = true
			}
		} else if codeBlockEnd.MatchString(line) {
			inBlock = false
			count++
		}
	}
	return count
}

// DetectLanguages returns the distinct fenced-code languages in the
// content, in order of first appearance.
func DetectLanguages(content string) []string {
	var langs []string
	seen := make(map[string]bool)
	for _, line := range strings.Split(content, "\n") {
		if m := codeBlockStart.FindStringSubmatch(line); m != nil {
			lang := m[1]
			if !seen[lang] {
				seen[lang] = true
				langs = append(langs, lang)
			}
		}
	}
	return langs
}

// IsMAMFile reports whether the path looks like a MAM module file.
func IsMAMFile(path string) bool {
	lower := strings.ToLower(path)
	return strings.HasSuffix(lower, ".mam.md")
}

// SplitLines splits content into lines, normalising CRLF to LF first.
func SplitLines(content string) []string {
	normalised := strings.ReplaceAll(content, "\r\n", "\n")
	return strings.Split(normalised, "\n")
}

// extractCodeBlocks scans body text for fenced code blocks and returns them.
func extractCodeBlocks(body, filePath string, baseLine int) []CodeBlock {
	var blocks []CodeBlock
	inBlock := false
	var lang string
	var codeLines []string

	for _, line := range strings.Split(body, "\n") {
		if !inBlock {
			if m := codeBlockStart.FindStringSubmatch(line); m != nil {
				inBlock = true
				lang = m[1]
				codeLines = nil
				continue
			}
		} else {
			if codeBlockEnd.MatchString(line) {
				inBlock = false
				blocks = append(blocks, CodeBlock{
					ContentNode: ContentNode{
						Type:     NodeCodeBlock,
						Location: SourceLocation{File: filePath, Line: baseLine},
					},
					Language: lang,
					Code:     strings.Join(codeLines, "\n"),
				})
				continue
			}
			codeLines = append(codeLines, line)
		}
	}
	return blocks
}
