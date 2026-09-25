package mam

import (
	"encoding/json"
	"fmt"
	"strings"
)

// FormatModuleSummary returns a one-line summary: title, section count,
// and code block count.
func FormatModuleSummary(mod *Module) string {
	return ModuleSummary(mod)
}

// FormatModuleJSON serializes the module AST to indented JSON.
func FormatModuleJSON(mod *Module) (string, error) {
	raw, err := json.MarshalIndent(mod, "", "  ")
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

// FormatSectionList returns a numbered list of sections with their types
// and content sizes.
func FormatSectionList(mod *Module) string {
	if mod == nil || len(mod.Sections) == 0 {
		return "(no sections)"
	}
	table := formatDataTable(
		[]string{"#", "Title", "Type", "Size"},
		collectSectionRows(mod),
	)
	return table
}

// FormatValidationReport renders a report grouped by severity with a
// summary line.
func FormatValidationReport(report *ValidationReport) string {
	if report == nil {
		return "nil report"
	}
	var b strings.Builder
	groups := groupDiagnosticsBySeverity(report.Diagnostics)
	for _, severity := range []Severity{SeverityError, SeverityWarning, SeverityInfo} {
		diags := groups[severity]
		if len(diags) == 0 {
			continue
		}
		fmt.Fprintf(&b, "%s (%d):\n", severityLabel(severity), len(diags))
		for _, d := range diags {
			fmt.Fprintf(&b, "  [%s] %s\n", d.Rule, wrapSingleLine(d.Message, 100))
		}
	}
	status := "valid"
	if !report.Valid {
		status = "invalid"
	}
	fmt.Fprintf(&b, "%s: %d diagnostics", status, len(report.Diagnostics))
	return b.String()
}

// FormatExecutionResults renders a detailed block per execution result,
// including output excerpts.
func FormatExecutionResults(results []*ExecutionResult) string {
	if len(results) == 0 {
		return "(no results)"
	}
	var b strings.Builder
	for i, res := range results {
		status := "ok"
		if !res.Succeeded() {
			status = fmt.Sprintf("exit %d", res.ExitCode)
		}
		fmt.Fprintf(&b, "[%d] %s (%s, %s)\n", i, res.Language, status, res.Duration)
		if excerpt := excerptLines(res.Stdout, 3); excerpt != "" {
			fmt.Fprintf(&b, "%s", indentBlock("stdout:\n"+excerpt, "    "))
			b.WriteString("\n")
		}
		if excerpt := excerptLines(res.Stderr, 3); excerpt != "" {
			fmt.Fprintf(&b, "%s", indentBlock("stderr:\n"+excerpt, "    "))
			b.WriteString("\n")
		}
	}
	return strings.TrimRight(b.String(), "\n")
}

// FormatCodeBlockList returns an aligned table of code blocks.
func FormatCodeBlockList(mod *Module) string {
	if mod == nil {
		return "(no code blocks)"
	}
	blocks := mod.AllCodeBlocks()
	if len(blocks) == 0 {
		return "(no code blocks)"
	}
	rows := make([][]string, 0, len(blocks))
	for i, cb := range blocks {
		rows = append(rows, []string{
			fmt.Sprintf("%d", i),
			normalizeLanguageLabel(cb.Language),
			fmt.Sprintf("%d bytes", len(cb.Code)),
			fmt.Sprintf("%d lines", len(strings.Split(cb.Code, "\n"))),
		})
	}
	return formatDataTable([]string{"#", "Language", "Size", "Lines"}, rows)
}

// FormatFrontMatter renders front matter metadata as aligned key: value
// lines.
func FormatFrontMatter(fm *FrontMatter) string {
	if fm == nil {
		return "(no front matter)"
	}
	pairs := [][2]string{
		{"title", fm.Title},
		{"version", fm.Version},
	}
	if fm.Author != "" {
		pairs = append(pairs, [2]string{"author", fm.Author})
	}
	if fm.Description != "" {
		pairs = append(pairs, [2]string{"description", fm.Description})
	}
	if len(fm.Tags) > 0 {
		pairs = append(pairs, [2]string{"tags", strings.Join(fm.Tags, ", ")})
	}
	keys := sortedMetadataKeys(fm.Metadata)
	for _, k := range keys {
		pairs = append(pairs, [2]string{k, fm.Metadata[k]})
	}
	width := 0
	for _, p := range pairs {
		if len(p[0]) > width {
			width = len(p[0])
		}
	}
	var b strings.Builder
	for _, p := range pairs {
		fmt.Fprintf(&b, "%s: %s\n", padRightTo(p[0], width), p[1])
	}
	return strings.TrimRight(b.String(), "\n")
}

func collectSectionRows(mod *Module) [][]string {
	rows := make([][]string, 0, len(mod.Sections))
	for i, s := range mod.Sections {
		rows = append(rows, []string{
			fmt.Sprintf("%d", i+1),
			truncateMiddle(s.Title, 40),
			string(s.SectionType),
			fmt.Sprintf("%d chars", len(s.Content)),
		})
	}
	return rows
}

func groupDiagnosticsBySeverity(diags []Diagnostic) map[Severity][]Diagnostic {
	groups := map[Severity][]Diagnostic{
		SeverityError:   {},
		SeverityWarning: {},
		SeverityInfo:    {},
	}
	for _, d := range diags {
		groups[d.Severity] = append(groups[d.Severity], d)
	}
	return groups
}

func severityLabel(s Severity) string {
	switch s {
	case SeverityError:
		return "Errors"
	case SeverityWarning:
		return "Warnings"
	default:
		return "Info"
	}
}

func formatDataTable(headers []string, rows [][]string) string {
	widths := make([]int, len(headers))
	for i, h := range headers {
		widths[i] = len(h)
	}
	for _, row := range rows {
		for i := range headers {
			cell := ""
			if i < len(row) {
				cell = row[i]
			}
			if len(cell) > widths[i] {
				widths[i] = len(cell)
			}
		}
	}
	var b strings.Builder
	b.WriteString(formatTableRow(headers, widths))
	b.WriteString("\n")
	b.WriteString(formatTableSeparator(widths))
	for _, row := range rows {
		b.WriteString("\n")
		b.WriteString(formatTableRow(padRowCells(row, len(headers)), widths))
	}
	return b.String()
}

func formatTableRow(cells []string, widths []int) string {
	parts := make([]string, len(widths))
	for i, w := range widths {
		cell := ""
		if i < len(cells) {
			cell = cells[i]
		}
		parts[i] = padRightTo(cell, w)
	}
	return "| " + strings.Join(parts, " | ") + " |"
}

func formatTableSeparator(widths []int) string {
	parts := make([]string, len(widths))
	for i, w := range widths {
		parts[i] = strings.Repeat("-", w+2)
	}
	return "|" + strings.Join(parts, "|") + "|"
}

func padRowCells(row []string, width int) []string {
	if len(row) >= width {
		return row[:width]
	}
	padded := make([]string, width)
	copy(padded, row)
	return padded
}

func padRightTo(text string, width int) string {
	if len(text) >= width {
		return text
	}
	return text + strings.Repeat(" ", width-len(text))
}

func truncateMiddle(text string, maxLength int) string {
	if len(text) <= maxLength || maxLength <= 3 {
		return text
	}
	keep := maxLength - 3
	left := keep / 2
	right := keep - left
	return text[:left] + "..." + text[len(text)-right:]
}

func wrapSingleLine(text string, maxLength int) string {
	single := strings.Join(strings.Fields(text), " ")
	if len(single) <= maxLength {
		return single
	}
	return single[:maxLength-3] + "..."
}

func excerptLines(text string, maxLines int) string {
	trimmed := strings.TrimRight(text, "\n")
	if trimmed == "" {
		return ""
	}
	lines := strings.Split(trimmed, "\n")
	if len(lines) > maxLines {
		lines = append(lines[:maxLines], fmt.Sprintf("... (%d more lines)", len(strings.Split(trimmed, "\n"))-maxLines))
	}
	return strings.Join(lines, "\n")
}

func indentBlock(text, prefix string) string {
	lines := strings.Split(text, "\n")
	for i := range lines {
		if lines[i] != "" {
			lines[i] = prefix + lines[i]
		}
	}
	return strings.Join(lines, "\n")
}

func sortedMetadataKeys(metadata map[string]string) []string {
	keys := make([]string, 0, len(metadata))
	for k := range metadata {
		keys = append(keys, k)
	}
	sortMetadataKeys(keys)
	return keys
}

func sortMetadataKeys(keys []string) {
	for i := 1; i < len(keys); i++ {
		for j := i; j > 0 && keys[j] < keys[j-1]; j-- {
			keys[j], keys[j-1] = keys[j-1], keys[j]
		}
	}
}

func normalizeLanguageLabel(lang string) string {
	trimmed := strings.TrimSpace(strings.ToLower(lang))
	if trimmed == "" {
		return "unknown"
	}
	return trimmed
}

