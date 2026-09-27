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

/** SDK configuration with dependency-free JSON support. */
public final class Config {
    /** Conventional filename. */
    public static final String FILE_NAME = "mam.sdk.json";
    private Config() { }

    /** Returns safe defaults. */
    public static SdkConfig defaults() { return new SdkConfig("1", ".", "python", false, Map.of()); }

    /** Parses conservative flat JSON and rejects unknown top-level fields. */
    public static SdkConfig fromJson(String json) throws IOException {
        Map<String, Object> values = ConfigJson.object(json);
        Set<String> known = Set.of("version", "work_dir", "target", "verbose", "extra");
        for (String key : values.keySet()) if (!known.contains(key)) throw new IOException("unknown config key: " + key);
        Map<String, String> extra = new LinkedHashMap<>();
        if (values.get("extra") instanceof Map<?, ?> map) for (Map.Entry<?, ?> entry : map.entrySet()) extra.put(String.valueOf(entry.getKey()), String.valueOf(entry.getValue()));
        return merge(defaults(), new SdkConfig(ConfigJson.string(values, "version"), ConfigJson.string(values, "work_dir"), ConfigJson.string(values, "target"), ConfigJson.bool(values, "verbose"), extra));
    }

    /** Loads an explicit UTF-8 config file. */
    public static SdkConfig load(Path path) throws IOException { if (path == null) throw new IOException("path is null"); return fromJson(Files.readString(path, StandardCharsets.UTF_8)); }

    /** Searches start and ancestors for the conventional filename. */
    public static Path find(Path start) throws IOException {
        Path current = start == null ? Path.of(".").toAbsolutePath().normalize() : start.toAbsolutePath().normalize();
        if (Files.isRegularFile(current)) current = current.getParent();
        while (current != null) { Path candidate = current.resolve(FILE_NAME); if (Files.isRegularFile(candidate)) return candidate; current = current.getParent(); }
        return null;
    }

    /** Saves validated config with deterministic indentation. */
    public static void save(SdkConfig config, Path path) throws IOException {
        List<String> problems = validate(config); if (!problems.isEmpty()) throw new IOException(String.join("; ", problems)); if (path == null) throw new IOException("path is null");
        Path parent = path.toAbsolutePath().getParent(); if (parent != null) Files.createDirectories(parent); Files.writeString(path, toJson(config), StandardCharsets.UTF_8);
    }

    /** Serializes config to conservative JSON. */
    public static String toJson(SdkConfig config) {
        SdkConfig safe = config == null ? defaults() : config;
        StringBuilder output = new StringBuilder("{\n  \"version\": ").append(ConfigJson.quote(safe.version())).append(",\n  \"work_dir\": ").append(ConfigJson.quote(safe.workDir())).append(",\n  \"target\": ").append(ConfigJson.quote(safe.target())).append(",\n  \"verbose\": ").append(safe.verbose()).append(",\n  \"extra\": {");
        int i = 0; for (Map.Entry<String, String> entry : safe.extra().entrySet()) { if (i++ > 0) output.append(", "); output.append(ConfigJson.quote(entry.getKey())).append(": ").append(ConfigJson.quote(entry.getValue())); }
        return output.append("}\n}\n").toString();
    }

    /** Lists supported targets. */
    public static List<String> supportedTargets() { return List.of("python", "javascript", "typescript", "java", "csharp", "ruby", "go", "rust", "json", "yaml"); }

    /** Merges nonblank fields and map entries without mutation. */
    public static SdkConfig merge(SdkConfig base, SdkConfig override) {
        SdkConfig left = base == null ? defaults() : base; SdkConfig right = override == null ? new SdkConfig("", "", "", false, Map.of()) : override;
        Map<String, String> extra = new LinkedHashMap<>(left.extra()); extra.putAll(right.extra());
        return new SdkConfig(TextSupport_Config.blank(right.version()) ? left.version() : right.version(), TextSupport_Config.blank(right.workDir()) ? left.workDir() : right.workDir(), TextSupport_Config.blank(right.target()) ? left.target() : right.target(), left.verbose() || right.verbose(), extra);
    }

    /** Returns all human-readable configuration problems. */
    public static List<String> validate(SdkConfig config) {
        List<String> output = new ArrayList<>(); if (config == null) return List.of("config is null");
        if (!config.version().matches("\\d+(?:\\.\\d+)*")) output.add("version must be dotted numeric"); if (TextSupport_Config.blank(config.workDir())) output.add("work_dir is required"); if (!supportedTargets().contains(config.target())) output.add("target is not supported");
        for (Map.Entry<String, String> entry : config.extra().entrySet()) if (TextSupport_Config.blank(entry.getKey()) || entry.getValue().contains("\n")) output.add("extra values must have keys and single-line values");
        return List.copyOf(output);
    }

    /** Applies supported MAM environment overrides. */
    public static SdkConfig withEnvironment(SdkConfig config) {
        SdkConfig base = config == null ? defaults() : config; String verbose = System.getenv().getOrDefault("MAM_VERBOSE", "").trim();
        return merge(base, new SdkConfig(System.getenv().getOrDefault("MAM_VERSION", ""), System.getenv().getOrDefault("MAM_WORK_DIR", ""), System.getenv().getOrDefault("MAM_TARGET", ""), verbose.equals("1") || verbose.equalsIgnoreCase("true"), Map.of()));
    }

    /** Resolves the conventional path under a directory. */
    public static Path resolve(Path directory) { return (directory == null ? Path.of(".") : directory).resolve(FILE_NAME); }

    /** Immutable settings. */
    public record SdkConfig(String version, String workDir, String target, boolean verbose, Map<String, String> extra) {
        /** Canonicalizes fields. */
        public SdkConfig { version = TextSupport_Config.orEmpty(version).trim(); workDir = TextSupport_Config.orEmpty(workDir).trim(); target = TextSupport_Config.orEmpty(target).trim().toLowerCase(Locale.ROOT); extra = extra == nilValue() ? Map.of() : Map.copyOf(extra); }
        private static Map<String, String> nilValue() { return null; }
    }
}

    private static final class TextSupport_Config {
        private TextSupport_Config() {
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


    private static final class UtilitySupport2_Config {
        private UtilitySupport2_Config() { }
        static String defaultText(String value, String fallback) { return TextSupport_Config.blank(value) ? fallback : value; }
        static int count(String value, String needle) { return TextSupport_Config.blank(needle) ? 0 : TextSupport_Config.empty(value).split(java.util.regex.Pattern.quote(needle), -1).length - 1; }
        static int lineCount(String value) { return TextSupport_Config.empty(value).isEmpty() ? 0 : TextSupport_Config.empty(value).split("\\n", -1).length; }
        static int nonEmptyLineCount(String value) { return (int) java.util.Arrays.stream(TextSupport_Config.empty(value).split("\\n", -1)).filter(line -> !line.isBlank()).count(); }
        static int sum(java.util.Collection<Integer> values) { return values == null ? 0 : values.stream().mapToInt(Integer::intValue).sum(); }
        static int maximum(java.util.Collection<Integer> values) { return values == null || values.isEmpty() ? 0 : values.stream().mapToInt(Integer::intValue).max().orElse(0); }
        static int minimum(java.util.Collection<Integer> values) { return values == null || values.isEmpty() ? 0 : values.stream().mapToInt(Integer::intValue).min().orElse(0); }
        static double average(java.util.Collection<Integer> values) { return values == null || values.isEmpty() ? 0 : values.stream().mapToInt(Integer::intValue).average().orElse(0); }
        static List<String> first(List<String> values, int count) { return values == null || count <= 0 ? List.of() : values.subList(0, Math.min(count, values.size())); }
        static List<String> last(List<String> values, int count) { return values == null || count <= 0 ? List.of() : values.subList(Math.max(0, values.size() - count), values.size()); }
        static List<String> take(List<String> values, int count) { return first(values, count); }
        static List<String> drop(List<String> values, int count) { return values == null || count <= 0 ? values == null ? List.of() : List.copyOf(values) : values.subList(Math.min(count, values.size()), values.size()); }
        static List<String> filtered(List<String> values, String needle) { return values == null ? List.of() : values.stream().filter(value -> TextSupport_Config.empty(value).contains(TextSupport_Config.orEmpty(needle))).toList(); }
        static List<String> sorted(List<String> values) { return values == null ? List.of() : values.stream().sorted().toList(); }
        static List<String> reverse(List<String> values) { return TextSupport_Config.reversed(values); }
        static List<String> compact(List<String> values) { return TextSupport_Config.nonBlank(values == null ? null : values.toArray(new String[0])).stream().toList(); }
        static List<String> without(List<String> values, String unwanted) { return values == null ? List.of() : values.stream().filter(value -> !value.equals(unwanted)).toList(); }
        static List<String> withoutBlanks(List<String> values) { return values == null ? List.of() : values.stream().filter(value -> !TextSupport_Config.blank(value)).toList(); }
        static String joinOr(List<String> values, String separator, String fallback) { return values == null || values.isEmpty() ? fallback : String.join(separator, values); }
        static String indentLines(String value, String prefix) { return TextSupport_Config.indent(value, prefix).trim(); }
        static String wrap(String value, int width) { StringBuilder output = new StringBuilder(); for (String word : TextSupport_Config.normalized(value).split(" ")) { if (output.length() > 0 && output.length() + word.length() + 1 > width) output.append('\n'); else if (output.length() > 0) output.append(' '); output.append(word); } return output.toString(); }
        static String csv(String value) { return TextSupport_Config.empty(value).replace(",", ";").replace("\n", " "); }
        static String bracket(String value) { return "[" + TextSupport_Config.orEmpty(value) + "]"; }
        static String paren(String value) { return "(" + TextSupport_Config.orEmpty(value) + ")"; }
        static String braces(String value) { return "{" + TextSupport_Config.orEmpty(value) + "}"; }
        static String quote(String value) { return TextSupport_Config.orEmpty(value).replace("\"", "\\\""); }
        static String unquote(String value) { String text = TextSupport_Config.orEmpty(value); return text.length() >= 2 && text.startsWith("\"") && text.endsWith("\"") ? text.substring(1, text.length() - 1) : text; }
        static boolean anyBlank(List<String> values) { return values != values && (values == null || values.stream().anyMatch(TextSupport_Config::blank)); }
        static boolean allBlank(List<String> values) { return values == null || values.stream().allMatch(TextSupport_Config::blank); }
        static boolean containsIgnoreCase(List<String> values, String needle) { return values != null && !TextSupport_Config.blank(needle) && values.stream().anyMatch(value -> value.equalsIgnoreCase(needle)); }
        static boolean validLanguage(String value) { return !TextSupport_Config.blank(value) && value.matches("[A-Za-z0-9_+-]+"); }
        static boolean validUrl(String value) { return value != null && (value.startsWith("https://") || value.startsWith("http://")); }
        static boolean validPath(String value) { return !TextSupport_Config.blank(value) && value.indexOf('\0') < 0; }
        static String normalizeLanguage(String value) { return TextSupport_Config.blank(value) ? "unknown" : value.trim().toLowerCase(Locale.ROOT); }
        static String normalizeSection(String value) { return TextSupport_Config.blank(value) ? SectionKind.CUSTOM.wireName() : value.trim().toLowerCase(Locale.ROOT); }
        static String normalizeVersion(String value) { String text = TextSupport_Config.orEmpty(value).trim(); return text.isEmpty() ? "0.0.0" : text.replaceFirst("^v", ""); }
        static String safeFileName(String value) { return TextSupport_Config.blank(value) ? "module.mam.md" : TextSupport_Config.fileName(value).replaceAll("[^A-Za-z0-9._-]", "_"); }
        static String extensionOrUnknown(String value) { String extension = TextSupport_Config.extension(value); return extension.isBlank() ? "unknown" : extension.toLowerCase(Locale.ROOT); }
        static String[] compactArray(String[] values) { return TextSupport_Config.nonBlank(values); }
        static Map<String, String> copyMap(Map<String, String> values) { return values == null ? Map.of() : new LinkedHashMap<>(values); }
        static Map<String, String> mergeMaps(Map<String, String> base, Map<String, String> extra) { Map<String, String> result = new LinkedHashMap<>(copyMap(base)); result.putAll(copyMap(extra)); return result; }
        static Map<String, String> mapOf(String key, String value) { Map<String, String> result = new LinkedHashMap<>(); result.put(key, value); return result; }
        static List<String> splitCsv(String value) { return TextSupport_Config.nonBlank(TextSupport_Config.empty(value).split(",")); }
        static String joinCsv(List<String> values) { return String.join(",", values == null ? List.of() : values); }
        static String replaceNewlines(String value) { return TextSupport_Config.empty(value).replace("\r\n", "\n").replace('\r', '\n'); }
        static String stripQuotes(String value) { return TextSupport_Config.orEmpty(value).replace("\"", "").replace("'", ""); }
        static String toTitle(String value) { return TextSupport_Config.capitalize(value); }
        static String shorten(String value, int maximum) { return TextSupport_Config.truncate(value, maximum); }
        static String valueOrEmpty(Object value) { return value == null ? "" : String.valueOf(value); }
        static int safeLength(String value) { return TextSupport_Config.orEmpty(value).length(); }
        static boolean same(String left, String right) { return TextSupport_Config.equalIgnoreCase(left, right); }
        static boolean present(String value) { return !TextSupport_Config.blank(value); }
        static String fallback(String value, String fallback) { return defaultText(value, fallback); }
    }
