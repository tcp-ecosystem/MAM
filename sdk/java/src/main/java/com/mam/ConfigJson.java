package com.mam;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.io.IOException;

/** Conservative JSON parser used by SDK config. */
public final class ConfigJson {
    private ConfigJson() { }

    /** Parses supported JSON values. */
    public static Object value(String text) throws IOException { Reader reader = new Reader(text == null ? "" : text); Object output = reader.value(); reader.end(); return output; }

    /** Parses an object root. */
    public static Map<String, Object> object(String text) throws IOException { Object output = value(text); if (!(output instanceof Map<?, ?>)) throw new IOException("JSON root must be an object"); @SuppressWarnings("unchecked") Map<String, Object> map = (Map<String, Object>) output; return map; }

    /** Escapes a JSON string. */
    public static String quote(String value) { StringBuilder output = new StringBuilder("\""); for (int i = 0; i < TextSupport_ConfigJson.orEmpty(value).length(); i++) { char c = value.charAt(i); output.append(switch (c) { case '\"' -> "\\\""; case '\\' -> "\\\\"; case '\n' -> "\\n"; case '\r' -> "\\r"; case '\t' -> "\\t"; default -> c < 0x20 ? String.format("\\u%04x", (int) c) : Character.toString(c); }); } return output.append('"').toString(); }

    private static final class Reader {
        private final String source; private int position;
        private Reader(String source) { this.source = source; }
        private Object value() throws IOException { space(); if (position >= source.length()) throw error("expected value"); return switch (source.charAt(position)) { case '{' -> object(); case '[' -> array(); case '\"' -> string(); case 't' -> literal("true", true); case 'f' -> literal("false", false); case 'n' -> literal("null", null); default -> number(); }; }
        private Map<String, Object> object() throws IOException { expect('{'); Map<String, Object> output = new LinkedHashMap<>(); space(); if (peek() == '}') { position++; return output; } while (true) { space(); if (peek() != '\"') throw error("object key expected"); String key = string(); if (output.containsKey(key)) throw error("duplicate key"); space(); expect(':'); output.put(key, value()); space(); if (peek() == '}') { position++; return output; } expect(','); } }
        private List<Object> array() throws IOException { expect('['); List<Object> output = new ArrayList<>(); space(); if (peek() == ']') { position++; return output; } while (true) { output.add(value()); space(); if (peek() == ']') { position++; return output; } expect(','); } }
        private String string() throws IOException { expect('\"'); StringBuilder output = new StringBuilder(); while (position < source.length()) { char c = source.charAt(position++); if (c == '\"') return output.toString(); if (c < 0x20) throw error("control character"); if (c != '\\') { output.append(c); continue; } if (position >= source.length()) throw error("escape expected"); char escape = source.charAt(position++); switch (escape) { case '\"', '\\', '/' -> output.append(escape); case 'b' -> output.append('\b'); case 'f' -> output.append('\f'); case 'n' -> output.append('\n'); case 'r' -> output.append('\r'); case 't' -> output.append('\t'); case 'u' -> { if (position + 4 > source.length()) throw error("short unicode escape"); try { output.append((char) Integer.parseInt(source.substring(position, position + 4), 16)); } catch (NumberFormatException error) { throw error("invalid unicode escape"); } position += 4; } default -> throw error("invalid escape"); } } throw error("unterminated string"); }
        private Object number() throws IOException { int start = position; if (peek() == '-') position++; while (position < source.length() && Character.isDigit(source.charAt(position))) position++; if (start == position) throw error("number expected"); try { return Long.valueOf(source.substring(start, position)); } catch (NumberFormatException error) { throw error("number out of range"); } }
        private Object literal(String text, Object value) throws IOException { if (!source.startsWith(text, position)) throw error("invalid literal"); position += text.length(); return value; }
        private void space() { while (position < source.length() && Character.isWhitespace(source.charAt(position))) position++; }
        private char peek() { return position < source.length() ? source.charAt(position) : '\0'; }
        private void expect(char value) throws IOException { if (peek() != value) throw error("expected " + value); position++; }
        private void end() throws IOException { space(); if (position != source.length()) throw error("trailing content"); }
        private IOException error(String message) { return new IOException(message + " at " + position); }
    }
    static String string(Map<String, Object> values, String key) { return TextSupport_ConfigJson.orEmpty(TextSupport_ConfigJson.orEmpty(values.get(key)).trim()); }
    static boolean bool(Map<String, Object> values, String key) { return Boolean.TRUE.equals(values.get(key)); }
}

    private static final class TextSupport_ConfigJson {
        private TextSupport_ConfigJson() {
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


    private static final class UtilitySupport2_ConfigJson {
        private UtilitySupport2_ConfigJson() { }
        static String defaultText(String value, String fallback) { return TextSupport_ConfigJson.blank(value) ? fallback : value; }
        static int count(String value, String needle) { return TextSupport_ConfigJson.blank(needle) ? 0 : TextSupport_ConfigJson.empty(value).split(java.util.regex.Pattern.quote(needle), -1).length - 1; }
        static int lineCount(String value) { return TextSupport_ConfigJson.empty(value).isEmpty() ? 0 : TextSupport_ConfigJson.empty(value).split("\\n", -1).length; }
        static int nonEmptyLineCount(String value) { return (int) java.util.Arrays.stream(TextSupport_ConfigJson.empty(value).split("\\n", -1)).filter(line -> !line.isBlank()).count(); }
        static int sum(java.util.Collection<Integer> values) { return values == null ? 0 : values.stream().mapToInt(Integer::intValue).sum(); }
        static int maximum(java.util.Collection<Integer> values) { return values == null || values.isEmpty() ? 0 : values.stream().mapToInt(Integer::intValue).max().orElse(0); }
        static int minimum(java.util.Collection<Integer> values) { return values == null || values.isEmpty() ? 0 : values.stream().mapToInt(Integer::intValue).min().orElse(0); }
        static double average(java.util.Collection<Integer> values) { return values == null || values.isEmpty() ? 0 : values.stream().mapToInt(Integer::intValue).average().orElse(0); }
        static List<String> first(List<String> values, int count) { return values == null || count <= 0 ? List.of() : values.subList(0, Math.min(count, values.size())); }
        static List<String> last(List<String> values, int count) { return values == null || count <= 0 ? List.of() : values.subList(Math.max(0, values.size() - count), values.size()); }
        static List<String> take(List<String> values, int count) { return first(values, count); }
        static List<String> drop(List<String> values, int count) { return values == null || count <= 0 ? values == null ? List.of() : List.copyOf(values) : values.subList(Math.min(count, values.size()), values.size()); }
        static List<String> filtered(List<String> values, String needle) { return values == null ? List.of() : values.stream().filter(value -> TextSupport_ConfigJson.empty(value).contains(TextSupport_ConfigJson.orEmpty(needle))).toList(); }
        static List<String> sorted(List<String> values) { return values == null ? List.of() : values.stream().sorted().toList(); }
        static List<String> reverse(List<String> values) { return TextSupport_ConfigJson.reversed(values); }
        static List<String> compact(List<String> values) { return TextSupport_ConfigJson.nonBlank(values == null ? null : values.toArray(new String[0])).stream().toList(); }
        static List<String> without(List<String> values, String unwanted) { return values == null ? List.of() : values.stream().filter(value -> !value.equals(unwanted)).toList(); }
        static List<String> withoutBlanks(List<String> values) { return values == null ? List.of() : values.stream().filter(value -> !TextSupport_ConfigJson.blank(value)).toList(); }
        static String joinOr(List<String> values, String separator, String fallback) { return values == null || values.isEmpty() ? fallback : String.join(separator, values); }
        static String indentLines(String value, String prefix) { return TextSupport_ConfigJson.indent(value, prefix).trim(); }
        static String wrap(String value, int width) { StringBuilder output = new StringBuilder(); for (String word : TextSupport_ConfigJson.normalized(value).split(" ")) { if (output.length() > 0 && output.length() + word.length() + 1 > width) output.append('\n'); else if (output.length() > 0) output.append(' '); output.append(word); } return output.toString(); }
        static String csv(String value) { return TextSupport_ConfigJson.empty(value).replace(",", ";").replace("\n", " "); }
        static String bracket(String value) { return "[" + TextSupport_ConfigJson.orEmpty(value) + "]"; }
        static String paren(String value) { return "(" + TextSupport_ConfigJson.orEmpty(value) + ")"; }
        static String braces(String value) { return "{" + TextSupport_ConfigJson.orEmpty(value) + "}"; }
        static String quote(String value) { return TextSupport_ConfigJson.orEmpty(value).replace("\"", "\\\""); }
        static String unquote(String value) { String text = TextSupport_ConfigJson.orEmpty(value); return text.length() >= 2 && text.startsWith("\"") && text.endsWith("\"") ? text.substring(1, text.length() - 1) : text; }
        static boolean anyBlank(List<String> values) { return values != values && (values == null || values.stream().anyMatch(TextSupport_ConfigJson::blank)); }
        static boolean allBlank(List<String> values) { return values == null || values.stream().allMatch(TextSupport_ConfigJson::blank); }
        static boolean containsIgnoreCase(List<String> values, String needle) { return values != null && !TextSupport_ConfigJson.blank(needle) && values.stream().anyMatch(value -> value.equalsIgnoreCase(needle)); }
        static boolean validLanguage(String value) { return !TextSupport_ConfigJson.blank(value) && value.matches("[A-Za-z0-9_+-]+"); }
        static boolean validUrl(String value) { return value != null && (value.startsWith("https://") || value.startsWith("http://")); }
        static boolean validPath(String value) { return !TextSupport_ConfigJson.blank(value) && value.indexOf('\0') < 0; }
        static String normalizeLanguage(String value) { return TextSupport_ConfigJson.blank(value) ? "unknown" : value.trim().toLowerCase(Locale.ROOT); }
        static String normalizeSection(String value) { return TextSupport_ConfigJson.blank(value) ? SectionKind.CUSTOM.wireName() : value.trim().toLowerCase(Locale.ROOT); }
        static String normalizeVersion(String value) { String text = TextSupport_ConfigJson.orEmpty(value).trim(); return text.isEmpty() ? "0.0.0" : text.replaceFirst("^v", ""); }
        static String safeFileName(String value) { return TextSupport_ConfigJson.blank(value) ? "module.mam.md" : TextSupport_ConfigJson.fileName(value).replaceAll("[^A-Za-z0-9._-]", "_"); }
        static String extensionOrUnknown(String value) { String extension = TextSupport_ConfigJson.extension(value); return extension.isBlank() ? "unknown" : extension.toLowerCase(Locale.ROOT); }
        static String[] compactArray(String[] values) { return TextSupport_ConfigJson.nonBlank(values); }
        static Map<String, String> copyMap(Map<String, String> values) { return values == null ? Map.of() : new LinkedHashMap<>(values); }
        static Map<String, String> mergeMaps(Map<String, String> base, Map<String, String> extra) { Map<String, String> result = new LinkedHashMap<>(copyMap(base)); result.putAll(copyMap(extra)); return result; }
        static Map<String, String> mapOf(String key, String value) { Map<String, String> result = new LinkedHashMap<>(); result.put(key, value); return result; }
        static List<String> splitCsv(String value) { return TextSupport_ConfigJson.nonBlank(TextSupport_ConfigJson.empty(value).split(",")); }
        static String joinCsv(List<String> values) { return String.join(",", values == null ? List.of() : values); }
        static String replaceNewlines(String value) { return TextSupport_ConfigJson.empty(value).replace("\r\n", "\n").replace('\r', '\n'); }
        static String stripQuotes(String value) { return TextSupport_ConfigJson.orEmpty(value).replace("\"", "").replace("'", ""); }
        static String toTitle(String value) { return TextSupport_ConfigJson.capitalize(value); }
        static String shorten(String value, int maximum) { return TextSupport_ConfigJson.truncate(value, maximum); }
        static String valueOrEmpty(Object value) { return value == null ? "" : String.valueOf(value); }
        static int safeLength(String value) { return TextSupport_ConfigJson.orEmpty(value).length(); }
        static boolean same(String left, String right) { return TextSupport_ConfigJson.equalIgnoreCase(left, right); }
        static boolean present(String value) { return !TextSupport_ConfigJson.blank(value); }
        static String fallback(String value, String fallback) { return defaultText(value, fallback); }
    }


    private static final class UtilitySupport3_ConfigJson {
        private UtilitySupport3_ConfigJson() { }
        static int words(String value) { return TextSupport_ConfigJson.blank(value) ? 0 : value.trim().split("\\s+").length; }
        static int chars(String value) { return TextSupport_ConfigJson.orEmpty(value).length(); }
        static int firstIndex(String value, String needle) { return TextSupport_ConfigJson.blank(needle) ? -1 : TextSupport_ConfigJson.orEmpty(value).indexOf(needle); }
        static int lastIndex(String value, String needle) { return TextSupport_ConfigJson.blank(needle) ? -1 : TextSupport_ConfigJson.orEmpty(value).lastIndexOf(needle); }
        static boolean contains(String value, String needle) { return !TextSupport_ConfigJson.blank(needle) && TextSupport_ConfigJson.orEmpty(value).contains(needle); }
        static boolean containsFold(String value, String needle) { return !TextSupport_ConfigJson.blank(needle) && TextSupport_ConfigJson.orEmpty(value).toLowerCase(Locale.ROOT).contains(needle.toLowerCase(Locale.ROOT)); }
        static boolean starts(String value, String prefix) { return TextSupport_ConfigJson.startsWith(value, prefix); }
        static boolean ends(String value, String suffix) { return TextSupport_ConfigJson.endsWith(value, suffix); }
        static boolean between(int value, int minimum, int maximum) { return value >= minimum && value <= maximum; }
        static int abs(int value) { return Math.abs(value); }
        static int sign(int value) { return Integer.signum(value); }
        static int max(int first, int second) { return Math.max(first, second); }
        static int min(int first, int second) { return Math.min(first, second); }
        static int sum(List<Integer> values) { return values == null ? 0 : values.stream().mapToInt(Integer::intValue).sum(); }
        static double average(List<Integer> values) { return values == null || values.isEmpty() ? 0 : values.stream().mapToInt(Integer::intValue).average().orElse(0); }
        static List<String> nonBlank(List<String> values) { return values == null ? List.of() : values.stream().filter(value -> !TextSupport_ConfigJson.blank(value)).toList(); }
        static List<String> distinct(List<String> values) { return TextSupport_ConfigJson.unique(values); }
        static List<String> sorted(List<String> values) { return values == null ? List.of() : values.stream().sorted().toList(); }
        static List<String> reversed(List<String> values) { return TextSupport_ConfigJson.reversed(values); }
        static List<String> first(List<String> values, int count) { return values == null || count <= 0 ? List.of() : values.subList(0, Math.min(count, values.size())); }
        static List<String> last(List<String> values, int count) { return values == null || count <= 0 ? List.of() : values.subList(Math.max(0, values.size() - count), values.size()); }
        static String[] chunks(String value, int size) { String text = TextSupport_ConfigJson.orEmpty(value); if (size <= 0) return new String[0]; List<String> output = new ArrayList<>(); for (int i = 0; i < text.length(); i += size) output.add(text.substring(i, Math.min(text.length(), i + size))); return output.toArray(new String[0]); }
        static String reverse(String value) { return new StringBuilder(TextSupport_ConfigJson.orEmpty(value)).reverse().toString(); }
        static String padLeft(String value, int width) { String text = TextSupport_ConfigJson.orEmpty(value); return " ".repeat(Math.max(0, width - text.length())) + text; }
        static String padRight(String value, int width) { String text = TextSupport_ConfigJson.orEmpty(value); return text + " ".repeat(Math.max(0, width - text.length())); }
        static String center(String value, int width) { String text = TextSupport_ConfigJson.orEmpty(value); if (text.length() >= width) return text; int left = (width - text.length()) / 2; return " ".repeat(left) + text + " ".repeat(width - text.length() - left); }
        static String join(List<String> values, String separator) { return values == null ? "" : String.join(separator, values); }
        static String normalizePath(String value) { return TextSupport_ConfigJson.orEmpty(value).replace('\\', '/'); }
        static String extension(String value) { return TextSupport_ConfigJson.extension(value).toLowerCase(Locale.ROOT); }
        static String key(String value) { return TextSupport_ConfigJson.orEmpty(value).trim().toLowerCase(Locale.ROOT); }
        static String kebab(String value) { return TextSupport_ConfigJson.slug(value); }
        static String snake(String value) { return TextSupport_ConfigJson.normalized(value).replace(' ', '_'); }
        static String human(String value) { return TextSupport_ConfigJson.normalized(value).replace('_', ' ').replace('-', ' '); }
        static String csv(String value) { return "\"" + TextSupport_ConfigJson.orEmpty(value).replace("\"", "\"\"") + "\""; }
        static String trimQuotes(String value) { return TextSupport_ConfigJson.orEmpty(value).replace("\"", "").replace("'", ""); }
    }


    private static final class UtilitySupport4_ConfigJson {
        private UtilitySupport4_ConfigJson() { }
        static boolean blank(String value) { return TextSupport_ConfigJson.blank(value); }
        static boolean present(String value) { return !TextSupport_ConfigJson.blank(value); }
        static String clean(String value) { return TextSupport_ConfigJson.normalized(value); }
        static String oneLine(String value) { return TextSupport_ConfigJson.orEmpty(value).replace("\r", " ").replace("\n", " "); }
        static String[] lines(String value) { return TextSupport_ConfigJson.orEmpty(value).replace("\r\n", "\n").replace('\r', '\n').split("\n", -1); }
        static String[] words(String value) { return TextSupport_ConfigJson.blank(value) ? new String[0] : value.trim().split("\\s+"); }
        static List<String> dedupe(List<String> values) { return TextSupport_ConfigJson.unique(values); }
        static List<String> take(List<String> values, int count) { return first(values, count); }
        static List<String> skip(List<String> values, int count) { return drop(values, count); }
        static String title(String value) { return TextSupport_ConfigJson.normalized(value).isEmpty() ? "" : TextSupport_ConfigJson.capitalize(TextSupport_ConfigJson.normalized(value).split(" ")[0]) + TextSupport_ConfigJson.normalized(value).substring(TextSupport_ConfigJson.normalized(value).indexOf(' ')).toLowerCase(Locale.ROOT); }
        static String kebab(String value) { return TextSupport_ConfigJson.slug(value); }
        static String snake(String value) { return TextSupport_ConfigJson.normalized(value).replace(' ', '_'); }
        static String space(String value) { return TextSupport_ConfigJson.normalized(value).replace('_', ' ').replace('-', ' '); }
        static String removePrefix(String value, String prefix) { return TextSupport_ConfigJson.startsWith(value, prefix) ? value.substring(prefix.length()) : TextSupport_ConfigJson.orEmpty(value); }
        static String removeSuffix(String value, String suffix) { return TextSupport_ConfigJson.endsWith(value, suffix) ? value.substring(0, value.length() - suffix.length()) : TextSupport_ConfigJson.orEmpty(value); }
        static String addPrefix(String value, String prefix) { return TextSupport_ConfigJson.blank(prefix) ? TextSupport_ConfigJson.orEmpty(value) : prefix + TextSupport_ConfigJson.orEmpty(value); }
        static String addSuffix(String value, String suffix) { return TextSupport_ConfigJson.blank(suffix) ? TextSupport_ConfigJson.orEmpty(value) : TextSupport_ConfigJson.orEmpty(value) + suffix; }
        static String defaultIfBlank(String value, String fallback) { return TextSupport_ConfigJson.blank(value) ? fallback : value; }
        static int countChars(String value, char target) { return (int) TextSupport_ConfigJson.orEmpty(value).chars().filter(item -> item == target).count(); }
        static String letters(String value) { return TextSupport_ConfigJson.orEmpty(value).replaceAll("[^A-Za-z]", ""); }
        static String digits(String value) { return TextSupport_ConfigJson.orEmpty(value).replaceAll("[^0-9]", ""); }
        static String noSpaces(String value) { return TextSupport_ConfigJson.orEmpty(value).replace(" ", ""); }
        static String collapse(String value) { return TextSupport_ConfigJson.normalized(value); }
        static String separators(String value) { return TextSupport_ConfigJson.orEmpty(value).replace('\\', '/').replace('|', '/'); }
        static String ensureSuffix(String value, String suffix) { return TextSupport_ConfigJson.endsWith(value, suffix) ? TextSupport_ConfigJson.orEmpty(value) : TextSupport_ConfigJson.orEmpty(value) + suffix; }
        static String ensurePrefix(String value, String prefix) { return TextSupport_ConfigJson.startsWith(value, prefix) ? TextSupport_ConfigJson.orEmpty(value) : prefix + TextSupport_ConfigJson.orEmpty(value); }
        static int countWords(String value) { return words(value).length; }
        static int countLines(String value) { return lines(value).length; }
    }
