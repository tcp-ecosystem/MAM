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
