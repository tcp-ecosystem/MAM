import java.util.*; import java.time.Instant; import java.time.Duration;

public class texttransformmam {

    public static class MAMException extends Exception { public final String code; public final Map<String, Object> details;
        public MAMException(String m, String c, Map<String, Object> d) { super(m); code = c; details = d != null ? d : Map.of(); }
    }

    public static class ValidationError extends MAMException { public ValidationError(String m) { super(m, "VALIDATION", Map.of()); } }

    public static class TimeoutException extends MAMException { public TimeoutException(String m, int ms) { super(m, "TIMEOUT", Map.of("timeout_ms", ms)); } }

    public static class ExecutionContext { public Map<String, Object> inputs = new HashMap<>(); public Map<String, String> env = new HashMap<>(); public int timeoutMs = 30000; private final Instant start = Instant.now();
        public double elapsedMs() { return Duration.between(start, Instant.now()).toNanos() / 1_000_000.0; }
        public void checkTimeout() throws TimeoutException { if (timeoutMs > 0 && elapsedMs() > timeoutMs) throw new TimeoutException("Timeout", timeoutMs); }
    }

    public static class ExecutionResult { public boolean success = true; public Map<String, Object> output = new HashMap<>(); public List<String> errors = new ArrayList<>(); public List<String> warnings = new ArrayList<>(); public double timeMs; public Map<String, Object> metadata = new HashMap<>(); }

    public enum ModuleState { INITIALIZED, RUNNING, COMPLETED, FAILED }

    public static class MAMModule { public String name; public String version = "1.0.0"; public ModuleState state = ModuleState.INITIALIZED;
        private final List<Runnable> hooksBefore = new ArrayList<>(); private final List<BiConsumer<ExecutionContext, ExecutionResult>> hooksAfter = new ArrayList<>();
        public MAMModule() { this.name = "texttransformmam"; }

        public ExecutionResult execute(ExecutionContext ctx) { var r = new ExecutionResult(); state = ModuleState.RUNNING; try { for (var h : hooksBefore) { h.run(); ctx.checkTimeout(); } r.output = new HashMap<>(); ctx.checkTimeout(); for (var h : hooksAfter) { h.accept(ctx, r); ctx.checkTimeout(); } } catch (Exception e) { r.success = false; r.errors.add(e.getMessage()); state = ModuleState.FAILED; } r.timeMs = ctx.elapsedMs(); state = r.success ? ModuleState.COMPLETED : ModuleState.FAILED; return r; }
    }

    public static void main(String[] args) { var m = new MAMModule(); var c = new ExecutionContext(); var r = m.execute(c); System.out.println("success=" + r.success + " time=" + r.timeMs + "ms"); System.exit(r.success ? 0 : 1); }
}
