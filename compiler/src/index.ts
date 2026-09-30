/**
 * MAM Compiler
 * 
 * Transpiles MAM AST to target languages.
 * MAM never executes. MAM compiles.
 */

export { MAMCompiler, type CompilerConfig, type CompileResult, type CompileTarget, type CompileTargetHandler, type TokenOptimization, type TargetHandlerOutput } from './compiler.js';
export { generateModuleContext, type CompileTargetName } from './context.js';
export { PythonTarget } from './targets/python.js';
export { JavaScriptTarget } from './targets/javascript.js';
export { GoTarget } from './targets/go.js';
export { OpenAITarget } from './targets/openai.js';
export { LangGraphTarget } from './targets/langgraph.js';
export { CrewAITarget } from './targets/crewai.js';
export { CSharpTarget } from './targets/csharp.js';
export { JavaTarget } from './targets/java.js';
export { WasmTarget } from './targets/wasm.js';
export { GeminiTarget } from './targets/gemini.js';
export { AutoGenTarget } from './targets/autogen.js';
export { KubernetesTarget } from './targets/kubernetes.js';
export { TerraformTarget } from './targets/terraform.js';
export { SemanticAnalyzer, analyzeSemantics, type SemanticResult, type SemanticError, type SemanticWarning, type AnalyzerConfig } from './analyzer/index.js';
export { MAMTransformer, transformToV2 } from './transformer.js';
export { CodeWriter, emitHeader, indent, joinLines, sanitizeIdentifier, type CodeWriterOptions } from './emit.js';
export { defaultCompilerConfig, normalizeCompilerConfig, resolveTarget, validateCompilerConfig, TARGET_ALIASES } from './options.js';
export { CompileErrorCode, CompileError, CompileIssueCollector, formatCompileError, type CompileWarning, type CompileIssue, type CompileLocation, type CompileErrorOptions } from './errors.js';