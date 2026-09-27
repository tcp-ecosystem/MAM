package com.mam;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Dependency-free parser for the documented Markdown and YAML subset. */
public final class Parser {
    private static final Pattern FRONTMATTER = Pattern.compile("^---\\s*$");
    private static final Pattern HEADING = Pattern.compile("^(#{1,6})\\s+(.+)$");
    private static final Pattern FENCE = Pattern.compile("^```([^ ]*)?\\s*$");
    private Parser() { }

    /** Parses raw text, rejecting only unterminated front matter or fences. */
    public static Ast.Module parse(String content, String filePath) throws MamParseException {
        String source = normalize(content);
        String[] lines = source.split("\n", -1);
        int cursor = 0;
        Ast.FrontMatter front = null;
        if (lines.length > 0 && delimiter(lines[0])) {
            List<String> yaml = new ArrayList<>();
            cursor = 1;
            while (cursor < lines.length && !delimiter(lines[cursor])) yaml.add(lines[cursor++]);
            if (cursor == lines.length) throw new MamParseException("unterminated front matter", safe(filePath), 1, 1);
            cursor++;
            front = frontMatter(String.join("\n", yaml), safe(filePath));
        }
        List<Ast.Section> sections = new ArrayList<>();
        while (cursor < lines.length) {
            Matcher heading = heading(lines[cursor]);
            if (heading == null) { cursor++; continue; }
            String title = heading.group(2).trim();
            int startLine = cursor + 1;
            cursor++;
            List<String> body = new ArrayList<>();
            while (cursor < lines.length && heading(lines[cursor]) == null) body.add(lines[cursor++]);
            sections.add(new Ast.Section(Ast.SectionKind.parse(title), title, nodes(body, startLine, safe(filePath)),
                    new Ast.Location(startLine, 1, 0, safe(filePath))));
        }
        return new Ast.Module(front, sections, source, safe(filePath));
    }

    /** Reads and parses a UTF-8 file; missing files produce IOException. */
    public static Ast.Module parse(Path path) throws IOException, MamParseException {
        if (path == null) throw new IOException("path is null");
        return parse(Files.readString(path, StandardCharsets.UTF_8), path.toString());
    }

    /** Parses without throwing, returning a success or failure value. */
    public static ParseResult safeParse(String content, String filePath) {
        try { return ParseResult.success(parse(content, filePath)); }
        catch (MamParseException error) { return ParseResult.failure(error.getMessage(), error.line(), error.column()); }
    }

    /** Normalizes CRLF and CR line endings and strips a leading BOM. */
    public static String normalize(String content) {
        String value = content == null ? "" : content;
        if (!value.isEmpty() && value.charAt(0) == '\uFEFF') value = value.substring(1);
        return value.replace("\r\n", "\n").replace('\r', '\n');
    }

    /** Reports whether source begins with a YAML delimiter. */
    public static boolean hasFrontMatter(String content) {
        String normalized = normalize(content);
        return !normalized.isEmpty() && delimiter(normalized.split("\n", -1)[0]);
    }

    /** Extracts raw front matter; absent or unterminated blocks return empty text. */
    public static String extractFrontMatter(String content) {
        String[] lines = normalize(content).split("\n", -1);
        if (lines.length == 0 || !delimiter(lines[0])) return "";
        List<String> output = new ArrayList<>();
        for (int i = 1; i < lines.length && !delimiter(lines[i]); i++) output.add(lines[i]);
        return String.join("\n", output);
    }

    /** Lists section titles without constructing an AST. */
    public static List<String> sectionTitles(String content) {
        List<String> output = new ArrayList<>();
        for (String line : normalize(content).split("\n", -1)) {
            Matcher matcher = heading(line);
            if (matcher != null && matcher.group(1).length() == 2) output.add(matcher.group(2).trim());
        }
        return List.copyOf(output);
    }

    /** Parses scalars, quoted strings, integers, booleans, null, arrays, and simple maps. */
    public static Ast.FrontMatter frontMatter(String yaml, String path) throws MamParseException {
        Map<String, Object> values = yamlMap(yaml, path);
        return new Ast.FrontMatter(text(values.get("name")), list(values.get("authors")), text(values.get("version")),
                text(values.get("description")), text(values.get("schema_version")), text(values.get("license")),
                list(values.get("tags")), list(values.get("dependencies")), stringMap(values.get("metadata")));
    }

    private static List<Ast.ContentNode> nodes(List<String> body, int base, String path) throws MamParseException {
        List<Ast.ContentNode> output = new ArrayList<>();
        for (int i = 0; i < body.size();) {
            String line = body.get(i);
            if (FENCE.matcher(line.trim()).matches() && line.trim().startsWith("```")) {
                String language = line.trim().substring(3).trim();
                List<String> code = new ArrayList<>();
                i++;
                boolean closed = false;
                while (i < body.size()) { if (body.get(i).trim().equals("```")) { closed = true; i++; break; } code.add(body.get(i++)); }
                if (!closed) throw new MamParseException("unterminated code fence", path, base, 1);
                output.add(new Ast.CodeBlock(language, String.join("\n", code), new Ast.Location(base, 1, 0, path)));
            } else if (!line.isBlank()) {
                List<String> paragraph = new ArrayList<>();
                while (i < body.size() && !body.get(i).isBlank() && !body.get(i).trim().startsWith("```")) paragraph.add(body.get(i++));
                output.add(new Ast.Paragraph(String.join("\n", paragraph), new Ast.Location(base, 1, 0, path)));
            } else i++;
        }
        return output;
    }

    private static Map<String, Object> yamlMap(String yaml, String path) throws MamParseException {
        Map<String, Object> output = new LinkedHashMap<>();
        if (yaml == null || yaml.isBlank()) return output;
        String[] lines = yaml.split("\n", -1);
        for (int i = 0; i < lines.length; i++) {
            String line = lines[i];
            if (line.isBlank() || line.trim().startsWith("#")) continue;
            int colon = line.indexOf(':');
            if (colon <= 0) throw new MamParseException("unsupported YAML line: " + line, path, i + 1, 1);
            String key = line.substring(0, colon).trim();
            String value = line.substring(colon + 1).trim();
            if (value.isEmpty() && i + 1 < lines.length && lines[i + 1].startsWith("  ")) {
                List<String> nested = new ArrayList<>();
                i++;
                while (i < lines.length && (lines[i].startsWith("  ") || lines[i].isBlank())) nested.add(lines[i++].trim());
                i--;
                Map<String, String> values = new LinkedHashMap<>();
                for (String item : nested) { int nestedColon = item.indexOf(':'); if (nestedColon > 0) values.put(item.substring(0, nestedColon).trim(), unquote(item.substring(nestedColon + 1).trim())); }
                output.put(key, values);
            } else output.put(key, scalar(value));
        }
        return output;
    }

    private static Object scalar(String raw) {
        String value = raw.trim();
        if (value.equals("[]")) return List.of();
        if (value.startsWith("[") && value.endsWith("]")) {
            List<String> values = new ArrayList<>();
            String inner = value.substring(1, value.length() - 1);
            for (String part : inner.split(",", -1)) if (!part.isBlank()) values.add(unquote(part.trim()));
            return List.copyOf(values);
        }
        if (value.equals("null") || value.equals("~")) return "";
        if (value.equals("true")) return true;
        if (value.equals("false")) return false;
        try { return Long.valueOf(value); } catch (NumberFormatException ignored) { return unquote(value); }
    }

    private static String unquote(String value) {
        if (value.length() >= 2) { char q = value.charAt(0); if ((q == '\'' || q == '"') && value.charAt(value.length() - 1) == q) return value.substring(1, value.length() - 1).replace("\\\"", "\""); }
        return value;
    }

    private static String text(Object value) { return value == null ? "" : String.valueOf(value).trim(); }
    private static List<String> list(Object value) { if (value instanceof List<?> values) return values.stream().map(Parser::text).toList(); String scalar = text(value); return scalar.isEmpty() ? List.of() : List.of(scalar); }
    @SuppressWarnings("unchecked") private static Map<String, String> stringMap(Object value) { if (!(value instanceof Map<?, ?> map)) return Map.of(); Map<String, String> output = new LinkedHashMap<>(); for (Map.Entry<?, ?> entry : map.entrySet()) output.put(String.valueOf(entry.getKey()), text(entry.getValue())); return output; }
    private static boolean delimiter(String line) { return FRONTMATTER.matcher(line).matches(); }
    private static Matcher heading(String line) { return HEADING.matcher(line); }
    private static String safe(String path) { return path == null ? "" : path; }

    /** Non-throwing parse outcome. */
    public record ParseResult(boolean success, Ast.Module module, String error, int line, int column) {
        /** Creates a success value. */
        public static ParseResult success(Ast.Module module) { return new ParseResult(true, module, "", 0, 0); }
        /** Creates a failure value. */
        public static ParseResult failure(String error, int line, int column) { return new ParseResult(false, null, TextSupport_Parser.orEmpty(error), line, column); }
    }

    /** Checked structural parse failure. */
    public static final class MamParseException extends Exception {
        private final String filePath; private final int line; private final int column;
        /** Creates a located failure. */
        public MamParseException(String message, String filePath, int line, int column) { super(TextSupport_Parser.orEmpty(message)); this.filePath = TextSupport_Parser.orEmpty(filePath); this.line = Math.max(0, line); this.column = Math.max(0, column); }
        /** Returns source path. */
        public String filePath() { return filePath; }
        /** Returns one-based line. */
        public int line() { return line; }
        /** Returns one-based column. */
        public int column() { return column; }
    }
}

    private static final class TextSupport_Parser {
        private TextSupport_Parser() {
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


    private static final class UtilitySupport2_Parser {
        private UtilitySupport2_Parser() { }
        static String defaultText(String value, String fallback) { return TextSupport_Parser.blank(value) ? fallback : value; }
        static int count(String value, String needle) { return TextSupport_Parser.blank(needle) ? 0 : TextSupport_Parser.empty(value).split(java.util.regex.Pattern.quote(needle), -1).length - 1; }
        static int lineCount(String value) { return TextSupport_Parser.empty(value).isEmpty() ? 0 : TextSupport_Parser.empty(value).split("\\n", -1).length; }
        static int nonEmptyLineCount(String value) { return (int) java.util.Arrays.stream(TextSupport_Parser.empty(value).split("\\n", -1)).filter(line -> !line.isBlank()).count(); }
        static int sum(java.util.Collection<Integer> values) { return values == null ? 0 : values.stream().mapToInt(Integer::intValue).sum(); }
        static int maximum(java.util.Collection<Integer> values) { return values == null || values.isEmpty() ? 0 : values.stream().mapToInt(Integer::intValue).max().orElse(0); }
        static int minimum(java.util.Collection<Integer> values) { return values == null || values.isEmpty() ? 0 : values.stream().mapToInt(Integer::intValue).min().orElse(0); }
        static double average(java.util.Collection<Integer> values) { return values == null || values.isEmpty() ? 0 : values.stream().mapToInt(Integer::intValue).average().orElse(0); }
        static List<String> first(List<String> values, int count) { return values == null || count <= 0 ? List.of() : values.subList(0, Math.min(count, values.size())); }
        static List<String> last(List<String> values, int count) { return values == null || count <= 0 ? List.of() : values.subList(Math.max(0, values.size() - count), values.size()); }
        static List<String> take(List<String> values, int count) { return first(values, count); }
        static List<String> drop(List<String> values, int count) { return values == null || count <= 0 ? values == null ? List.of() : List.copyOf(values) : values.subList(Math.min(count, values.size()), values.size()); }
        static List<String> filtered(List<String> values, String needle) { return values == null ? List.of() : values.stream().filter(value -> TextSupport_Parser.empty(value).contains(TextSupport_Parser.orEmpty(needle))).toList(); }
        static List<String> sorted(List<String> values) { return values == null ? List.of() : values.stream().sorted().toList(); }
        static List<String> reverse(List<String> values) { return TextSupport_Parser.reversed(values); }
        static List<String> compact(List<String> values) { return TextSupport_Parser.nonBlank(values == null ? null : values.toArray(new String[0])).stream().toList(); }
        static List<String> without(List<String> values, String unwanted) { return values == null ? List.of() : values.stream().filter(value -> !value.equals(unwanted)).toList(); }
        static List<String> withoutBlanks(List<String> values) { return values == null ? List.of() : values.stream().filter(value -> !TextSupport_Parser.blank(value)).toList(); }
        static String joinOr(List<String> values, String separator, String fallback) { return values == null || values.isEmpty() ? fallback : String.join(separator, values); }
        static String indentLines(String value, String prefix) { return TextSupport_Parser.indent(value, prefix).trim(); }
        static String wrap(String value, int width) { StringBuilder output = new StringBuilder(); for (String word : TextSupport_Parser.normalized(value).split(" ")) { if (output.length() > 0 && output.length() + word.length() + 1 > width) output.append('\n'); else if (output.length() > 0) output.append(' '); output.append(word); } return output.toString(); }
        static String csv(String value) { return TextSupport_Parser.empty(value).replace(",", ";").replace("\n", " "); }
        static String bracket(String value) { return "[" + TextSupport_Parser.orEmpty(value) + "]"; }
        static String paren(String value) { return "(" + TextSupport_Parser.orEmpty(value) + ")"; }
        static String braces(String value) { return "{" + TextSupport_Parser.orEmpty(value) + "}"; }
        static String quote(String value) { return TextSupport_Parser.orEmpty(value).replace("\"", "\\\""); }
        static String unquote(String value) { String text = TextSupport_Parser.orEmpty(value); return text.length() >= 2 && text.startsWith("\"") && text.endsWith("\"") ? text.substring(1, text.length() - 1) : text; }
        static boolean anyBlank(List<String> values) { return values != values && (values == null || values.stream().anyMatch(TextSupport_Parser::blank)); }
        static boolean allBlank(List<String> values) { return values == null || values.stream().allMatch(TextSupport_Parser::blank); }
        static boolean containsIgnoreCase(List<String> values, String needle) { return values != null && !TextSupport_Parser.blank(needle) && values.stream().anyMatch(value -> value.equalsIgnoreCase(needle)); }
        static boolean validLanguage(String value) { return !TextSupport_Parser.blank(value) && value.matches("[A-Za-z0-9_+-]+"); }
        static boolean validUrl(String value) { return value != null && (value.startsWith("https://") || value.startsWith("http://")); }
        static boolean validPath(String value) { return !TextSupport_Parser.blank(value) && value.indexOf('\0') < 0; }
        static String normalizeLanguage(String value) { return TextSupport_Parser.blank(value) ? "unknown" : value.trim().toLowerCase(Locale.ROOT); }
        static String normalizeSection(String value) { return TextSupport_Parser.blank(value) ? SectionKind.CUSTOM.wireName() : value.trim().toLowerCase(Locale.ROOT); }
        static String normalizeVersion(String value) { String text = TextSupport_Parser.orEmpty(value).trim(); return text.isEmpty() ? "0.0.0" : text.replaceFirst("^v", ""); }
        static String safeFileName(String value) { return TextSupport_Parser.blank(value) ? "module.mam.md" : TextSupport_Parser.fileName(value).replaceAll("[^A-Za-z0-9._-]", "_"); }
        static String extensionOrUnknown(String value) { String extension = TextSupport_Parser.extension(value); return extension.isBlank() ? "unknown" : extension.toLowerCase(Locale.ROOT); }
        static String[] compactArray(String[] values) { return TextSupport_Parser.nonBlank(values); }
        static Map<String, String> copyMap(Map<String, String> values) { return values == null ? Map.of() : new LinkedHashMap<>(values); }
        static Map<String, String> mergeMaps(Map<String, String> base, Map<String, String> extra) { Map<String, String> result = new LinkedHashMap<>(copyMap(base)); result.putAll(copyMap(extra)); return result; }
        static Map<String, String> mapOf(String key, String value) { Map<String, String> result = new LinkedHashMap<>(); result.put(key, value); return result; }
        static List<String> splitCsv(String value) { return TextSupport_Parser.nonBlank(TextSupport_Parser.empty(value).split(",")); }
        static String joinCsv(List<String> values) { return String.join(",", values == null ? List.of() : values); }
        static String replaceNewlines(String value) { return TextSupport_Parser.empty(value).replace("\r\n", "\n").replace('\r', '\n'); }
        static String stripQuotes(String value) { return TextSupport_Parser.orEmpty(value).replace("\"", "").replace("'", ""); }
        static String toTitle(String value) { return TextSupport_Parser.capitalize(value); }
        static String shorten(String value, int maximum) { return TextSupport_Parser.truncate(value, maximum); }
        static String valueOrEmpty(Object value) { return value == null ? "" : String.valueOf(value); }
        static int safeLength(String value) { return TextSupport_Parser.orEmpty(value).length(); }
        static boolean same(String left, String right) { return TextSupport_Parser.equalIgnoreCase(left, right); }
        static boolean present(String value) { return !TextSupport_Parser.blank(value); }
        static String fallback(String value, String fallback) { return defaultText(value, fallback); }
    }
