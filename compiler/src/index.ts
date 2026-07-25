/**
 * MAM Compiler
 * 
 * Transpiles MAM AST to target languages.
 * MAM never executes. MAM compiles.
 */

export { MAMCompiler, type CompilerConfig, type CompileResult, type CompileTarget } from './compiler.js';
export { PythonTarget } from './targets/python.js';
export { JavaScriptTarget } from './targets/javascript.js';
export { GoTarget } from './targets/go.js';
export { OpenAITarget } from './targets/openai.js';
export { LangGraphTarget } from './targets/langgraph.js';
export { CrewAITarget } from './targets/crewai.js';
export { SemanticAnalyzer, analyzeSemantics, type SemanticResult, type SemanticError, type SemanticWarning, type AnalyzerConfig } from './analyzer/index.js';