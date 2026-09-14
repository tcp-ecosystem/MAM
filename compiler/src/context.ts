/**
 * MAM Module Context Generator
 *
 * Generates formatted context blocks for compiled module outputs.
 * Embeds full MAM module metadata so any reader understands the complete system.
 */

import { V2ModuleNode } from '@mam/ast';

// ============================================================================
// Comment Syntax Map
// ============================================================================

interface CommentStyle {
  line: string;
  blockOpen?: string;
  blockClose?: string;
  indent: string;
}

const COMMENT_STYLES: Record<string, CommentStyle> = {
  python:     { line: '#', indent: '# ' },
  javascript: { line: '//', indent: '// ' },
  typescript: { line: '//', indent: '// ' },
  go:         { line: '//', indent: '// ' },
  rust:       { line: '//', indent: '// ' },
  csharp:     { line: '///', indent: '/// ' },
  java:       { line: '//', indent: '// ' },
  openai:     { line: '#', indent: '# ' },
  langgraph:  { line: '#', indent: '# ' },
  crewai:     { line: '#', indent: '# ' },
  gemini:     { line: '#', indent: '# ' },
  autogen:    { line: '#', indent: '# ' },
  claude:     { line: '//', indent: '// ' },
  kubernetes: { line: '#', indent: '# ' },
  terraform:  { line: '#', indent: '# ' },
  docker:     { line: '#', indent: '# ' },
  wasm:       { line: ';;', indent: ';; ' },
};

const PYTHON_DOCSTRING_STYLES = new Set(['python', 'openai', 'langgraph', 'crewai', 'gemini', 'autogen']);
const JSDOC_STYLES = new Set(['javascript', 'typescript']);
const RUST_DOC_STYLES = new Set(['rust']);
const CSHARP_DOC_STYLES = new Set(['csharp']);

// ============================================================================
// Context Builder
// ============================================================================

function na(val: unknown): string {
  if (val === undefined || val === null || val === '') return 'N/A';
  return String(val);
}

function listItems(items: string[] | undefined): string[] {
  if (!items || items.length === 0) return ['  N/A'];
  return items.map(item => `  - ${item}`);
}

function buildContextLines(mod: V2ModuleNode): string[] {
  const lines: string[] = [];
  const meta = mod.metadata as Record<string, unknown> | undefined;

  lines.push('MAM Module Context');
  lines.push('==================');
  lines.push(`Name: ${na(mod.name)}`);
  lines.push(`Type: ${na(mod.moduleType)}`);
  lines.push(`Version: ${na(meta?.version) || '1.0.0'}`);
  lines.push(`Author: ${na(meta?.author) || 'MAM User'}`);
  lines.push(`Description: ${na(mod.description)}`);
  lines.push('');

  lines.push(`Purpose: ${na(mod.description || mod.documentation)}`);
  lines.push('');

  // Inputs
  lines.push('Inputs:');
  if (mod.inputs && mod.inputs.length > 0) {
    for (const inp of mod.inputs) {
      lines.push(`  - ${inp.name}: ${inp.type} (required: ${inp.required})${inp.description ? ' — ' + inp.description : ''}`);
    }
  } else {
    lines.push('  N/A');
  }
  lines.push('');

  // Outputs
  lines.push('Outputs:');
  if (mod.outputs && mod.outputs.length > 0) {
    for (const out of mod.outputs) {
      lines.push(`  - ${out.name}: ${out.type}${out.description ? ' — ' + out.description : ''}`);
    }
  } else {
    lines.push('  N/A');
  }
  lines.push('');

  // Capabilities
  lines.push('Capabilities:');
  lines.push(...listItems(mod.capabilities));
  lines.push('');

  // Rules
  lines.push('Rules:');
  lines.push(...listItems(mod.rules));
  lines.push('');

  // Workflow
  if (mod.steps && mod.steps.length > 0) {
    lines.push('Workflow:');
    for (const step of mod.steps) {
      const edge = mod.edges?.find(e => e.source === step.name);
      const target = edge ? ` → ${edge.target}` : '';
      lines.push(`  - ${step.name}${target}`);
    }
    lines.push('');
  }

  // Dependencies
  lines.push('Dependencies:');
  lines.push(...listItems(mod.requires));
  lines.push('');

  // Permissions
  lines.push('Permissions:');
  if (mod.permissions) {
    lines.push(`  Network: ${na(mod.permissions.network)}`);
    lines.push(`  Filesystem: ${na(mod.permissions.filesystem)}`);
    if (mod.permissions.python) lines.push(`  Python: ${na(mod.permissions.python)}`);
    if (mod.permissions.memory) lines.push(`  Memory: ${na(mod.permissions.memory)}`);
    if (mod.permissions.exec) lines.push(`  Exec: ${na(mod.permissions.exec)}`);
  } else {
    lines.push('  Network: N/A');
    lines.push('  Filesystem: N/A');
  }
  lines.push('');

  // Tests
  lines.push(`Tests: ${na(mod.tests) || 'See source module'}`);
  lines.push('');

  // Examples
  lines.push(`Examples: ${na(mod.examples) || 'See source module'}`);
  lines.push('');

  // References
  lines.push('References: See https://github.com/tcp-ecosystems/MAM');

  return lines;
}

// ============================================================================
// Formatters
// ============================================================================

function formatAsLineComments(contextLines: string[], style: CommentStyle): string {
  return contextLines.map(line => {
    if (line === '') return style.line;
    return `${style.indent}${line}`;
  }).join('\n');
}

function formatAsPythonDocstring(contextLines: string[]): string {
  const body = contextLines.map(line => {
    if (line === '') return '';
    return `    ${line}`;
  }).join('\n');
  return `"""\n${body}\n"""`;
}

function formatAsJSDoc(contextLines: string[]): string {
  const body = contextLines.map(line => {
    if (line === '') return ' *';
    return ` * ${line}`;
  }).join('\n');
  return `/**\n${body}\n */`;
}

function formatAsRustDoc(contextLines: string[]): string {
  return contextLines.map(line => {
    if (line === '') return '//!';
    return `//! ${line}`;
  }).join('\n');
}

function formatAsCSharpDoc(contextLines: string[]): string {
  return contextLines.map(line => {
    if (line === '') return '///';
    return `/// ${line}`;
  }).join('\n');
}

function formatAsJSON(mod: V2ModuleNode): string {
  const meta = mod.metadata as Record<string, unknown> | undefined;
  const context: Record<string, unknown> = {
    _generator: 'MAM Compiler',
    _moduleContext: {
      name: mod.name,
      type: mod.moduleType,
      version: meta?.version || '1.0.0',
      author: meta?.author || 'MAM User',
      description: mod.description || 'N/A',
      purpose: mod.description || mod.documentation || 'N/A',
      inputs: mod.inputs?.map(i => ({ name: i.name, type: i.type, required: i.required })) || [],
      outputs: mod.outputs?.map(o => ({ name: o.name, type: o.type })) || [],
      capabilities: mod.capabilities || [],
      rules: mod.rules || [],
      workflow: mod.steps?.map(s => s.name) || [],
      dependencies: mod.requires || [],
      permissions: mod.permissions || { network: 'N/A', filesystem: 'N/A' },
      tests: mod.tests || 'See source module',
      examples: mod.examples || 'See source module',
      references: 'See https://github.com/tcp-ecosystems/MAM',
    },
  };
  return JSON.stringify(context, null, 2);
}

// ============================================================================
// Public API
// ============================================================================

export type CompileTargetName =
  | 'python' | 'javascript' | 'typescript' | 'go' | 'rust'
  | 'csharp' | 'java' | 'openai' | 'langgraph' | 'crewai'
  | 'gemini' | 'autogen' | 'claude' | 'kubernetes' | 'terraform'
  | 'docker' | 'wasm' | 'json';

/**
 * Generate a formatted context block for a MAM module.
 * Returns the context string ready to be embedded in the compiled output.
 */
export function generateModuleContext(mod: V2ModuleNode, target: CompileTargetName): string {
  const contextLines = buildContextLines(mod);

  // JSON gets special treatment
  if (target === 'json') {
    return formatAsJSON(mod);
  }

  // Python-style docstrings
  if (PYTHON_DOCSTRING_STYLES.has(target)) {
    return formatAsPythonDocstring(contextLines);
  }

  // JSDoc
  if (JSDOC_STYLES.has(target)) {
    return formatAsJSDoc(contextLines);
  }

  // Rust doc comments
  if (RUST_DOC_STYLES.has(target)) {
    return formatAsRustDoc(contextLines);
  }

  // C# XML doc
  if (CSHARP_DOC_STYLES.has(target)) {
    return formatAsCSharpDoc(contextLines);
  }

  // Everything else uses line comments
  const style = COMMENT_STYLES[target] || { line: '//', indent: '// ' };
  return formatAsLineComments(contextLines, style);
}
