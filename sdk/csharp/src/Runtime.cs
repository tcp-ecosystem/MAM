namespace Mam;

using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using Sys = System.Collections.Generic;
/// <summary>Executes MAM code blocks with timeout and output bounds.</summary>
public sealed class Runtime
{
    private readonly ExecutionConfig config;
    /// <summary>Initializes a runtime with normalized configuration.</summary><param name="config">Optional configuration; null uses defaults.</param> public Runtime(ExecutionConfig? config = null) => this.config = config ?? ExecutionConfig.Defaults();

    /// <summary>Gets the runtime's defensive configuration copy.</summary> public ExecutionConfig Config => config with { Environment = new Dictionary<string, string>(config.Environment, StringComparer.Ordinal) };
    /// <summary>Returns supported language tags in stable order.</summary> public static string[] SupportedLanguages() => new[] { "python", "python3", "javascript", "node", "bash", "sh", "ruby" };
    /// <summary>Resolves a language to an invocation.</summary><param name="language">Case-insensitive language tag.</param><returns>An executable and fixed arguments.</returns><exception cref="MamExecutionException">The language is unsupported.</exception>
    public static Invocation InvocationFor(string? language) => (language?.Trim().ToLowerInvariant()) switch { "python" or "python3" or "py" => new Invocation("python", new[] { "-c" }), "javascript" or "js" or "node" => new Invocation("node", new[] { "-e" }), "bash" or "sh" or "shell" => new Invocation("bash", new[] { "-c" }), "ruby" or "rb" => new Invocation("ruby", new[] { "-e" }), _ => throw new MamExecutionException("unsupported language: " + language) };

    /// <summary>Executes one block and represents startup and non-zero failures as results.</summary><param name="block">Nullable code block.</param><returns>One execution result.</returns>
    public ExecutionResult Execute(Ast.CodeBlock? block)
    {
        if (block == null || string.IsNullOrWhiteSpace(block.Code)) return new ExecutionResult(0, string.Empty, "code block is empty", 0);
        long started = Environment.TickCount64;
        try
        {
            Invocation invocation = InvocationFor(block.Language); System.Diagnostics.ProcessStartInfo info = new(invocation.Executable) { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = config.WorkingDirectory ?? string.Empty }; foreach (string argument in invocation.Arguments) info.ArgumentList.Add(argument); info.ArgumentList.Add(block.Code); foreach (KeyValuePair<string, string> variable in config.Environment) info.Environment[variable.Key] = variable.Value;
            using System.Diagnostics.Process process = System.Diagnostics.Process.Start(info) ?? throw new InvalidOperationException("process did not start"); string stdout = process.StandardOutput.ReadToEnd(); string stderr = process.StandardError.ReadToEnd(); if (!process.WaitFor(config.TimeoutMs)) { try { process.Kill(true); } catch (InvalidOperationException) { } return new ExecutionResult(124, Truncate(stdout, config.MaxOutputBytes), Truncate(stderr, config.MaxOutputBytes) + "\ntimed out", Environment.TickCount64 - started); }
            return new ExecutionResult(process.ExitCode, Truncate(stdout, config.MaxOutputBytes), Truncate(stderr, config.MaxOutputBytes), Environment.TickCount64 - started);
        }
        catch (MamExecutionException error) { return new ExecutionResult(127, string.Empty, error.Message, Environment.TickCount64 - started); }
        catch (Exception error) { return new ExecutionResult(127, string.Empty, error.Message, Environment.TickCount64 - started); }
    }

    /// <summary>Executes all blocks in module order.</summary><param name="module">Nullable module.</param><returns>One result per block.</returns> public ExecutionResult[] ExecuteModule(Ast.Module? module) => module?.AllCodeBlocks().Select(Execute).ToArray() ?? Array.Empty<ExecutionResult>();
    /// <summary>Reports true only for a nonempty all-zero result list.</summary><param name="results">Nullable results.</param><returns>Whether every result succeeded.</returns> public static bool AllSucceeded(IEnumerable<ExecutionResult>? results) { if (results == null) return false; ExecutionResult[] values = results.ToArray(); return values.Length > 0 && values.All(item => item.Succeeded); }
    /// <summary>Counts results by exit code.</summary><param name="results">Nullable results.</param><returns>Exit-code counts.</returns> public static IDictionary<int, int> ExitCodeCounts(IEnumerable<ExecutionResult>? results) { Sys.Dictionary<int, int> output = new(); if (results != null) foreach (ExecutionResult result in results) output[result.ExitCode] = output.GetValueOrDefault(result.ExitCode) + 1; return output; }
    private static string Truncate(string value, int bytes) { if (value.Length <= bytes) return value; return value[..Math.Max(0, bytes)] + "...(truncated)"; }

    /// <summary>Stores a resolved process invocation.</summary><param name="Executable">Executable name.</param><param name="Arguments">Fixed arguments before inline code.</param> public sealed record Invocation(string Executable, string[] Arguments) { /// <summary>Copies arguments.</summary> public Invocation => this with { Arguments = Arguments?.ToArray() ?? Array.Empty<string>() }; }
    /// <summary>Stores execution controls.</summary><param name="TimeoutMs">Maximum duration; nonpositive becomes one minute.</param><param name="Environment">Additional variables.</param><param name="WorkingDirectory">Optional working directory.</param><param name="MaxOutputBytes">Per-stream cap; nonpositive becomes one megabyte.</param>
    public sealed record ExecutionConfig { /// <summary>Gets timeout.</summary> public long TimeoutMs { get; init; } = 60_000; /// <summary>Gets environment.</summary> public IDictionary<string, string> Environment { get; init; } = new Dictionary<string, string>(StringComparer.Ordinal); /// <summary>Gets working directory.</summary> public string? WorkingDirectory { get; init; } /// <summary>Gets output cap.</summary> public int MaxOutputBytes { get; init; } = 1_048_576; /// <summary>Creates normalized settings.</summary> public ExecutionConfig(long timeoutMs, IDictionary<string, string> environment, string? workingDirectory, int maxOutputBytes) { TimeoutMs = timeoutMs <= 0 ? 60_000 : timeoutMs; Environment = environment == null ? new Dictionary<string, string>(StringComparer.Ordinal) : new Dictionary<string, string>(environment, StringComparer.Ordinal); WorkingDirectory = workingDirectory; MaxOutputBytes = maxOutputBytes <= 0 ? 1_048_576 : maxOutputBytes; } /// <summary>Returns documented defaults.</summary> public static ExecutionConfig Defaults() => new(60_000, new Dictionary<string, string>(), null, 1_048_576); }
    /// <summary>Stores one process outcome.</summary><param name="ExitCode">Process exit code.</param><param name="Stdout">Captured standard output.</param><param name="Stderr">Captured standard error.</param><param name="DurationMs">Elapsed milliseconds.</param>
    public sealed record ExecutionResult(int ExitCode, string Stdout, string Stderr, long DurationMs) { /// <summary>Reports whether the exit is zero.</summary> public bool Succeeded => ExitCode == 0; /// <summary>Combines nonempty streams.</summary> public string CombinedOutput => Stdout.Length == 0 ? Stderr : Stderr.Length == 0 ? Stdout : Stdout + "\n" + Stderr; }
    /// <summary>Represents an invocation resolution failure.</summary><param name="message">Failure reason.</param> public sealed class MamExecutionException(string message) : Exception(TextSupport_Runtime.Empty(message));
}

    internal static class TextSupport_Runtime
    {
        internal static bool Blank(string? value) => string.IsNullOrWhiteSpace(value);
        internal static string Empty(string? value) => value ?? string.Empty;
        internal static string Normalized(string? value) => string.Join(' ', Empty(value).Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
        internal static bool EqualIgnoreCase(string? left, string? right) => string.Equals(left, right, StringComparison.OrdinalIgnoreCase);
        internal static bool Starts(string? value, string? prefix) => value != null && prefix != null && value.StartsWith(prefix, StringComparison.OrdinalIgnoreCase);
        internal static bool Ends(string? value, string? suffix) => value != null && suffix != null && value.EndsWith(suffix, StringComparison.OrdinalIgnoreCase);
        internal static string Truncate(string? value, int maximum)
        {
            string text = Empty(value);
            if (maximum < 0) return string.Empty;
            if (text.Length <= maximum) return text;
            if (maximum <= 3) return text[..maximum];
            return string.Concat(text.AsSpan(0, maximum - 3), "...");
        }
        internal static string FirstLine(string? value)
        {
            string text = Empty(value); int end = text.IndexOf('\n'); return end < 0 ? text : text[..end];
        }
        internal static string LastLine(string? value)
        {
            string text = Empty(value); int end = text.LastIndexOf('\n'); return end < 0 ? text : text[(end + 1)..];
        }
        internal static string Capitalize(string? value)
        {
            string text = Empty(value).Trim(); return text.Length == 0 ? text : char.ToUpperInvariant(text[0]) + text[1..];
        }
        internal static Sys.List<string> NonBlank(IEnumerable<string?>? values)
        {
            Sys.List<string> output = new();
            if (values == null) return output;
            foreach (string? value in values) if (!Blank(value)) output.Add(value!.Trim());
            return output;
        }
        internal static Sys.List<string> Unique(IEnumerable<string?>? values)
        {
            Sys.HashSet<string> seen = new(StringComparer.Ordinal); Sys.List<string> output = new();
            if (values != null) foreach (string? value in values) if (!Blank(value) && seen.Add(value!.Trim())) output.Add(value.Trim());
            return output;
        }
        internal static string Joined(IEnumerable<string?>? values, string separator)
        {
            Sys.List<string> output = new(); if (values != null) foreach (string? value in values) output.Add(Empty(value));
            return string.Join(separator, output);
        }
        internal static int CountContaining(IEnumerable<string?>? values, string? needle)
        {
            if (values == null || Blank(needle)) return 0; int count = 0; foreach (string? value in values) if (Empty(value).Contains(needle, StringComparison.Ordinal)) count++; return count;
        }
        internal static Sys.List<string> Reversed(IEnumerable<string?>? values)
        {
            Sys.List<string> output = new(); if (values != null) output.AddRange(values); output.Reverse(); return output;
        }
        internal static string Repeated(char value, int count) => count <= 0 ? string.Empty : new string(value, count);
        internal static int Clamp(int value, int minimum, int maximum) => Math.Max(minimum, Math.Min(maximum, value));
        internal static long Clamp(long value, long minimum, long maximum) => Math.Max(minimum, Math.Min(maximum, value));
        internal static string JsonEscape(string? value) => Empty(value).Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\n", "\\n").Replace("\r", "\\r").Replace("\t", "\\t");
        internal static string FileName(string? path)
        {
            string normalized = Empty(path).Replace('\\', '/'); int slash = normalized.LastIndexOf('/'); return slash < 0 ? normalized : normalized[(slash + 1)..];
        }
        internal static string Extension(string? path)
        {
            string name = FileName(path); int dot = name.LastIndexOf('.'); return dot < 0 ? string.Empty : name[(dot + 1)..];
        }
        internal static string Slug(string? value)
        {
            char[] input = Empty(value).Trim().ToLowerInvariant().ToArray(); System.Text.StringBuilder output = new();
            bool separator = false; foreach (char c in input) { if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) { output.Append(c); separator = false; } else separator = output.Length > 0; if (separator) output.Append('-'); }
            string result = output.ToString().Trim('-'); return result.Length > 64 ? result[..64].TrimEnd('-') : result;
        }
    }


    internal static class UtilitySupport2_Runtime
    {
        internal static string DefaultText(string? value, string fallback) => TextSupport_Runtime.Blank(value) ? fallback : value!;
        internal static int Count(string? value, string? needle) => TextSupport_Runtime.Blank(needle) ? 0 : (TextSupport_Runtime.Empty(value).Split(needle!, StringSplitOptions.None).Length - 1);
        internal static int LineCount(string? value) => TextSupport_Runtime.Empty(value).Split('\n').Length;
        internal static int NonEmptyLineCount(string? value) => TextSupport_Runtime.Empty(value).Split('\n').Count(line => !string.IsNullOrWhiteSpace(line));
        internal static int Sum(IEnumerable<int>? values) => values?.Sum() ?? 0;
        internal static int Maximum(IEnumerable<int>? values) => values?.DefaultIfEmpty(0).Max() ?? 0;
        internal static int Minimum(IEnumerable<int>? values) => values?.DefaultIfEmpty(0).Min() ?? 0;
        internal static double Average(IEnumerable<int>? values) => values?.DefaultIfEmpty(0).Average() ?? 0;
        internal static string[] First(IEnumerable<string?>? values, int count) => count <= 0 ? Array.Empty<string>() : values?.Take(count).Select(item => item ?? string.Empty).ToArray() ?? Array.Empty<string>();
        internal static string[] Last(IEnumerable<string?>? values, int count) { if (count <= 0) return Array.Empty<string>(); string[] all = values?.Select(item => item ?? string.Empty).ToArray() ?? Array.Empty<string>(); return all.Skip(Math.Max(0, all.Length - count)).ToArray(); }
        internal static string[] Take(IEnumerable<string?>? values, int count) => First(values, count);
        internal static string[] Drop(IEnumerable<string?>? values, int count) => count <= 0 ? values?.Select(item => item ?? string.Empty).ToArray() ?? Array.Empty<string>() : values?.Skip(count).Select(item => item ?? string.Empty).ToArray() ?? Array.Empty<string>();
        internal static string[] Filtered(IEnumerable<string?>? values, string? needle) => TextSupport_Runtime.Blank(needle) ? Array.Empty<string>() : values?.Where(item => TextSupport_Runtime.Empty(item).Contains(needle!, StringComparison.Ordinal)).Select(item => item!).ToArray() ?? Array.Empty<string>();
        internal static string[] Sorted(IEnumerable<string?>? values) => values?.Select(item => item ?? string.Empty).OrderBy(item => item, StringComparer.Ordinal).ToArray() ?? Array.Empty<string>();
        internal static string[] Reversed(IEnumerable<string?>? values) => values?.Select(item => item ?? string.Empty).Reverse().ToArray() ?? Array.Empty<string>();
        internal static string[] Compact(IEnumerable<string?>? values) => TextSupport_Runtime.NonBlank(values);
        internal static string[] Without(IEnumerable<string?>? values, string? unwanted) => values?.Where(item => item != unwanted).Select(item => item ?? string.Empty).ToArray() ?? Array.Empty<string>();
        internal static string[] WithoutBlanks(IEnumerable<string?>? values) => values?.Where(item => !TextSupport_Runtime.Blank(item)).Select(item => item!).ToArray() ?? Array.Empty<string>();
        internal static string JoinOr(IEnumerable<string?>? values, string separator, string fallback) { string[] items = values?.Select(item => item ?? string.Empty).ToArray() ?? Array.Empty<string>(); return items.Length == 0 ? fallback : string.Join(separator, items); }
        internal static string IndentLines(string? value, string prefix) => string.Join("\n", TextSupport_Runtime.Empty(value).Split('\n').Select(line => line.Length == 0 ? line : prefix + line));
        internal static string Wrap(string? value, int width) { Sys.List<string> words = TextSupport_Runtime.Empty(value).Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).ToList(); Sys.List<string> lines = new(); StringBuilder current = new(); foreach (string word in words) { if (current.Length > 0 && current.Length + word.Length + 1 > width) { lines.Add(current.ToString()); current.Clear(); } else if (current.Length > 0) current.Append(' '); current.Append(word); } if (current.Length > 0) lines.Add(current.ToString()); return string.Join("\n", lines); }
        internal static string Csv(string? value) => TextSupport_Runtime.Empty(value).Replace(',', ';').Replace("\n", " ");
        internal static string Bracket(string? value) => "[" + TextSupport_Runtime.Empty(value) + "]";
        internal static string Paren(string? value) => "(" + TextSupport_Runtime.Empty(value) + ")";
        internal static string Braces(string? value) => "{" + TextSupport_Runtime.Empty(value) + "}";
        internal static string Quote(string? value) => TextSupport_Runtime.Empty(value).Replace("\"", "\\\"");
        internal static string Unquote(string? value) { string text = TextSupport_Runtime.Empty(value); return text.Length >= 2 && text.StartsWith('"') && text.EndsWith('"') ? text[1..^1] : text; }
        internal static bool AnyBlank(IEnumerable<string?>? values) => values == null || values.Any(TextSupport_Runtime.Blank);
        internal static bool AllBlank(IEnumerable<string?>? values) => values == null || values.All(TextSupport_Runtime.Blank);
        internal static bool ContainsIgnoreCase(IEnumerable<string?>? values, string? needle) => !TextSupport_Runtime.Blank(needle) && values != null && values.Any(item => string.Equals(item, needle, StringComparison.OrdinalIgnoreCase));
        internal static bool ValidLanguage(string? value) => !TextSupport_Runtime.Blank(value) && System.Text.RegularExpressions.Regex.IsMatch(value!, "^[A-Za-z0-9_+-]+$");
        internal static bool ValidUrl(string? value) => value != null && (value.StartsWith("https://", StringComparison.OrdinalIgnoreCase) || value.StartsWith("http://", StringComparison.OrdinalIgnoreCase));
        internal static bool ValidPath(string? value) => !TextSupport_Runtime.Blank(value) && !value!.Contains('\0');
        internal static string NormalizeLanguage(string? value) => TextSupport_Runtime.Blank(value) ? "unknown" : value!.Trim().ToLowerInvariant();
        internal static string NormalizeSection(string? value) => TextSupport_Runtime.Blank(value) ? "custom" : value!.Trim().ToLowerInvariant();
        internal static string NormalizeVersion(string? value) { string text = TextSupport_Runtime.Empty(value).Trim(); return text.Length == 0 ? "0.0.0" : (text.StartsWith("v", StringComparison.OrdinalIgnoreCase) ? text[1..] : text); }
        internal static string SafeFileName(string? value) => TextSupport_Runtime.Blank(value) ? "module.mam.md" : System.Text.RegularExpressions.Regex.Replace(TextSupport_Runtime.FileName(value), "[^A-Za-z0-9._-]", "_");
        internal static string ExtensionOrUnknown(string? value) => TextSupport_Runtime.Blank(TextSupport_Runtime.Extension(value)) ? "unknown" : TextSupport_Runtime.Extension(value).ToLowerInvariant();
        internal static string[] CompactArray(IEnumerable<string?>? values) => TextSupport_Runtime.NonBlank(values);
        internal static IDictionary<string, string> CopyMap(IDictionary<string, string>? values) => values == null ? new Dictionary<string, string>(StringComparer.Ordinal) : new Dictionary<string, string>(values, StringComparer.Ordinal);
        internal static IDictionary<string, string> MergeMaps(IDictionary<string, string>? first, IDictionary<string, string>? second) { IDictionary<string, string> output = CopyMap(first); if (second != null) foreach (KeyValuePair<string, string> item in second) output[item.Key] = item.Value; return output; }
        internal static IDictionary<string, string> MapOf(string key, string value) => new Dictionary<string, string>(StringComparer.Ordinal) { [key] = value };
        internal static string[] SplitCsv(string? value) => TextSupport_Runtime.Empty(value).Split(',', StringSplitOptions.RemoveEmptyEntries).Select(item => item.Trim()).ToArray();
        internal static string JoinCsv(IEnumerable<string?>? values) => string.Join(",", values?.Select(item => item ?? string.Empty) ?? Array.Empty<string>());
        internal static string ReplaceNewlines(string? value) => TextSupport_Runtime.Empty(value).Replace("\r\n", "\n").Replace('\r', '\n');
        internal static string StripQuotes(string? value) => System.Text.RegularExpressions.Regex.Replace(TextSupport_Runtime.Empty(value), "^[\\\"']|[\\\"']$", "");
        internal static string ToTitle(string? value) => TextSupport_Runtime.Capitalize(value);
        internal static string Shorten(string? value, int maximum) => TextSupport_Runtime.Truncate(value, maximum);
        internal static string ValueOrEmpty(object? value) => value?.ToString() ?? string.Empty;
        internal static int SafeLength(string? value) => TextSupport_Runtime.Empty(value).Length;
        internal static bool Same(string? left, string? right) => TextSupport_Runtime.EqualIgnoreCase(left, right);
        internal static bool Present(string? value) => !TextSupport_Runtime.Blank(value);
        internal static string Fallback(string? value, string fallback) => DefaultText(value, fallback);
    }


    internal static class UtilitySupport3_Runtime
    {
        internal static string? FirstNonBlank(IEnumerable<string?>? values) => values?.FirstOrDefault(item => !TextSupport_Runtime.Blank(item));
        internal static string? LastNonBlank(IEnumerable<string?>? values) => values?.LastOrDefault(item => !TextSupport_Runtime.Blank(item));
        internal static string? Longest(IEnumerable<string?>? values) => values?.Where(item => !TextSupport_Runtime.Blank(item)).OrderByDescending(item => item!.Length).FirstOrDefault();
        internal static string? Shortest(IEnumerable<string?>? values) => values?.Where(item => !TextSupport_Runtime.Blank(item)).OrderBy(item => item!.Length).FirstOrDefault();
        internal static string[] DistinctSorted(IEnumerable<string?>? values) => values?.Select(item => item ?? string.Empty).Distinct(StringComparer.Ordinal).OrderBy(item => item, StringComparer.Ordinal).ToArray() ?? Array.Empty<string>();
        internal static string[] DistinctIgnoreCase(IEnumerable<string?>? values) => values?.Where(item => !TextSupport_Runtime.Blank(item)).Select(item => item!).Distinct(StringComparer.OrdinalIgnoreCase).ToArray() ?? Array.Empty<string>();
        internal static string[] Chunks(string? value, int size) { string text = TextSupport_Runtime.Empty(value); if (size <= 0) return Array.Empty<string>(); return Enumerable.Range(0, (text.Length + size - 1) / size).Select(index => text.Substring(index * size, Math.Min(size, text.Length - index * size))).ToArray(); }
        internal static string Reverse(string? value) => new(TextSupport_Runtime.Empty(value).Reverse().ToArray());
        internal static string PadLeft(string? value, int width, char fill = ' ') => TextSupport_Runtime.Empty(value).PadLeft(Math.Max(0, width), fill);
        internal static string PadRight(string? value, int width, char fill = ' ') => TextSupport_Runtime.Empty(value).PadRight(Math.Max(0, width), fill);
        internal static string Center(string? value, int width, char fill = ' ') { string text = TextSupport_Runtime.Empty(value); if (text.Length >= width) return text; int left = (width - text.Length) / 2; return new string(fill, left) + text + new string(fill, width - text.Length - left); }
        internal static string RepeatText(string? value, int count) => count <= 0 ? string.Empty : TextSupport_Runtime.Empty(value) + string.Concat(Enumerable.Repeat(TextSupport_Runtime.Empty(value), count - 1));
        internal static string NormalizeWhitespace(string? value) => TextSupport_Runtime.Normalized(value);
        internal static string NormalizePath(string? value) => TextSupport_Runtime.Empty(value).Replace('\\', '/');
        internal static string NormalizeExtension(string? value) => TextSupport_Runtime.Extension(value).ToLowerInvariant();
        internal static string NormalizeKey(string? value) => TextSupport_Runtime.Empty(value).Trim().ToLowerInvariant();
        internal static string[] SplitLines(string? value) => TextSupport_Runtime.Empty(value).Replace("\r\n", "\n").Replace('\r', '\n').Split('\n');
        internal static string[] SplitWhitespace(string? value) => TextSupport_Runtime.Empty(value).Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
        internal static string[] SplitComma(string? value) => TextSupport_Runtime.Empty(value).Split(',', StringSplitOptions.RemoveEmptyEntries).Select(item => item.Trim()).ToArray();
        internal static string[] SplitPipe(string? value) => TextSupport_Runtime.Empty(value).Split('|', StringSplitOptions.RemoveEmptyEntries).Select(item => item.Trim()).ToArray();
        internal static string JoinLines(IEnumerable<string?>? values) => string.Join("\n", values?.Select(item => item ?? string.Empty) ?? Array.Empty<string>());
        internal static string JoinTabs(IEnumerable<string?>? values) => string.Join("\t", values?.Select(item => item ?? string.Empty) ?? Array.Empty<string>());
        internal static string JoinSpaces(IEnumerable<string?>? values) => string.Join(" ", values?.Select(item => item ?? string.Empty) ?? Array.Empty<string>());
        internal static int CountWords(string? value) => SplitWhitespace(value).Length;
        internal static int CountChars(string? value) => TextSupport_Runtime.Empty(value).Length;
        internal static int CountLines(string? value) => SplitLines(value).Length;
        internal static int CountSubstring(string? value, string? needle) => Count(value, needle);
        internal static bool Contains(string? value, string? needle) => !TextSupport_Runtime.Blank(needle) && TextSupport_Runtime.Empty(value).Contains(needle!, StringComparison.Ordinal);
        internal static bool ContainsFold(string? value, string? needle) => !TextSupport_Runtime.Blank(needle) && TextSupport_Runtime.Empty(value).Contains(needle!, StringComparison.OrdinalIgnoreCase);
        internal static bool StartsFold(string? value, string? prefix) => TextSupport_Runtime.Starts(value, prefix);
        internal static bool EndsFold(string? value, string? suffix) => TextSupport_Runtime.Ends(value, suffix);
        internal static bool EqualsFold(string? left, string? right) => TextSupport_Runtime.EqualIgnoreCase(left, right);
        internal static bool Between(int value, int minimum, int maximum) => value >= minimum && value <= maximum;
        internal static int Abs(int value) => Math.Abs(value);
        internal static long Abs(long value) => Math.Abs(value);
        internal static int Sign(int value) => Math.Sign(value);
        internal static long Sign(long value) => Math.Sign(value);
        internal static int MaxOf(params int[] values) => values?.DefaultIfEmpty(0).Max() ?? 0;
        internal static int MinOf(params int[] values) => values?.DefaultIfEmpty(0).Min() ?? 0;
        internal static double AverageOf(params int[] values) => values?.DefaultIfEmpty(0).Average() ?? 0;
        internal static int RoundHalfUp(double value) => (int)Math.Round(value, MidpointRounding.AwayFromZero);
        internal static int SafeIndex(int value, int length) => Math.Max(0, Math.Min(Math.Max(0, length - 1), value));
        internal static string SafeSubstring(string? value, int start, int length) { string text = TextSupport_Runtime.Empty(value); if (start >= text.Length || length <= 0) return string.Empty; return text.Substring(start, Math.Min(length, text.Length - start)); }
        internal static string SafeSlice(string? value, int start, int finish) { string text = TextSupport_Runtime.Empty(value); int a = SafeIndex(start, text.Length); int b = SafeIndex(finish, text.Length); return a <= b ? text[a..b] : string.Empty; }
        internal static bool IsAscii(string? value) => TextSupport_Runtime.Empty(value).All(character => character <= 0x7f);
        internal static bool IsPrintable(string? value) => TextSupport_Runtime.Empty(value).All(character => !char.IsControl(character));
        internal static string StripControl(string? value) => new(TextSupport_Runtime.Empty(value).Where(character => !char.IsControl(character)).ToArray());
        internal static string QuoteCsv(string? value) => "\"" + TextSupport_Runtime.Empty(value).Replace("\"", "\"\"") + "\"";
        internal static string UnquoteCsv(string? value) { string text = TextSupport_Runtime.Empty(value); return text.Length >= 2 && text[0] == '"' && text[^1] == '"' ? text[1..^1].Replace("\"\"", "\"") : text; }
        internal static string ToKebab(string? value) => TextSupport_Runtime.Slug(value);
        internal static string ToSnake(string? value) => TextSupport_Runtime.Empty(value).Trim().ToLowerInvariant().Replace(' ', '_');
        internal static string ToCamel(string? value) => TextSupport_Runtime.Capitalize(TextSupport_Runtime.Slug(value).Replace("-", " ")).Replace(" ", string.Empty);
        internal static string ToTitle(string? value) => TextSupport_Runtime.Capitalize(value);
        internal static string ToHuman(string? value) => TextSupport_Runtime.Empty(value).Replace('_', ' ').Replace('-', ' ').Trim();
        internal static string ToIdentifier(string? value) { string text = TextSupport_Runtime.Slug(value).Replace("-", "_"); return text.Length == 0 ? "value" : (char.IsDigit(text[0]) ? "v_" + text : text); }
        internal static string Fallback(string? value, string fallback) => TextSupport_Runtime.Blank(value) ? fallback : value!;
        internal static string EmptyToNull(string? value) => TextSupport_Runtime.Blank(value) ? null : value;
        internal static string NullToEmpty(string? value) => value ?? string.Empty;
        internal static IEnumerable<string> DistinctStable(IEnumerable<string?>? values) => values?.Select(item => item ?? string.Empty).Distinct() ?? Array.Empty<string>();
        internal static IEnumerable<string> NonBlankStable(IEnumerable<string?>? values) => values?.Where(item => !TextSupport_Runtime.Blank(item)).Select(item => item!) ?? Array.Empty<string>();
        internal static IDictionary<string, string> EmptyMap() => new Dictionary<string, string>(StringComparer.Ordinal);
        internal static IReadOnlyList<string> EmptyList() => Array.Empty<string>();
        internal static bool IsEmpty<T>(IEnumerable<T>? values) => values == null || !values.Any();
    }


    internal static class UtilitySupport4_Runtime
    {
        internal static bool IsNullOrWhite(string? value) => TextSupport_Runtime.Blank(value);
        internal static bool HasText(string? value) => !TextSupport_Runtime.Blank(value);
        internal static string Clean(string? value) => TextSupport_Runtime.Normalized(value);
        internal static string OneLine(string? value) => TextSupport_Runtime.Empty(value).Replace("\r", " ").Replace("\n", " ");
        internal static string[] Lines(string? value) => TextSupport_Runtime.Empty(value).Replace("\r\n", "\n").Replace('\r', '\n').Split('\n');
        internal static string[] Words(string? value) => TextSupport_Runtime.Empty(value).Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
        internal static string[] Sentences(string? value) => TextSupport_Runtime.Empty(value).Split('.', StringSplitOptions.RemoveEmptyEntries).Select(item => item.Trim()).Where(item => item.Length > 0).ToArray();
        internal static string[] Deduplicate(IEnumerable<string?>? values) => values?.Select(item => item ?? string.Empty).Distinct().ToArray() ?? Array.Empty<string>();
        internal static string[] KeepNonBlank(IEnumerable<string?>? values) => values?.Where(item => !TextSupport_Runtime.Blank(item)).Select(item => item!).ToArray() ?? Array.Empty<string>();
        internal static string[] RejectNonBlank(IEnumerable<string?>? values) => values?.Where(TextSupport_Runtime.Blank).Select(item => item ?? string.Empty).ToArray() ?? Array.Empty<string>();
        internal static string[] TakeUnique(IEnumerable<string?>? values, int count) => values?.Select(item => item ?? string.Empty).Distinct().Take(Math.Max(0, count)).ToArray() ?? Array.Empty<string>();
        internal static string[] SkipUnique(IEnumerable<string?>? values, int count) => values?.Select(item => item ?? string.Empty).Distinct().Skip(Math.Max(0, count)).ToArray() ?? Array.Empty<string>();
        internal static string[] ReverseUnique(IEnumerable<string?>? values) => values?.Select(item => item ?? string.Empty).Distinct().Reverse().ToArray() ?? Array.Empty<string>();
        internal static string[] SortByLength(IEnumerable<string?>? values) => values?.Select(item => item ?? string.Empty).OrderBy(item => item.Length).ToArray() ?? Array.Empty<string>();
        internal static string Longest(IEnumerable<string?>? values) => values?.OrderByDescending(item => (item ?? string.Empty).Length).FirstOrDefault() ?? string.Empty;
        internal static string Shortest(IEnumerable<string?>? values) => values?.OrderBy(item => (item ?? string.Empty).Length).FirstOrDefault() ?? string.Empty;
        internal static int IndexOfWord(string? value, string? word) { string[] words = Words(value); int index = Array.FindIndex(words, item => string.Equals(item, word, StringComparison.OrdinalIgnoreCase)); return index; }
        internal static bool ContainsWord(string? value, string? word) => IndexOfWord(value, word) >= 0;
        internal static int CountWord(string? value, string? word) => Words(value).Count(item => string.Equals(item, word, StringComparison.OrdinalIgnoreCase));
        internal static string TitleCase(string? value) => string.Join(" ", Words(value).Select(TextSupport_Runtime.Capitalize));
        internal static string KebabCase(string? value) => TextSupport_Runtime.Slug(value);
        internal static string SnakeCase(string? value) => OneLine(value).ToLowerInvariant().Replace(' ', '_');
        internal static string SpaceCase(string? value) => OneLine(value).Replace('_', ' ').Replace('-', ' ').Trim();
        internal static string RemovePrefix(string? value, string? prefix) => TextSupport_Runtime.Starts(value, prefix) ? value![prefix!.Length..] : TextSupport_Runtime.Empty(value);
        internal static string RemoveSuffix(string? value, string? suffix) => TextSupport_Runtime.Ends(value, suffix) ? value![..^suffix!.Length] : TextSupport_Runtime.Empty(value);
        internal static string AddPrefix(string? value, string? prefix) => TextSupport_Runtime.Blank(prefix) ? TextSupport_Runtime.Empty(value) : prefix + TextSupport_Runtime.Empty(value);
        internal static string AddSuffix(string? value, string? suffix) => TextSupport_Runtime.Blank(suffix) ? TextSupport_Runtime.Empty(value) : TextSupport_Runtime.Empty(value) + suffix;
        internal static string DefaultIfBlank(string? value, string fallback) => TextSupport_Runtime.Blank(value) ? fallback : value!;
        internal static string OrEmpty(string? value) => value ?? string.Empty;
        internal static string? OrNull(string? value) => TextSupport_Runtime.Blank(value) ? null : value;
        internal static int CountChars(string? value, char target) => TextSupport_Runtime.Empty(value).Count(item => item == target);
        internal static int CountNewlines(string? value) => CountChars(value, '\n');
        internal static int CountTabs(string? value) => CountChars(value, '\t');
        internal static bool IsAsciiLetter(char value) => (value >= 'a' && value <= 'z') || (value >= 'A' && value <= 'Z');
        internal static bool IsDigit(char value) => value >= '0' && value <= '9';
        internal static bool IsWordChar(char value) => IsAsciiLetter(value) || IsDigit(value) || value == '_';
        internal static string Letters(string? value) => new(TextSupport_Runtime.Empty(value).Where(IsAsciiLetter).ToArray());
        internal static string Digits(string? value) => new(TextSupport_Runtime.Empty(value).Where(IsDigit).ToArray());
        internal static string StripSpaces(string? value) => new(TextSupport_Runtime.Empty(value).Where(item => !char.IsWhiteSpace(item)).ToArray());
        internal static string CollapseSpaces(string? value) => string.Join(" ", Words(value));
        internal static string NormalizeSeparators(string? value) => TextSupport_Runtime.Empty(value).Replace('\\', '/').Replace('|', '/');
        internal static string EnsureSuffix(string? value, string suffix) => TextSupport_Runtime.Ends(value, suffix) ? TextSupport_Runtime.Empty(value) : TextSupport_Runtime.Empty(value) + suffix;
        internal static string EnsurePrefix(string? value, string prefix) => TextSupport_Runtime.Starts(value, prefix) ? TextSupport_Runtime.Empty(value) : prefix + TextSupport_Runtime.Empty(value);
        internal static string QuoteJson(string? value) => System.Text.Json.JsonSerializer.Serialize(TextSupport_Runtime.Empty(value));
        internal static string UnquoteJson(string? value) { try { return System.Text.Json.JsonSerializer.Deserialize<string>(TextSupport_Runtime.Empty(value)) ?? string.Empty; } catch { return TextSupport_Runtime.Empty(value); } }
        internal static string TruncateWords(string? value, int count) { string[] words = Words(value); return string.Join(" ", words.Take(Math.Max(0, count))) + (words.Length > count ? "..." : string.Empty); }
        internal static bool IsNullOrEmpty<T>(IEnumerable<T>? values) => values == null || !values.Any();
        internal static int SafeCount<T>(IEnumerable<T>? values) => values?.Count() ?? 0;
        internal static IEnumerable<T> SafeEmpty<T>(IEnumerable<T>? values) => values ?? Array.Empty<T>();
        internal static string Describe<T>(IEnumerable<T>? values) => values == null ? "null" : values.Count().ToString(System.Globalization.CultureInfo.InvariantCulture);
    }


    internal static class UtilitySupport5_Runtime
    {
        internal static string? FirstValue(IEnumerable<string?>? values) => values?.FirstOrDefault();
        internal static string? LastValue(IEnumerable<string?>? values) => values?.LastOrDefault();
        internal static string? MiddleValue(IEnumerable<string?>? values) { string[] all = values?.ToArray() ?? Array.Empty<string>(); return all.Length == 0 ? null : all[all.Length / 2]; }
        internal static bool HasDuplicates(IEnumerable<string?>? values) => values != null && values.Select(item => item ?? string.Empty).Distinct().Count() != values.Count();
        internal static string[] WithoutDuplicates(IEnumerable<string?>? values) => values?.Select(item => item ?? string.Empty).Distinct().ToArray() ?? Array.Empty<string>();
        internal static string[] OnlyWords(IEnumerable<string?>? values) => values?.Where(item => !TextSupport_Runtime.Blank(item) && item.All(IsWord)).ToArray() ?? Array.Empty<string>();
        internal static string[] OnlyDigits(IEnumerable<string?>? values) => values?.Where(item => !TextSupport_Runtime.Blank(item) && item.All(char.IsDigit)).ToArray() ?? Array.Empty<string>();
        internal static bool IsWord(string? value) => !TextSupport_Runtime.Blank(value) && value!.All(IsWordChar);
        internal static bool IsWordChar(char value) => char.IsLetterOrDigit(value) || value == '_';
        internal static string JoinNonBlank(IEnumerable<string?>? values, string separator) => string.Join(separator, values?.Where(item => !TextSupport_Runtime.Blank(item)).Select(item => item!) ?? Array.Empty<string>());
        internal static string TitleOrUntitled(string? value) => TextSupport_Runtime.Blank(value) ? "Untitled" : TextSupport_Runtime.Capitalize(value);
        internal static string StripPrefixOrSelf(string? value, string? prefix) => TextSupport_Runtime.Starts(value, prefix) ? value![prefix!.Length..] : TextSupport_Runtime.Empty(value);
        internal static string StripSuffixOrSelf(string? value, string? suffix) => TextSupport_Runtime.Ends(value, suffix) ? value![..^suffix!.Length] : TextSupport_Runtime.Empty(value);
        internal static string EnsurePathSeparator(string? value) { string text = TextSupport_Runtime.Empty(value).Replace('\\', '/'); return text.EndsWith('/') ? text : text + '/'; }
        internal static string EnsureNoPathSeparator(string? value) { string text = TextSupport_Runtime.Empty(value).Replace('\\', '/'); return text.EndsWith('/') ? text[..^1] : text; }
        internal static string FileNameOrDefault(string? value, string fallback) => TextSupport_Runtime.Blank(TextSupport_Runtime.FileName(value)) ? fallback : TextSupport_Runtime.FileName(value);
        internal static string ExtensionOrBlank(string? value) => TextSupport_Runtime.Extension(value);
        internal static bool IsMamPath(string? value) => TextSupport_Runtime.Ends(value, ".mam.md");
        internal static bool IsMarkdownPath(string? value) => TextSupport_Runtime.Ends(value, ".md");
        internal static string WithExtension(string? value, string extension) => TextSupport_Runtime.Extension(value).Length == 0 ? TextSupport_Runtime.Empty(value) + "." + extension : TextSupport_Runtime.Empty(value);
        internal static int CompareLength(string? left, string? right) => TextSupport_Runtime.Empty(left).Length.CompareTo(TextSupport_Runtime.Empty(right).Length);
        internal static string Repeat(string? value, int count) => count <= 0 ? string.Empty : string.Concat(Enumerable.Repeat(TextSupport_Runtime.Empty(value), count));
        internal static string Fill(string? value, int width, char fill) => PadRight(value, width, fill);
        internal static string PadLeft(string? value, int width, char fill = ' ') => TextSupport_Runtime.Empty(value).PadLeft(Math.Max(0, width), fill);
        internal static string PadRight(string? value, int width, char fill = ' ') => TextSupport_Runtime.Empty(value).PadRight(Math.Max(0, width), fill);
        internal static int Percent(int part, int whole) => whole == 0 ? 0 : (int)Math.Round(part * 100.0 / whole);
        internal static bool IsSuccess(int exitCode) => exitCode == 0;
        internal static bool IsTimeout(int exitCode) => exitCode == 124 || exitCode == 137;
        internal static bool IsFailure(int exitCode) => exitCode != 0 && !IsTimeout(exitCode);
        internal static string ExitLabel(int exitCode) => IsSuccess(exitCode) ? "ok" : IsTimeout(exitCode) ? "timeout" : "error";
        internal static string Duration(long milliseconds) => milliseconds < 1000 ? milliseconds + "ms" : (milliseconds / 1000.0).ToString("0.0", System.Globalization.CultureInfo.InvariantCulture) + "s";
        internal static string ByteLimit(int bytes) => bytes >= 1_048_576 ? (bytes / 1_048_576.0).ToString("0.0", System.Globalization.CultureInfo.InvariantCulture) + " MiB" : bytes + " bytes";
        internal static bool IsAscii(string? value) => TextSupport_Runtime.Empty(value).All(character => character <= 0x7f);
        internal static bool IsPrintable(string? value) => TextSupport_Runtime.Empty(value).All(character => !char.IsControl(character));
        internal static string ControlFree(string? value) => new(TextSupport_Runtime.Empty(value).Where(character => !char.IsControl(character)).ToArray());
        internal static bool ContainsControl(string? value) => TextSupport_Runtime.Empty(value).Any(char.IsControl);
        internal static string NormalizeLanguage(string? value) => TextSupport_Runtime.Blank(value) ? "unknown" : value!.Trim().ToLowerInvariant();
        internal static string NormalizeVersion(string? value) => TextSupport_Runtime.Blank(value) ? "0.0.0" : value!.Trim().TrimStart('v', 'V');
        internal static string NormalizeName(string? value) => TextSupport_Runtime.Slug(value);
        internal static string Quote(string? value) => "\"" + TextSupport_Runtime.Empty(value).Replace("\"", "\\\"") + "\"";
        internal static string Unquote(string? value) { string text = TextSupport_Runtime.Empty(value); return text.Length >= 2 && text[0] == '"' && text[^1] == '"' ? text[1..^1] : text; }
        internal static string SafeJson(string? value) => System.Text.Json.JsonSerializer.Serialize(TextSupport_Runtime.Empty(value));
        internal static string JoinPath(params string?[] parts) => Path.Combine(parts.Select(part => TextSupport_Runtime.Empty(part)).Where(part => part.Length > 0));
        internal static bool IsAbsolutePath(string? value) => Path.IsPathRooted(TextSupport_Runtime.Empty(value));
        internal static bool IsExistingFile(string? value) => File.Exists(value);
        internal static bool IsExistingDirectory(string? value) => Directory.Exists(value);
        internal static bool IsWritableDirectory(string? value) => Directory.Exists(value);
    }
