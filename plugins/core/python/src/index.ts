/**
 * MAM Python Plugin
 * 
 * Provides Python code execution context for MAM modules.
 */

import { MAMPlugin, PluginManifest, SectionDefinition, ValidationRule, RuntimeContext, ExecutionContext, ExecutionResult } from '@mam/plugin-api';
import { spawn } from 'node:child_process';
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

const manifest: PluginManifest = {
  name: '@mam/plugin-python',
  version: '1.0.0',
  description: 'Python code execution for MAM modules',
  author: 'MAM Team',
  license: 'MIT',
  mamVersion: '>=1.0.0',
  keywords: ['python', 'runtime', 'execution'],
  main: './index.js',
};

const pythonSection: SectionDefinition = {
  name: 'Python',
  description: 'Python code block',
  required: false,
  contentTypes: ['code'],
  validator: (content) => {
    const results = [];
    for (const node of content) {
      if (node.type === 'CodeBlock' && (node as { language: string }).language === 'python') {
        const value = (node as { value: string }).value;
        if (value.trim().length === 0) {
          results.push({ valid: false, message: 'Empty Python code block' });
        }
        if (value.includes('import os') && value.includes('os.system')) {
          results.push({ valid: true, message: 'Warning: Direct OS commands detected' });
        }
      }
    }
    return results;
  },
};

const pythonRule: ValidationRule = {
  name: 'python-syntax',
  description: 'Check Python code blocks for common issues',
  severity: 'warning',
  check: (module) => {
    const results = [];
    for (const section of module.sections) {
      for (const content of section.content) {
        if (content.type === 'CodeBlock' && (content as { language: string }).language === 'python') {
          const lines = (content as { value: string }).value.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (lines[i]!.includes('\t') && lines[i]!.includes('    ')) {
              results.push({ valid: false, message: `Mixed tabs/spaces at line ${i + 1}`, location: content.location?.start });
            }
          }
          const hasImport = lines.some(l => l.trimStart().startsWith('import ') || l.trimStart().startsWith('from '));
          const hasDef = lines.some(l => l.trimStart().startsWith('def '));
          if (hasImport && hasDef && !lines.some(l => l.includes('__name__'))) {
            results.push({ valid: false, message: 'Module has imports+defs but no __main__ guard', location: content.location?.start });
          }
        }
      }
    }
    return results;
  },
};

const pythonContext: RuntimeContext = {
  name: 'python',
  language: 'python',
  canHandle: (lang) => lang === 'python' || lang === 'py',
  execute: async (code: string, ctx: ExecutionContext): Promise<ExecutionResult> => {
    const startTime = performance.now();
    const tmpFile = join(tmpdir(), `mam-${randomBytes(8).toString('hex')}.py`);
    try {
      await writeFile(tmpFile, code, 'utf-8');
      return await new Promise((resolve) => {
        const proc = spawn('python3', [tmpFile], {
          timeout: ctx.timeout || 30000,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        });
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
        proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
        proc.on('close', (code) => {
          resolve({ success: code === 0, output: stdout.trim(), error: stderr || undefined, timeMs: performance.now() - startTime });
        });
        proc.on('error', (err) => {
          resolve({ success: false, error: err.message, timeMs: performance.now() - startTime });
        });
      });
    } finally {
      try { await unlink(tmpFile); } catch { /* ignore */ }
    }
  },
};

const pythonPlugin: MAMPlugin = {
  manifest,
  sections: [pythonSection],
  rules: [pythonRule],
  contexts: [pythonContext],
};
export default pythonPlugin;