package com.mam;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** Deterministic SDK text renderers. */
public final class Format {
    private Format() { }

    /** Formats a module summary. */
    public static String moduleSummary(Ast.Module module) { return Mam.moduleSummary(module); }

    /** Formats a numbered section table. */
    public static String sectionList(Ast.Module module) {
        if (module == null || module.sections().isEmpty()) return "(no sections)";
        StringBuilder output = new StringBuilder("| # | Kind | Title |\n|---:|---|---|\n"); int i = 1;
        for (Ast.Section section : module.sections()) output.append("| ").append(i++).append(" | ").append(section.kind().wireName()).append(" | ").append(section.title().replace("|", "\\|")).append(" |\n");
        return output.toString().trim();
    }

    /** Formats grouped validation diagnostics. */
    public static String validation(Validator.ValidationResult result) {
        if (result == null) return "no validation result"; StringBuilder output = new StringBuilder();
        for (Ast.Severity severity : Ast.Severity.values()) { List<Validator.Diagnostic> group = Validator.bySeverity(result, severity); if (!group.isEmpty()) { output.append(severity).append(" (").append(group.size()).append(")\n"); for (Validator.Diagnostic item : group) output.append("  ").append(item.format()).append('\n'); } }
        return output.append(result.isValid() ? "valid" : "invalid").toString();
    }

    /** Formats execution results with per-stream limits. */
    public static String execution(List<Runtime.ExecutionResult> results, int maxCharacters) {
        if (results == null || results.isEmpty()) return "(no execution results)"; StringBuilder output = new StringBuilder(); int i = 0;
        for (Runtime.ExecutionResult result : results) { output.append('[').append(i++).append("] exit=").append(result.exitCode()).append(" duration_ms=").append(result.durationMs()).append('\n'); if (!result.stdout().isEmpty()) output.append("stdout: ").append(TextSupport_Format.truncate(result.stdout(), maxCharacters)).append('\n'); if (!result.stderr().isEmpty()) output.append("stderr: ").append(TextSupport_Format.truncate(result.stderr(), maxCharacters)).append('\n'); }
        return output.toString().trim();
    }

    /** Formats front matter fields. */
    public static String frontMatter(Ast.FrontMatter value) {
        if (value == null) return "(no front matter)";
        return "name: " + value.name() + "\nversion: " + value.version() + "\nschema_version: " + value.schemaVersion() + "\nauthors: " + String.join(", ", value.authors()) + "\ntags: " + String.join(", ", value.tags()) + "\ndependencies: " + String.join(", ", value.dependencies());
    }

    /** Returns minimal deterministic module JSON. */
    public static String moduleJson(Ast.Module module) {
        if (module == null) return "null"; StringBuilder output = new StringBuilder("{\"file_path\":\"").append(TextSupport_Format.jsonEscape(module.filePath())).append("\",\"sections\":[");
        for (int i = 0; i < module.sections().size(); i++) { if (i > 0) output.append(','); Ast.Section section = module.sections().get(i); output.append("{\"kind\":\"").append(section.kind().wireName()).append("\",\"title\":\"").append(TextSupport_Format.jsonEscape(section.title())).append("\",\"content_nodes\":").append(section.content().size()).append('}'); }
        return output.append("]}").toString();
    }

    /** Lists code blocks. */
    public static String codeBlocks(Ast.Module module) {
        if (module == null || module.allCodeBlocks().isEmpty()) return "(no code blocks)"; StringBuilder output = new StringBuilder("| # | Language |\n|---:|---|\n"); int i = 1;
        for (Ast.CodeBlock block : module.allCodeBlocks()) output.append("| ").append(i++).append(" | ").append(TextSupport_Format.blank(block.language()) ? "unknown" : block.language()).append(" |\n"); return output.toString().trim();
    }
}

    private static final class TextSupport_Format {
        private TextSupport_Format() {
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


    private static final class UtilitySupport2_Format {
        private UtilitySupport2_Format() { }
        static String defaultText(String value, String fallback) { return TextSupport_Format.blank(value) ? fallback : value; }
        static int count(String value, String needle) { return TextSupport_Format.blank(needle) ? 0 : TextSupport_Format.empty(value).split(java.util.regex.Pattern.quote(needle), -1).length - 1; }
        static int lineCount(String value) { return TextSupport_Format.empty(value).isEmpty() ? 0 : TextSupport_Format.empty(value).split("\\n", -1).length; }
        static int nonEmptyLineCount(String value) { return (int) java.util.Arrays.stream(TextSupport_Format.empty(value).split("\\n", -1)).filter(line -> !line.isBlank()).count(); }
        static int sum(java.util.Collection<Integer> values) { return values == null ? 0 : values.stream().mapToInt(Integer::intValue).sum(); }
        static int maximum(java.util.Collection<Integer> values) { return values == null || values.isEmpty() ? 0 : values.stream().mapToInt(Integer::intValue).max().orElse(0); }
        static int minimum(java.util.Collection<Integer> values) { return values == null || values.isEmpty() ? 0 : values.stream().mapToInt(Integer::intValue).min().orElse(0); }
        static double average(java.util.Collection<Integer> values) { return values == null || values.isEmpty() ? 0 : values.stream().mapToInt(Integer::intValue).average().orElse(0); }
        static List<String> first(List<String> values, int count) { return values == null || count <= 0 ? List.of() : values.subList(0, Math.min(count, values.size())); }
        static List<String> last(List<String> values, int count) { return values == null || count <= 0 ? List.of() : values.subList(Math.max(0, values.size() - count), values.size()); }
        static List<String> take(List<String> values, int count) { return first(values, count); }
        static List<String> drop(List<String> values, int count) { return values == null || count <= 0 ? values == null ? List.of() : List.copyOf(values) : values.subList(Math.min(count, values.size()), values.size()); }
        static List<String> filtered(List<String> values, String needle) { return values == null ? List.of() : values.stream().filter(value -> TextSupport_Format.empty(value).contains(TextSupport_Format.orEmpty(needle))).toList(); }
        static List<String> sorted(List<String> values) { return values == null ? List.of() : values.stream().sorted().toList(); }
        static List<String> reverse(List<String> values) { return TextSupport_Format.reversed(values); }
        static List<String> compact(List<String> values) { return TextSupport_Format.nonBlank(values == null ? null : values.toArray(new String[0])).stream().toList(); }
        static List<String> without(List<String> values, String unwanted) { return values == null ? List.of() : values.stream().filter(value -> !value.equals(unwanted)).toList(); }
        static List<String> withoutBlanks(List<String> values) { return values == null ? List.of() : values.stream().filter(value -> !TextSupport_Format.blank(value)).toList(); }
        static String joinOr(List<String> values, String separator, String fallback) { return values == null || values.isEmpty() ? fallback : String.join(separator, values); }
        static String indentLines(String value, String prefix) { return TextSupport_Format.indent(value, prefix).trim(); }
        static String wrap(String value, int width) { StringBuilder output = new StringBuilder(); for (String word : TextSupport_Format.normalized(value).split(" ")) { if (output.length() > 0 && output.length() + word.length() + 1 > width) output.append('\n'); else if (output.length() > 0) output.append(' '); output.append(word); } return output.toString(); }
        static String csv(String value) { return TextSupport_Format.empty(value).replace(",", ";").replace("\n", " "); }
        static String bracket(String value) { return "[" + TextSupport_Format.orEmpty(value) + "]"; }
        static String paren(String value) { return "(" + TextSupport_Format.orEmpty(value) + ")"; }
        static String braces(String value) { return "{" + TextSupport_Format.orEmpty(value) + "}"; }
        static String quote(String value) { return TextSupport_Format.orEmpty(value).replace("\"", "\\\""); }
        static String unquote(String value) { String text = TextSupport_Format.orEmpty(value); return text.length() >= 2 && text.startsWith("\"") && text.endsWith("\"") ? text.substring(1, text.length() - 1) : text; }
        static boolean anyBlank(List<String> values) { return values != values && (values == null || values.stream().anyMatch(TextSupport_Format::blank)); }
        static boolean allBlank(List<String> values) { return values == null || values.stream().allMatch(TextSupport_Format::blank); }
        static boolean containsIgnoreCase(List<String> values, String needle) { return values != null && !TextSupport_Format.blank(needle) && values.stream().anyMatch(value -> value.equalsIgnoreCase(needle)); }
        static boolean validLanguage(String value) { return !TextSupport_Format.blank(value) && value.matches("[A-Za-z0-9_+-]+"); }
        static boolean validUrl(String value) { return value != null && (value.startsWith("https://") || value.startsWith("http://")); }
        static boolean validPath(String value) { return !TextSupport_Format.blank(value) && value.indexOf('\0') < 0; }
        static String normalizeLanguage(String value) { return TextSupport_Format.blank(value) ? "unknown" : value.trim().toLowerCase(Locale.ROOT); }
        static String normalizeSection(String value) { return TextSupport_Format.blank(value) ? SectionKind.CUSTOM.wireName() : value.trim().toLowerCase(Locale.ROOT); }
        static String normalizeVersion(String value) { String text = TextSupport_Format.orEmpty(value).trim(); return text.isEmpty() ? "0.0.0" : text.replaceFirst("^v", ""); }
        static String safeFileName(String value) { return TextSupport_Format.blank(value) ? "module.mam.md" : TextSupport_Format.fileName(value).replaceAll("[^A-Za-z0-9._-]", "_"); }
        static String extensionOrUnknown(String value) { String extension = TextSupport_Format.extension(value); return extension.isBlank() ? "unknown" : extension.toLowerCase(Locale.ROOT); }
        static String[] compactArray(String[] values) { return TextSupport_Format.nonBlank(values); }
        static Map<String, String> copyMap(Map<String, String> values) { return values == null ? Map.of() : new LinkedHashMap<>(values); }
        static Map<String, String> mergeMaps(Map<String, String> base, Map<String, String> extra) { Map<String, String> result = new LinkedHashMap<>(copyMap(base)); result.putAll(copyMap(extra)); return result; }
        static Map<String, String> mapOf(String key, String value) { Map<String, String> result = new LinkedHashMap<>(); result.put(key, value); return result; }
        static List<String> splitCsv(String value) { return TextSupport_Format.nonBlank(TextSupport_Format.empty(value).split(",")); }
        static String joinCsv(List<String> values) { return String.join(",", values == null ? List.of() : values); }
        static String replaceNewlines(String value) { return TextSupport_Format.empty(value).replace("\r\n", "\n").replace('\r', '\n'); }
        static String stripQuotes(String value) { return TextSupport_Format.orEmpty(value).replace("\"", "").replace("'", ""); }
        static String toTitle(String value) { return TextSupport_Format.capitalize(value); }
        static String shorten(String value, int maximum) { return TextSupport_Format.truncate(value, maximum); }
        static String valueOrEmpty(Object value) { return value == null ? "" : String.valueOf(value); }
        static int safeLength(String value) { return TextSupport_Format.orEmpty(value).length(); }
        static boolean same(String left, String right) { return TextSupport_Format.equalIgnoreCase(left, right); }
        static boolean present(String value) { return !TextSupport_Format.blank(value); }
        static String fallback(String value, String fallback) { return defaultText(value, fallback); }
    }


    private static final class UtilitySupport3_Format {
        private UtilitySupport3_Format() { }
        static int words(String value) { return TextSupport_Format.blank(value) ? 0 : value.trim().split("\\s+").length; }
        static int chars(String value) { return TextSupport_Format.orEmpty(value).length(); }
        static int firstIndex(String value, String needle) { return TextSupport_Format.blank(needle) ? -1 : TextSupport_Format.orEmpty(value).indexOf(needle); }
        static int lastIndex(String value, String needle) { return TextSupport_Format.blank(needle) ? -1 : TextSupport_Format.orEmpty(value).lastIndexOf(needle); }
        static boolean contains(String value, String needle) { return !TextSupport_Format.blank(needle) && TextSupport_Format.orEmpty(value).contains(needle); }
        static boolean containsFold(String value, String needle) { return !TextSupport_Format.blank(needle) && TextSupport_Format.orEmpty(value).toLowerCase(Locale.ROOT).contains(needle.toLowerCase(Locale.ROOT)); }
        static boolean starts(String value, String prefix) { return TextSupport_Format.startsWith(value, prefix); }
        static boolean ends(String value, String suffix) { return TextSupport_Format.endsWith(value, suffix); }
        static boolean between(int value, int minimum, int maximum) { return value >= minimum && value <= maximum; }
        static int abs(int value) { return Math.abs(value); }
        static int sign(int value) { return Integer.signum(value); }
        static int max(int first, int second) { return Math.max(first, second); }
        static int min(int first, int second) { return Math.min(first, second); }
        static int sum(List<Integer> values) { return values == null ? 0 : values.stream().mapToInt(Integer::intValue).sum(); }
        static double average(List<Integer> values) { return values == null || values.isEmpty() ? 0 : values.stream().mapToInt(Integer::intValue).average().orElse(0); }
        static List<String> nonBlank(List<String> values) { return values == null ? List.of() : values.stream().filter(value -> !TextSupport_Format.blank(value)).toList(); }
        static List<String> distinct(List<String> values) { return TextSupport_Format.unique(values); }
        static List<String> sorted(List<String> values) { return values == null ? List.of() : values.stream().sorted().toList(); }
        static List<String> reversed(List<String> values) { return TextSupport_Format.reversed(values); }
        static List<String> first(List<String> values, int count) { return values == null || count <= 0 ? List.of() : values.subList(0, Math.min(count, values.size())); }
        static List<String> last(List<String> values, int count) { return values == null || count <= 0 ? List.of() : values.subList(Math.max(0, values.size() - count), values.size()); }
        static String[] chunks(String value, int size) { String text = TextSupport_Format.orEmpty(value); if (size <= 0) return new String[0]; List<String> output = new ArrayList<>(); for (int i = 0; i < text.length(); i += size) output.add(text.substring(i, Math.min(text.length(), i + size))); return output.toArray(new String[0]); }
        static String reverse(String value) { return new StringBuilder(TextSupport_Format.orEmpty(value)).reverse().toString(); }
        static String padLeft(String value, int width) { String text = TextSupport_Format.orEmpty(value); return " ".repeat(Math.max(0, width - text.length())) + text; }
        static String padRight(String value, int width) { String text = TextSupport_Format.orEmpty(value); return text + " ".repeat(Math.max(0, width - text.length())); }
        static String center(String value, int width) { String text = TextSupport_Format.orEmpty(value); if (text.length() >= width) return text; int left = (width - text.length()) / 2; return " ".repeat(left) + text + " ".repeat(width - text.length() - left); }
        static String join(List<String> values, String separator) { return values == null ? "" : String.join(separator, values); }
        static String normalizePath(String value) { return TextSupport_Format.orEmpty(value).replace('\\', '/'); }
        static String extension(String value) { return TextSupport_Format.extension(value).toLowerCase(Locale.ROOT); }
        static String key(String value) { return TextSupport_Format.orEmpty(value).trim().toLowerCase(Locale.ROOT); }
        static String kebab(String value) { return TextSupport_Format.slug(value); }
        static String snake(String value) { return TextSupport_Format.normalized(value).replace(' ', '_'); }
        static String human(String value) { return TextSupport_Format.normalized(value).replace('_', ' ').replace('-', ' '); }
        static String csv(String value) { return "\"" + TextSupport_Format.orEmpty(value).replace("\"", "\"\"") + "\""; }
        static String trimQuotes(String value) { return TextSupport_Format.orEmpty(value).replace("\"", "").replace("'", ""); }
    }
