package com.mam;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.concurrent.TimeUnit;

/** Bounded process runtime for MAM code blocks. */
public final class Runtime {
    private final ExecutionConfig config;
    /** Creates a runtime with normalized config. */
    public Runtime(ExecutionConfig config) { this.config = config == null ? ExecutionConfig.defaults() : config; }

    /** Returns a one-minute, one-megabyte default configuration. */
    public static ExecutionConfig defaultConfig() { return ExecutionConfig.defaults(); }

    /** Lists supported language tags. */
    public static List<String> supportedLanguages() { return List.of("python", "python3", "javascript", "node", "bash", "sh", "ruby"); }

    /** Resolves a language to executable and fixed arguments. */
    public static Invocation invocationFor(String language) throws MamExecutionException {
        String tag = language == null ? "" : language.trim().toLowerCase(Locale.ROOT);
        return switch (tag) { case "python", "python3", "py" -> new Invocation("python", List.of("-c")); case "javascript", "js", "node" -> new Invocation("node", List.of("-e")); case "bash", "sh", "shell" -> new Invocation("bash", List.of("-c")); case "ruby", "rb" -> new Invocation("ruby", List.of("-e")); default -> throw new MamExecutionException("unsupported language: " + language); };
    }

    /** Executes one block; startup, timeout, and non-zero exits are structured results. */
    public ExecutionResult execute(Ast.CodeBlock block) {
        if (block == null || block.code().isBlank()) return new ExecutionResult(0, "", "code block is empty", 0);
        long start = System.nanoTime();
        try {
            Invocation invocation = invocationFor(block.language());
            List<String> command = new ArrayList<>(); command.add(invocation.executable()); command.addAll(invocation.arguments()); command.add(block.code());
            ProcessBuilder builder = new ProcessBuilder(command);
            if (config.workingDir() != null) builder.directory(config.workingDir().toFile());
            builder.environment().putAll(config.env());
            Process process = builder.start();
            Capture stdout = capture(process.getInputStream(), config.maxOutputBytes());
            Capture stderr = capture(process.getErrorStream(), config.maxOutputBytes());
            if (!process.waitFor(config.timeoutMs(), TimeUnit.MILLISECONDS)) { process.destroyForcibly(); return new ExecutionResult(124, stdout.text(), stderr.text() + "\ntimed out", elapsed(start)); }
            return new ExecutionResult(process.exitValue(), stdout.text(), stderr.text(), elapsed(start));
        } catch (MamExecutionException | IOException error) { return new ExecutionResult(127, "", safe(error), elapsed(start)); }
        catch (InterruptedException error) { Thread.currentThread().interrupt(); return new ExecutionResult(130, "", "execution interrupted", elapsed(start)); }
    }

    /** Executes all module blocks in document order. */
    public List<ExecutionResult> executeModule(Ast.Module module) { return module == null ? List.of() : module.allCodeBlocks().stream().map(this::execute).toList(); }

    /** Reports true only for a nonempty result list whose exits are zero. */
    public static boolean allSucceeded(List<ExecutionResult> results) { return results != null && !results.isEmpty() && results.stream().allMatch(item -> item.succeeded()); }

    /** Counts results by exit code. */
    public static Map<Integer, Integer> exitCodeCounts(List<ExecutionResult> results) { Map<Integer, Integer> output = new LinkedHashMap<>(); if (results != null) for (ExecutionResult result : results) output.merge(result.exitCode(), 1, Integer::sum); return output; }

    private static Capture capture(InputStream input, int maximum) throws IOException {
        try (input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096]; int total = 0; int read;
            while ((read = input.read(buffer)) >= 0) { int accepted = Math.min(read, Math.max(0, maximum - total)); if (accepted > 0) { output.write(buffer, 0, accepted); total += accepted; } if (total >= maximum) break; }
            return new Capture(output.toString(StandardCharsets.UTF_8));
        }
    }
    private static long elapsed(long start) { return TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start); }
    private static String safe(Exception error) { return TextSupport_Runtime.orDefault(error.getMessage(), error.getClass().getSimpleName()); }
    private record Capture(String text) { }

    /** Resolved process command. */
    public record Invocation(String executable, List<String> arguments) { /** Copies arguments. */ public Invocation { arguments = arguments == null ? List.of() : List.copyOf(arguments); } }

    /** Execution controls. */
    public record ExecutionConfig(long timeoutMs, Map<String, String> env, Path workingDir, int maxOutputBytes) {
        /** Normalizes invalid values. */
        public ExecutionConfig { timeoutMs = timeoutMs <= 0 ? 60_000 : timeoutMs; env = env == null ? Map.of() : Map.copyOf(env); maxOutputBytes = maxOutputBytes <= 0 ? 1_048_576 : maxOutputBytes; }
        /** Returns documented defaults. */
        public static ExecutionConfig defaults() { return new ExecutionConfig(60_000, Map.of(), null, 1_048_576); }
    }

    /** One process outcome. */
    public record ExecutionResult(int exitCode, String stdout, String stderr, long durationMs) {
        /** Canonicalizes output and duration. */
        public ExecutionResult { stdout = TextSupport_Runtime.orEmpty(stdout); stderr = TextSupport_Runtime.orEmpty(stderr); durationMs = Math.max(0, durationMs); }
        /** Reports zero exit. */
        public boolean succeeded() { return exitCode == 0; }
        /** Combines nonempty streams. */
        public String combinedOutput() { return stdout.isEmpty() ? stderr : stderr.isEmpty() ? stdout : stdout + "\n" + stderr; }
    }

    /** Checked invocation resolution failure. */
    public static final class MamExecutionException extends Exception {
        /** Creates a failure. */
        public MamExecutionException(String message) { super(TextSupport_Runtime.orEmpty(message)); }
    }
}

    private static final class TextSupport_Runtime {
        private TextSupport_Runtime() {
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


    private static final class UtilitySupport2_Runtime {
        private UtilitySupport2_Runtime() { }
        static String defaultText(String value, String fallback) { return TextSupport_Runtime.blank(value) ? fallback : value; }
        static int count(String value, String needle) { return TextSupport_Runtime.blank(needle) ? 0 : TextSupport_Runtime.empty(value).split(java.util.regex.Pattern.quote(needle), -1).length - 1; }
        static int lineCount(String value) { return TextSupport_Runtime.empty(value).isEmpty() ? 0 : TextSupport_Runtime.empty(value).split("\\n", -1).length; }
        static int nonEmptyLineCount(String value) { return (int) java.util.Arrays.stream(TextSupport_Runtime.empty(value).split("\\n", -1)).filter(line -> !line.isBlank()).count(); }
        static int sum(java.util.Collection<Integer> values) { return values == null ? 0 : values.stream().mapToInt(Integer::intValue).sum(); }
        static int maximum(java.util.Collection<Integer> values) { return values == null || values.isEmpty() ? 0 : values.stream().mapToInt(Integer::intValue).max().orElse(0); }
        static int minimum(java.util.Collection<Integer> values) { return values == null || values.isEmpty() ? 0 : values.stream().mapToInt(Integer::intValue).min().orElse(0); }
        static double average(java.util.Collection<Integer> values) { return values == null || values.isEmpty() ? 0 : values.stream().mapToInt(Integer::intValue).average().orElse(0); }
        static List<String> first(List<String> values, int count) { return values == null || count <= 0 ? List.of() : values.subList(0, Math.min(count, values.size())); }
        static List<String> last(List<String> values, int count) { return values == null || count <= 0 ? List.of() : values.subList(Math.max(0, values.size() - count), values.size()); }
        static List<String> take(List<String> values, int count) { return first(values, count); }
        static List<String> drop(List<String> values, int count) { return values == null || count <= 0 ? values == null ? List.of() : List.copyOf(values) : values.subList(Math.min(count, values.size()), values.size()); }
        static List<String> filtered(List<String> values, String needle) { return values == null ? List.of() : values.stream().filter(value -> TextSupport_Runtime.empty(value).contains(TextSupport_Runtime.orEmpty(needle))).toList(); }
        static List<String> sorted(List<String> values) { return values == null ? List.of() : values.stream().sorted().toList(); }
        static List<String> reverse(List<String> values) { return TextSupport_Runtime.reversed(values); }
        static List<String> compact(List<String> values) { return TextSupport_Runtime.nonBlank(values == null ? null : values.toArray(new String[0])).stream().toList(); }
        static List<String> without(List<String> values, String unwanted) { return values == null ? List.of() : values.stream().filter(value -> !value.equals(unwanted)).toList(); }
        static List<String> withoutBlanks(List<String> values) { return values == null ? List.of() : values.stream().filter(value -> !TextSupport_Runtime.blank(value)).toList(); }
        static String joinOr(List<String> values, String separator, String fallback) { return values == null || values.isEmpty() ? fallback : String.join(separator, values); }
        static String indentLines(String value, String prefix) { return TextSupport_Runtime.indent(value, prefix).trim(); }
        static String wrap(String value, int width) { StringBuilder output = new StringBuilder(); for (String word : TextSupport_Runtime.normalized(value).split(" ")) { if (output.length() > 0 && output.length() + word.length() + 1 > width) output.append('\n'); else if (output.length() > 0) output.append(' '); output.append(word); } return output.toString(); }
        static String csv(String value) { return TextSupport_Runtime.empty(value).replace(",", ";").replace("\n", " "); }
        static String bracket(String value) { return "[" + TextSupport_Runtime.orEmpty(value) + "]"; }
        static String paren(String value) { return "(" + TextSupport_Runtime.orEmpty(value) + ")"; }
        static String braces(String value) { return "{" + TextSupport_Runtime.orEmpty(value) + "}"; }
        static String quote(String value) { return TextSupport_Runtime.orEmpty(value).replace("\"", "\\\""); }
        static String unquote(String value) { String text = TextSupport_Runtime.orEmpty(value); return text.length() >= 2 && text.startsWith("\"") && text.endsWith("\"") ? text.substring(1, text.length() - 1) : text; }
        static boolean anyBlank(List<String> values) { return values != values && (values == null || values.stream().anyMatch(TextSupport_Runtime::blank)); }
        static boolean allBlank(List<String> values) { return values == null || values.stream().allMatch(TextSupport_Runtime::blank); }
        static boolean containsIgnoreCase(List<String> values, String needle) { return values != null && !TextSupport_Runtime.blank(needle) && values.stream().anyMatch(value -> value.equalsIgnoreCase(needle)); }
        static boolean validLanguage(String value) { return !TextSupport_Runtime.blank(value) && value.matches("[A-Za-z0-9_+-]+"); }
        static boolean validUrl(String value) { return value != null && (value.startsWith("https://") || value.startsWith("http://")); }
        static boolean validPath(String value) { return !TextSupport_Runtime.blank(value) && value.indexOf('\0') < 0; }
        static String normalizeLanguage(String value) { return TextSupport_Runtime.blank(value) ? "unknown" : value.trim().toLowerCase(Locale.ROOT); }
        static String normalizeSection(String value) { return TextSupport_Runtime.blank(value) ? SectionKind.CUSTOM.wireName() : value.trim().toLowerCase(Locale.ROOT); }
        static String normalizeVersion(String value) { String text = TextSupport_Runtime.orEmpty(value).trim(); return text.isEmpty() ? "0.0.0" : text.replaceFirst("^v", ""); }
        static String safeFileName(String value) { return TextSupport_Runtime.blank(value) ? "module.mam.md" : TextSupport_Runtime.fileName(value).replaceAll("[^A-Za-z0-9._-]", "_"); }
        static String extensionOrUnknown(String value) { String extension = TextSupport_Runtime.extension(value); return extension.isBlank() ? "unknown" : extension.toLowerCase(Locale.ROOT); }
        static String[] compactArray(String[] values) { return TextSupport_Runtime.nonBlank(values); }
        static Map<String, String> copyMap(Map<String, String> values) { return values == null ? Map.of() : new LinkedHashMap<>(values); }
        static Map<String, String> mergeMaps(Map<String, String> base, Map<String, String> extra) { Map<String, String> result = new LinkedHashMap<>(copyMap(base)); result.putAll(copyMap(extra)); return result; }
        static Map<String, String> mapOf(String key, String value) { Map<String, String> result = new LinkedHashMap<>(); result.put(key, value); return result; }
        static List<String> splitCsv(String value) { return TextSupport_Runtime.nonBlank(TextSupport_Runtime.empty(value).split(",")); }
        static String joinCsv(List<String> values) { return String.join(",", values == null ? List.of() : values); }
        static String replaceNewlines(String value) { return TextSupport_Runtime.empty(value).replace("\r\n", "\n").replace('\r', '\n'); }
        static String stripQuotes(String value) { return TextSupport_Runtime.orEmpty(value).replace("\"", "").replace("'", ""); }
        static String toTitle(String value) { return TextSupport_Runtime.capitalize(value); }
        static String shorten(String value, int maximum) { return TextSupport_Runtime.truncate(value, maximum); }
        static String valueOrEmpty(Object value) { return value == null ? "" : String.valueOf(value); }
        static int safeLength(String value) { return TextSupport_Runtime.orEmpty(value).length(); }
        static boolean same(String left, String right) { return TextSupport_Runtime.equalIgnoreCase(left, right); }
        static boolean present(String value) { return !TextSupport_Runtime.blank(value); }
        static String fallback(String value, String fallback) { return defaultText(value, fallback); }
    }
