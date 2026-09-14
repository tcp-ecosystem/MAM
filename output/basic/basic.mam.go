package basic_mam

import ("encoding/json"; "fmt"; "os"; "sync"; "time")

type MAMError struct { Message string; Code string; Details map[string]interface{} }
func (e *MAMError) Error() string { return fmt.Sprintf("[%s] %s", e.Code, e.Message) }
func NewMAMError(msg, code string, d map[string]interface{}) *MAMError { if d == nil { d = make(map[string]interface{}) }; return &MAMError{msg, code, d} }

type ValidationError struct{ *MAMError }

type TimeoutError struct{ *MAMError }

type ExecutionContext struct { Inputs map[string]interface{}; Env map[string]string; TimeoutMs int; mu sync.Mutex; start time.Time }
func NewExecutionContext(inputs map[string]interface{}, timeoutMs int) *ExecutionContext { if inputs == nil { inputs = make(map[string]interface{}) }; if timeoutMs <= 0 { timeoutMs = 30000 }; return &ExecutionContext{inputs, make(map[string]string), timeoutMs, sync.Mutex{}, time.Now()} }
func (ec *ExecutionContext) ElapsedMs() float64 { return float64(time.Since(ec.start).Microseconds()) / 1000.0 }
func (ec *ExecutionContext) CheckTimeout() error { if ec.TimeoutMs > 0 && ec.ElapsedMs() > float64(ec.TimeoutMs) { return NewMAMError(fmt.Sprintf("Timeout after %dms", ec.TimeoutMs), "TIMEOUT", nil) }; return nil }

type ExecutionResult struct { Success bool `json:"success"`; Output map[string]interface{} `json:"output"`; Errors []string `json:"errors"`; Warnings []string `json:"warnings"`; TimeMs float64 `json:"time_ms"`; Metadata map[string]interface{} `json:"metadata"` }
func NewExecutionResult() *ExecutionResult { return &ExecutionResult{true, make(map[string]interface{}), []string{}, []string{}, 0, make(map[string]interface{})} }

type MAMModule struct { Name string; Version string; State string; hooksBefore []func(ctx *ExecutionContext); hooksAfter []func(ctx *ExecutionContext, r *ExecutionResult); mu sync.RWMutex }
func NewMAMModule(name string) *MAMModule { if name == "" { name = "${basename(ctx.filePath, extname(ctx.filePath))}" }; return &MAMModule{name, "1.0.0", "initialized", nil, nil, sync.RWMutex{}} }
func (m *MAMModule) Execute(ctx *ExecutionContext) *ExecutionResult {
    m.mu.Lock(); m.State = "running"; m.mu.Unlock()
    result := NewExecutionResult()
    if err := ctx.CheckTimeout(); err != nil { result.Success = false; result.Errors = append(result.Errors, err.Error()); m.State = "failed"; return result }
    for _, h := range m.hooksBefore { h(ctx); if err := ctx.CheckTimeout(); err != nil { result.Success = false; result.Errors = append(result.Errors, err.Error()); m.State = "failed"; return result } }
    // Core logic placeholder
    result.Output = make(map[string]interface{})
    for _, h := range m.hooksAfter { h(ctx, result); if err := ctx.CheckTimeout(); err != nil { result.Success = false; result.Errors = append(result.Errors, err.Error()); m.State = "failed"; return result } }
    result.TimeMs = ctx.ElapsedMs(); m.State = "completed"; if !result.Success { m.State = "failed" }
    return result
}

func main() { mod := NewMAMModule(""); ctx := NewExecutionContext(nil, 30000); result := mod.Execute(ctx); b, _ := json.MarshalIndent(result, "", "  "); fmt.Println(string(b)); if !result.Success { os.Exit(1) } }
