package com.mam;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/** Immutable AST vocabulary for MAM. */
public final class Ast {
    private Ast() { }

    /** One-based source position; zero denotes unknown. */
    public record Location(int line, int column, int offset, String filePath) {
        /** Formats a path-qualified position without failing on null input. */
        public String format() { return (filePath == null || filePath.isBlank() ? "line " : filePath + ":") + line + ":" + column; }
    }

    /** Validation severity. */
    public enum Severity {
        /** Invalidating error. */
        ERROR,
        /** Recoverable warning. */
        WARNING,
        /** Informational finding. */
        INFO
    }

    /** Nineteen standard section kinds and one custom variant. */
    public enum SectionKind {
        /** Metadata. */ METADATA("metadata"),
        /** Purpose. */ PURPOSE("purpose"),
        /** Inputs. */ INPUTS("inputs"),
        /** Outputs. */ OUTPUTS("outputs"),
        /** Rules. */ RULES("rules"),
        /** Workflow. */ WORKFLOW("workflow"),
        /** Mermaid. */ MERMAID("mermaid"),
        /** Python. */ PYTHON("python"),
        /** Prompt. */ PROMPT("prompt"),
        /** Memory. */ MEMORY("memory"),
        /** Examples. */ EXAMPLES("examples"),
        /** Tests. */ TESTS("tests"),
        /** References. */ REFERENCES("references"),
        /** Dependencies. */ DEPENDENCIES("dependencies"),
        /** Exports. */ EXPORTS("exports"),
        /** Imports. */ IMPORTS("imports"),
        /** Plugins. */ PLUGINS("plugins"),
        /** Permissions. */ PERMISSIONS("permissions"),
        /** Capabilities. */ CAPABILITIES("capabilities"),
        /** User-defined section. */ CUSTOM("custom");
        private final String wireName;
        SectionKind(String wireName) { this.wireName = wireName; }
        /** Returns the lowercase stable name. */
        public String wireName() { return wireName; }
        /** Parses standard names case-insensitively; unknown names become custom. */
        public static SectionKind parse(String value) {
            String text = value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
            for (SectionKind kind : values()) if (kind != CUSTOM && kind.wireName.equals(text)) return kind;
            return CUSTOM;
        }
    }

    /** Common immutable content node contract. */
    public sealed interface ContentNode permits Heading, Paragraph, CodeBlock, List, Table,
            Blockquote, HorizontalRule, Link, Image, Text {
        /** Returns source location. */
        Location location();
        /** Returns plain text projection. */
        String text();
    }

    /** Heading node. */
    public record Heading(int level, String text, Location location) implements ContentNode {
        /** Canonicalizes level and null text. */
        public Heading { if (level < 1 || level > 6) level = 6; text = Objects.requireNonNullElse(text, ""); }
    }

    /** Paragraph node. */
    public record Paragraph(String value, Location location) implements ContentNode {
        /** Canonicalizes null value. */
        public Paragraph { value = Objects.requireNonNullElse(value, ""); }
        @Override public String text() { return value; }
    }

    /** Fenced code node. */
    public record CodeBlock(String language, String code, Location location) implements ContentNode {
        /** Canonicalizes null fields. */
        public CodeBlock { language = Objects.requireNonNullElse(language, ""); code = Objects.requireNonNullElse(code, ""); }
        @Override public String text() { return code; }
    }

    /** Markdown list node. */
    public record List(String[] items, boolean ordered, Location location) implements ContentNode {
        /** Defensively copies items. */
        public List { items = items == null ? new String[0] : items.clone(); }
        @Override public String[] items() { return items.clone(); }
        @Override public String text() { return String.join("\n", items); }
    }

    /** Markdown table node. */
    public record Table(String[] headers, String[][] rows, Location location) implements ContentNode {
        /** Defensively copies cells. */
        public Table { headers = headers == null ? new String[0] : headers.clone(); rows = copyRows(rows); }
        @Override public String[] headers() { return headers.clone(); }
        @Override public String[][] rows() { return copyRows(rows); }
        @Override public String text() { return headers.length == 0 ? "" : String.join(" | ", headers); }
        private static String[][] copyRows(String[][] values) {
            if (values == null) return new String[0][];
            String[][] copy = new String[values.length][];
            for (int i = 0; i < values.length; i++) copy[i] = values[i] == null ? new String[0] : values[i].clone();
            return copy;
        }
    }

    /** Blockquote node. */
    public record Blockquote(String[] lines, Location location) implements ContentNode {
        /** Defensively copies lines. */
        public Blockquote { lines = lines == null ? new String[0] : lines.clone(); }
        @Override public String[] lines() { return lines.clone(); }
        @Override public String text() { return String.join("\n", lines); }
    }

    /** Horizontal rule node. */
    public record HorizontalRule(Location location) implements ContentNode {
        @Override public String text() { return "---"; }
    }

    /** Link node. */
    public record Link(String label, String url, Location location) implements ContentNode {
        /** Canonicalizes null fields. */
        public Link { label = Objects.requireNonNullElse(label, ""); url = Objects.requireNonNullElse(url, ""); }
        @Override public String text() { return label.isBlank() ? url : label; }
    }

    /** Image node. */
    public record Image(String alt, String url, Location location) implements ContentNode {
        /** Canonicalizes null fields. */
        public Image { alt = Objects.requireNonNullElse(alt, ""); url = Objects.requireNonNullElse(url, ""); }
        @Override public String text() { return alt; }
    }

    /** Plain text node. */
    public record Text(String value, Location location) implements ContentNode {
        /** Canonicalizes null value. */
        public Text { value = Objects.requireNonNullElse(value, ""); }
        @Override public String text() { return value; }
    }

    /** Authoritative MAM front matter. */
    public record FrontMatter(String name, List<String> authors, String version, String description,
            String schemaVersion, String license, List<String> tags, List<String> dependencies,
            Map<String, String> metadata) {
        /** Defensively copies fields. */
        public FrontMatter {
            name = Objects.requireNonNullElse(name, ""); authors = copy(authors); version = Objects.requireNonNullElse(version, "");
            description = Objects.requireNonNullElse(description, ""); schemaVersion = Objects.requireNonNullElse(schemaVersion, "");
            license = Objects.requireNonNullElse(license, ""); tags = copy(tags); dependencies = copy(dependencies);
            metadata = metadata == null ? Map.of() : Map.copyOf(metadata);
        }
        private static List<String> copy(List<String> value) { return value == null ? List.of() : List.copyOf(value); }
    }

    /** Parsed section. */
    public record Section(SectionKind kind, String title, List<ContentNode> content, Location location) {
        /** Defensively copies fields. */
        public Section { title = Objects.requireNonNullElse(title, ""); content = content == null ? List.of() : List.copyOf(content); }
        /** Returns direct code nodes. */
        public List<CodeBlock> codeBlocks() {
            return content.stream().filter(CodeBlock.class::isInstance).map(CodeBlock.class::cast).toList();
        }
    }

    /** Parsed module root. */
    public record Module(FrontMatter frontMatter, List<Section> sections, String rawContent, String filePath) {
        /** Defensively copies fields. */
        public Module { sections = sections == null ? List.of() : List.copyOf(sections); rawContent = Objects.requireNonNullElse(rawContent, ""); filePath = Objects.requireNonNullElse(filePath, ""); }
        /** Returns all code blocks in document order. */
        public List<CodeBlock> allCodeBlocks() { return sections.stream().flatMap(section -> section.codeBlocks().stream()).toList(); }
        /** Returns the first matching standard section. */
        public Section sectionByKind(SectionKind kind) { return sections.stream().filter(section -> section.kind() == kind).findFirst().orElse(null); }
        /** Returns distinct lower-case languages. */
        public List<String> codeBlockLanguages() { return allCodeBlocks().stream().map(block -> block.language().toLowerCase(Locale.ROOT)).distinct().toList(); }
        /** Returns display name or a stable fallback. */
        public String displayName() { return frontMatter == null || frontMatter.name().isBlank() ? "untitled" : frontMatter.name(); }
    }
}

    private static final class TextSupport_Ast {
        private TextSupport_Ast() {
        }

        static boolean blank(String value) {
            return value == null || value.trim().isEmpty();
        }

        static String orEmpty(String value) {
            return value == null ? "" : value;
        }

        static String normalized(String value) {
            return orEmpty(value).trim().replaceAll("\\s+", " ");
        }

        static boolean equalIgnoreCase(String left, String right) {
            return left == null ? right == null : left.equalsIgnoreCase(right);
        }

        static boolean startsWith(String value, String prefix) {
            return value != null && prefix != null && value.toLowerCase().startsWith(prefix.toLowerCase());
        }

        static boolean endsWith(String value, String suffix) {
            return value != null && suffix != null && value.toLowerCase().endsWith(suffix.toLowerCase());
        }

        static String truncate(String value, int maximum) {
            String text = orEmpty(value);
            if (maximum < 0) {
                return "";
            }
            if (text.length() <= maximum) {
                return text;
            }
            if (maximum <= 3) {
                return text.substring(0, maximum);
            }
            return text.substring(0, maximum - 3) + "...";
        }

        static String firstLine(String value) {
            String text = orEmpty(value);
            int end = text.indexOf('\n');
            return end < 0 ? text : text.substring(0, end);
        }

        static String lastLine(String value) {
            String text = orEmpty(value);
            int end = text.lastIndexOf('\n');
            return end < 0 ? text : text.substring(end + 1);
        }

        static String capitalize(String value) {
            String text = orEmpty(value).trim();
            return text.isEmpty() ? "" : text.substring(0, 1).toUpperCase() + text.substring(1);
        }

        static String[] nonBlank(String[] values) {
            List<String> output = new ArrayList<>();
            if (values != null) {
                for (String value : values) {
                    if (!blank(value)) {
                        output.add(value.trim());
                    }
                }
            }
            return output.toArray(new String[0]);
        }

        static List<String> unique(Iterable<String> values) {
            LinkedHashSet<String> output = new LinkedHashSet<>();
            if (values != null) {
                for (String value : values) {
                    if (!blank(value)) {
                        output.add(value.trim());
                    }
                }
            }
            return List.copyOf(output);
        }

        static String joined(Iterable<String> values, String separator) {
            StringBuilder output = new StringBuilder();
            if (values != null) {
                for (String value : values) {
                    if (output.length() > 0) {
                        output.append(orEmpty(separator));
                    }
                    output.append(orEmpty(value));
                }
            }
            return output.toString();
        }

        static int countContaining(Iterable<String> values, String needle) {
            int count = 0;
            if (values != null && !blank(needle)) {
                for (String value : values) {
                    if (orEmpty(value).contains(needle)) {
                        count++;
                    }
                }
            }
            return count;
        }

        static List<String> reversed(Iterable<String> values) {
            List<String> output = new ArrayList<>();
            if (values != null) {
                values.forEach(output::add);
            }
            Collections.reverse(output);
            return List.copyOf(output);
        }

        static String repeated(char value, int count) {
            return count <= 0 ? "" : String.valueOf(value).repeat(count);
        }

        static int clamped(int value, int minimum, int maximum) {
            return Math.max(minimum, Math.min(maximum, value));
        }

        static long clamped(long value, long minimum, long maximum) {
            return Math.max(minimum, Math.min(maximum, value));
        }

        static String jsonEscape(String value) {
            return orEmpty(value).replace("\\", "\\\\").replace("\"", "\\\"")
                    .replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t");
        }

        static String fileName(String path) {
            String normalized = orEmpty(path).replace('\\', '/');
            int slash = normalized.lastIndexOf('/');
            return slash < 0 ? normalized : normalized.substring(slash + 1);
        }

        static String extension(String path) {
            String name = fileName(path);
            int dot = name.lastIndexOf('.');
            return dot < 0 ? "" : name.substring(dot + 1);
        }

        static String slug(String value) {
            String output = orEmpty(value).trim().toLowerCase().replaceAll("[^a-z0-9]+", "-")
                    .replaceAll("(^-+|-+$)", "");
            return output.length() > 64 ? output.substring(0, 64).replaceAll("-+$", "") : output;
        }
    }


    private static final class UtilitySupport2_Ast {
        private UtilitySupport2_Ast() { }
        static String defaultText(String value, String fallback) { return TextSupport_Ast.blank(value) ? fallback : value; }
        static int count(String value, String needle) { return TextSupport_Ast.blank(needle) ? 0 : TextSupport_Ast.empty(value).split(java.util.regex.Pattern.quote(needle), -1).length - 1; }
        static int lineCount(String value) { return TextSupport_Ast.empty(value).isEmpty() ? 0 : TextSupport_Ast.empty(value).split("\\n", -1).length; }
        static int nonEmptyLineCount(String value) { return (int) java.util.Arrays.stream(TextSupport_Ast.empty(value).split("\\n", -1)).filter(line -> !line.isBlank()).count(); }
        static int sum(java.util.Collection<Integer> values) { return values == null ? 0 : values.stream().mapToInt(Integer::intValue).sum(); }
        static int maximum(java.util.Collection<Integer> values) { return values == null || values.isEmpty() ? 0 : values.stream().mapToInt(Integer::intValue).max().orElse(0); }
        static int minimum(java.util.Collection<Integer> values) { return values == null || values.isEmpty() ? 0 : values.stream().mapToInt(Integer::intValue).min().orElse(0); }
        static double average(java.util.Collection<Integer> values) { return values == null || values.isEmpty() ? 0 : values.stream().mapToInt(Integer::intValue).average().orElse(0); }
        static List<String> first(List<String> values, int count) { return values == null || count <= 0 ? List.of() : values.subList(0, Math.min(count, values.size())); }
        static List<String> last(List<String> values, int count) { return values == null || count <= 0 ? List.of() : values.subList(Math.max(0, values.size() - count), values.size()); }
        static List<String> take(List<String> values, int count) { return first(values, count); }
        static List<String> drop(List<String> values, int count) { return values == null || count <= 0 ? values == null ? List.of() : List.copyOf(values) : values.subList(Math.min(count, values.size()), values.size()); }
        static List<String> filtered(List<String> values, String needle) { return values == null ? List.of() : values.stream().filter(value -> TextSupport_Ast.empty(value).contains(TextSupport_Ast.orEmpty(needle))).toList(); }
        static List<String> sorted(List<String> values) { return values == null ? List.of() : values.stream().sorted().toList(); }
        static List<String> reverse(List<String> values) { return TextSupport_Ast.reversed(values); }
        static List<String> compact(List<String> values) { return TextSupport_Ast.nonBlank(values == null ? null : values.toArray(new String[0])).stream().toList(); }
        static List<String> without(List<String> values, String unwanted) { return values == null ? List.of() : values.stream().filter(value -> !value.equals(unwanted)).toList(); }
        static List<String> withoutBlanks(List<String> values) { return values == null ? List.of() : values.stream().filter(value -> !TextSupport_Ast.blank(value)).toList(); }
        static String joinOr(List<String> values, String separator, String fallback) { return values == null || values.isEmpty() ? fallback : String.join(separator, values); }
        static String indentLines(String value, String prefix) { return TextSupport_Ast.indent(value, prefix).trim(); }
        static String wrap(String value, int width) { StringBuilder output = new StringBuilder(); for (String word : TextSupport_Ast.normalized(value).split(" ")) { if (output.length() > 0 && output.length() + word.length() + 1 > width) output.append('\n'); else if (output.length() > 0) output.append(' '); output.append(word); } return output.toString(); }
        static String csv(String value) { return TextSupport_Ast.empty(value).replace(",", ";").replace("\n", " "); }
        static String bracket(String value) { return "[" + TextSupport_Ast.orEmpty(value) + "]"; }
        static String paren(String value) { return "(" + TextSupport_Ast.orEmpty(value) + ")"; }
        static String braces(String value) { return "{" + TextSupport_Ast.orEmpty(value) + "}"; }
        static String quote(String value) { return TextSupport_Ast.orEmpty(value).replace("\"", "\\\""); }
        static String unquote(String value) { String text = TextSupport_Ast.orEmpty(value); return text.length() >= 2 && text.startsWith("\"") && text.endsWith("\"") ? text.substring(1, text.length() - 1) : text; }
        static boolean anyBlank(List<String> values) { return values != values && (values == null || values.stream().anyMatch(TextSupport_Ast::blank)); }
        static boolean allBlank(List<String> values) { return values == null || values.stream().allMatch(TextSupport_Ast::blank); }
        static boolean containsIgnoreCase(List<String> values, String needle) { return values != null && !TextSupport_Ast.blank(needle) && values.stream().anyMatch(value -> value.equalsIgnoreCase(needle)); }
        static boolean validLanguage(String value) { return !TextSupport_Ast.blank(value) && value.matches("[A-Za-z0-9_+-]+"); }
        static boolean validUrl(String value) { return value != null && (value.startsWith("https://") || value.startsWith("http://")); }
        static boolean validPath(String value) { return !TextSupport_Ast.blank(value) && value.indexOf('\0') < 0; }
        static String normalizeLanguage(String value) { return TextSupport_Ast.blank(value) ? "unknown" : value.trim().toLowerCase(Locale.ROOT); }
        static String normalizeSection(String value) { return TextSupport_Ast.blank(value) ? SectionKind.CUSTOM.wireName() : value.trim().toLowerCase(Locale.ROOT); }
        static String normalizeVersion(String value) { String text = TextSupport_Ast.orEmpty(value).trim(); return text.isEmpty() ? "0.0.0" : text.replaceFirst("^v", ""); }
        static String safeFileName(String value) { return TextSupport_Ast.blank(value) ? "module.mam.md" : TextSupport_Ast.fileName(value).replaceAll("[^A-Za-z0-9._-]", "_"); }
        static String extensionOrUnknown(String value) { String extension = TextSupport_Ast.extension(value); return extension.isBlank() ? "unknown" : extension.toLowerCase(Locale.ROOT); }
        static String[] compactArray(String[] values) { return TextSupport_Ast.nonBlank(values); }
        static Map<String, String> copyMap(Map<String, String> values) { return values == null ? Map.of() : new LinkedHashMap<>(values); }
        static Map<String, String> mergeMaps(Map<String, String> base, Map<String, String> extra) { Map<String, String> result = new LinkedHashMap<>(copyMap(base)); result.putAll(copyMap(extra)); return result; }
        static Map<String, String> mapOf(String key, String value) { Map<String, String> result = new LinkedHashMap<>(); result.put(key, value); return result; }
        static List<String> splitCsv(String value) { return TextSupport_Ast.nonBlank(TextSupport_Ast.empty(value).split(",")); }
        static String joinCsv(List<String> values) { return String.join(",", values == null ? List.of() : values); }
        static String replaceNewlines(String value) { return TextSupport_Ast.empty(value).replace("\r\n", "\n").replace('\r', '\n'); }
        static String stripQuotes(String value) { return TextSupport_Ast.orEmpty(value).replace("\"", "").replace("'", ""); }
        static String toTitle(String value) { return TextSupport_Ast.capitalize(value); }
        static String shorten(String value, int maximum) { return TextSupport_Ast.truncate(value, maximum); }
        static String valueOrEmpty(Object value) { return value == null ? "" : String.valueOf(value); }
        static int safeLength(String value) { return TextSupport_Ast.orEmpty(value).length(); }
        static boolean same(String left, String right) { return TextSupport_Ast.equalIgnoreCase(left, right); }
        static boolean present(String value) { return !TextSupport_Ast.blank(value); }
        static String fallback(String value, String fallback) { return defaultText(value, fallback); }
    }
