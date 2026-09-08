/**
 * End-to-End Compilation Pipeline Test
 *
 * Tests the FULL pipeline: .mam.md → Parse → Transform → Compile → Target Output
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseMAM } from '../../parser/dist/index.js';
import { MAMCompiler, transformToV2, type CompilerConfig } from '../../compiler/dist/index.js';
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

// ============================================================================
// Helpers
// ============================================================================

function loadFixture(name: string): string {
  const fixturesDir = join(import.meta.dirname, '../../parser/tests/fixtures/valid');
  return readFileSync(join(fixturesDir, name), 'utf-8');
}

function loadExample(name: string): string {
  const examplesDir = join(import.meta.dirname, '../../modules/examples');
  return readFileSync(join(examplesDir, name), 'utf-8');
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

function fullPipeline(input: string, target: CompilerConfig['target'], source: string) {
  const parseResult = parseMAM(input, { source });
  expect(parseResult.errors).toHaveLength(0);

  const modules = transformToV2(parseResult.ast);
  expect(modules.length).toBeGreaterThan(0);

  const compiler = createCompiler();
  const result = compiler.compile(modules, { target, includeComments: true });
  return result;
}

// ============================================================================
// Parser Tests
// ============================================================================

describe('Parser: .mam.md Parsing', () => {
  it('parses minimal.mam.md', () => {
    const input = loadFixture('minimal.mam.md');
    const result = parseMAM(input, { source: 'minimal.mam.md' });

    expect(result.errors).toHaveLength(0);
    expect(result.ast.frontmatter?.data?.id).toBe('minimal');
    expect(result.ast.frontmatter?.data?.name).toBe('Minimal Module');
  });

  it('parses basic.mam.md', () => {
    const input = loadFixture('basic.mam.md');
    const result = parseMAM(input, { source: 'basic.mam.md' });

    expect(result.errors).toHaveLength(0);
    expect(result.ast.frontmatter?.data?.id).toBe('basic-module');
  });

  it('parses full.mam.md', () => {
    const input = loadFixture('full.mam.md');
    const result = parseMAM(input, { source: 'full.mam.md' });

    expect(result.errors).toHaveLength(0);
    expect(result.ast.frontmatter).toBeDefined();
  });
});

// ============================================================================
// Transformer Tests
// ============================================================================

describe('Transformer: MAMModule → V2ModuleNode', () => {
  it('transforms minimal.mam.md to V2ModuleNode', () => {
    const input = loadFixture('minimal.mam.md');
    const parseResult = parseMAM(input, { source: 'minimal.mam.md' });
    const modules = transformToV2(parseResult.ast);

    expect(modules).toHaveLength(1);
    expect(modules[0].type).toBe('ModuleNode');
    expect(modules[0].name).toBe('Minimal Module');
    expect(modules[0].moduleType).toBe('module');
  });

  it('transforms basic.mam.md to V2ModuleNode', () => {
    const input = loadFixture('basic.mam.md');
    const parseResult = parseMAM(input, { source: 'basic.mam.md' });
    const modules = transformToV2(parseResult.ast);

    expect(modules).toHaveLength(1);
    expect(modules[0].name).toBe('Basic Module');
  });

  it('infers agent type from role/goal sections', () => {
    const input = `---
id: test-agent
name: Test Agent
version: 1.0.0
author: Test
runtime: python
---

## Purpose

A test agent.

## Role

Research assistant

## Goal

Find information about topics
`;
    const parseResult = parseMAM(input, { source: 'test.mam.md' });
    const modules = transformToV2(parseResult.ast);

    expect(modules).toHaveLength(1);
    expect(modules[0].moduleType).toBe('agent');
  });

  it('infers tool type from provider field', () => {
    const input = `---
id: web-search
name: Web Search
version: 1.0.0
author: Test
runtime: python
provider: google
---

## Purpose

Search the web.
`;
    const parseResult = parseMAM(input, { source: 'test.mam.md' });
    const modules = transformToV2(parseResult.ast);

    expect(modules).toHaveLength(1);
    expect(modules[0].moduleType).toBe('tool');
  });

  it('extracts inputs from table', () => {
    const input = `---
id: test-module
name: Test Module
version: 1.0.0
author: Test
runtime: python
---

## Purpose

Test.

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| query | string | Yes | Search query |
| limit | int | No | Max results |
`;
    const parseResult = parseMAM(input, { source: 'test.mam.md' });
    const modules = transformToV2(parseResult.ast);

    expect(modules[0].inputs).toBeDefined();
    expect(modules[0].inputs).toHaveLength(2);
    expect(modules[0].inputs![0].name).toBe('query');
    expect(modules[0].inputs![0].type).toBe('string');
    expect(modules[0].inputs![0].required).toBe(true);
  });

  it('extracts rules from list', () => {
    const input = `---
id: policy-module
name: Policy Module
version: 1.0.0
author: Test
runtime: python
---

## Purpose

Test policy.

## Rules

- Never expose secrets
- Validate all inputs
- Log all operations
`;
    const parseResult = parseMAM(input, { source: 'test.mam.md' });
    const modules = transformToV2(parseResult.ast);

    expect(modules[0].documentation).toBeDefined();
    expect(modules[0].documentation).toContain('secrets');
    expect(modules[0].documentation).toContain('Validate all inputs');
  });

  it('extracts dependencies', () => {
    const input = `---
id: test-deps
name: Test Module
version: 1.0.0
author: Test
runtime: python
---

## Purpose

Test.

## Dependencies

- lodash
- express
`;
    const parseResult = parseMAM(input, { source: 'test.mam.md' });
    const modules = transformToV2(parseResult.ast);

    expect(modules[0].requires).toBeDefined();
    expect(modules[0].requires).toHaveLength(2);
    expect(modules[0].requires).toContain('lodash');
  });
});

// ============================================================================
// Full Pipeline: .mam.md → Parse → Transform → Compile
// ============================================================================

describe('Full Pipeline: .mam.md → Parse → Transform → Compile', () => {
  const targets: CompilerConfig['target'][] = [
    'python', 'javascript', 'go', 'rust',
    'openai', 'langgraph', 'crewai', 'claude', 'gemini', 'autogen',
    'kubernetes', 'docker', 'wasm', 'csharp', 'java', 'terraform',
  ];

  for (const target of targets) {
    it(`minimal.mam.md → ${target}`, () => {
      const input = loadFixture('minimal.mam.md');
      const result = fullPipeline(input, target, 'minimal.mam.md');

      expect(result.success).toBe(true);
      expect(result.output).toBeTruthy();
      expect(result.stats.linesGenerated).toBeGreaterThan(0);
    });
  }

  for (const target of targets) {
    it(`basic.mam.md → ${target}`, () => {
      const input = loadFixture('basic.mam.md');
      const result = fullPipeline(input, target, 'basic.mam.md');

      expect(result.success).toBe(true);
      expect(result.output).toBeTruthy();
    });
  }

  for (const target of targets) {
    it(`full.mam.md → ${target}`, () => {
      const input = loadFixture('full.mam.md');
      const result = fullPipeline(input, target, 'full.mam.md');

      expect(result.success).toBe(true);
      expect(result.output).toBeTruthy();
    });
  }
});

// ============================================================================
// Output Quality
// ============================================================================

describe('Output Quality: Compiled Code', () => {
  it('Python output has class and init method', () => {
    const input = loadFixture('minimal.mam.md');
    const result = fullPipeline(input, 'python', 'minimal.mam.md');

    expect(result.output).toContain('class');
    expect(result.output).toContain('def __init__');
  });

  it('JavaScript output has class and constructor', () => {
    const input = loadFixture('minimal.mam.md');
    const result = fullPipeline(input, 'javascript', 'minimal.mam.md');

    expect(result.output).toContain('class');
    expect(result.output).toContain('constructor');
  });

  it('Go output has struct and Execute', () => {
    const input = loadFixture('minimal.mam.md');
    const result = fullPipeline(input, 'go', 'minimal.mam.md');

    expect(result.output).toContain('struct');
    expect(result.output).toContain('Execute');
  });

  it('Rust output has struct and fn execute', () => {
    const input = loadFixture('minimal.mam.md');
    const result = fullPipeline(input, 'rust', 'minimal.mam.md');

    expect(result.output).toContain('struct');
    expect(result.output).toContain('fn execute');
  });

  it('Kubernetes output has Deployment manifest', () => {
    const input = loadFixture('minimal.mam.md');
    const result = fullPipeline(input, 'kubernetes', 'minimal.mam.md');

    expect(result.output).toContain('apiVersion: apps/v1');
    expect(result.output).toContain('kind: Deployment');
  });

  it('Docker output has FROM instruction', () => {
    const input = loadFixture('minimal.mam.md');
    const result = fullPipeline(input, 'docker', 'minimal.mam.md');

    expect(result.output).toContain('FROM');
  });

  it('Wasm output has (module', () => {
    const input = loadFixture('minimal.mam.md');
    const result = fullPipeline(input, 'wasm', 'minimal.mam.md');

    expect(result.output).toContain('(module');
  });
});
