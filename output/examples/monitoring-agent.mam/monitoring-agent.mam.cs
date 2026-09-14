using System; using System.Collections.Generic; using System.Diagnostics; using System.Text.Json;

namespace monitoringagentmam {

    public class MAMError : Exception { public string Code { get; } public Dictionary<string, object> Details { get; }
        public MAMError(string msg, string code = "UNKNOWN", Dictionary<string, object>? d = null) : base(msg) { Code = code; Details = d ?? new(); }
    }

    public class ValidationError : MAMError { public ValidationError(string m) : base(m, "VALIDATION") { } }

    public class MAMTimeoutException : MAMError { public MAMTimeoutException(string m, int ms) : base(m, "TIMEOUT", new() { { "timeout_ms", ms } }) { } }

    public class ExecutionContext { public Dictionary<string, object> Inputs { get; set; } = new(); public Dictionary<string, string> Env { get; set; } = new(); public int TimeoutMs { get; set; } = 30000; private readonly Stopwatch _sw = new();
        public ExecutionContext() { _sw.Start(); } public double ElapsedMs => _sw.Elapsed.TotalMilliseconds;
        public void CheckTimeout() { if (TimeoutMs > 0 && ElapsedMs > TimeoutMs) throw new MAMTimeoutException("Timeout", TimeoutMs); }
    }

    public class ExecutionResult { public bool Success { get; set; } = true; public Dictionary<string, object> Output { get; set; } = new(); public List<string> Errors { get; set; } = new(); public List<string> Warnings { get; set; } = new(); public double TimeMs { get; set; } public Dictionary<string, object> Metadata { get; set; } = new(); }

    public enum ModuleStateType { Initialized, Running, Completed, Failed }

    public class MAMModule { public string Name { get; } public string Version { get; } = "1.0.0"; public ModuleStateType State { get; private set; } = ModuleStateType.Initialized;
        private readonly List<Action<ExecutionContext>> _before = new(); private readonly List<Action<ExecutionContext, ExecutionResult>> _after = new();
        public MAMModule(string? name = null) { Name = name ?? "monitoring-agent.mam"; }

        public ExecutionResult Execute(ExecutionContext ctx) { var r = new ExecutionResult(); State = ModuleStateType.Running; try { foreach (var h in _before) { h(ctx); ctx.CheckTimeout(); } r.Output = new(); ctx.CheckTimeout(); foreach (var h in _after) { h(ctx, r); ctx.CheckTimeout(); } } catch (Exception ex) { r.Success = false; r.Errors.Add(ex.Message); State = ModuleStateType.Failed; } r.TimeMs = ctx.ElapsedMs; State = r.Success ? ModuleStateType.Completed : ModuleStateType.Failed; return r; }
    }

    public static class Program { public static void Main() { var m = new MAMModule(); var c = new ExecutionContext(); var r = m.Execute(c); Console.WriteLine(JsonSerializer.Serialize(r, new JsonSerializerOptions { WriteIndented = true })); Environment.Exit(r.Success ? 0 : 1); } }
}
