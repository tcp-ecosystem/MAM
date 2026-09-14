use std::collections::HashMap; use std::fmt; use std::time::{Duration, Instant};

#[derive(Debug, Clone)] pub struct MAMError { pub message: String, pub code: String, pub details: HashMap<String, String> }
impl fmt::Display for MAMError { fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result { write!(f, "[{}] {}", self.code, self.message) } }
impl std::error::Error for MAMError {}

impl MAMError { pub fn new(message: &str, code: &str) -> Self { Self { message: message.into(), code: code.into(), details: HashMap::new() } } }

#[derive(Debug)] pub struct ValidationError(pub MAMError);
#[derive(Debug)] pub struct TimeoutError(pub MAMError);

#[derive(Debug, Clone, Default)] pub struct ExecutionContext { pub inputs: HashMap<String, String>, pub env: HashMap<String, String>, pub timeout_ms: u64, pub start: Instant }
impl ExecutionContext { pub fn new(timeout_ms: u64) -> Self { Self { inputs: HashMap::new(), env: HashMap::new(), timeout_ms, start: Instant::now() } }
    pub fn elapsed_ms(&self) -> f64 { self.start.elapsed().as_secs_f64() * 1000.0 }
    pub fn check_timeout(&self) -> Result<(), TimeoutError> { if self.timeout_ms > 0 && self.elapsed_ms() > self.timeout_ms as f64 { Err(TimeoutError(MAMError::new("Timeout", "TIMEOUT"))) } else { Ok(()) } }
}

#[derive(Debug, Clone, Default)] pub struct ExecutionResult { pub success: bool, pub output: HashMap<String, String>, pub errors: Vec<String>, pub warnings: Vec<String>, pub time_ms: f64 }

#[derive(Debug, Clone, PartialEq)] pub enum ModuleState { Initialized, Running, Completed, Failed }

pub struct MAMModule { pub name: String, pub version: String, pub state: ModuleState, pub hooks_before: Vec<Box<dyn Fn(&mut ExecutionContext)>>, pub hooks_after: Vec<Box<dyn Fn(&mut ExecutionContext, &mut ExecutionResult)>> }
impl MAMModule { pub fn new(name: &str) -> Self { Self { name: name.into(), version: "1.0.0".into(), state: ModuleState::Initialized, hooks_before: vec![], hooks_after: vec![] } }
    pub fn execute(&mut self, ctx: &mut ExecutionContext) -> ExecutionResult { let mut r = ExecutionResult::default(); self.state = ModuleState::Running; if let Err(e) = ctx.check_timeout() { r.success = false; r.errors.push(e.0.to_string()); self.state = ModuleState::Failed; return r; }
        for h in &self.hooks_before { h(ctx); if let Err(e) = ctx.check_timeout() { r.success = false; r.errors.push(e.0.to_string()); self.state = ModuleState::Failed; return r; } }
        // Core logic placeholder; r.output = HashMap::new();
        for h in &self.hooks_after { h(ctx, &mut r); if let Err(e) = ctx.check_timeout() { r.success = false; r.errors.push(e.0.to_string()); self.state = ModuleState::Failed; return r; } }
        r.time_ms = ctx.elapsed_ms(); self.state = if r.success { ModuleState::Completed } else { ModuleState::Failed }; r
    }
}

fn main() { let mut modl = MAMModule::new(""); let mut ctx = ExecutionContext::new(30000); let r = modl.execute(&mut ctx); println!("{:?}", r); std::process::exit(if r.success { 0 } else { 1 }); }
