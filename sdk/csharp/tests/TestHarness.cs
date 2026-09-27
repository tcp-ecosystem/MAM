namespace Mam.Tests;

using System;
using System.Collections.Generic;

/// <summary>Zero-dependency executable checks for the C# SDK.</summary>
public static class TestHarness
{
    /// <summary>Runs every check and returns a process exit code.</summary>
    /// <param name="args">Unused command-line arguments.</param>
    /// <returns>Zero after all checks complete; otherwise one.</returns>
    public static int Main(string[] args)
    {
        try { RunAll(); return 0; } catch (Exception error) { Console.Error.WriteLine(error.Message); return 1; }
    }

    /// <summary>Executes ten package checks.</summary>
    public static void RunAll()
    {
        Kinds(); FrontMatter(); ParserNodes(); SafeParse(); Validation(); Runtime(); Plugins(); Template(); Config(); Nulls();
        Console.WriteLine("10 checks completed");
    }
    /// <summary>Checks twenty section variants.</summary> public static void Kinds() { if (Enum.GetValues<Ast.SectionKind>().Length != 20) throw new Exception("section kinds"); }
    /// <summary>Checks authoritative front matter name.</summary> public static void FrontMatter() { Ast.FrontMatter value = new("x", Array.Empty<string>(), "1", "", "1", "MIT", Array.Empty<string>(), Array.Empty<string>(), new Dictionary<string, string>()); if (value.Name.Length == 0) throw new Exception("front matter"); }
    /// <summary>Checks parsing and code nodes.</summary> public static void ParserNodes() { Ast.Module module = Parser.Parse("---\nname: x\nauthors: [A]\n---\n## Purpose\nText\n```python\nprint(1)\n```\n", "x"); if (module.AllCodeBlocks().Length != 1) throw new Exception("parser"); }
    /// <summary>Checks non-throwing parse failure.</summary> public static void SafeParse() { if (Parser.SafeParse("---\nname: x\n## Purpose\n", "x").Success) throw new Exception("safe parse"); }
    /// <summary>Checks validation.</summary> public static void Validation() { if (!Mam.IsValidModule(Parser.Parse("---\nname: x\nversion: 1\n---\n## Purpose\nok", "x"))) throw new Exception("validation"); }
    /// <summary>Checks runtime defaults.</summary> public static void Runtime() { if (Runtime.ExecutionConfig.Defaults().TimeoutMs != 60_000) throw new Exception("runtime"); }
    /// <summary>Checks plugin registry.</summary> public static void Plugins() { PluginRegistry registry = new(); if (!registry.Register(new Stub())) throw new Exception("plugins"); }
    /// <summary>Checks template rendering.</summary> public static void Template() { if (!Template.NewModule("Demo", "module", new Dictionary<string, string> { ["author"] = "A" }).Contains("name: Demo")) throw new Exception("template"); }
    /// <summary>Checks config merge.</summary> public static void Config() { Config.SdkConfig baseConfig = Config.Defaults(); if (Config.Merge(baseConfig, new Config.SdkConfig("", "", "csharp", false, new Dictionary<string, string>())).Target != "csharp" || baseConfig.Target != "python") throw new Exception("config"); }
    /// <summary>Checks documented null behavior.</summary> public static void Nulls() { if (Mam.ModuleSummary(null).Length == 0 || new Validator().Validate(null).IsValid) throw new Exception("nulls"); }
    private sealed class Stub : IPlugin { public string Name => "stub"; public string Version => "1"; public IReadOnlyList<HookPoint> Hooks { get; } = new[] { HookPoint.BeforeParse }; public string? Handle(HookPoint point, PluginContext context) => point.ToString(); }
