/**
 * End-to-End Compilation Pipeline Test
 *
 * Tests: .mam.md → Parse → AST → [GAP: no transformer] → Compile → Target Output
 *
 * FINDING: The parser outputs MAMModule (sections) but the compiler expects V2ModuleNode[].
 * There is NO automatic transformer between them. This is a critical gap for beta.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseMAM } from '../../parser/dist/index.js';
import { MAMCompiler, type CompilerConfig } from '../../compiler/dist/compiler.js';
import { PythonTarget } from '../../compiler/dist/targets/python.js';
import { JavaScriptTarget } from '../../compiler/dist/targets/javascript.js';
import { GoTarget } from '../../compiler/dist/targets/go.js';
import { RustTarget } from '../../compiler/dist/targets/rust.js';
import { OpenAITarget } from '../../compiler/dist/targets/openai.js';
import { LangGraphTarget } from '../../compiler/dist/targets/langgraph.js';
import { CrewAITarget } from '../../compiler/dist/targets/crewai.js';
import { KubernetesTarget } from '../../compiler/dist/targets/kubernetes.js';
import { DockerTarget } from '../../compiler/dist/targets/docker.js';
import { WasmTarget } from '../../compiler/dist/targets/wasm.js';
import { ClaudeTarget } from '../../compiler/dist/targets/claude.js';
import { GeminiTarget } from '../../compiler/dist/targets/gemini.js';
import { AutoGenTarget } from '../../compiler/dist/targets/autogen.js';
import { CSharpTarget } from '../../compiler/dist/targets/csharp.js';
import { JavaTarget } from '../../compiler/dist/targets/java.js';
import { TerraformTarget } from '../../compiler/dist/targets/terraform.js';
import { type V2ModuleNode } from '../../ast/dist/index.js';

// ============================================================================
// Helpers
// ============================================================================

function loadFixture(name: string): string {
  const fixturesDir = join(import.meta.dirname, '../../parser/tests/fixtures/valid');
  return readFileSync(join(fixturesDir, name), 'utf-8');
}

const loc = { start: { line: 1, column: 0 }, end: { line: 5, column: 0 }, source: 'test' };

function makeModule(overrides: Partial<V2ModuleNode> & { name: string }): V2ModuleNode {
  return {
    type: 'ModuleNode',
    moduleType: 'agent',
    name: 'test-module',
    role: 'Test agent',
    goal: 'Test goal',
    location: loc,
    ...overrides,
  };
}

function createCompiler(): MAMCompiler {
  const compiler = new MAMCompiler();
  compiler.registerTarget('python', new PythonTarget());
  compiler.registerTarget('javascript', new JavaScriptTarget());
  compiler.registerTarget('go', new GoTarget());
  compiler.registerTarget('rust', new RustTarget());
  compiler.registerTarget('openai', new OpenAITarget());
  compiler.registerTarget('langgraph', new LangGraphTarget());
  compiler.registerTarget('crewai', new CrewAITarget());
  compiler.registerTarget('kubernetes', new KubernetesTarget());
  compiler.registerTarget('docker', new DockerTarget());
  compiler.registerTarget('wasm', new WasmTarget());
  compiler.registerTarget('claude', new ClaudeTarget());
  compiler.registerTarget('gemini', new GeminiTarget());
  compiler.registerTarget('autogen', new AutoGenTarget());
  compiler.registerTarget('csharp', new CSharpTarget());
  compiler.registerTarget('java', new JavaTarget());
  compiler.registerTarget('terraform', new TerraformTarget());
  return compiler;
}

// ============================================================================
// Parser Tests - Can we parse .mam.md files?
// ============================================================================

describe('Parser: .mam.md Parsing', () => {
  it('parses minimal.mam.md', () => {
    const input = loadFixture('minimal.mam.md');
    const result = parseMAM(input, { source: 'minimal.mam.md' });

    expect(result.errors).toHaveLength(0);
    expect(result.ast).toBeDefined();
    expect(result.ast.frontmatter).toBeDefined();
    expect(result.ast.frontmatter?.data?.id).toBe('minimal');
    expect(result.ast.frontmatter?.data?.name).toBe('Minimal Module');
    expect(result.ast.sections.length).toBeGreaterThan(0);
  });

  it('parses basic.mam.md', () => {
    const input = loadFixture('basic.mam.md');
    const result = parseMAM(input, { source: 'basic.mam.md' });

    expect(result.errors).toHaveLength(0);
    expect(result.ast.frontmatter?.data?.id).toBe('basic-module');
    expect(result.ast.sections.length).toBe(2);
  });

  it('parses full.mam.md', () => {
    const input = loadFixture('full.mam.md');
    const result = parseMAM(input, { source: 'full.mam.md' });

    expect(result.errors).toHaveLength(0);
    expect(result.ast.frontmatter).toBeDefined();
    expect(result.ast.sections.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Compiler Tests - Can we compile V2ModuleNode to all targets?
// ============================================================================

describe('Compiler: All Targets', () => {
  const agentModule = makeModule({
    name: 'researcher',
    moduleType: 'agent',
    role: 'Researcher',
    goal: 'Research topics',
    tools: ['web-search'],
    handoff: ['writer'],
  });

  const toolModule = makeModule({
    name: 'web-search',
    moduleType: 'tool',
    provider: 'google',
    capabilities: ['search'],
  });

  const workflowModule = makeModule({
    name: 'pipeline',
    moduleType: 'workflow',
    steps: [
      { type: 'StepNode', name: 'step-1', location: loc },
      { type: 'StepNode', name: 'step-2', location: loc },
    ],
    edges: [
      { type: 'EdgeNode', source: 'step-1', target: 'step-2', location: loc },
    ],
  });

  const targets: CompilerConfig['target'][] = [
    'python', 'javascript', 'go', 'rust',
    'openai', 'langgraph', 'crewai', 'claude', 'gemini', 'autogen',
    'kubernetes', 'docker', 'wasm', 'csharp', 'java', 'terraform',
  ];

  for (const target of targets) {
    it(`compiles agent to ${target}`, () => {
      const compiler = createCompiler();
      const result = compiler.compile([agentModule], { target, includeComments: true });
      expect(result.success).toBe(true);
      expect(result.output).toBeTruthy();
      expect(result.stats.linesGenerated).toBeGreaterThan(0);
    });
  }

  for (const target of targets) {
    it(`compiles tool to ${target}`, () => {
      const compiler = createCompiler();
      const result = compiler.compile([toolModule], { target, includeComments: true });
      expect(result.success).toBe(true);
      expect(result.output).toBeTruthy();
    });
  }

  for (const target of targets) {
    it(`compiles workflow to ${target}`, () => {
      const compiler = createCompiler();
      const result = compiler.compile([workflowModule], { target, includeComments: true });
      expect(result.success).toBe(true);
      expect(result.output).toBeTruthy();
    });
  }
});

// ============================================================================
// Compiler: Output Quality Checks
// ============================================================================

describe('Compiler: Output Quality', () => {
  const agentModule = makeModule({
    name: 'researcher',
    moduleType: 'agent',
    role: 'Researcher',
    goal: 'Research topics',
  });

  it('Python output contains class and execute method', () => {
    const compiler = createCompiler();
    const result = compiler.compile([agentModule], { target: 'python', includeComments: true });
    expect(result.output).toContain('class');
    expect(result.output).toContain('def execute');
    expect(result.output).toContain('Researcher');
  });

  it('JavaScript output contains class and execute method', () => {
    const compiler = createCompiler();
    const result = compiler.compile([agentModule], { target: 'javascript', includeComments: true });
    expect(result.output).toContain('class');
    expect(result.output).toContain('execute');
  });

  it('Go output contains struct and Execute function', () => {
    const compiler = createCompiler();
    const result = compiler.compile([agentModule], { target: 'go', includeComments: true });
    expect(result.output).toContain('struct');
    expect(result.output).toContain('Execute');
  });

  it('Rust output contains struct and execute function', () => {
    const compiler = createCompiler();
    const result = compiler.compile([agentModule], { target: 'rust', includeComments: true });
    expect(result.output).toContain('struct');
    expect(result.output).toContain('fn execute');
  });

  it('Kubernetes output contains Deployment manifest', () => {
    const compiler = createCompiler();
    const result = compiler.compile([agentModule], { target: 'kubernetes', includeComments: true });
    expect(result.output).toContain('apiVersion: apps/v1');
    expect(result.output).toContain('kind: Deployment');
    expect(result.output).toContain('mam-type: agent');
  });

  it('Docker output contains Dockerfile instructions', () => {
    const compiler = createCompiler();
    const result = compiler.compile([agentModule], { target: 'docker', includeComments: true });
    expect(result.output).toContain('FROM');
  });

  it('Wasm output contains WAT module', () => {
    const compiler = createCompiler();
    const result = compiler.compile([agentModule], { target: 'wasm', includeComments: true });
    expect(result.output).toContain('(module');
    expect(result.output).toContain('(memory');
  });
});

// ============================================================================
// GAP DOCUMENTATION: Parser → Compiler Missing Transformer
// ============================================================================

describe('GAP: Parser → Compiler Transformer', () => {
  it('documents that parser output cannot be fed directly to compiler', () => {
    // Parser output structure:
    const input = loadFixture('minimal.mam.md');
    const parseResult = parseMAM(input, { source: 'minimal.mam.md' });

    // Parser returns MAMModule with sections
    expect(parseResult.ast).toBeDefined();
    expect(parseResult.ast.sections).toBeDefined();
    expect(parseResult.ast.frontmatter).toBeDefined();

    // Compiler expects V2ModuleNode[]
    // There is NO function to convert parseResult.ast → V2ModuleNode[]
    // This is a CRITICAL GAP for the beta release

    // The parser AST structure:
    // { type: 'MAMModule', frontmatter: { data: {...} }, sections: [...] }
    //
    // The compiler expects:
    // V2ModuleNode[] = [{ type: 'ModuleNode', moduleType: 'agent', name: '...', ... }]
    //
    // A transformer function is needed:
    // function mamModuleToV2ModuleNode(ast: MAMModule): V2ModuleNode[]
  });
});
