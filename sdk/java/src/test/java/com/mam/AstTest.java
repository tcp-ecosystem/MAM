package com.mam;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;

/** Zero-dependency checks runnable as a plain Java main class. */
public final class AstTest {
    private AstTest() { }

    /** Runs every check and throws on the first failure. */
    public static void main(String[] args) throws Exception { runAll(); }

    /** Executes all ten checks. */
    public static void runAll() throws Exception { kinds(); frontMatter(); parser(); safe(); validation(); runtime(); plugins(); template(); config(); nulls(); System.out.println("10 checks completed"); }
    /** Checks twenty section variants. */ public static void kinds() { if (Ast.SectionKind.values().length != 20) throw new AssertionError("kinds"); }
    /** Checks name field. */ public static void frontMatter() { if (new Ast.FrontMatter("x", List.of(), "1", "", "1", "MIT", List.of(), List.of(), Map.of()).name().isBlank()) throw new AssertionError("name"); }
    /** Checks parser output. */ public static void parser() throws Exception { Ast.Module module = Parser.parse("---\nname: x\nauthors: [A]\n---\n## Purpose\nText\n```python\nprint(1)\n```\n", "x"); if (module.allCodeBlocks().size() != 1) throw new AssertionError("parser"); }
    /** Checks safe failure. */ public static void safe() { if (Parser.safeParse("---\nname: x\n## Purpose\n", "x").success()) throw new AssertionError("safe"); }
    /** Checks validation. */ public static void validation() throws Exception { if (!Mam.isValidModule(Parser.parse("---\nname: x\nversion: 1\n---\n## Purpose\nok", "x"))) throw new AssertionError("validation"); }
    /** Checks runtime defaults. */ public static void runtime() { if (new Runtime.ExecutionConfig(0, null, null, 0).timeoutMs() != 60_000) throw new AssertionError("runtime"); }
    /** Checks plugins. */ public static void plugins() { if (!new Plugins.PluginRegistry().register(new Stub()) || new Plugins.PluginRegistry().size() != 0) throw new AssertionError("plugins"); }
    /** Checks templates. */ public static void template() { if (!Template.newModule("Demo", "module", Map.of("author", "A")).contains("name: Demo")) throw new AssertionError("template"); }
    /** Checks config merge. */ public static void config() { Config.SdkConfig base = Config.defaults(); if (!Config.merge(base, new Config.SdkConfig("", "", "java", false, Map.of())).target().equals("java") || !base.target().equals("python")) throw new AssertionError("config"); }
    /** Checks null behavior. */ public static void nulls() { if (Mam.moduleSummary(null).isBlank() || new Validator().validate(null).isValid()) throw new AssertionError("nulls"); }

    private static final class Stub implements Plugins.Plugin {
        public String name() { return "stub"; }
        public String version() { return "1"; }
        public List<Plugins.HookPoint> hooks() { return List.of(Plugins.HookPoint.BEFORE_PARSE); }
        public String handle(Plugins.HookPoint point, Plugins.Context context) { return point.name(); }
    }
