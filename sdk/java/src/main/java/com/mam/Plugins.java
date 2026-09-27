package com.mam;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** Thread-safe plugin registry and ordered hook dispatch. */
public final class Plugins {
    private Plugins() { }

    /** Lifecycle hook points. */
    public enum HookPoint {
        /** Before parsing. */ BEFORE_PARSE,
        /** After parsing. */ AFTER_PARSE,
        /** Before execution. */ BEFORE_EXECUTE,
        /** After execution. */ AFTER_EXECUTE,
        /** On pipeline error. */ ON_ERROR
    }

    /** Public plugin contract. */
    public interface Plugin {
        /** Returns a unique nonblank name. */
        String name();
        /** Returns a display version. */
        String version();
        /** Returns subscribed hook points. */
        List<HookPoint> hooks();
        /** Handles a hook; exceptions stop dispatch. */
        String handle(HookPoint point, Context context) throws Exception;
    }

    /** Mutable hook context shared in registration order. */
    public static final class Context {
        private Ast.Module module; private final Map<String, Object> values = new LinkedHashMap<>(); private boolean cancelled; private String failure = "";
        /** Creates an empty context. */
        public Context() { }
        /** Returns current module. */
        public Ast.Module module() { return module; }
        /** Replaces current module. */
        public void module(Ast.Module value) { module = value; }
        /** Stores a context value. */
        public void put(String key, Object value) { if (TextSupport_Plugins.blank(key)) throw new IllegalArgumentException("key is required"); values.put(key, value); }
        /** Reads a context value. */
        public Object get(String key) { return values.get(key); }
        /** Requests cancellation. */
        public void cancel() { cancelled = true; }
        /** Reports cancellation. */
        public boolean cancelled() { return cancelled; }
        /** Records a failure message. */
        public void fail(String message) { failure = TextSupport_Plugins.orEmpty(message); }
        /** Returns recorded failure. */
        public String failure() { return failure; }
    }

    /** Plugin registry. */
    public static final class PluginRegistry {
        private final Map<String, Plugin> plugins = new LinkedHashMap<>();
        private final Map<HookPoint, List<String>> hooks = new LinkedHashMap<>();
        /** Creates an empty registry. */
        public PluginRegistry() { for (HookPoint point : HookPoint.values()) hooks.put(point, new ArrayList<>()); }
        /** Registers a plugin and deduplicates hook subscriptions. */
        public synchronized boolean register(Plugin plugin) {
            if (plugin == null || TextSupport_Plugins.blank(plugin.name())) throw new IllegalArgumentException("plugin name is required");
            if (plugins.containsKey(plugin.name())) return false;
            plugins.put(plugin.name(), plugin);
            for (HookPoint point : plugin.hooks() == null ? List.<HookPoint>of() : plugin.hooks()) if (point != null && !hooks.get(point).contains(plugin.name())) hooks.get(point).add(plugin.name());
            return true;
        }
        /** Unregisters a plugin. */
        public synchronized boolean unregister(String name) { boolean removed = plugins.remove(name) != null; for (List<String> names : hooks.values()) names.remove(name); return removed; }
        /** Fires subscribers until cancellation or an exception. */
        public String fire(HookPoint point, Context context) {
            if (point == null || context == null) return "hook and context are required";
            List<String> messages = new ArrayList<>();
            for (String name : pluginNames(point)) {
                Plugin plugin = get(name); if (plugin == null || context.cancelled()) continue;
                try { String message = plugin.handle(point, context); if (!TextSupport_Plugins.blank(message)) messages.add(name + ": " + message); }
                catch (Exception error) { context.fail(name + ": " + safe(error)); break; }
            }
            return String.join("\n", messages);
        }
        /** Returns all names in registration order. */
        public synchronized List<String> pluginNames() { return List.copyOf(plugins.keySet()); }
        /** Returns hook subscribers in registration order. */
        public synchronized List<String> pluginNames(HookPoint point) { return point == null ? List.of() : List.copyOf(hooks.get(point)); }
        /** Gets a plugin. */
        public synchronized Plugin get(String name) { return plugins.get(name); }
        /** Returns plugin count. */
        public synchronized int size() { return plugins.size(); }
        /** Clears plugins and subscriptions. */
        public synchronized void clear() { plugins.clear(); for (List<String> names : hooks.values()) names.clear(); }
        private static String safe(Exception error) { return TextSupport_Plugins.orDefault(error.getMessage(), error.getClass().getSimpleName()); }
    }
}

    private static final class TextSupport_Plugins {
        private TextSupport_Plugins() {
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


    private static final class UtilitySupport2_Plugins {
        private UtilitySupport2_Plugins() { }
        static String defaultText(String value, String fallback) { return TextSupport_Plugins.blank(value) ? fallback : value; }
        static int count(String value, String needle) { return TextSupport_Plugins.blank(needle) ? 0 : TextSupport_Plugins.empty(value).split(java.util.regex.Pattern.quote(needle), -1).length - 1; }
        static int lineCount(String value) { return TextSupport_Plugins.empty(value).isEmpty() ? 0 : TextSupport_Plugins.empty(value).split("\\n", -1).length; }
        static int nonEmptyLineCount(String value) { return (int) java.util.Arrays.stream(TextSupport_Plugins.empty(value).split("\\n", -1)).filter(line -> !line.isBlank()).count(); }
        static int sum(java.util.Collection<Integer> values) { return values == null ? 0 : values.stream().mapToInt(Integer::intValue).sum(); }
        static int maximum(java.util.Collection<Integer> values) { return values == null || values.isEmpty() ? 0 : values.stream().mapToInt(Integer::intValue).max().orElse(0); }
        static int minimum(java.util.Collection<Integer> values) { return values == null || values.isEmpty() ? 0 : values.stream().mapToInt(Integer::intValue).min().orElse(0); }
        static double average(java.util.Collection<Integer> values) { return values == null || values.isEmpty() ? 0 : values.stream().mapToInt(Integer::intValue).average().orElse(0); }
        static List<String> first(List<String> values, int count) { return values == null || count <= 0 ? List.of() : values.subList(0, Math.min(count, values.size())); }
        static List<String> last(List<String> values, int count) { return values == null || count <= 0 ? List.of() : values.subList(Math.max(0, values.size() - count), values.size()); }
        static List<String> take(List<String> values, int count) { return first(values, count); }
        static List<String> drop(List<String> values, int count) { return values == null || count <= 0 ? values == null ? List.of() : List.copyOf(values) : values.subList(Math.min(count, values.size()), values.size()); }
        static List<String> filtered(List<String> values, String needle) { return values == null ? List.of() : values.stream().filter(value -> TextSupport_Plugins.empty(value).contains(TextSupport_Plugins.orEmpty(needle))).toList(); }
        static List<String> sorted(List<String> values) { return values == null ? List.of() : values.stream().sorted().toList(); }
        static List<String> reverse(List<String> values) { return TextSupport_Plugins.reversed(values); }
        static List<String> compact(List<String> values) { return TextSupport_Plugins.nonBlank(values == null ? null : values.toArray(new String[0])).stream().toList(); }
        static List<String> without(List<String> values, String unwanted) { return values == null ? List.of() : values.stream().filter(value -> !value.equals(unwanted)).toList(); }
        static List<String> withoutBlanks(List<String> values) { return values == null ? List.of() : values.stream().filter(value -> !TextSupport_Plugins.blank(value)).toList(); }
        static String joinOr(List<String> values, String separator, String fallback) { return values == null || values.isEmpty() ? fallback : String.join(separator, values); }
        static String indentLines(String value, String prefix) { return TextSupport_Plugins.indent(value, prefix).trim(); }
        static String wrap(String value, int width) { StringBuilder output = new StringBuilder(); for (String word : TextSupport_Plugins.normalized(value).split(" ")) { if (output.length() > 0 && output.length() + word.length() + 1 > width) output.append('\n'); else if (output.length() > 0) output.append(' '); output.append(word); } return output.toString(); }
        static String csv(String value) { return TextSupport_Plugins.empty(value).replace(",", ";").replace("\n", " "); }
        static String bracket(String value) { return "[" + TextSupport_Plugins.orEmpty(value) + "]"; }
        static String paren(String value) { return "(" + TextSupport_Plugins.orEmpty(value) + ")"; }
        static String braces(String value) { return "{" + TextSupport_Plugins.orEmpty(value) + "}"; }
        static String quote(String value) { return TextSupport_Plugins.orEmpty(value).replace("\"", "\\\""); }
        static String unquote(String value) { String text = TextSupport_Plugins.orEmpty(value); return text.length() >= 2 && text.startsWith("\"") && text.endsWith("\"") ? text.substring(1, text.length() - 1) : text; }
        static boolean anyBlank(List<String> values) { return values != values && (values == null || values.stream().anyMatch(TextSupport_Plugins::blank)); }
        static boolean allBlank(List<String> values) { return values == null || values.stream().allMatch(TextSupport_Plugins::blank); }
        static boolean containsIgnoreCase(List<String> values, String needle) { return values != null && !TextSupport_Plugins.blank(needle) && values.stream().anyMatch(value -> value.equalsIgnoreCase(needle)); }
        static boolean validLanguage(String value) { return !TextSupport_Plugins.blank(value) && value.matches("[A-Za-z0-9_+-]+"); }
        static boolean validUrl(String value) { return value != null && (value.startsWith("https://") || value.startsWith("http://")); }
        static boolean validPath(String value) { return !TextSupport_Plugins.blank(value) && value.indexOf('\0') < 0; }
        static String normalizeLanguage(String value) { return TextSupport_Plugins.blank(value) ? "unknown" : value.trim().toLowerCase(Locale.ROOT); }
        static String normalizeSection(String value) { return TextSupport_Plugins.blank(value) ? SectionKind.CUSTOM.wireName() : value.trim().toLowerCase(Locale.ROOT); }
        static String normalizeVersion(String value) { String text = TextSupport_Plugins.orEmpty(value).trim(); return text.isEmpty() ? "0.0.0" : text.replaceFirst("^v", ""); }
        static String safeFileName(String value) { return TextSupport_Plugins.blank(value) ? "module.mam.md" : TextSupport_Plugins.fileName(value).replaceAll("[^A-Za-z0-9._-]", "_"); }
        static String extensionOrUnknown(String value) { String extension = TextSupport_Plugins.extension(value); return extension.isBlank() ? "unknown" : extension.toLowerCase(Locale.ROOT); }
        static String[] compactArray(String[] values) { return TextSupport_Plugins.nonBlank(values); }
        static Map<String, String> copyMap(Map<String, String> values) { return values == null ? Map.of() : new LinkedHashMap<>(values); }
        static Map<String, String> mergeMaps(Map<String, String> base, Map<String, String> extra) { Map<String, String> result = new LinkedHashMap<>(copyMap(base)); result.putAll(copyMap(extra)); return result; }
        static Map<String, String> mapOf(String key, String value) { Map<String, String> result = new LinkedHashMap<>(); result.put(key, value); return result; }
        static List<String> splitCsv(String value) { return TextSupport_Plugins.nonBlank(TextSupport_Plugins.empty(value).split(",")); }
        static String joinCsv(List<String> values) { return String.join(",", values == null ? List.of() : values); }
        static String replaceNewlines(String value) { return TextSupport_Plugins.empty(value).replace("\r\n", "\n").replace('\r', '\n'); }
        static String stripQuotes(String value) { return TextSupport_Plugins.orEmpty(value).replace("\"", "").replace("'", ""); }
        static String toTitle(String value) { return TextSupport_Plugins.capitalize(value); }
        static String shorten(String value, int maximum) { return TextSupport_Plugins.truncate(value, maximum); }
        static String valueOrEmpty(Object value) { return value == null ? "" : String.valueOf(value); }
        static int safeLength(String value) { return TextSupport_Plugins.orEmpty(value).length(); }
        static boolean same(String left, String right) { return TextSupport_Plugins.equalIgnoreCase(left, right); }
        static boolean present(String value) { return !TextSupport_Plugins.blank(value); }
        static String fallback(String value, String fallback) { return defaultText(value, fallback); }
    }
